import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { Pool, PoolClient } from 'pg';
import type { AuthUser, UserRole } from './types.js';
import { ApiError } from '../http/errors.js';

export async function createAccount(pool: Pool, input: {
  fullName: string; email: string; password: string; phone: string;
  role: Exclude<UserRole, 'admin'>;
  organization?: { name: string; address: string; city: string; locality: string; pincode: string; serviceAreas: { city: string; locality: string; pincode: string }[] };
  volunteerLocation?: { city: string; locality: string; pincode: string };
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertPhoneAvailable(client, input.phone);
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await client.query(
      `INSERT INTO users (full_name, email, password_hash, phone, phone_e164, role)
       VALUES ($1, $2, $3, $4, $4, $5)
       RETURNING id, email, full_name, role`,
      [input.fullName, input.email.toLowerCase(), passwordHash, input.phone, input.role],
    );
    const row = user.rows[0];
    let organization;
    if (input.organization) {
      const organizationType = input.role === 'ngo' ? 'recipient' : 'donor';
      const created = await client.query(
        `INSERT INTO organizations (owner_user_id, name, organization_type, address, city, locality, pincode)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, organization_type, verification_status, address, city, locality, pincode`,
        [row.id, input.organization.name, organizationType, input.organization.address,
          input.organization.city, input.organization.locality, input.organization.pincode],
      );
      organization = created.rows[0];
      for (const area of input.organization.serviceAreas) {
        await client.query(
          'INSERT INTO service_areas (organization_id, city, locality, pincode) VALUES ($1, $2, $3, $4)',
          [organization.id, area.city, area.locality, area.pincode],
        );
      }
    }
    if (input.volunteerLocation) {
      await client.query(
        'INSERT INTO volunteer_profiles (user_id, city, pincode) VALUES ($1, $2, $3)',
        [row.id, input.volunteerLocation.city, input.volunteerLocation.pincode],
      );
    }
    await client.query('COMMIT');
    return { ...row, organization };
  } catch (error) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(error)) {
      if (isConstraint(error, 'users_phone_e164_unique_idx')) throw new ApiError(409, 'PHONE_IN_USE', 'This phone number is already linked to an account.');
      throw new ApiError(409, 'EMAIL_IN_USE', 'An account with this email already exists.');
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function authenticateAccount(pool: Pool, email: string, phone: string, password: string, secret: string) {
  const result = await pool.query(
    `SELECT u.id, u.email, u.phone, u.phone_e164, u.full_name, u.password_hash, u.role,
            o.id AS organization_id, o.name AS organization_name, o.verification_status, o.verification_note
     FROM users u LEFT JOIN organizations o ON o.owner_user_id = u.id
     WHERE LOWER(u.email) = LOWER($1) AND u.is_active = TRUE
     ORDER BY o.created_at DESC LIMIT 1`,
    [email],
  );
  if (!result.rowCount || !(await bcrypt.compare(password, result.rows[0].password_hash))) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }
  const row = result.rows[0];
  if (!row.phone && !row.phone_e164) {
    throw new ApiError(428, 'PHONE_ENROLLMENT_REQUIRED', 'Add a contact phone to this account before signing in.');
  }
  if (!matchesPhone(row.phone_e164, row.phone, phone)) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email, phone number, or password is incorrect.');
  }
  const user: AuthUser = {
    id: row.id, email: row.email, phone: row.phone_e164 ?? row.phone, fullName: row.full_name, role: row.role,
    ...(row.organization_id ? {
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      verificationStatus: row.verification_status,
      verificationNote: row.verification_note,
    } : {}),
  };
  const expiresIn = (process.env.JWT_EXPIRES_IN ?? '8h') as jwt.SignOptions['expiresIn'];
  const token = jwt.sign({ role: user.role }, secret, {
    subject: user.id,
    issuer: 'foodloop-api',
    audience: 'foodloop-web',
    expiresIn,
  });
  return { user, token };
}

export async function enrollLegacyPhone(pool: Pool, input: { email: string; phone: string; password: string }, secret: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT id, phone, phone_e164, password_hash FROM users WHERE LOWER(email) = LOWER($1) AND is_active = TRUE FOR UPDATE',
      [input.email],
    );
    if (!result.rowCount || !(await bcrypt.compare(input.password, result.rows[0].password_hash))) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    const current = result.rows[0];
    if (current.phone || current.phone_e164) throw new ApiError(409, 'PHONE_ALREADY_SET', 'This account already has a phone number. Sign in using that number.');
    await assertPhoneAvailable(client, input.phone);
    await client.query('UPDATE users SET phone = $1, phone_e164 = $1, updated_at = NOW() WHERE id = $2', [input.phone, current.id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (isUniqueViolation(error) && isConstraint(error, 'users_phone_e164_unique_idx')) {
      throw new ApiError(409, 'PHONE_IN_USE', 'This phone number is already linked to an account.');
    }
    throw error;
  } finally { client.release(); }
  return authenticateAccount(pool, input.email, input.phone, input.password, secret);
}

async function assertPhoneAvailable(client: PoolClient, phone: string, excludeUserId?: string) {
  const digits = phone.replace(/\D/g, '');
  const aliases = [digits];
  if (digits.startsWith('91') && digits.length === 12) aliases.push(digits.slice(2));
  const result = await client.query(
    `SELECT 1 FROM users
     WHERE ($3::uuid IS NULL OR id <> $3)
       AND (phone_e164 = $1 OR regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = ANY($2::text[]))
     LIMIT 1`,
    [phone, aliases, excludeUserId ?? null],
  );
  if (result.rowCount) throw new ApiError(409, 'PHONE_IN_USE', 'This phone number is already linked to an account.');
}

function matchesPhone(storedE164: string | null, storedPhone: string | null, suppliedE164: string) {
  if (storedE164) return storedE164 === suppliedE164;
  if (!storedPhone) return false;
  const storedDigits = storedPhone.replace(/\D/g, '');
  const suppliedDigits = suppliedE164.replace(/\D/g, '');
  if (storedDigits === suppliedDigits) return true;
  return suppliedDigits.startsWith('91') && suppliedDigits.length === 12 && storedDigits === suppliedDigits.slice(2);
}

export async function createOrganization(client: PoolClient, user: AuthUser, input: {
  name: string; address: string; city: string; locality: string; pincode: string;
  serviceAreas: { city: string; locality: string; pincode: string }[];
}) {
  if (user.role !== 'donor' && user.role !== 'ngo') throw new ApiError(403, 'FORBIDDEN', 'Only donors and NGOs can register an organization.');
  await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id]);
  const existing = await client.query('SELECT 1 FROM organizations WHERE owner_user_id = $1 LIMIT 1', [user.id]);
  if (existing.rowCount) throw new ApiError(409, 'ORGANIZATION_EXISTS', 'This account already has an organization.');
  const type = user.role === 'ngo' ? 'recipient' : 'donor';
  try {
    const result = await client.query(
      `INSERT INTO organizations (owner_user_id, name, organization_type, address, city, locality, pincode)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, organization_type, verification_status, address, city, locality, pincode, created_at`,
      [user.id, input.name, type, input.address, input.city, input.locality, input.pincode],
    );
    const organization = result.rows[0];
    for (const area of input.serviceAreas) {
      await client.query('INSERT INTO service_areas (organization_id, city, locality, pincode) VALUES ($1, $2, $3, $4)',
        [organization.id, area.city, area.locality, area.pincode]);
    }
    return organization;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ApiError(409, 'ORGANIZATION_EXISTS', 'This account already has an organization.');
    throw error;
  }
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function isConstraint(error: unknown, constraint: string): error is { constraint: string } {
  return typeof error === 'object' && error !== null && 'constraint' in error && error.constraint === constraint;
}
