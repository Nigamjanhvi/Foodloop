import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import { ApiError } from '../http/errors.js';
import type { AuthUser, UserRole } from './types.js';

export function createAuthenticate(pool: Pool, secret: string) {
  return async (request: Request, _response: Response, next: NextFunction) => {
    const header = request.header('authorization');
    if (!header?.startsWith('Bearer ')) return next(new ApiError(401, 'AUTH_REQUIRED', 'Sign in to continue.'));

    try {
      const payload = jwt.verify(header.slice(7), secret, {
        issuer: 'foodloop-api',
        audience: 'foodloop-web',
      });
      if (typeof payload === 'string' || !payload.sub) throw new Error('Invalid token subject');

      const result = await pool.query(
        `SELECT u.id, u.email, u.phone, u.phone_e164, u.full_name, u.role,
                o.id AS organization_id, o.name AS organization_name,
                o.verification_status, o.verification_note
         FROM users u
         LEFT JOIN organizations o ON o.owner_user_id = u.id
         WHERE u.id = $1 AND u.is_active = TRUE
         ORDER BY o.created_at DESC LIMIT 1`,
        [payload.sub],
      );
      if (!result.rowCount) return next(new ApiError(401, 'INVALID_SESSION', 'Your session is no longer valid. Please sign in again.'));
      const row = result.rows[0];
      request.auth = {
        id: row.id,
        email: row.email,
        phone: row.phone_e164 ?? row.phone,
        fullName: row.full_name,
        role: row.role as UserRole,
        ...(row.organization_id ? {
          organizationId: row.organization_id,
          organizationName: row.organization_name,
          verificationStatus: row.verification_status,
          verificationNote: row.verification_note,
        } : {}),
      } satisfies AuthUser;
      next();
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      if (error instanceof jwt.TokenExpiredError) return next(new ApiError(401, 'SESSION_EXPIRED', 'Your session expired. Please sign in again.'));
      if (error instanceof jwt.JsonWebTokenError) return next(new ApiError(401, 'INVALID_SESSION', 'Your session is invalid. Please sign in again.'));
      next(error);
    }
  };
}

export function requireRoles(...roles: UserRole[]) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (!request.auth) return next(new ApiError(401, 'AUTH_REQUIRED', 'Sign in to continue.'));
    if (!roles.includes(request.auth.role)) return next(new ApiError(403, 'FORBIDDEN', 'You do not have permission to do that.'));
    next();
  };
}
