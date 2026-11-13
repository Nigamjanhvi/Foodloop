import './config/env.js';
import { createApp } from './app.js';
import { pool } from './db/pool.js';

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || Buffer.byteLength(jwtSecret) < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 bytes. Generate one with: node -e "console.log(require(\'node:crypto\').randomBytes(48).toString(\'base64url\'))"');
}

const app = createApp(pool, jwtSecret);
const port = Number(process.env.PORT ?? 4000);
const server = app.listen(port, () => console.info(`FoodLoop API listening on port ${port}`));

const shutdown = () => {
  server.close(() => void pool.end().finally(() => process.exit(0)));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
