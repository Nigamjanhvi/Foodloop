-- Deliver business activity to authenticated administrators without placing
-- administrator-only events in a global broadcast channel.
CREATE OR REPLACE FUNCTION foodloop_emit_admin_event(
  p_event_type TEXT,p_title TEXT,p_message TEXT,p_resource_type TEXT,p_resource_id UUID,
  p_metadata JSONB,p_idempotency_key TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE admin_user UUID; notification_id UUID;
BEGIN
  FOR admin_user IN SELECT id FROM users WHERE role='admin' AND is_active=TRUE LOOP
    INSERT INTO in_app_notifications(user_id,event_type,title,message,resource_type,resource_id,metadata,idempotency_key)
    VALUES(admin_user,p_event_type,p_title,p_message,p_resource_type,p_resource_id,COALESCE(p_metadata,'{}'::jsonb),p_idempotency_key)
    ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING id INTO notification_id;
    IF notification_id IS NOT NULL THEN
      INSERT INTO user_events(user_id,event_type,resource_type,resource_id,payload,idempotency_key)
      VALUES(admin_user,p_event_type,p_resource_type,p_resource_id,
        jsonb_build_object('notification_id',notification_id,'title',p_title,'message',p_message,'metadata',COALESCE(p_metadata,'{}'::jsonb)),
        'admin-event:'||p_idempotency_key||':'||admin_user::text)
      ON CONFLICT(user_id,idempotency_key) DO NOTHING;
    END IF;
    notification_id:=NULL;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION foodloop_admin_donation_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_name TEXT; title_text TEXT; message_text TEXT; dedupe TEXT;
BEGIN
  IF TG_OP='INSERT' THEN
    event_name:='donation.created';title_text:='New donation listed';message_text:=NEW.food_name||' was listed in '||NEW.locality||'.';
    dedupe:='admin-donation-created:'||NEW.id;
  ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('cancelled','expired') THEN
    event_name:='donation.'||NEW.status;title_text:='Donation '||NEW.status;message_text:=NEW.food_name||' was '||NEW.status||'.';
    dedupe:='admin-donation-status:'||NEW.id||':'||NEW.status;
  ELSE RETURN NEW;
  END IF;
  PERFORM foodloop_emit_admin_event(event_name,title_text,message_text,'donation',NEW.id,
    jsonb_build_object('status',NEW.status,'city',NEW.city,'locality',NEW.locality),dedupe);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS donations_admin_business_events ON donations;
CREATE TRIGGER donations_admin_business_events AFTER INSERT OR UPDATE OF status ON donations
FOR EACH ROW EXECUTE FUNCTION foodloop_admin_donation_event();

CREATE OR REPLACE FUNCTION foodloop_admin_reservation_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE food TEXT; event_name TEXT; title_text TEXT; message_text TEXT; dedupe TEXT;
BEGIN
  SELECT food_name INTO food FROM donations WHERE id=NEW.donation_id;
  IF TG_OP='INSERT' THEN
    event_name:='reservation.created';title_text:='New reservation';message_text:=food||' has a new reservation request.';
    dedupe:='admin-reservation-created:'||NEW.id;
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    event_name:='reservation.'||NEW.status;
    title_text:=CASE NEW.status WHEN 'accepted' THEN 'Reservation accepted' WHEN 'approved' THEN 'Reservation accepted'
      WHEN 'rejected' THEN 'Reservation declined' WHEN 'cancelled' THEN 'Reservation cancelled'
      WHEN 'picked_up' THEN 'Food picked up' WHEN 'delivered' THEN 'Food delivered' WHEN 'expired' THEN 'Reservation expired' ELSE 'Reservation updated' END;
    message_text:=food||' reservation is now '||NEW.status||'.';
    dedupe:='admin-reservation-status:'||NEW.id||':'||NEW.status||':'||NEW.updated_at::text;
  ELSE RETURN NEW;
  END IF;
  PERFORM foodloop_emit_admin_event(event_name,title_text,message_text,'reservation',NEW.id,
    jsonb_build_object('food_name',food,'status',NEW.status),'admin-'||dedupe);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS reservations_admin_business_events ON reservations;
CREATE TRIGGER reservations_admin_business_events AFTER INSERT OR UPDATE OF status ON reservations
FOR EACH ROW EXECUTE FUNCTION foodloop_admin_reservation_event();

CREATE OR REPLACE FUNCTION foodloop_admin_assignment_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE food TEXT; event_name TEXT; title_text TEXT; message_text TEXT; dedupe TEXT;
BEGIN
  SELECT d.food_name INTO food FROM reservations r JOIN donations d ON d.id=r.donation_id WHERE r.id=NEW.reservation_id;
  IF TG_OP='INSERT' THEN
    event_name:='assignment.offered';title_text:='Volunteer assistance requested';message_text:='Volunteer assistance was requested for '||food||'.';
    dedupe:='admin-assignment-offered:'||NEW.id;
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    event_name:='assignment.'||NEW.status;
    title_text:=CASE NEW.status WHEN 'accepted' THEN 'Volunteer accepted the task' WHEN 'cancelled' THEN 'Volunteer request cancelled'
      WHEN 'picked_up' THEN 'Pickup confirmed' WHEN 'delivered' THEN 'Delivery confirmed' ELSE 'Volunteer task updated' END;
    message_text:=title_text||' for '||food||'.';dedupe:='admin-assignment-status:'||NEW.id||':'||NEW.status||':'||NEW.updated_at::text;
  ELSE RETURN NEW;
  END IF;
  PERFORM foodloop_emit_admin_event(event_name,title_text,message_text,'assignment',NEW.id,
    jsonb_build_object('food_name',food,'status',NEW.status,'reservation_id',NEW.reservation_id),dedupe);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS assignments_admin_business_events ON reservation_assignments;
CREATE TRIGGER assignments_admin_business_events AFTER INSERT OR UPDATE OF status ON reservation_assignments
FOR EACH ROW EXECUTE FUNCTION foodloop_admin_assignment_event();

CREATE OR REPLACE FUNCTION foodloop_admin_review_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.verification_status IS DISTINCT FROM NEW.verification_status THEN
    PERFORM foodloop_emit_admin_event('organization.'||NEW.verification_status,'Organization review updated',
      NEW.name||' was marked '||NEW.verification_status||'.','organization',NEW.id,
      jsonb_build_object('status',NEW.verification_status,'note',NEW.verification_note),
      'admin-organization-review:'||NEW.id||':'||NEW.verification_status||':'||COALESCE(NEW.verified_at::text,'unknown'));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS organizations_admin_business_events ON organizations;
CREATE TRIGGER organizations_admin_business_events AFTER UPDATE OF verification_status ON organizations
FOR EACH ROW EXECUTE FUNCTION foodloop_admin_review_event();

CREATE OR REPLACE FUNCTION foodloop_worker_state_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE worker_status TEXT;status_time TIMESTAMPTZ;
BEGIN
  IF TG_OP='INSERT' THEN worker_status:='started';status_time:=NEW.started_at;
  ELSIF OLD.stopped_at IS DISTINCT FROM NEW.stopped_at THEN
    worker_status:=CASE WHEN NEW.stopped_at IS NULL THEN 'started' ELSE 'stopped' END;
    status_time:=COALESCE(NEW.stopped_at,NEW.heartbeat_at);
  ELSE RETURN NEW;
  END IF;
  PERFORM foodloop_emit_admin_event('notification.worker.'||worker_status,'Notification worker '||worker_status,
    'The email worker '||worker_status||' ('||NEW.worker_id||').',NULL,NULL,
    jsonb_build_object('worker_id',NEW.worker_id,'status',worker_status,'heartbeat_at',NEW.heartbeat_at),
    'admin-worker-state:'||NEW.worker_id||':'||worker_status||':'||status_time::text);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notification_worker_state_events ON notification_worker_state;
CREATE TRIGGER notification_worker_state_events AFTER INSERT OR UPDATE OF stopped_at ON notification_worker_state
FOR EACH ROW EXECUTE FUNCTION foodloop_worker_state_event();

CREATE OR REPLACE FUNCTION foodloop_worker_error_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.last_error IS NOT NULL AND OLD.last_error IS DISTINCT FROM NEW.last_error THEN
    PERFORM foodloop_emit_admin_event('notification.worker.error','Notification worker error',
      'The email worker reported an operational error. Inspect the worker record and application logs.',NULL,NULL,
      jsonb_build_object('worker_id',NEW.worker_id,'error',left(NEW.last_error,500),'heartbeat_at',NEW.heartbeat_at),
      'admin-worker-error:'||NEW.worker_id||':'||NEW.heartbeat_at::text);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS notification_worker_error_events ON notification_worker_state;
CREATE TRIGGER notification_worker_error_events AFTER UPDATE OF last_error ON notification_worker_state
FOR EACH ROW EXECUTE FUNCTION foodloop_worker_error_event();

CREATE OR REPLACE FUNCTION foodloop_assignment_declined_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE donor_user UUID;recipient_user UUID;food TEXT;title_text TEXT;msg TEXT;
BEGIN
  SELECT d.food_name,donor.owner_user_id,recipient.owner_user_id INTO food,donor_user,recipient_user
  FROM reservation_assignments a JOIN reservations r ON r.id=a.reservation_id JOIN donations d ON d.id=r.donation_id
  JOIN organizations donor ON donor.id=d.donor_organization_id JOIN organizations recipient ON recipient.id=r.recipient_organization_id
  WHERE a.id=NEW.assignment_id;
  title_text:='Volunteer declined the task';
  msg:='A local volunteer declined the offer for '||food||'. The offer remains open to other eligible volunteers.';
  PERFORM foodloop_emit_notice(recipient_user,'assignment.rejected',title_text,msg,'assignment',NEW.assignment_id,
    jsonb_build_object('food_name',food),'assignment-declined:'||NEW.assignment_id||':'||NEW.volunteer_user_id,'FoodLoop: '||title_text,msg);
  PERFORM foodloop_emit_notice(donor_user,'assignment.rejected',title_text,msg,'assignment',NEW.assignment_id,
    jsonb_build_object('food_name',food),'assignment-declined-donor:'||NEW.assignment_id||':'||NEW.volunteer_user_id,'FoodLoop: '||title_text,msg);
  PERFORM foodloop_emit_admin_event('assignment.rejected',title_text,msg,'assignment',NEW.assignment_id,
    jsonb_build_object('volunteer_user_id',NEW.volunteer_user_id),'admin-assignment-declined:'||NEW.assignment_id||':'||NEW.volunteer_user_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS assignment_declined_event ON assignment_rejections;
CREATE TRIGGER assignment_declined_event AFTER INSERT ON assignment_rejections
FOR EACH ROW EXECUTE FUNCTION foodloop_assignment_declined_event();
