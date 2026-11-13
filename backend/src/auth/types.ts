import type { Request } from 'express';

export type UserRole = 'donor' | 'ngo' | 'volunteer' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  phone: string | null;
  fullName: string;
  role: UserRole;
  organizationId?: string;
  organizationName?: string;
  verificationStatus?: 'pending' | 'verified' | 'rejected';
  verificationNote?: string | null;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthUser;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthUser;
    }
  }
}
