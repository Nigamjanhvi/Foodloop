import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import { pool } from './db/pool.js';

export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_request, response) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', service: 'foodloop-api', database: 'connected', timestamp: new Date().toISOString() });
  } catch {
    response.status(503).json({ status: 'error', service: 'foodloop-api', database: 'unavailable' });
  }
});

app.get('/api/v1', (_request, response) => response.json({ name: 'FoodLoop API', version: 'v1' }));

app.use((_error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  response.status(500).json({ error: 'Internal server error' });
});

export const schemas = { health: z.object({ status: z.string() }) };
