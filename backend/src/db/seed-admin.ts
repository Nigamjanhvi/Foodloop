import '../config/env.js';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { phoneSchema } from '../auth/schemas.js';
import { pool } from './pool.js';

const input = z.object({
  ADMIN_EMAIL: z.string().email().max(254),
  ADMIN_PASSWORD: z.string().min(16).max(128),
  ADMIN_FULL_NAME: z.string().trim().min(2).max(120),
  ADMIN_PHONE: phoneSchema,
});

try {
  const parsed = input.safeParse(process.env);
  if (!parsed.success) throw new Error('Set ADMIN_EMAIL, ADMIN_PASSWORD (at least 16 characters), ADMIN_FULL_NAME, and ADMIN_PHONE in E.164 format.');
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_FULL_NAME, ADMIN_PHONE } = parsed.data;
  const existing = await pool.query('SELECT id, role, phone, phone_e164, password_hash FROM users WHERE LOWER(email) = LOWER($1)', [ADMIN_EMAIL]);
  if (existing.rowCount) {
    const row = existing.rows[0];
    if (row.role !== 'admin') throw new Error('That email belongs to a non-admin account. The seed command never promotes accounts.');
    if (row.phone || row.phone_e164) throw new Error('That admin account already has a contact phone. No data was changed.');
    if (!(await bcrypt.compare(ADMIN_PASSWORD, row.password_hash))) throw new Error('The existing admin password did not match. No data was changed.');
    await assertPhoneAvailable(ADMIN_PHONE, row.id);
    await pool.query('UPDATE users SET phone = $1, phone_e164 = $1, updated_at = NOW() WHERE id = $2', [ADMIN_PHONE, row.id]);
    console.info(`Contact phone added to the existing admin account ${ADMIN_EMAIL}.`);
  } else {
    await assertPhoneAvailable(ADMIN_PHONE);
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await pool.query(
      `INSERT INTO users (email, password_hash, role, full_name, phone, phone_e164)
       VALUES ($1, $2, 'admin', $3, $4, $4)`,
      [ADMIN_EMAIL.toLowerCase(), passwordHash, ADMIN_FULL_NAME, ADMIN_PHONE],
    );
    console.info(`Admin account created for ${ADMIN_EMAIL}.`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Admin seeding failed.');
  process.exitCode = 1;
} finally {
  await pool.end();
}

async function assertPhoneAvailable(phone: string, excludeUserId?: string) {
  const digits = phone.replace(/\D/g, '');
  const aliases = [digits];
  if (digits.startsWith('91') && digits.length === 12) aliases.push(digits.slice(2));
  const result = await pool.query(
    `SELECT 1 FROM users WHERE ($3::uuid IS NULL OR id <> $3)
       AND (phone_e164 = $1 OR regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = ANY($2::text[])) LIMIT 1`,
    [phone, aliases, excludeUserId ?? null],
  );
  if (result.rowCount) throw new Error('That phone number is already linked to an account.');
}
