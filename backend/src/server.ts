import './config/env.js';
import { app } from './app.js';
import { pool } from './db/pool.js';

const port = Number(process.env.PORT ?? 4000);
const server = app.listen(port, () => console.info(`FoodLoop API listening on port ${port}`));

const shutdown = () => {
  server.close(() => void pool.end().finally(() => process.exit(0)));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
