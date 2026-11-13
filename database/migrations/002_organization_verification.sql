ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS verified_by_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_note TEXT;

CREATE INDEX IF NOT EXISTS organizations_verification_idx
  ON organizations (verification_status, created_at DESC);
