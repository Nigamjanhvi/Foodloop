import { Router, type Request } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { createAuthenticate, requireRoles } from '../auth/middleware.js';
import { ApiError } from '../http/errors.js';

const categories = ['cooked_meals', 'rice_grains', 'fruits', 'vegetables', 'bakery', 'packaged_food', 'other'] as const;
const units = ['meals', 'packets', 'kilograms', 'litres', 'boxes', 'other'] as const;
const storageTypes = ['ambient', 'refrigerated', 'frozen', 'hot', 'other'] as const;
const uuidSchema = z.string().uuid();
const futureDate = z.coerce.date();
const locationFields = {
  pickup_address: z.string().trim().min(5).max(500),
  city: z.string().trim().min(2).max(100),
  locality: z.string().trim().min(2).max(120),
  pincode: z.string().trim().regex(/^\d{5,10}$/),
};
const foodFields = {
  food_name: z.string().trim().min(2).max(160),
  category: z.enum(categories),
  description: z.string().trim().max(2000).default(''),
  quantity_total: z.coerce.number().positive().max(1_000_000).multipleOf(.01),
  unit: z.enum(units),
  prepared_at: futureDate,
  storage_type: z.enum(storageTypes),
  handling_info: z.string().trim().max(2000).default(''),
  ...locationFields,
  collection_deadline: futureDate,
};
const donationCreateSchema = z.object(foodFields).superRefine(validateDonationDates);
const donationPatchSchema = z.object({
  food_name: foodFields.food_name.optional(), category: foodFields.category.optional(), description: foodFields.description.optional(),
  quantity_total: foodFields.quantity_total.optional(), unit: foodFields.unit.optional(), prepared_at: foodFields.prepared_at.optional(),
  storage_type: foodFields.storage_type.optional(), handling_info: foodFields.handling_info.optional(),
  pickup_address: foodFields.pickup_address.optional(), city: foodFields.city.optional(), locality: foodFields.locality.optional(),
  pincode: foodFields.pincode.optional(), collection_deadline: foodFields.collection_deadline.optional(),
}).refine((input) => Object.keys(input).length > 0, 'Provide at least one field to update.').superRefine(validateDonationDates);
function validateDonationDates(value: { prepared_at?: Date; collection_deadline?: Date }, context: z.RefinementCtx) {
  const now = Date.now();
  const prepared = value.prepared_at?.getTime();
  const deadline = value.collection_deadline?.getTime();
  if (prepared !== undefined && (prepared < now - 30 * 86400_000 || prepared > now + 7 * 86400_000)) {
    context.addIssue({ code: 'custom', path: ['prepared_at'], message: 'Preparation time must be within the past 30 days or next 7 days.' });
  }
  if (deadline !== undefined && (deadline <= now || deadline > now + 30 * 86400_000)) {
    context.addIssue({ code: 'custom', path: ['collection_deadline'], message: 'Collection deadline must be in the future and within 30 days.' });
  }
  if (prepared !== undefined && deadline !== undefined && deadline <= prepared) {
    context.addIssue({ code: 'custom', path: ['collection_deadline'], message: 'Collection deadline must be after preparation time.' });
  }
}
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(12),
  search: z.string().trim().max(160).optional(), category: z.enum(categories).optional(),
  status: z.enum(['all', 'available', 'partially_reserved', 'fully_reserved', 'expired', 'cancelled', 'reserved', 'completed', 'history']).optional(), city: z.string().trim().max(100).optional(),
  locality: z.string().trim().max(120).optional(), pincode: z.string().trim().regex(/^\d{5,10}$/).optional(),
  min_quantity: z.coerce.number().min(0).max(1_000_000).optional(), deadline_before: z.coerce.date().optional(),
});
const adminDonationQuery = listQuerySchema.extend({ status: z.enum(['all', 'available', 'partially_reserved', 'fully_reserved', 'expired', 'cancelled', 'reserved', 'completed']).default('all') });
const adminReservationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(12),
  status: z.enum(['all', 'pending', 'accepted', 'rejected', 'cancelled', 'expired', 'approved', 'picked_up', 'delivered']).default('all'),
  search: z.string().trim().max(160).optional(),
});
const reservationCreateSchema = z.object({ quantity: z.coerce.number().positive().max(1_000_000).multipleOf(.01), message: z.string().trim().max(1000).optional() });

const donationColumns = `d.id, d.donor_organization_id, d.food_name, d.category, d.description,
  d.quantity_total, d.quantity_reserved, d.quantity_remaining, d.unit, d.prepared_at,
  d.storage_type, d.handling_info, d.pickup_address, d.city, d.locality, d.pincode,
  d.collection_deadline, d.status, d.created_at, d.updated_at`;
const donationReturning = `id, donor_organization_id, food_name, category, description,
  quantity_total, quantity_reserved, quantity_remaining, unit, prepared_at, storage_type,
  handling_info, pickup_address, city, locality, pincode, collection_deadline, status, created_at, updated_at`;
const reservationColumns = `r.id, r.donation_id, r.recipient_organization_id, r.quantity, r.status,
  r.message, r.status_reason, r.created_at, r.updated_at,
  d.food_name, d.category, d.unit, d.city, d.locality, d.pincode, d.pickup_address,
  d.collection_deadline, d.status AS donation_status,
  donor.id AS donor_organization_id, donor.name AS donor_organization_name,
  donor.verification_status AS donor_verification_status,
  recipient.name AS recipient_organization_name, recipient.verification_status AS recipient_verification_status,
  donor_user.id AS donor_owner_user_id, recipient_user.id AS recipient_owner_user_id`;

export function createDonationRouter(pool: Pool, jwtSecret: string) {
  const router = Router();
  router.use(createAuthenticate(pool, jwtSecret));

  router.post('/donations', requireRoles('donor'), async (request, response, next) => {
    try {
      const input = donationCreateSchema.parse(request.body);
      const organization = await verifiedOrganization(pool, request.auth!.id, 'donor');
      const created = await pool.query(
        `INSERT INTO donations (
          donor_organization_id, food_name, category, description, quantity_total, quantity_reserved,
          quantity_remaining, unit, prepared_at, storage_type, handling_info, pickup_address,
          city, locality, pincode, collection_deadline, status
        ) VALUES ($1,$2,$3,$4,$5,0,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'available')
        RETURNING ${donationReturning}`,
        [organization.id, input.food_name, input.category, input.description, input.quantity_total,
          input.unit, input.prepared_at, input.storage_type, input.handling_info, input.pickup_address,
          input.city, input.locality, input.pincode, input.collection_deadline],
      );
      response.status(201).json({ data: { donation: created.rows[0] } });
    } catch (error) { next(error); }
  });

  router.get('/donations/mine', requireRoles('donor'), async (request, response, next) => {
    try {
      await expireDueDonations(pool);
      const query = listQuerySchema.parse(request.query);
      const organization = await organizationForUser(pool, request.auth!.id, 'donor');
      const params = donationFilters(query, organization.id);
      const { rows, total, pages } = await paginatedDonations(pool, params, query.page, query.limit);
      const summary = await pool.query(`SELECT
        count(*)::int AS total_donations,
        count(*) FILTER (WHERE status IN ('available','partially_reserved','fully_reserved','reserved') AND collection_deadline > NOW())::int AS active_donations,
        (SELECT count(*)::int FROM reservations r JOIN donations d ON d.id=r.donation_id WHERE d.donor_organization_id=$1 AND r.status='delivered') AS completed_deliveries,
        COALESCE((SELECT json_agg(json_build_object('unit', grouped.unit, 'quantity', grouped.quantity) ORDER BY grouped.unit)
          FROM (SELECT unit, sum(quantity_total)::numeric(12,2) AS quantity FROM donations WHERE donor_organization_id=$1 GROUP BY unit) grouped), '[]'::json) AS quantity_by_unit
        FROM donations WHERE donor_organization_id=$1`, [organization.id]);
      response.json({ data: { donations: rows, pagination: { page: query.page, limit: query.limit, total, pages }, summary: summary.rows[0] } });
    } catch (error) { next(error); }
  });

  router.get('/donations/available', requireRoles('ngo'), async (request, response, next) => {
    try {
      await expireDueDonations(pool);
      const query = listQuerySchema.parse(request.query);
      const recipient = await verifiedOrganization(pool, request.auth!.id, 'recipient');
      const search = query.search ? `%${query.search}%` : null;
      const matching = `(
        (lower(d.city)=lower($5) AND lower(d.locality)=lower($6) AND d.pincode=$7)
        OR EXISTS (SELECT 1 FROM service_areas sa WHERE sa.organization_id=$1
          AND lower(sa.city)=lower(d.city)
          AND (sa.locality IS NULL OR lower(sa.locality)=lower(d.locality))
          AND (sa.pincode IS NULL OR sa.pincode=d.pincode))
        OR (lower(d.city)=lower($5) AND NOT EXISTS (SELECT 1 FROM service_areas sa WHERE sa.organization_id=$1))
      )`;
      const filterValues = [recipient.id, search, query.category ?? null, query.city ?? null,
        recipient.city, recipient.locality, recipient.pincode, query.locality ?? null, query.pincode ?? null,
        query.min_quantity ?? 0, query.deadline_before ?? null];
      const result = await pool.query(
        `SELECT ${donationColumns}, donor.name AS donor_organization_name,
          CASE WHEN d.pincode = $7 THEN 0
               WHEN lower(d.locality) = lower($6) THEN 1 ELSE 2 END AS locality_match_order
         FROM donations d JOIN organizations donor ON donor.id = d.donor_organization_id
         WHERE d.status IN ('available','partially_reserved','reserved') AND d.collection_deadline > NOW()
           AND d.quantity_remaining > 0 AND ($4::text IS NULL OR lower(d.city)=lower($4)) AND ${matching}
           AND ($2::text IS NULL OR d.food_name ILIKE $2 OR d.description ILIKE $2)
           AND ($3::text IS NULL OR d.category = $3)
           AND ($8::text IS NULL OR d.locality ILIKE '%' || $8 || '%')
           AND ($9::text IS NULL OR d.pincode = $9) AND d.quantity_remaining >= $10
           AND ($11::timestamptz IS NULL OR d.collection_deadline <= $11)
           AND d.donor_organization_id <> $1
         ORDER BY locality_match_order, d.collection_deadline ASC, d.created_at DESC
         LIMIT $12 OFFSET $13`,
        [...filterValues, query.limit, (query.page - 1) * query.limit],
      );
      const count = await pool.query(
        `SELECT count(*)::int AS total FROM donations d
         WHERE d.status IN ('available','partially_reserved','reserved') AND d.collection_deadline > NOW()
           AND d.quantity_remaining > 0 AND ($4::text IS NULL OR lower(d.city)=lower($4)) AND ${matching}
           AND ($2::text IS NULL OR d.food_name ILIKE $2 OR d.description ILIKE $2)
           AND ($3::text IS NULL OR d.category = $3)
           AND ($8::text IS NULL OR d.locality ILIKE '%' || $8 || '%')
           AND ($9::text IS NULL OR d.pincode = $9) AND d.quantity_remaining >= $10
           AND ($11::timestamptz IS NULL OR d.collection_deadline <= $11)
           AND d.donor_organization_id <> $1`, filterValues,
      );
      const total = count.rows[0].total as number;
      response.json({ data: { donations: result.rows, pagination: { page: query.page, limit: query.limit, total, pages: Math.ceil(total / query.limit) } } });
    } catch (error) { next(error); }
  });

  router.get('/donations/:id', requireRoles('donor', 'ngo', 'admin'), async (request, response, next) => {
    try {
      const id = parseId(request.params.id);
      await expireDueDonations(pool);
      const result = await pool.query(
        `SELECT ${donationColumns}, donor.name AS donor_organization_name,
          donor.organization_type AS donor_organization_type,
          donor.verification_status AS donor_verification_status
         FROM donations d JOIN organizations donor ON donor.id = d.donor_organization_id
         JOIN users donor_user ON donor_user.id = donor.owner_user_id WHERE d.id = $1`, [id],
      );
      if (!result.rowCount) throw new ApiError(404, 'DONATION_NOT_FOUND', 'Donation was not found.');
      const donation = result.rows[0];
      if (request.auth!.role === 'donor' && donation.donor_organization_id !== request.auth!.organizationId) {
        const owner = await pool.query('SELECT 1 FROM organizations WHERE id=$1 AND owner_user_id=$2', [donation.donor_organization_id, request.auth!.id]);
        if (!owner.rowCount) throw new ApiError(403, 'FORBIDDEN', 'You cannot view another donor’s donation.');
      }
      if (request.auth!.role === 'ngo') {
        const recipient = await verifiedOrganization(pool, request.auth!.id, 'recipient');
        if (donation.donor_organization_id === recipient.id) throw new ApiError(403, 'OWN_DONATION', 'Recipient organizations cannot reserve their own donation.');
        if (!await isInServiceArea(pool, recipient, donation)) throw new ApiError(404, 'DONATION_NOT_FOUND', 'This donation is outside your organization’s saved service area.');
        if (!['available', 'partially_reserved', 'reserved'].includes(donation.status) || donation.collection_deadline <= new Date() || Number(donation.quantity_remaining) <= 0) {
          throw new ApiError(404, 'DONATION_UNAVAILABLE', 'This donation is no longer available for reservation.');
        }
      }
      response.json({ data: { donation } });
    } catch (error) { next(error); }
  });

  router.patch('/donations/:id', requireRoles('donor'), async (request, response, next) => {
    try {
      const id = parseId(request.params.id);
      const input = donationPatchSchema.parse(request.body);
      await verifiedOrganization(pool, request.auth!.id, 'donor');
      const donation = await withTransaction(pool, async (client) => {
        await expireDue(client);
        const current = await client.query('SELECT * FROM donations WHERE id=$1 FOR UPDATE', [id]);
        if (!current.rowCount) throw new ApiError(404, 'DONATION_NOT_FOUND', 'Donation was not found.');
        const row = current.rows[0];
        await assertDonationOwner(client, id, request.auth!.id);
        if (!['available', 'partially_reserved', 'reserved'].includes(row.status)) throw new ApiError(409, 'DONATION_NOT_EDITABLE', 'Only active donations can be edited.');
        const nextTotal = input.quantity_total ?? Number(row.quantity_total);
        const reserved = Number(row.quantity_reserved);
        if (nextTotal < reserved) throw new ApiError(400, 'QUANTITY_BELOW_RESERVED', 'Total quantity cannot be less than the quantity already reserved.');
        if (reserved > 0 && input.unit && input.unit !== row.unit) throw new ApiError(409, 'UNIT_LOCKED', 'The quantity unit cannot change after a reservation has been made.');
        const merged = { ...row, ...input };
        donationCreateSchema.parse({ ...merged, quantity_total: nextTotal });
        const assignments: string[] = [];
        const values: unknown[] = [];
        const editable = ['food_name', 'category', 'description', 'quantity_total', 'unit', 'prepared_at', 'storage_type', 'handling_info', 'pickup_address', 'city', 'locality', 'pincode', 'collection_deadline'] as const;
        for (const field of editable) if (input[field] !== undefined) { values.push(input[field]); assignments.push(`${field}=$${values.length}`); }
        const remaining = nextTotal - reserved;
        values.push(remaining); assignments.push(`quantity_remaining=$${values.length}`);
        values.push(remaining === 0 ? 'fully_reserved' : reserved > 0 ? 'partially_reserved' : 'available'); assignments.push(`status=$${values.length}`);
        values.push(id); assignments.push(`updated_at=NOW()`);
        const result = await client.query(`UPDATE donations d SET ${assignments.join(', ')} WHERE d.id=$${values.length} RETURNING ${donationColumns}`, values);
        return result.rows[0];
      });
      response.json({ data: { donation } });
    } catch (error) { next(error); }
  });

  router.post('/donations/:id/cancel', requireRoles('donor'), async (request, response, next) => {
    try {
      const id = parseId(request.params.id);
      const donation = await withTransaction(pool, async (client) => {
        await expireDue(client);
        const locked = await client.query('SELECT * FROM donations WHERE id=$1 FOR UPDATE', [id]);
        if (!locked.rowCount) throw new ApiError(404, 'DONATION_NOT_FOUND', 'Donation was not found.');
        const row = locked.rows[0];
        await assertDonationOwner(client, id, request.auth!.id);
        if (!['available', 'partially_reserved', 'reserved', 'fully_reserved'].includes(row.status)) throw new ApiError(409, 'DONATION_NOT_CANCELLABLE', 'This donation cannot be cancelled in its current state.');
        const accepted = await client.query(`SELECT 1 FROM reservations WHERE donation_id=$1 AND status IN ('accepted','approved','picked_up') LIMIT 1`, [id]);
        if (accepted.rowCount) throw new ApiError(409, 'ACCEPTED_RESERVATIONS_EXIST', 'This donation has an accepted reservation and cannot be cancelled. Resolve that request first.');
        await client.query(`UPDATE reservations SET status='cancelled', status_reason='Donation cancelled by donor.', updated_at=NOW() WHERE donation_id=$1 AND status='pending'`, [id]);
        const updated = await client.query(`UPDATE donations d SET status='cancelled', quantity_reserved=0,
          quantity_remaining=quantity_total, updated_at=NOW() WHERE d.id=$1 RETURNING ${donationColumns}`, [id]);
        return updated.rows[0];
      });
      response.json({ data: { donation } });
    } catch (error) { next(error); }
  });

  router.post('/donations/:id/reservations', requireRoles('ngo'), async (request, response, next) => {
    try {
      const donationId = parseId(request.params.id);
      const input = reservationCreateSchema.parse(request.body);
      const result = await withTransaction(pool, async (client) => {
        await expireDue(client);
        const recipient = await verifiedOrganization(client, request.auth!.id, 'recipient');
        const donationResult = await client.query('SELECT * FROM donations WHERE id=$1 FOR UPDATE', [donationId]);
        if (!donationResult.rowCount) throw new ApiError(404, 'DONATION_NOT_FOUND', 'Donation was not found.');
        const donation = donationResult.rows[0];
        if (donation.donor_organization_id === recipient.id) throw new ApiError(403, 'OWN_DONATION', 'You cannot reserve food donated by your own organization.');
        if (!await isInServiceArea(client, recipient, donation)) throw new ApiError(403, 'OUTSIDE_SERVICE_AREA', 'This donation is outside your organization’s saved service area.');
        if (!['available', 'partially_reserved', 'reserved'].includes(donation.status) || new Date(donation.collection_deadline) <= new Date()) {
          throw new ApiError(409, 'DONATION_UNAVAILABLE', 'This donation is no longer open for reservations.');
        }
        if (input.quantity > Number(donation.quantity_remaining)) throw new ApiError(409, 'INSUFFICIENT_QUANTITY', 'The requested quantity exceeds the currently available amount.');
        const duplicate = await client.query(`SELECT 1 FROM reservations WHERE donation_id=$1 AND recipient_organization_id=$2 AND status IN ('pending','accepted','approved','picked_up') LIMIT 1`, [donationId, recipient.id]);
        if (duplicate.rowCount) throw new ApiError(409, 'ACTIVE_REQUEST_EXISTS', 'Your organization already has an active request for this donation.');
        const reservation = await client.query(`INSERT INTO reservations (donation_id, recipient_organization_id, quantity, status, message)
          VALUES ($1,$2,$3,'pending',$4) RETURNING id, donation_id, recipient_organization_id, quantity, status, message, status_reason, created_at, updated_at`,
        [donationId, recipient.id, input.quantity, input.message ?? null]);
        const remaining = Number(donation.quantity_remaining) - input.quantity;
        const reserved = Number(donation.quantity_reserved) + input.quantity;
        await client.query(`UPDATE donations SET quantity_remaining=$1, quantity_reserved=$2, status=$3, updated_at=NOW() WHERE id=$4`,
          [remaining, reserved, remaining === 0 ? 'fully_reserved' : 'partially_reserved', donationId]);
        return reservation.rows[0];
      });
      response.status(201).json({ data: { reservation: result } });
    } catch (error) { next(error); }
  });

  router.get('/reservations/mine', requireRoles('ngo'), async (request, response, next) => {
    try {
      await expireDueDonations(pool);
      const page = pageParams(request);
      const recipient = await organizationForUser(pool, request.auth!.id, 'recipient');
      const status = parseStatusFilter(request.query.status);
      const values = [recipient.id, status, page.limit, (page.page - 1) * page.limit];
      const rows = await pool.query(`SELECT ${reservationColumns} FROM reservations r
        JOIN donations d ON d.id=r.donation_id JOIN organizations donor ON donor.id=d.donor_organization_id
        JOIN organizations recipient ON recipient.id=r.recipient_organization_id
        JOIN users donor_user ON donor_user.id=donor.owner_user_id JOIN users recipient_user ON recipient_user.id=recipient.owner_user_id
        WHERE r.recipient_organization_id=$1 AND ($2::text IS NULL OR ($2='history' AND r.status IN ('accepted','rejected','cancelled','expired','approved','picked_up','delivered')) OR r.status=$2)
        ORDER BY r.created_at DESC LIMIT $3 OFFSET $4`, values);
      const total = await pool.query(`SELECT count(*)::int AS total FROM reservations WHERE recipient_organization_id=$1
        AND ($2::text IS NULL OR ($2='history' AND status IN ('accepted','rejected','cancelled','expired','approved','picked_up','delivered')) OR status=$2)`, values.slice(0, 2));
      respondPage(response, 'reservations', rows.rows, total.rows[0].total as number, page.page, page.limit);
    } catch (error) { next(error); }
  });

  router.get('/reservations/received', requireRoles('donor'), async (request, response, next) => {
    try {
      await expireDueDonations(pool);
      const page = pageParams(request);
      const donor = await organizationForUser(pool, request.auth!.id, 'donor');
      const status = parseStatusFilter(request.query.status);
      const values = [donor.id, status, page.limit, (page.page - 1) * page.limit];
      const rows = await pool.query(`SELECT ${reservationColumns} FROM reservations r
        JOIN donations d ON d.id=r.donation_id JOIN organizations donor ON donor.id=d.donor_organization_id
        JOIN organizations recipient ON recipient.id=r.recipient_organization_id
        JOIN users donor_user ON donor_user.id=donor.owner_user_id JOIN users recipient_user ON recipient_user.id=recipient.owner_user_id
        WHERE d.donor_organization_id=$1 AND ($2::text IS NULL OR ($2='history' AND r.status IN ('accepted','rejected','cancelled','expired','approved','picked_up','delivered')) OR r.status=$2)
        ORDER BY r.created_at DESC LIMIT $3 OFFSET $4`, values);
      const total = await pool.query(`SELECT count(*)::int AS total FROM reservations r JOIN donations d ON d.id=r.donation_id
        WHERE d.donor_organization_id=$1 AND ($2::text IS NULL OR ($2='history' AND r.status IN ('accepted','rejected','cancelled','expired','approved','picked_up','delivered')) OR r.status=$2)`, values.slice(0, 2));
      respondPage(response, 'reservations', rows.rows, total.rows[0].total as number, page.page, page.limit);
    } catch (error) { next(error); }
  });

  router.get('/reservations/:id', async (request, response, next) => {
    try {
      const id = parseId(request.params.id);
      await expireDueDonations(pool);
      const result = await pool.query(`SELECT ${reservationColumns} FROM reservations r
        JOIN donations d ON d.id=r.donation_id JOIN organizations donor ON donor.id=d.donor_organization_id
        JOIN organizations recipient ON recipient.id=r.recipient_organization_id
        JOIN users donor_user ON donor_user.id=donor.owner_user_id JOIN users recipient_user ON recipient_user.id=recipient.owner_user_id
        WHERE r.id=$1`, [id]);
      if (!result.rowCount) throw new ApiError(404, 'RESERVATION_NOT_FOUND', 'Reservation was not found.');
      const row = result.rows[0];
      if (request.auth!.role !== 'admin' && row.donor_owner_user_id !== request.auth!.id && row.recipient_owner_user_id !== request.auth!.id) {
        throw new ApiError(403, 'FORBIDDEN', 'You cannot view this reservation.');
      }
      response.json({ data: { reservation: row } });
    } catch (error) { next(error); }
  });

  router.patch('/reservations/:id/accept', requireRoles('donor'), async (request, response, next) => {
    try { response.json({ data: { reservation: await decideReservation(pool, request, parseId(request.params.id), 'accepted') } }); }
    catch (error) { next(error); }
  });
  router.patch('/reservations/:id/reject', requireRoles('donor'), async (request, response, next) => {
    try {
      const note = z.object({ note: z.string().trim().max(1000).optional() }).parse(request.body).note;
      response.json({ data: { reservation: await decideReservation(pool, request, parseId(request.params.id), 'rejected', note) } });
    } catch (error) { next(error); }
  });
  router.post('/reservations/:id/cancel', requireRoles('ngo'), async (request, response, next) => {
    try { response.json({ data: { reservation: await cancelReservation(pool, request, parseId(request.params.id)) } }); }
    catch (error) { next(error); }
  });

  router.get('/admin/donations', requireRoles('admin'), async (request, response, next) => {
    try {
      await expireDueDonations(pool);
      const query = adminDonationQuery.parse(request.query);
      const search = query.search ? `%${query.search}%` : null;
      const status = query.status === 'all' ? null : query.status;
      const values = [status, search, query.category ?? null, query.city ?? null, query.locality ?? null, query.pincode ?? null, query.deadline_before ?? null, query.limit, (query.page - 1) * query.limit];
      const rows = await pool.query(`SELECT ${donationColumns}, donor.name AS donor_organization_name
        FROM donations d JOIN organizations donor ON donor.id=d.donor_organization_id
        WHERE ($1::text IS NULL OR d.status=$1) AND ($2::text IS NULL OR d.food_name ILIKE $2 OR donor.name ILIKE $2)
          AND ($3::text IS NULL OR d.category=$3) AND ($4::text IS NULL OR d.city ILIKE $4)
          AND ($5::text IS NULL OR d.locality ILIKE $5) AND ($6::text IS NULL OR d.pincode=$6)
          AND ($7::timestamptz IS NULL OR d.collection_deadline <= $7)
        ORDER BY d.created_at DESC LIMIT $8 OFFSET $9`, values);
      const count = await pool.query(`SELECT count(*)::int AS total FROM donations d JOIN organizations donor ON donor.id=d.donor_organization_id
        WHERE ($1::text IS NULL OR d.status=$1) AND ($2::text IS NULL OR d.food_name ILIKE $2 OR donor.name ILIKE $2)
          AND ($3::text IS NULL OR d.category=$3) AND ($4::text IS NULL OR d.city ILIKE $4)
          AND ($5::text IS NULL OR d.locality ILIKE $5) AND ($6::text IS NULL OR d.pincode=$6)
          AND ($7::timestamptz IS NULL OR d.collection_deadline <= $7)`, values.slice(0, 7));
      respondPage(response, 'donations', rows.rows, count.rows[0].total as number, query.page, query.limit);
    } catch (error) { next(error); }
  });

  router.get('/admin/reservations', requireRoles('admin'), async (request, response, next) => {
    try {
      await expireDueDonations(pool);
      const query = adminReservationQuery.parse(request.query);
      const status = query.status === 'all' ? null : query.status;
      const search = query.search ? `%${query.search}%` : null;
      const values = [status, search, query.limit, (query.page - 1) * query.limit];
      const rows = await pool.query(`SELECT ${reservationColumns} FROM reservations r
        JOIN donations d ON d.id=r.donation_id JOIN organizations donor ON donor.id=d.donor_organization_id
        JOIN organizations recipient ON recipient.id=r.recipient_organization_id
        JOIN users donor_user ON donor_user.id=donor.owner_user_id JOIN users recipient_user ON recipient_user.id=recipient.owner_user_id
        WHERE ($1::text IS NULL OR r.status=$1) AND ($2::text IS NULL OR donor.name ILIKE $2 OR recipient.name ILIKE $2 OR d.food_name ILIKE $2)
        ORDER BY r.created_at DESC LIMIT $3 OFFSET $4`, values);
      const count = await pool.query(`SELECT count(*)::int AS total FROM reservations r JOIN donations d ON d.id=r.donation_id
        JOIN organizations donor ON donor.id=d.donor_organization_id JOIN organizations recipient ON recipient.id=r.recipient_organization_id
        WHERE ($1::text IS NULL OR r.status=$1) AND ($2::text IS NULL OR donor.name ILIKE $2 OR recipient.name ILIKE $2 OR d.food_name ILIKE $2)`, values.slice(0, 2));
      respondPage(response, 'reservations', rows.rows, count.rows[0].total as number, query.page, query.limit);
    } catch (error) { next(error); }
  });

  return router;
}

async function verifiedOrganization(db: Pool | PoolClient, userId: string, type: 'donor' | 'recipient') {
  const result = await db.query(`SELECT o.*, u.role, u.is_active FROM organizations o JOIN users u ON u.id=o.owner_user_id
    WHERE o.owner_user_id=$1 AND o.organization_type=$2 ORDER BY o.created_at DESC LIMIT 1`, [userId, type]);
  const organization = result.rows[0];
  if (!organization) throw new ApiError(404, 'ORGANIZATION_NOT_FOUND', 'A matching organization profile is required.');
  if (organization.role !== (type === 'donor' ? 'donor' : 'ngo')) throw new ApiError(403, 'ROLE_MISMATCH', 'This account cannot perform that organization action.');
  if (!organization.is_active) throw new ApiError(403, 'ACCOUNT_INACTIVE', 'This account is inactive.');
  if (organization.verification_status !== 'verified') throw new ApiError(403, 'ORGANIZATION_NOT_VERIFIED', 'Your organization must be verified before using this feature.');
  return organization;
}

async function organizationForUser(db: Pool | PoolClient, userId: string, type: 'donor' | 'recipient') {
  const result = await db.query('SELECT * FROM organizations WHERE owner_user_id=$1 AND organization_type=$2 ORDER BY created_at DESC LIMIT 1', [userId, type]);
  if (!result.rowCount) throw new ApiError(404, 'ORGANIZATION_NOT_FOUND', 'A matching organization profile is required.');
  return result.rows[0];
}

async function isInServiceArea(db: Pool | PoolClient, organization: { id: string; city: string; locality: string; pincode: string }, donation: { city: string; locality: string; pincode: string }) {
  const result = await db.query(`SELECT (
    (lower($2)=lower($5) AND lower($3)=lower($6) AND $4=$7)
    OR EXISTS (SELECT 1 FROM service_areas sa WHERE sa.organization_id=$1
      AND lower(sa.city)=lower($5)
      AND (sa.locality IS NULL OR lower(sa.locality)=lower($6))
      AND (sa.pincode IS NULL OR sa.pincode=$7))
    OR (lower($2)=lower($5) AND NOT EXISTS (SELECT 1 FROM service_areas sa WHERE sa.organization_id=$1))
  ) AS matched`, [organization.id, organization.city, organization.locality, organization.pincode,
    donation.city, donation.locality, donation.pincode]);
  return result.rows[0].matched as boolean;
}

async function assertDonationOwner(client: PoolClient, donationId: string, userId: string) {
  const owner = await client.query('SELECT 1 FROM donations d JOIN organizations o ON o.id=d.donor_organization_id WHERE d.id=$1 AND o.owner_user_id=$2', [donationId, userId]);
  if (!owner.rowCount) throw new ApiError(403, 'FORBIDDEN', 'You can only manage donations owned by your organization.');
}

async function decideReservation(pool: Pool, request: Request, id: string, decision: 'accepted' | 'rejected', note?: string) {
  return withTransaction(pool, async (client) => {
    await expireDue(client);
    const found = await client.query('SELECT donation_id FROM reservations WHERE id=$1', [id]);
    if (!found.rowCount) throw new ApiError(404, 'RESERVATION_NOT_FOUND', 'Reservation was not found.');
    const donationId = found.rows[0].donation_id as string;
    await client.query('SELECT id FROM donations WHERE id=$1 FOR UPDATE', [donationId]);
    const locked = await client.query('SELECT * FROM reservations WHERE id=$1 FOR UPDATE', [id]);
    const reservation = locked.rows[0];
    if (!reservation) throw new ApiError(404, 'RESERVATION_NOT_FOUND', 'Reservation was not found.');
    await assertDonationOwner(client, donationId, request.auth!.id);
    if (reservation.status !== 'pending') throw new ApiError(409, 'INVALID_RESERVATION_TRANSITION', 'Only pending reservation requests can be accepted or rejected.');
    const changed = await client.query('UPDATE reservations SET status=$1, status_reason=$2, updated_at=NOW() WHERE id=$3 RETURNING *', [decision, note ?? null, id]);
    if (decision === 'rejected') await releaseQuantity(client, donationId, Number(reservation.quantity));
    return changed.rows[0];
  });
}

async function cancelReservation(pool: Pool, request: Request, id: string) {
  return withTransaction(pool, async (client) => {
    await expireDue(client);
    const found = await client.query('SELECT donation_id FROM reservations WHERE id=$1', [id]);
    if (!found.rowCount) throw new ApiError(404, 'RESERVATION_NOT_FOUND', 'Reservation was not found.');
    const donationId = found.rows[0].donation_id as string;
    await client.query('SELECT id FROM donations WHERE id=$1 FOR UPDATE', [donationId]);
    const locked = await client.query('SELECT * FROM reservations WHERE id=$1 FOR UPDATE', [id]);
    const reservation = locked.rows[0];
    const organization = await organizationForUser(client, request.auth!.id, 'recipient');
    if (reservation.recipient_organization_id !== organization.id) throw new ApiError(403, 'FORBIDDEN', 'You can only cancel your own reservation.');
    if (!['pending', 'accepted', 'approved'].includes(reservation.status)) throw new ApiError(409, 'INVALID_RESERVATION_TRANSITION', 'Only pending or accepted reservations can be cancelled.');
    const updated = await client.query(`UPDATE reservations SET status='cancelled', status_reason='Cancelled by recipient organization.', updated_at=NOW() WHERE id=$1 RETURNING *`, [id]);
    await releaseQuantity(client, donationId, Number(reservation.quantity));
    return updated.rows[0];
  });
}

async function releaseQuantity(client: PoolClient, donationId: string, quantity: number) {
  const result = await client.query('SELECT * FROM donations WHERE id=$1 FOR UPDATE', [donationId]);
  const donation = result.rows[0];
  if (!donation) throw new ApiError(404, 'DONATION_NOT_FOUND', 'Donation was not found.');
  const reserved = Math.max(0, Number(donation.quantity_reserved) - quantity);
  const remaining = Math.min(Number(donation.quantity_total), Number(donation.quantity_remaining) + quantity);
  let status = donation.status;
  if (!['expired', 'cancelled', 'completed'].includes(status)) status = remaining === 0 ? 'fully_reserved' : reserved > 0 ? 'partially_reserved' : 'available';
  await client.query('UPDATE donations SET quantity_reserved=$1, quantity_remaining=$2, status=$3, updated_at=NOW() WHERE id=$4', [reserved, remaining, status, donationId]);
}

async function expireDueDonations(pool: Pool) {
  await withTransaction(pool, (client) => expireDue(client));
}

async function expireDue(client: PoolClient) {
  await client.query(`WITH due AS MATERIALIZED (
      SELECT id FROM donations WHERE collection_deadline <= NOW()
        AND status IN ('available','partially_reserved','fully_reserved','reserved')
      FOR UPDATE SKIP LOCKED
    ), released AS (
      UPDATE reservations SET status='expired', status_reason='Collection deadline passed before the request was resolved.', updated_at=NOW()
      WHERE status='pending' AND donation_id IN (SELECT id FROM due)
      RETURNING donation_id, quantity
    ), totals AS (
      SELECT donation_id, sum(quantity)::numeric(10,2) AS quantity FROM released GROUP BY donation_id
    )
    UPDATE donations d SET
      quantity_reserved = d.quantity_reserved - COALESCE(totals.quantity, 0),
      quantity_remaining = d.quantity_remaining + COALESCE(totals.quantity, 0),
      status = 'expired', updated_at = NOW()
    FROM due LEFT JOIN totals ON totals.donation_id=due.id
    WHERE d.id=due.id`);
}

async function withTransaction<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await callback(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

function parseId(value: string | string[]) {
  const result = uuidSchema.safeParse(Array.isArray(value) ? value[0] : value);
  if (!result.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Record id must be a valid UUID.');
  return result.data;
}

function pageParams(request: Request) {
  const parsed = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(12) }).parse(request.query);
  return parsed;
}

function parseStatusFilter(value: unknown) {
  if (value === undefined || value === '' || value === 'all') return null;
  return z.enum(['pending', 'accepted', 'rejected', 'cancelled', 'expired', 'approved', 'picked_up', 'delivered', 'history']).parse(value);
}

function donationFilters(query: z.infer<typeof listQuerySchema>, organizationId: string) {
  return [organizationId, query.status ?? null, query.search ? `%${query.search}%` : null, query.category ?? null,
    query.city ? `%${query.city}%` : null, query.locality ? `%${query.locality}%` : null,
    query.pincode ?? null, query.deadline_before ?? null];
}

async function paginatedDonations(pool: Pool, filters: unknown[], page: number, limit: number) {
  const values = [...filters, limit, (page - 1) * limit];
  const predicate = `d.donor_organization_id=$1 AND ($2::text IS NULL OR ($2='history' AND d.status IN ('fully_reserved','expired','cancelled','completed')) OR d.status=$2)
    AND ($3::text IS NULL OR d.food_name ILIKE $3 OR d.description ILIKE $3)
    AND ($4::text IS NULL OR d.category=$4) AND ($5::text IS NULL OR d.city ILIKE $5)
    AND ($6::text IS NULL OR d.locality ILIKE $6) AND ($7::text IS NULL OR d.pincode=$7)
    AND ($8::timestamptz IS NULL OR d.collection_deadline <= $8)`;
  const [rows, count] = await Promise.all([
    pool.query(`SELECT ${donationColumns} FROM donations d WHERE ${predicate} ORDER BY d.created_at DESC LIMIT $9 OFFSET $10`, values),
    pool.query(`SELECT count(*)::int AS total FROM donations d WHERE ${predicate}`, values.slice(0, 8)),
  ]);
  const total = count.rows[0].total as number;
  return { rows: rows.rows, total, pages: Math.ceil(total / limit) };
}

function respondPage(response: import('express').Response, key: 'donations' | 'reservations', rows: unknown[], total: number, page: number, limit: number) {
  response.json({ data: { [key]: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
}
