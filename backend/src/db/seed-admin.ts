import '../config/env.js';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { pool } from './pool.js';

const input = z.object({
  ADMIN_EMAIL: z.string().email().max(254),
  ADMIN_PASSWORD: z.string().min(16).max(128),
  ADMIN_FULL_NAME: z.string().trim().min(2).max(120),
});

try {
  const parsed = input.safeParse(process.env);
  if (!parsed.success) throw new Error('Set ADMIN_EMAIL, ADMIN_PASSWORD (at least 16 characters), and ADMIN_FULL_NAME before seeding.');
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_FULL_NAME } = parsed.data;
  const existing = await pool.query('SELECT role FROM users WHERE LOWER(email) = LOWER($1)', [ADMIN_EMAIL]);
  if (existing.rowCount) throw new Error('That email already has an account. The seed command never promotes or overwrites an existing account.');
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await pool.query(
    `INSERT INTO users (email, password_hash, role, full_name)
     VALUES ($1, $2, 'admin', $3)`,
    [ADMIN_EMAIL.toLowerCase(), passwordHash, ADMIN_FULL_NAME],
  );
  console.info(`Admin account created for ${ADMIN_EMAIL}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Admin seeding failed.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
