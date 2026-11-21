-- Add durable in-app notifications, SSE replay records, and a recoverable mail queue.
-- Existing notification_queue rows and delivery history are preserved.
ALTER TABLE notification_queue
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS recipient_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_payload JSONB,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS notification_queue_idempotency_idx
  ON notification_queue(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS notification_queue_claim_idx
  ON notification_queue(status, next_attempt_at, created_at)
  WHERE status IN ('pending','failed','processing');

CREATE TABLE IF NOT EXISTS in_app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS in_app_notifications_user_history_idx
  ON in_app_notifications(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS in_app_notifications_unread_idx
  ON in_app_notifications(user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS user_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS user_events_replay_idx ON user_events(user_id, id);

CREATE TABLE IF NOT EXISTS notification_worker_state (
  worker_id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL,
  stopped_at TIMESTAMPTZ,
  last_error TEXT,
  jobs_processed BIGINT NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION foodloop_notification_failure_admin_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE admin_user UUID; notification_id UUID; dedupe TEXT;
BEGIN
  IF NEW.status='failed' AND OLD.status IS DISTINCT FROM NEW.status THEN
    dedupe:='notification-failed:'||NEW.id::text;
    FOR admin_user IN SELECT id FROM users WHERE role='admin' AND is_active=TRUE LOOP
      INSERT INTO in_app_notifications(user_id,event_type,title,message,resource_type,resource_id,metadata,idempotency_key)
      VALUES(admin_user,'notification.failed','Email delivery stopped after retries',
        'An outbound email could not be delivered after its retry limit. Inspect the notification monitor.',
        'notification_job',NEW.id,jsonb_build_object('event_type',NEW.event_type,'attempts',NEW.attempts),dedupe)
      ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING id INTO notification_id;
      IF notification_id IS NOT NULL THEN
        INSERT INTO user_events(user_id,event_type,resource_type,resource_id,payload,idempotency_key)
        VALUES(admin_user,'notification.failed','notification_job',NEW.id,
          jsonb_build_object('notification_id',notification_id,'event_type',NEW.event_type,'attempts',NEW.attempts),
          'notification-failure-event:'||NEW.id::text||':'||admin_user::text)
        ON CONFLICT(user_id,idempotency_key) DO NOTHING;
      END IF;
      notification_id:=NULL;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notification_failure_admin_event ON notification_queue;
CREATE TRIGGER notification_failure_admin_event AFTER UPDATE OF status ON notification_queue
FOR EACH ROW EXECUTE FUNCTION foodloop_notification_failure_admin_event();

CREATE OR REPLACE FUNCTION foodloop_new_user_admin_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE admin_user UUID; notification_id UUID;
BEGIN
  FOR admin_user IN SELECT id FROM users WHERE role='admin' AND is_active=TRUE LOOP
    INSERT INTO in_app_notifications(user_id,event_type,title,message,resource_type,resource_id,metadata,idempotency_key)
    VALUES(admin_user,'user.registered','New FoodLoop account',NEW.full_name||' registered as '||NEW.role||'.',
      'user',NEW.id,jsonb_build_object('role',NEW.role),'user-registered:'||NEW.id::text)
    ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING id INTO notification_id;
    IF notification_id IS NOT NULL THEN
      INSERT INTO user_events(user_id,event_type,resource_type,resource_id,payload,idempotency_key)
      VALUES(admin_user,'user.registered','user',NEW.id,jsonb_build_object('notification_id',notification_id,'role',NEW.role),
        'user-registered-event:'||NEW.id::text||':'||admin_user::text)
      ON CONFLICT(user_id,idempotency_key) DO NOTHING;
    END IF;
    notification_id:=NULL;
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_phase5_admin_events ON users;
CREATE TRIGGER users_phase5_admin_events AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION foodloop_new_user_admin_event();

CREATE OR REPLACE FUNCTION foodloop_emit_notice(
  p_user_id UUID, p_event_type TEXT, p_title TEXT, p_message TEXT,
  p_resource_type TEXT, p_resource_id UUID, p_metadata JSONB,
  p_idempotency_key TEXT, p_email_subject TEXT DEFAULT NULL, p_email_body TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_notification_id UUID;
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  INSERT INTO in_app_notifications(user_id,event_type,title,message,resource_type,resource_id,metadata,idempotency_key)
  VALUES(p_user_id,p_event_type,p_title,p_message,p_resource_type,p_resource_id,COALESCE(p_metadata,'{}'::jsonb),p_idempotency_key)
  ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING id INTO v_notification_id;
  IF v_notification_id IS NULL THEN RETURN; END IF;
  INSERT INTO user_events(user_id,event_type,resource_type,resource_id,payload,idempotency_key)
  VALUES(p_user_id,p_event_type,p_resource_type,p_resource_id,
    jsonb_build_object('notification_id',v_notification_id,'title',p_title,'message',p_message,'metadata',COALESCE(p_metadata,'{}'::jsonb)),
    'notification:'||v_notification_id::text)
  ON CONFLICT(user_id,idempotency_key) DO NOTHING;
  IF p_email_subject IS NOT NULL AND p_email_body IS NOT NULL THEN
    INSERT INTO notification_queue(recipient_email,recipient_user_id,event_type,subject,body,status,attempts,max_attempts,next_attempt_at,updated_at,idempotency_key)
    SELECT u.email,p_user_id,p_event_type,p_email_subject,p_email_body,'pending',0,8,NOW(),NOW(),'email:'||p_idempotency_key
    FROM users u WHERE u.id=p_user_id AND u.is_active=TRUE
    ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION foodloop_donation_events() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE recipient RECORD; donor_user UUID; base_event TEXT;
BEGIN
  SELECT owner_user_id INTO donor_user FROM organizations WHERE id=NEW.donor_organization_id;
  IF TG_OP='INSERT' THEN
    FOR recipient IN
      SELECT DISTINCT o.owner_user_id, o.id, o.name FROM organizations o JOIN users u ON u.id=o.owner_user_id
      WHERE o.organization_type='recipient' AND o.verification_status='verified' AND u.is_active=TRUE
        AND ((lower(o.city)=lower(NEW.city) AND lower(o.locality)=lower(NEW.locality) AND o.pincode=NEW.pincode)
          OR EXISTS(SELECT 1 FROM service_areas sa WHERE sa.organization_id=o.id AND lower(sa.city)=lower(NEW.city)
            AND (sa.locality IS NULL OR lower(sa.locality)=lower(NEW.locality)) AND (sa.pincode IS NULL OR sa.pincode=NEW.pincode))
          OR (lower(o.city)=lower(NEW.city) AND NOT EXISTS(SELECT 1 FROM service_areas sa WHERE sa.organization_id=o.id)))
    LOOP
      PERFORM foodloop_emit_notice(recipient.owner_user_id,'donation.created','New food nearby',
        NEW.food_name||' is available in '||NEW.locality||'.','donation',NEW.id,
        jsonb_build_object('food_name',NEW.food_name,'city',NEW.city,'locality',NEW.locality),
        'donation-created:'||NEW.id||':'||recipient.id,'New FoodLoop donation: '||NEW.food_name,
        'A verified donor listed '||NEW.food_name||' in '||NEW.locality||', '||NEW.city||'. Sign in to review availability.');
    END LOOP;
    RETURN NEW;
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('cancelled','expired') THEN
    base_event:=CASE NEW.status WHEN 'cancelled' THEN 'donation.cancelled' ELSE 'donation.expired' END;
    PERFORM foodloop_emit_notice(donor_user,base_event,'Donation '||NEW.status,
      NEW.food_name||' was '||NEW.status||'.','donation',NEW.id,
      jsonb_build_object('food_name',NEW.food_name,'status',NEW.status),base_event||':'||NEW.id,
      'FoodLoop donation '||NEW.status,NEW.food_name||' was '||NEW.status||'.');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS donations_phase5_events ON donations;
CREATE TRIGGER donations_phase5_events AFTER INSERT OR UPDATE OF status ON donations
FOR EACH ROW EXECUTE FUNCTION foodloop_donation_events();

CREATE OR REPLACE FUNCTION foodloop_reservation_events() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE donor_user UUID; recipient_user UUID; food TEXT; event_name TEXT; title_text TEXT; msg TEXT; target UUID; idem TEXT;
BEGIN
  SELECT d.food_name,donor_org.owner_user_id,ro.owner_user_id INTO food,donor_user,recipient_user
  FROM donations d JOIN organizations donor_org ON donor_org.id=d.donor_organization_id
  JOIN organizations ro ON ro.id=NEW.recipient_organization_id WHERE d.id=NEW.donation_id;
  IF TG_OP='INSERT' THEN
    PERFORM foodloop_emit_notice(donor_user,'reservation.requested','New reservation request',
      'An organization requested '||NEW.quantity||' units of '||food||'.','reservation',NEW.id,
      jsonb_build_object('food_name',food,'quantity',NEW.quantity),'reservation-request:'||NEW.id,
      'New reservation request for '||food,'A recipient organization requested '||NEW.quantity||' units of '||food||'.');
    PERFORM foodloop_emit_notice(recipient_user,'reservation.created','Reservation submitted',
      'Your request for '||food||' was sent to the donor.','reservation',NEW.id,
      jsonb_build_object('food_name',food,'status',NEW.status),'reservation-created:'||NEW.id,
      'FoodLoop reservation submitted','Your request for '||food||' has been submitted.');
    RETURN NEW;
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    event_name:='reservation.'||NEW.status;
    title_text:=CASE NEW.status WHEN 'accepted' THEN 'Reservation accepted' WHEN 'approved' THEN 'Reservation accepted'
      WHEN 'rejected' THEN 'Reservation declined' WHEN 'cancelled' THEN 'Reservation cancelled'
      WHEN 'picked_up' THEN 'Food picked up' WHEN 'delivered' THEN 'Food delivered' WHEN 'expired' THEN 'Reservation expired' ELSE 'Reservation updated' END;
    msg:=food||' reservation is now '||NEW.status||'.';
    idem:='reservation-status:'||NEW.id||':'||NEW.status||':'||NEW.updated_at::text;
    target:=CASE WHEN NEW.status IN ('accepted','approved','rejected','picked_up','delivered','expired') THEN recipient_user ELSE donor_user END;
    PERFORM foodloop_emit_notice(target,event_name,title_text,msg,'reservation',NEW.id,
      jsonb_build_object('food_name',food,'status',NEW.status),idem,'FoodLoop: '||title_text,msg);
    IF target IS DISTINCT FROM donor_user THEN
      PERFORM foodloop_emit_notice(donor_user,event_name,title_text,msg,'reservation',NEW.id,
        jsonb_build_object('food_name',food,'status',NEW.status),idem||':donor','FoodLoop: '||title_text,msg);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reservations_phase5_events ON reservations;
CREATE TRIGGER reservations_phase5_events AFTER INSERT OR UPDATE OF status ON reservations
FOR EACH ROW EXECUTE FUNCTION foodloop_reservation_events();

CREATE OR REPLACE FUNCTION foodloop_assignment_events() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE donor_user UUID; recipient_user UUID; volunteer_email_user UUID; food TEXT; target UUID; event_name TEXT; title_text TEXT; msg TEXT; idem TEXT;
BEGIN
  SELECT d.food_name,donor_org.owner_user_id,ro.owner_user_id INTO food,donor_user,recipient_user
  FROM reservations r JOIN donations d ON d.id=r.donation_id JOIN organizations donor_org ON donor_org.id=d.donor_organization_id
  JOIN organizations ro ON ro.id=r.recipient_organization_id WHERE r.id=NEW.reservation_id;
  IF TG_OP='INSERT' THEN
    FOR volunteer_email_user IN SELECT DISTINCT p.user_id FROM volunteer_profiles p JOIN users u ON u.id=p.user_id
      JOIN reservations r ON r.id=NEW.reservation_id JOIN donations d ON d.id=r.donation_id
      WHERE p.is_available=TRUE AND u.is_active=TRUE AND lower(p.city)=lower(d.city)
        AND (p.pincode=d.pincode OR lower(p.locality)=lower(d.locality))
    LOOP
      PERFORM foodloop_emit_notice(volunteer_email_user,'assignment.offered','Local pickup task available',
        'A verified NGO requested help transporting '||food||'.','assignment',NEW.id,
        jsonb_build_object('food_name',food),'assignment-offered:'||NEW.id||':'||volunteer_email_user,
        'FoodLoop pickup task available','A local organization needs help transporting '||food||'. Sign in to review the task.');
    END LOOP;
    RETURN NEW;
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    event_name:='assignment.'||NEW.status;
    title_text:=CASE NEW.status WHEN 'accepted' THEN 'Volunteer accepted the task' WHEN 'rejected' THEN 'Volunteer declined the task'
      WHEN 'cancelled' THEN 'Volunteer request cancelled' WHEN 'picked_up' THEN 'Pickup confirmed'
      WHEN 'delivered' THEN 'Delivery confirmed' ELSE 'Volunteer task updated' END;
    msg:=title_text||' for '||food||'.';
    idem:='assignment-status:'||NEW.id||':'||NEW.status||':'||NEW.updated_at::text;
    target:=CASE WHEN NEW.volunteer_user_id IS NOT NULL THEN NEW.volunteer_user_id ELSE recipient_user END;
    PERFORM foodloop_emit_notice(target,event_name,title_text,msg,'assignment',NEW.id,jsonb_build_object('food_name',food,'status',NEW.status,'reservation_id',NEW.reservation_id),idem,'FoodLoop: '||title_text,msg);
    PERFORM foodloop_emit_notice(recipient_user,event_name,title_text,msg,'assignment',NEW.id,jsonb_build_object('food_name',food,'status',NEW.status,'reservation_id',NEW.reservation_id),idem||':ngo','FoodLoop: '||title_text,msg);
    PERFORM foodloop_emit_notice(donor_user,event_name,title_text,msg,'assignment',NEW.id,jsonb_build_object('food_name',food,'status',NEW.status,'reservation_id',NEW.reservation_id),idem||':donor','FoodLoop: '||title_text,msg);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS assignments_phase5_events ON reservation_assignments;
CREATE TRIGGER assignments_phase5_events AFTER INSERT OR UPDATE OF status ON reservation_assignments
FOR EACH ROW EXECUTE FUNCTION foodloop_assignment_events();


CREATE OR REPLACE FUNCTION foodloop_organization_review_events() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE owner_id UUID; event_name TEXT;
BEGIN
  IF OLD.verification_status IS DISTINCT FROM NEW.verification_status THEN
    SELECT owner_user_id INTO owner_id FROM organizations WHERE id=NEW.id;
    event_name:='organization.'||NEW.verification_status;
    PERFORM foodloop_emit_notice(owner_id,event_name,'Organization review updated',
      'Your organization is now '||NEW.verification_status||'.','organization',NEW.id,
      jsonb_build_object('status',NEW.verification_status,'note',NEW.verification_note),
      event_name||':'||NEW.id||':'||NEW.verified_at::text,'FoodLoop organization review',
      'Your organization '||NEW.name||' is now '||NEW.verification_status||'.');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS organizations_phase5_events ON organizations;
CREATE TRIGGER organizations_phase5_events AFTER UPDATE OF verification_status ON organizations
FOR EACH ROW EXECUTE FUNCTION foodloop_organization_review_events();

