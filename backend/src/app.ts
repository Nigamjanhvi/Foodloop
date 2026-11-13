import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import { createAuthenticate, requireRoles } from './auth/middleware.js';
import { loginSchema, organizationInputSchema, registerSchema, verificationSchema, verificationStatusSchema } from './auth/schemas.js';
import { authenticateAccount, createAccount, createOrganization } from './auth/service.js';
import { ApiError } from './http/errors.js';

export function createApp(pool: Pool, jwtSecret: string) {
  const app = express();
  const authenticate = createAuthenticate(pool, jwtSecret);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? 'http://localhost:5173' }));
  app.use(express.json({ limit: '1mb' }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts. Try again later.' } },
  });

  app.get('/api/health', async (_request, response) => {
    try {
      await pool.query('SELECT 1');
      response.json({ data: { status: 'ok', service: 'foodloop-api', database: 'connected', timestamp: new Date().toISOString() } });
    } catch {
      response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'The API is running, but PostgreSQL is unavailable.' } });
    }
  });
  app.get('/api/v1', (_request, response) => response.json({ data: { name: 'FoodLoop API', version: 'v1' } }));

  app.post('/api/v1/auth/register', authLimiter, async (request, response, next) => {
    try {
      const input = registerSchema.parse(request.body);
      await createAccount(pool, input);
      const session = await authenticateAccount(pool, input.email, input.password, jwtSecret);
      response.status(201).json({ data: session });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/auth/login', authLimiter, async (request, response, next) => {
    try {
      const input = loginSchema.parse(request.body);
      response.json({ data: await authenticateAccount(pool, input.email, input.password, jwtSecret) });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/auth/me', authenticate, (request, response) => {
    response.json({ data: { user: request.auth } });
  });

  app.post('/api/v1/organizations', authenticate, requireRoles('donor', 'ngo'), async (request, response, next) => {
    const client = await pool.connect();
    try {
      const input = organizationInputSchema.parse(request.body);
      await client.query('BEGIN');
      const organization = await createOrganization(client, request.auth!, input);
      await client.query('COMMIT');
      response.status(201).json({ data: { organization } });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      next(error);
    } finally { client.release(); }
  });

  app.get('/api/v1/organizations/me', authenticate, requireRoles('donor', 'ngo'), async (request, response, next) => {
    try {
      const result = await pool.query(
        `SELECT o.id, o.name, o.organization_type, o.verification_status, o.verification_note,
                o.verified_at, o.address, o.city, o.locality, o.pincode, o.created_at,
                COALESCE(json_agg(json_build_object('city', sa.city, 'locality', sa.locality, 'pincode', sa.pincode))
                  FILTER (WHERE sa.id IS NOT NULL), '[]') AS service_areas
         FROM organizations o LEFT JOIN service_areas sa ON sa.organization_id = o.id
         WHERE o.owner_user_id = $1 GROUP BY o.id ORDER BY o.created_at DESC LIMIT 1`,
        [request.auth!.id],
      );
      if (!result.rowCount) throw new ApiError(404, 'ORGANIZATION_NOT_FOUND', 'No organization is registered for this account.');
      response.json({ data: { organization: result.rows[0] } });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/admin/organizations', authenticate, requireRoles('admin'), async (request, response, next) => {
    try {
      const parsed = verificationStatusSchema.safeParse(request.query.status ?? 'pending');
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Status must be pending, verified, or rejected.', validationDetails(parsed.error));
      const result = await pool.query(
        `SELECT o.id, o.name, o.organization_type, o.verification_status, o.address, o.city,
                o.locality, o.pincode, o.created_at, o.verification_note,
                u.id AS owner_id, u.full_name AS owner_name, u.email AS owner_email, u.phone AS owner_phone
         FROM organizations o JOIN users u ON u.id = o.owner_user_id
         WHERE o.verification_status = $1 ORDER BY o.created_at ASC`,
        [parsed.data],
      );
      response.json({ data: { organizations: result.rows } });
    } catch (error) { next(error); }
  });

  app.patch('/api/v1/admin/organizations/:id/verification', authenticate, requireRoles('admin'), async (request, response, next) => {
    try {
      const parameter = request.params.id;
      const id = Array.isArray(parameter) ? parameter[0] : parameter;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Organization id must be a valid UUID.');
      }
      const input = verificationSchema.parse(request.body);
      const updated = await pool.query(
        `UPDATE organizations SET verification_status = $1, verified_by_user_id = $2,
           verified_at = NOW(), verification_note = $3
         WHERE id = $4
         RETURNING id, name, organization_type, verification_status, verification_note, verified_at`,
        [input.status, request.auth!.id, input.note ?? null, id],
      );
      if (!updated.rowCount) throw new ApiError(404, 'ORGANIZATION_NOT_FOUND', 'Organization was not found.');
      response.json({ data: { organization: updated.rows[0] } });
    } catch (error) { next(error); }
  });

  const errors: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof ZodError) {
      response.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Check the highlighted fields and try again.', details: validationDetails(error) } });
      return;
    }
    if (error instanceof ApiError) {
      response.status(error.status).json({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } });
      return;
    }
    if (isPgUniqueViolation(error)) {
      response.status(409).json({ error: { code: 'CONFLICT', message: 'That record already exists.' } });
      return;
    }
    if (isMalformedJson(error)) {
      response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } });
      return;
    }
    if (isDatabaseUnavailable(error)) {
      response.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'FoodLoop cannot reach PostgreSQL. Start the database and try again.' } });
      return;
    }
    console.error('Unhandled FoodLoop API error:', error);
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
  };
  app.use(errors);
  return app;
}

function validationDetails(error: ZodError) {
  return error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
}

function isPgUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function isMalformedJson(error: unknown): error is { type: string } {
  return typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.parse.failed';
}

function isDatabaseUnavailable(error: unknown): error is { code: string } {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', '57P03'].includes(String(error.code));
}
