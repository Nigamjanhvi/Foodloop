import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { createAuthenticate, requireRoles } from '../auth/middleware.js';
import { ApiError } from '../http/errors.js';

const uuidSchema = z.string().uuid();
const profilePatchSchema = z.object({
  city: z.string().trim().min(2).max(100).optional(),
  locality: z.string().trim().min(2).max(120).optional(),
  pincode: z.string().trim().regex(/^\d{5,10}$/).optional(),
  is_available: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Provide at least one profile field to update.');
const otpSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the six-digit code.') });
const historyQuerySchema = z.object({ status: z.enum(['all', 'active', 'completed', 'offered', 'accepted', 'picked_up', 'delivered', 'cancelled', 'rejected']).default('all') });

const safeAssignmentColumns = `a.id, a.reservation_id, a.volunteer_user_id, a.status, a.offered_at,
  a.accepted_at, a.pickup_verified_at, a.delivery_verified_at, a.created_at, a.updated_at,
  r.quantity AS reserved_quantity, r.status AS reservation_status,
  d.id AS donation_id, d.food_name, d.category, d.quantity_total, d.unit, d.pickup_address,
  d.city AS pickup_city, d.locality AS pickup_locality, d.pincode AS pickup_pincode,
  d.collection_deadline, d.status AS donation_status,
  donor.id AS donor_organization_id, donor.name AS donor_organization_name,
  donor_user.id AS donor_owner_user_id, donor_user.full_name AS donor_contact_name,
  COALESCE(donor_user.phone_e164, donor_user.phone) AS donor_contact_phone,
  recipient.id AS recipient_organization_id, recipient.name AS recipient_organization_name,
  recipient.address AS delivery_address, recipient.city AS delivery_city,
  recipient.locality AS delivery_locality, recipient.pincode AS delivery_pincode,
  recipient_user.id AS recipient_owner_user_id, recipient_user.full_name AS recipient_contact_name,
  COALESCE(recipient_user.phone_e164, recipient_user.phone) AS recipient_contact_phone,
  volunteer.full_name AS volunteer_name, COALESCE(volunteer.phone_e164, volunteer.phone) AS volunteer_phone`;
const assignmentJoins = `FROM reservation_assignments a
  JOIN reservations r ON r.id=a.reservation_id
  JOIN donations d ON d.id=r.donation_id
  JOIN organizations donor ON donor.id=d.donor_organization_id
  JOIN users donor_user ON donor_user.id=donor.owner_user_id
  JOIN organizations recipient ON recipient.id=r.recipient_organization_id
  JOIN users recipient_user ON recipient_user.id=recipient.owner_user_id
  LEFT JOIN users volunteer ON volunteer.id=a.volunteer_user_id`;

export function createAssignmentRouter(pool: Pool, jwtSecret: string) {
  const router = Router();
  router.use(createAuthenticate(pool, jwtSecret));
  const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, keyGenerator: (request) => request.auth?.id ?? 'unauthenticated', standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'OTP_RATE_LIMITED', message: 'Too many code verification attempts. Try again later.' } } });
  const developmentCodeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 4, keyGenerator: (request) => request.auth?.id ?? 'unauthenticated', standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: { code: 'OTP_ISSUE_RATE_LIMITED', message: 'Too many development code requests. Try again later.' } } });

  router.get('/volunteers/me', requireRoles('volunteer'), async (request, response, next) => {
    try {
      const result = await pool.query(`SELECT p.user_id, p.city, p.locality, p.pincode, p.is_available, p.created_at, p.updated_at,
        u.full_name, u.email, COALESCE(u.phone_e164,u.phone) AS phone
        FROM volunteer_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1 AND u.is_active=TRUE`, [request.auth!.id]);
      if (!result.rowCount) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Volunteer profile was not found.');
      response.json({ data: { profile: result.rows[0] } });
    } catch (error) { next(error); }
  });

  router.patch('/volunteers/me', requireRoles('volunteer'), async (request, response, next) => {
    try {
      const input = profilePatchSchema.parse(request.body);
      const fields = Object.keys(input) as (keyof typeof input)[];
      const values: unknown[] = [];
      const assignments = fields.map((field) => { values.push(input[field]); return `${field}=$${values.length}`; });
      values.push(request.auth!.id);
      const result = await pool.query(`UPDATE volunteer_profiles p SET ${assignments.join(', ')}, updated_at=NOW()
        FROM users u WHERE p.user_id=$${values.length} AND u.id=p.user_id AND u.is_active=TRUE
        RETURNING p.user_id,p.city,p.locality,p.pincode,p.is_available,p.created_at,p.updated_at`, values);
      if (!result.rowCount) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Volunteer profile was not found.');
      response.json({ data: { profile: result.rows[0] } });
    } catch (error) { next(error); }
  });

  router.post('/reservations/:id/assignments', requireRoles('ngo'), async (request, response, next) => {
    try {
      const reservationId = parseId(request.params.id);
      const assignment = await withTransaction(pool, async (client) => {
        const recipient = await organizationForUser(client, request.auth!.id, 'recipient');
        const result = await client.query(`SELECT r.*, d.status AS donation_status, d.collection_deadline, d.donor_organization_id
          FROM reservations r JOIN donations d ON d.id=r.donation_id WHERE r.id=$1 FOR UPDATE OF r,d`, [reservationId]);
        if (!result.rowCount || result.rows[0].recipient_organization_id !== recipient.id) throw new ApiError(404, 'RESERVATION_NOT_FOUND', 'Reservation was not found for your organization.');
        const reservation = result.rows[0];
        if (!['accepted', 'approved'].includes(reservation.status)) throw new ApiError(409, 'RESERVATION_NOT_ACCEPTED', 'Volunteer assistance is available only for an accepted reservation.');
        if (reservation.donation_status === 'expired' || new Date(reservation.collection_deadline) <= new Date()) {
          throw new ApiError(409, 'COLLECTION_DEADLINE_PASSED', 'The collection deadline has passed. Volunteer assistance can only be requested before the pickup deadline.');
        }
        if (reservation.status === 'delivered' || ['cancelled', 'expired', 'rejected'].includes(reservation.status)) {
          throw new ApiError(409, 'RESERVATION_UNAVAILABLE', 'This reservation can no longer receive volunteer assistance.');
        }
        const existing = await client.query(`SELECT id FROM reservation_assignments WHERE reservation_id=$1
          AND status IN ('pending','offered','accepted','picked_up') LIMIT 1`, [reservationId]);
        if (existing.rowCount) throw new ApiError(409, 'ASSIGNMENT_EXISTS', 'This reservation already has an active volunteer assignment.');
        const created = await client.query(`INSERT INTO reservation_assignments (reservation_id,status,offered_at)
          VALUES ($1,'offered',NOW()) RETURNING id,reservation_id,status,offered_at,created_at,updated_at`, [reservationId]);
        return created.rows[0];
      });
      response.status(201).json({ data: { assignment } });
    } catch (error) { next(error); }
  });

  router.get('/reservations/:id/assignments', requireRoles('donor', 'ngo'), async (request, response, next) => {
    try {
      const reservationId = parseId(request.params.id);
      const identity = await reservationParty(pool, reservationId, request.auth!.id);
      const result = await pool.query(`SELECT ${safeAssignmentColumns} ${assignmentJoins}
        WHERE a.reservation_id=$1 ORDER BY a.created_at DESC LIMIT 1`, [reservationId]);
      const assignment = result.rows[0] ?? null;
      response.json({ data: { assignment: assignment ? privacyView(assignment, identity) : null } });
    } catch (error) { next(error); }
  });

  router.get('/volunteers/assignments/available', requireRoles('volunteer'), async (request, response, next) => {
    try {
      const profile = await volunteerProfile(pool, request.auth!.id);
      if (!profile.is_available) { response.json({ data: { assignments: [] } }); return; }
      const result = await pool.query(`SELECT ${safeAssignmentColumns} ${assignmentJoins}
        JOIN volunteer_profiles p ON p.user_id=$1
        WHERE a.status='offered' AND a.volunteer_user_id IS NULL
          AND p.is_available=TRUE AND lower(p.city)=lower(d.city)
          AND (p.pincode=d.pincode OR lower(p.locality)=lower(d.locality))
          AND d.collection_deadline>NOW() AND d.status NOT IN ('cancelled','expired','completed')
          AND r.status IN ('accepted','approved')
          AND NOT EXISTS (SELECT 1 FROM assignment_rejections ar WHERE ar.assignment_id=a.id AND ar.volunteer_user_id=$1)
          AND NOT EXISTS (SELECT 1 FROM reservation_assignments mine WHERE mine.volunteer_user_id=$1 AND mine.status IN ('accepted','picked_up'))
        ORDER BY d.collection_deadline ASC,a.offered_at ASC`, [request.auth!.id]);
      response.json({ data: { assignments: result.rows.map((row) => privacyView(row, { id: request.auth!.id, role: 'volunteer' })) } });
    } catch (error) { next(error); }
  });

  router.get('/volunteers/assignments/mine', requireRoles('volunteer'), async (request, response, next) => {
    try {
      const { status } = historyQuerySchema.parse(request.query);
      const predicate = status === 'all' ? 'TRUE' : status === 'active' ? "a.status IN ('accepted','picked_up')"
        : status === 'completed' ? "a.status='delivered'" : 'a.status=$2';
      const values = status === 'all' || status === 'active' || status === 'completed' ? [request.auth!.id] : [request.auth!.id, status];
      const result = await pool.query(`SELECT ${safeAssignmentColumns} ${assignmentJoins}
        WHERE a.volunteer_user_id=$1 AND ${predicate} ORDER BY a.created_at DESC`, values);
      response.json({ data: { assignments: result.rows.map((row) => privacyView(row, { id: request.auth!.id, role: 'volunteer' })) } });
    } catch (error) { next(error); }
  });

  router.get('/assignments/:id', async (request, response, next) => {
    try {
      const id = parseId(request.params.id);
      const result = await pool.query(`SELECT ${safeAssignmentColumns} ${assignmentJoins} WHERE a.id=$1`, [id]);
      if (!result.rowCount) throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment was not found.');
      const row = result.rows[0];
      const identity = await assignmentViewer(pool, request.auth!, row);
      response.json({ data: { assignment: privacyView(row, identity) } });
    } catch (error) { next(error); }
  });

  router.post('/assignments/:id/accept', requireRoles('volunteer'), async (request, response, next) => {
    try {
      const id = parseId(request.params.id);
      const result = await withTransaction(pool, async (client) => {
        const found = await client.query('SELECT reservation_id FROM reservation_assignments WHERE id=$1', [id]);
        if (!found.rowCount) throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment was not found.');
        const reservationId = found.rows[0].reservation_id as string;
        const reservation = await client.query(`SELECT r.status,r.recipient_organization_id,d.status AS donation_status,d.collection_deadline
          FROM reservations r JOIN donations d ON d.id=r.donation_id WHERE r.id=$1 FOR UPDATE OF r,d`, [reservationId]);
        if (!reservation.rowCount || !['accepted','approved'].includes(reservation.rows[0].status)
          || ['cancelled','expired','completed'].includes(reservation.rows[0].donation_status)
          || new Date(reservation.rows[0].collection_deadline) <= new Date()) throw new ApiError(409, 'RESERVATION_UNAVAILABLE', 'The reservation is no longer eligible for pickup.');
        const profile = await client.query(`SELECT p.*,u.is_active FROM volunteer_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1 FOR UPDATE OF p`, [request.auth!.id]);
        if (!profile.rowCount || !profile.rows[0].is_active || !profile.rows[0].is_available) throw new ApiError(403, 'VOLUNTEER_INELIGIBLE', 'An active volunteer profile marked available is required.');
        const row = await client.query(`SELECT a.*,d.city,d.locality,d.pincode FROM reservation_assignments a
          JOIN reservations r ON r.id=a.reservation_id JOIN donations d ON d.id=r.donation_id WHERE a.id=$1 FOR UPDATE OF a`, [id]);
        if (!row.rowCount) throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment was not found.');
        const assignment = row.rows[0];
        if (assignment.status !== 'offered' || assignment.volunteer_user_id) throw new ApiError(409, 'ASSIGNMENT_TAKEN', 'This assignment is no longer available.');
        const volunteer = profile.rows[0];
        if (volunteer.city.toLowerCase() !== assignment.city.toLowerCase()
          || (volunteer.pincode !== assignment.pincode && volunteer.locality.toLowerCase() !== assignment.locality.toLowerCase())) {
          throw new ApiError(403, 'OUTSIDE_SERVICE_AREA', 'This pickup is outside your saved service area.');
        }
        const rejected = await client.query('SELECT 1 FROM assignment_rejections WHERE assignment_id=$1 AND volunteer_user_id=$2', [id, request.auth!.id]);
        if (rejected.rowCount) throw new ApiError(409, 'ASSIGNMENT_REJECTED', 'You already declined this assignment.');
        const busy = await client.query("SELECT 1 FROM reservation_assignments WHERE volunteer_user_id=$1 AND status IN ('accepted','picked_up') LIMIT 1", [request.auth!.id]);
        if (busy.rowCount) throw new ApiError(409, 'VOLUNTEER_BUSY', 'Complete or cancel your active assignment before accepting another.');
        await client.query(`UPDATE reservation_assignments SET status='cancelled',updated_at=NOW()
          WHERE reservation_id=$1 AND id<>$2 AND status='offered'`, [reservationId, id]);
        const code = generateOtp();
        const updated = await client.query(`UPDATE reservation_assignments SET status='accepted',volunteer_user_id=$1,
          accepted_at=NOW(),pickup_otp_hash=$2,pickup_otp_expires_at=NOW()+INTERVAL '10 minutes',pickup_attempt_count=0,updated_at=NOW()
          WHERE id=$3 RETURNING id,status,accepted_at`, [request.auth!.id, hashOtp(jwtSecret,id,'pickup',code), id]);
        return updated.rows[0];
      });
      response.json({ data: { assignment: result } });
    } catch (error) { next(error); }
  });

  router.post('/assignments/:id/reject', requireRoles('volunteer'), async (request, response, next) => {
    try {
      const id = parseId(request.params.id);
      const result = await withTransaction(pool, async (client) => {
        const assignment = await client.query(`SELECT a.id,a.status,d.city,d.locality,d.pincode FROM reservation_assignments a
          JOIN reservations r ON r.id=a.reservation_id JOIN donations d ON d.id=r.donation_id WHERE a.id=$1 FOR UPDATE OF a`, [id]);
        if (!assignment.rowCount || assignment.rows[0].status !== 'offered') throw new ApiError(409, 'ASSIGNMENT_UNAVAILABLE', 'Only open assignments can be rejected.');
        const profile = await client.query('SELECT * FROM volunteer_profiles WHERE user_id=$1 AND is_available=TRUE FOR UPDATE', [request.auth!.id]);
        if (!profile.rowCount) throw new ApiError(403, 'VOLUNTEER_INELIGIBLE', 'An available volunteer profile is required.');
        const task = assignment.rows[0]; const volunteer = profile.rows[0];
        if (volunteer.city.toLowerCase() !== task.city.toLowerCase() || (volunteer.pincode !== task.pincode && volunteer.locality.toLowerCase() !== task.locality.toLowerCase())) throw new ApiError(403, 'OUTSIDE_SERVICE_AREA', 'This assignment is outside your saved service area.');
        await client.query(`INSERT INTO assignment_rejections (assignment_id,volunteer_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id,request.auth!.id]);
        return { id, status: 'rejected' };
      });
      response.json({ data: { assignment: result } });
    } catch (error) { next(error); }
  });

  router.post('/assignments/:id/cancel', async (request, response, next) => {
    try {
      const id = parseId(request.params.id);
      const result = await withTransaction(pool, async (client) => {
        const found = await client.query('SELECT reservation_id FROM reservation_assignments WHERE id=$1', [id]);
        if (!found.rowCount) throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment was not found.');
        const reservationId = found.rows[0].reservation_id as string;
        await client.query('SELECT id FROM reservations WHERE id=$1 FOR UPDATE', [reservationId]);
        const assignment = await client.query('SELECT * FROM reservation_assignments WHERE id=$1 FOR UPDATE', [id]);
        const row = assignment.rows[0];
        if (!['offered','accepted'].includes(row.status)) throw new ApiError(409, 'ASSIGNMENT_NOT_CANCELLABLE', 'Only offered assignments or accepted tasks before pickup can be cancelled.');
        const allowed = request.auth!.role === 'ngo'
          ? (await organizationForUser(client,request.auth!.id,'recipient')).id === (await client.query('SELECT recipient_organization_id FROM reservations WHERE id=$1',[reservationId])).rows[0].recipient_organization_id
          : request.auth!.role === 'donor'
            ? Boolean((await client.query('SELECT 1 FROM reservations r JOIN donations d ON d.id=r.donation_id JOIN organizations o ON o.id=d.donor_organization_id WHERE r.id=$1 AND o.owner_user_id=$2',[reservationId,request.auth!.id])).rowCount)
            : request.auth!.role === 'volunteer' && row.volunteer_user_id === request.auth!.id;
        if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'You cannot cancel this assignment.');
        const updated = await client.query(`UPDATE reservation_assignments SET status='cancelled',pickup_otp_hash=NULL,
          delivery_otp_hash=NULL,updated_at=NOW() WHERE id=$1 RETURNING id,status,volunteer_user_id`, [id]);
        return updated.rows[0];
      });
      response.json({ data: { assignment: result } });
    } catch (error) { next(error); }
  });

  router.post('/assignments/:id/pickup-otp/dev-code', developmentCodeLimiter, requireRoles('donor'), async (request, response, next) => {
    try {
      assertDevelopmentCodeAllowed();
      const id = parseId(request.params.id);
      const assignment = await issueDevelopmentOtp(pool, jwtSecret, id, request.auth!.id, 'pickup');
      response.json({ data: { assignment, code: assignment.code, development_only: true, expires_at: assignment.expires_at } });
    } catch (error) { next(error); }
  });

  router.post('/assignments/:id/delivery-otp/dev-code', developmentCodeLimiter, requireRoles('ngo'), async (request, response, next) => {
    try {
      assertDevelopmentCodeAllowed();
      const id = parseId(request.params.id);
      const assignment = await issueDevelopmentOtp(pool, jwtSecret, id, request.auth!.id, 'delivery');
      response.json({ data: { assignment, code: assignment.code, development_only: true, expires_at: assignment.expires_at } });
    } catch (error) { next(error); }
  });

  router.post('/assignments/:id/pickup-otp/verify', otpLimiter, requireRoles('volunteer'), async (request, response, next) => {
    try {
      const id = parseId(request.params.id); const { code } = otpSchema.parse(request.body);
      const outcome = await verifyOtp(pool, jwtSecret, id, request.auth!.id, code, 'pickup');
      if (outcome.error) throw new ApiError(outcome.error.status, outcome.error.code, outcome.error.message);
      response.json({ data: { assignment: outcome.assignment } });
    } catch (error) { next(error); }
  });

  router.post('/assignments/:id/delivery-otp/verify', otpLimiter, requireRoles('volunteer'), async (request, response, next) => {
    try {
      const id = parseId(request.params.id); const { code } = otpSchema.parse(request.body);
      const outcome = await verifyOtp(pool, jwtSecret, id, request.auth!.id, code, 'delivery');
      if (outcome.error) throw new ApiError(outcome.error.status, outcome.error.code, outcome.error.message);
      response.json({ data: { assignment: outcome.assignment } });
    } catch (error) { next(error); }
  });

  return router;
}

type Viewer = { id: string; role: 'donor' | 'ngo' | 'volunteer' | 'admin' };

function privacyView(row: Record<string, any>, viewer: Viewer) {
  const canSeeContact = row.volunteer_user_id === viewer.id || row.donor_owner_user_id === viewer.id || row.recipient_owner_user_id === viewer.id;
  const { donor_owner_user_id, recipient_owner_user_id, ...safe } = row;
  if (!canSeeContact) {
    delete safe.donor_contact_name; delete safe.donor_contact_phone;
    delete safe.recipient_contact_name; delete safe.recipient_contact_phone;
    delete safe.volunteer_phone;
  }
  return safe;
}

async function assignmentViewer(pool: Pool, viewer: Viewer, row: Record<string, any>): Promise<Viewer> {
  if (viewer.role === 'admin' || row.donor_owner_user_id === viewer.id || row.recipient_owner_user_id === viewer.id || row.volunteer_user_id === viewer.id) return viewer;
  if (viewer.role === 'volunteer' && row.status === 'offered') {
    const profile = await volunteerProfile(pool, viewer.id);
    if (profile.is_available && profile.city.toLowerCase() === String(row.pickup_city).toLowerCase()
      && (profile.pincode === row.pickup_pincode || profile.locality.toLowerCase() === String(row.pickup_locality).toLowerCase())) return viewer;
  }
  throw new ApiError(403, 'FORBIDDEN', 'You cannot view this assignment.');
}

async function reservationParty(pool: Pool, reservationId: string, userId: string): Promise<Viewer> {
  const result = await pool.query(`SELECT donor.owner_user_id AS donor_id,recipient.owner_user_id AS recipient_id
    FROM reservations r JOIN donations d ON d.id=r.donation_id JOIN organizations donor ON donor.id=d.donor_organization_id
    JOIN organizations recipient ON recipient.id=r.recipient_organization_id WHERE r.id=$1`, [reservationId]);
  if (!result.rowCount) throw new ApiError(404, 'RESERVATION_NOT_FOUND', 'Reservation was not found.');
  if (result.rows[0].donor_id === userId) return { id: userId, role: 'donor' };
  if (result.rows[0].recipient_id === userId) return { id: userId, role: 'ngo' };
  throw new ApiError(403, 'FORBIDDEN', 'You cannot view assignment details for this reservation.');
}

async function organizationForUser(db: Pool | PoolClient, userId: string, type: 'donor' | 'recipient') {
  const result = await db.query(`SELECT o.* FROM organizations o JOIN users u ON u.id=o.owner_user_id
    WHERE o.owner_user_id=$1 AND o.organization_type=$2 AND u.is_active=TRUE ORDER BY o.created_at DESC LIMIT 1`, [userId,type]);
  if (!result.rowCount) throw new ApiError(404, 'ORGANIZATION_NOT_FOUND', 'Organization profile was not found.');
  const org = result.rows[0];
  if (org.verification_status !== 'verified') throw new ApiError(403, 'ORGANIZATION_NOT_VERIFIED', 'Your organization must be verified to use assignment workflows.');
  return org;
}

async function volunteerProfile(db: Pool | PoolClient, userId: string) {
  const result = await db.query(`SELECT p.*,u.is_active FROM volunteer_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1`, [userId]);
  if (!result.rowCount) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Volunteer profile was not found.');
  if (!result.rows[0].is_active) throw new ApiError(403, 'VOLUNTEER_INELIGIBLE', 'Your volunteer account is inactive.');
  return result.rows[0];
}

async function issueDevelopmentOtp(pool: Pool, secret: string, id: string, userId: string, kind: 'pickup' | 'delivery') {
  return withTransaction(pool, async (client) => {
    const result = await client.query(`SELECT a.*,r.recipient_organization_id,d.donor_organization_id
      FROM reservation_assignments a JOIN reservations r ON r.id=a.reservation_id
      JOIN donations d ON d.id=r.donation_id WHERE a.id=$1 FOR UPDATE OF a`, [id]);
    if (!result.rowCount) throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment was not found.');
    const row = result.rows[0];
    const orgType = kind === 'pickup' ? 'donor' : 'recipient';
    const ownerId = kind === 'pickup' ? row.donor_organization_id : row.recipient_organization_id;
    const organization = await client.query('SELECT owner_user_id,verification_status FROM organizations WHERE id=$1', [ownerId]);
    if (organization.rows[0]?.owner_user_id !== userId) throw new ApiError(403, 'FORBIDDEN', 'Only the associated organization can issue this development code.');
    if (organization.rows[0].verification_status !== 'verified') throw new ApiError(403, 'ORGANIZATION_NOT_VERIFIED', 'Organization verification is required.');
    if ((kind === 'pickup' && row.status !== 'accepted') || (kind === 'delivery' && row.status !== 'picked_up')) throw new ApiError(409, 'INVALID_ASSIGNMENT_STATE', `A ${kind} code is unavailable at this assignment stage.`);
    const code = generateOtp(); const expiresAt = new Date(Date.now()+10*60_000);
    const hash = hashOtp(secret,id,kind,code);
    const hashColumn = kind === 'pickup' ? 'pickup_otp_hash' : 'delivery_otp_hash';
    const expiryColumn = kind === 'pickup' ? 'pickup_otp_expires_at' : 'delivery_otp_expires_at';
    const attemptsColumn = kind === 'pickup' ? 'pickup_attempt_count' : 'delivery_attempt_count';
    await client.query(`UPDATE reservation_assignments SET ${hashColumn}=$1,${expiryColumn}=$2,${attemptsColumn}=0,updated_at=NOW() WHERE id=$3`, [hash,expiresAt,id]);
    return { id, code, expires_at: expiresAt.toISOString(), development_only: true, recipient: orgType };
  });
}

type VerifyOutcome = { error?: { status: number; code: string; message: string }; assignment?: Record<string, unknown> };
async function verifyOtp(pool: Pool, secret: string, id: string, userId: string, code: string, kind: 'pickup' | 'delivery'): Promise<VerifyOutcome> {
  return withTransaction(pool, async (client) => {
    const found = await client.query('SELECT reservation_id FROM reservation_assignments WHERE id=$1', [id]);
    if (!found.rowCount) throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment was not found.');
    const reservationId = found.rows[0].reservation_id as string;
    const reservation = await client.query('SELECT id,status,donation_id FROM reservations WHERE id=$1 FOR UPDATE', [reservationId]);
    const locked = await client.query('SELECT * FROM reservation_assignments WHERE id=$1 FOR UPDATE', [id]);
    const row = locked.rows[0];
    if (row.volunteer_user_id !== userId) throw new ApiError(403, 'FORBIDDEN', 'Only the assigned volunteer can verify this code.');
    const requiredAssignmentStatus = kind === 'pickup' ? 'accepted' : 'picked_up';
    const requiredReservationStatus = kind === 'pickup' ? ['accepted','approved'] : ['picked_up'];
    if (row.status !== requiredAssignmentStatus || !requiredReservationStatus.includes(reservation.rows[0].status)) throw new ApiError(409, 'INVALID_ASSIGNMENT_STATE', `${kind === 'pickup' ? 'Pickup' : 'Delivery'} verification is not available at this stage.`);
    const hashColumn = kind === 'pickup' ? 'pickup_otp_hash' : 'delivery_otp_hash';
    const expiryColumn = kind === 'pickup' ? 'pickup_otp_expires_at' : 'delivery_otp_expires_at';
    const attemptsColumn = kind === 'pickup' ? 'pickup_attempt_count' : 'delivery_attempt_count';
    const hash = row[hashColumn] as string | null; const expiry = row[expiryColumn] as Date | null; const attempts = Number(row[attemptsColumn]);
    if (!hash || !expiry) return { error: { status: 409, code: 'OTP_NOT_ISSUED', message: 'Ask the authorized organization to issue a fresh development code.' } };
    if (attempts >= 5) return { error: { status: 429, code: 'OTP_ATTEMPTS_EXCEEDED', message: 'The maximum code attempts were reached. Ask the authorized organization to issue a new code.' } };
    if (new Date(expiry) <= new Date()) return { error: { status: 410, code: 'OTP_EXPIRED', message: 'This code expired. Ask the authorized organization to issue a new one.' } };
    const candidate = Buffer.from(hashOtp(secret,id,kind,code),'hex'); const expected = Buffer.from(hash,'hex');
    if (candidate.length !== expected.length || !timingSafeEqual(candidate,expected)) {
      await client.query(`UPDATE reservation_assignments SET ${attemptsColumn}=${attemptsColumn}+1,updated_at=NOW() WHERE id=$1`, [id]);
      return { error: { status: 400, code: 'OTP_INCORRECT', message: 'That code is incorrect.' } };
    }
    if (kind === 'pickup') {
      const deliveryCode = generateOtp();
      await client.query(`UPDATE reservation_assignments SET status='picked_up',pickup_verified_at=NOW(),pickup_otp_hash=NULL,
        delivery_otp_hash=$1,delivery_otp_expires_at=NOW()+INTERVAL '10 minutes',delivery_attempt_count=0,updated_at=NOW() WHERE id=$2`,
      [hashOtp(secret,id,'delivery',deliveryCode),id]);
      await client.query(`UPDATE reservations SET status='picked_up',updated_at=NOW() WHERE id=$1`,[reservationId]);
    } else {
      await client.query('SELECT id FROM donations WHERE id=$1 FOR UPDATE',[reservation.rows[0].donation_id]);
      await client.query(`UPDATE reservation_assignments SET status='delivered',delivery_verified_at=NOW(),delivery_otp_hash=NULL,updated_at=NOW() WHERE id=$1`,[id]);
      await client.query(`UPDATE reservations SET status='delivered',updated_at=NOW() WHERE id=$1`,[reservationId]);
      await client.query(`UPDATE donations d SET quantity_delivered=d.quantity_delivered+r.quantity,
        status=CASE WHEN d.quantity_delivered+r.quantity >= d.quantity_total THEN 'completed' ELSE d.status END,
        updated_at=NOW() FROM reservations r WHERE r.id=$1 AND d.id=r.donation_id`,[reservationId]);
    }
    const updated = await client.query('SELECT id,reservation_id,volunteer_user_id,status,pickup_verified_at,delivery_verified_at,updated_at FROM reservation_assignments WHERE id=$1',[id]);
    return { assignment: updated.rows[0] };
  });
}

function assertDevelopmentCodeAllowed() {
  if (process.env.NODE_ENV === 'production') throw new ApiError(404, 'NOT_FOUND', 'Development code issuance is not available.');
}
function generateOtp() { return randomInt(0,1_000_000).toString().padStart(6,'0'); }
function hashOtp(secret: string,id: string,kind: 'pickup'|'delivery',code: string) {
  return createHmac('sha256',secret).update(`${id}:${kind}:${code}`).digest('hex');
}
function parseId(value: string | string[]) {
  const parsed=uuidSchema.safeParse(Array.isArray(value)?value[0]:value);
  if (!parsed.success) throw new ApiError(400,'VALIDATION_ERROR','Record id must be a valid UUID.');
  return parsed.data;
}
async function withTransaction<T>(pool: Pool,callback:(client:PoolClient)=>Promise<T>):Promise<T> {
  const client=await pool.connect();
  try { await client.query('BEGIN'); const result=await callback(client); await client.query('COMMIT'); return result; }
  catch(error) { await client.query('ROLLBACK').catch(()=>undefined); throw error; }
  finally { client.release(); }
}
