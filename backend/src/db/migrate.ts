import '../config/env.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './pool.js';

const migrationPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../database/migrations/001_initial.sql');

try {
  const sql = await readFile(migrationPath, 'utf8');
  await pool.query(sql);
  console.info('Database migrations applied.');
} catch (error) {
  console.error('Database migration failed:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
