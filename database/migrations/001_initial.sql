CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('donor', 'ngo', 'volunteer', 'admin')),
  full_name TEXT NOT NULL,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  organization_type TEXT NOT NULL CHECK (organization_type IN ('donor', 'recipient')),
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  locality TEXT NOT NULL,
  pincode VARCHAR(10) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  city TEXT NOT NULL,
  locality TEXT,
  pincode VARCHAR(10),
  CHECK (locality IS NOT NULL OR pincode IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS donations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_organization_id UUID NOT NULL REFERENCES organizations(id),
  food_name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  quantity_total NUMERIC(10,2) NOT NULL CHECK (quantity_total > 0),
  quantity_remaining NUMERIC(10,2) NOT NULL CHECK (quantity_remaining >= 0),
  unit TEXT NOT NULL CHECK (unit IN ('meals', 'packets', 'kilograms')),
  prepared_at TIMESTAMPTZ NOT NULL,
  handling_info TEXT NOT NULL,
  pickup_address TEXT NOT NULL,
  city TEXT NOT NULL,
  locality TEXT NOT NULL,
  pincode VARCHAR(10) NOT NULL,
  collection_deadline TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'completed', 'expired', 'cancelled')),
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (quantity_remaining <= quantity_total)
);

CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id UUID NOT NULL REFERENCES donations(id),
  recipient_organization_id UUID NOT NULL REFERENCES organizations(id),
  quantity NUMERIC(10,2) NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'picked_up', 'delivered')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (donation_id, recipient_organization_id)
);

CREATE TABLE IF NOT EXISTS volunteer_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  city TEXT NOT NULL,
  pincode VARCHAR(10) NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS reservation_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL UNIQUE REFERENCES reservations(id),
  volunteer_user_id UUID NOT NULL REFERENCES users(id),
  pickup_otp_hash TEXT NOT NULL,
  delivery_otp_hash TEXT NOT NULL,
  pickup_verified_at TIMESTAMPTZ,
  delivery_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS donations_location_idx ON donations (city, locality, pincode, status);
CREATE INDEX IF NOT EXISTS donations_deadline_idx ON donations (collection_deadline) WHERE status = 'available';
CREATE INDEX IF NOT EXISTS reservations_recipient_idx ON reservations (recipient_organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notification_pending_idx ON notification_queue (next_attempt_at) WHERE status IN ('pending', 'failed');
