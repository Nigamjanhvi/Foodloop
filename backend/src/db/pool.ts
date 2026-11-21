import '../config/env.js';
import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is missing. Create a project-root .env file from .env.example.');
}

export const pool = new Pool({
  connectionString: databaseUrl,
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// PostgreSQL can close idle connections during a restart or maintenance event.
// node-postgres removes that client from the pool, but the Pool's error event
// must be handled or Node treats the event as unhandled and terminates the API.
pool.on('error', (error) => {
  console.error(JSON.stringify({
    event: 'database.pool.idle_client_error',
    code: 'code' in error ? error.code : undefined,
    message: error.message,
  }));
});
