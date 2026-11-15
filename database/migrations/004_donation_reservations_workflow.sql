-- Extend the existing donation tables in place. Existing donations retain
-- their values; reserved quantity is derived from the original total/remaining
-- fields so historical quantities are not rewritten.
ALTER TABLE donations
  ADD COLUMN IF NOT EXISTS quantity_reserved NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS storage_type TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE donations
SET quantity_reserved = quantity_total - quantity_remaining
WHERE quantity_reserved = 0 AND quantity_total > quantity_remaining;

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS status_reason TEXT;

ALTER TABLE donations DROP CONSTRAINT IF EXISTS donations_status_check;
ALTER TABLE donations DROP CONSTRAINT IF EXISTS donations_unit_check;
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_donation_id_recipient_organization_id_key;

DO $$ BEGIN
  ALTER TABLE donations ADD CONSTRAINT donations_workflow_status_check
    CHECK (status IN ('available', 'partially_reserved', 'fully_reserved', 'expired', 'cancelled', 'reserved', 'completed')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE donations ADD CONSTRAINT donations_workflow_unit_check
    CHECK (unit IN ('meals', 'packets', 'kilograms', 'litres', 'boxes', 'other')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE donations ADD CONSTRAINT donations_workflow_category_check
    CHECK (category IN ('cooked_meals', 'rice_grains', 'fruits', 'vegetables', 'bakery', 'packaged_food', 'other')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE donations ADD CONSTRAINT donations_storage_type_check
    CHECK (storage_type IN ('ambient', 'refrigerated', 'frozen', 'hot', 'other')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE donations ADD CONSTRAINT donations_reserved_quantity_check
    CHECK (quantity_reserved >= 0 AND quantity_reserved <= quantity_total
      AND quantity_remaining >= 0 AND quantity_remaining + quantity_reserved = quantity_total) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE reservations ADD CONSTRAINT reservations_workflow_status_check
    CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled', 'expired', 'approved', 'picked_up', 'delivered')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS donations_owner_created_idx ON donations (donor_organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS donations_workflow_discovery_idx ON donations (status, collection_deadline, city, pincode, locality);
CREATE INDEX IF NOT EXISTS reservations_donor_queue_idx ON reservations (donation_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS reservations_recipient_status_idx ON reservations (recipient_organization_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS reservations_one_active_request_idx
  ON reservations (donation_id, recipient_organization_id)
  WHERE status IN ('pending', 'accepted', 'approved', 'picked_up');
