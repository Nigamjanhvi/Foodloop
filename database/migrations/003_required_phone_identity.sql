-- Add canonical phone identity for new accounts while retaining existing
-- phone values and legacy rows with no phone so old records are not rewritten.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_e164 TEXT;

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_phone_e164_format_check
    CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_e164_unique_idx
  ON users (phone_e164) WHERE phone_e164 IS NOT NULL;

-- Existing emails have no case-insensitive duplicates, checked before this
-- additive index was introduced.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique_idx
  ON users (lower(email));
