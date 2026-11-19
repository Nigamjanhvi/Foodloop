-- Extend the existing volunteer and assignment records in place.
-- No existing accounts, reservations, assignments, or OTP hashes are deleted.
ALTER TABLE volunteer_profiles
  ADD COLUMN IF NOT EXISTS locality TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE donations
  ADD COLUMN IF NOT EXISTS quantity_delivered NUMERIC(10,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE donations ADD CONSTRAINT donations_delivered_quantity_check
    CHECK (quantity_delivered >= 0 AND quantity_delivered <= quantity_total) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

UPDATE donations d SET quantity_delivered=COALESCE((
  SELECT sum(r.quantity)::numeric(10,2) FROM reservations r WHERE r.donation_id=d.id AND r.status='delivered'
),0);

ALTER TABLE reservation_assignments
  ALTER COLUMN volunteer_user_id DROP NOT NULL,
  ALTER COLUMN pickup_otp_hash DROP NOT NULL,
  ALTER COLUMN delivery_otp_hash DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'accepted',
  ADD COLUMN IF NOT EXISTS offered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS pickup_otp_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_otp_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_attempt_count INTEGER NOT NULL DEFAULT 0;

UPDATE reservation_assignments
SET status = CASE
    WHEN delivery_verified_at IS NOT NULL THEN 'delivered'
    WHEN pickup_verified_at IS NOT NULL THEN 'picked_up'
    ELSE 'accepted'
  END,
  accepted_at = COALESCE(accepted_at, created_at),
  updated_at = COALESCE(updated_at, created_at);

ALTER TABLE reservation_assignments DROP CONSTRAINT IF EXISTS reservation_assignments_reservation_id_key;
DO $$ BEGIN
  ALTER TABLE reservation_assignments ADD CONSTRAINT reservation_assignments_status_check
    CHECK (status IN ('pending', 'offered', 'accepted', 'rejected', 'cancelled', 'picked_up', 'delivered')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE reservation_assignments ADD CONSTRAINT reservation_assignments_attempts_check
    CHECK (pickup_attempt_count >= 0 AND delivery_attempt_count >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS reservation_assignments_one_active_reservation_idx
  ON reservation_assignments (reservation_id)
  WHERE status IN ('pending', 'offered', 'accepted', 'picked_up');
CREATE UNIQUE INDEX IF NOT EXISTS reservation_assignments_one_active_volunteer_idx
  ON reservation_assignments (volunteer_user_id)
  WHERE volunteer_user_id IS NOT NULL AND status IN ('accepted', 'picked_up');
CREATE INDEX IF NOT EXISTS reservation_assignments_volunteer_history_idx
  ON reservation_assignments (volunteer_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS volunteer_profiles_service_area_idx
  ON volunteer_profiles (city, pincode, locality) WHERE is_available = TRUE;

-- A volunteer rejection is scoped to that volunteer. The offer remains open
-- to other eligible volunteers and a rejection survives subsequent reads.
CREATE TABLE IF NOT EXISTS assignment_rejections (
  assignment_id UUID NOT NULL REFERENCES reservation_assignments(id) ON DELETE CASCADE,
  volunteer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (assignment_id, volunteer_user_id)
);
