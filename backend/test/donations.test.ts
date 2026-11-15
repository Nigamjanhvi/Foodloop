import '../src/config/env.js';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import bcrypt from 'bcrypt';
import { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../src/app.js';

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Set TEST_DATABASE_URL or DATABASE_URL to run backend integration tests.');
const schema = `foodloop_donations_test_${randomBytes(7).toString('hex')}`;
const bootstrapPool = new Pool({ connectionString: databaseUrl, max: 1 });
const testPool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 6 });
const app = createApp(testPool, randomBytes(48).toString('base64url'));
const password = 'FoodLoop_Donations_Test_2026';
const headers = (token: string) => ({ Authorization: `Bearer ${token}` });
let donorToken = '';
let otherDonorToken = '';
let pendingDonorToken = '';
let ngoToken = '';
let secondNgoToken = '';
let adminToken = '';
let donorOrganizationId = '';
let otherDonorOrganizationId = '';
let ngoOrganizationId = '';

async function register(input: { role: 'donor' | 'ngo'; email: string; phone: string; name: string; locality: string; pincode: string }) {
  const role = input.role;
  const response = await request(app).post('/api/v1/auth/register').send({
    fullName: input.name, email: input.email, phone: input.phone, password, role,
    organization: {
      name: `${input.name} Organization`, address: '1 Community Road, Phagwara', city: 'Phagwara',
      locality: input.locality, pincode: input.pincode,
      ...(role === 'ngo' ? { serviceAreas: [{ city: 'Phagwara', locality: 'Central', pincode: '144401' }] } : {}),
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return { token: response.body.data.token as string, organizationId: response.body.data.user.organizationId as string };
}

function donationInput(overrides: Record<string, unknown> = {}) {
  const prepared = new Date(Date.now() - 30 * 60_000);
  const deadline = new Date(Date.now() + 4 * 60 * 60_000);
  return {
    food_name: 'Vegetable rice meal', category: 'cooked_meals', description: 'Freshly prepared surplus lunch.',
    quantity_total: 50, unit: 'packets', prepared_at: prepared.toISOString(), storage_type: 'ambient',
    handling_info: 'Keep covered and collect promptly.', pickup_address: '1 Community Road, Phagwara',
    city: 'Phagwara', locality: 'Central', pincode: '144401', collection_deadline: deadline.toISOString(),
    ...overrides,
  };
}

async function verifyOrganization(id: string) {
  const response = await request(app).patch(`/api/v1/admin/organizations/${id}/verification`)
    .set(headers(adminToken)).send({ status: 'verified', note: 'Verified for local integration testing.' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
}

before(async () => {
  await bootstrapPool.query(`CREATE SCHEMA ${schema}`);
  const migrationDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database/migrations');
  const migrations = (await readdir(migrationDir)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name)).sort();
  for (const migration of migrations) await testPool.query(await readFile(path.join(migrationDir, migration), 'utf8'));

  const adminHash = await bcrypt.hash('Admin_FoodLoop_Test_2026', 10);
  const admin = await testPool.query(`INSERT INTO users (full_name,email,password_hash,phone,phone_e164,role)
    VALUES ('Test Administrator','phase3-admin@example.test',$1,'+911234567890','+911234567890','admin') RETURNING id`, [adminHash]);
  const adminLogin = await request(app).post('/api/v1/auth/login').send({ email: 'phase3-admin@example.test', phone: '+911234567890', password: 'Admin_FoodLoop_Test_2026' });
  assert.equal(adminLogin.status, 200);
  adminToken = adminLogin.body.data.token;

  const donor = await register({ role: 'donor', email: 'phase3-donor@example.test', phone: '+911234567891', name: 'Phase Three Donor', locality: 'Central', pincode: '144401' });
  donorToken = donor.token; donorOrganizationId = donor.organizationId;
  const secondDonor = await register({ role: 'donor', email: 'phase3-donor-two@example.test', phone: '+911234567892', name: 'Another Donor', locality: 'East', pincode: '144403' });
  otherDonorToken = secondDonor.token; otherDonorOrganizationId = secondDonor.organizationId;
  const pendingDonor = await register({ role: 'donor', email: 'phase3-pending@example.test', phone: '+911234567893', name: 'Pending Donor', locality: 'West', pincode: '144404' });
  pendingDonorToken = pendingDonor.token;
  const ngo = await register({ role: 'ngo', email: 'phase3-ngo@example.test', phone: '+911234567894', name: 'North Community Kitchen', locality: 'North', pincode: '144402' });
  ngoToken = ngo.token; ngoOrganizationId = ngo.organizationId;
  const secondNgo = await register({ role: 'ngo', email: 'phase3-ngo-two@example.test', phone: '+911234567895', name: 'Central Food Support', locality: 'Central', pincode: '144401' });
  secondNgoToken = secondNgo.token;
  await verifyOrganization(donorOrganizationId);
  await verifyOrganization(otherDonorOrganizationId);
  await verifyOrganization(ngoOrganizationId);
  const secondNgoId = (await testPool.query('SELECT id FROM organizations WHERE owner_user_id=(SELECT id FROM users WHERE email=$1)', ['phase3-ngo-two@example.test'])).rows[0].id as string;
  await verifyOrganization(secondNgoId);
  void admin.rows[0].id;
});

after(async () => {
  await testPool.end();
  await bootstrapPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await bootstrapPool.end();
});

test('verified donor, recipient discovery, reservations, concurrency, expiry, and admin inspection use persisted rows', async () => {
  const pendingDenied = await request(app).post('/api/v1/donations').set(headers(pendingDonorToken)).send(donationInput());
  assert.equal(pendingDenied.status, 403);
  assert.equal(pendingDenied.body.error.code, 'ORGANIZATION_NOT_VERIFIED');
  const ngoCannotCreate = await request(app).post('/api/v1/donations').set(headers(ngoToken)).send(donationInput());
  assert.equal(ngoCannotCreate.status, 403);
  const noAuth = await request(app).get('/api/v1/donations/available');
  assert.equal(noAuth.status, 401);

  const invalidQuantity = await request(app).post('/api/v1/donations').set(headers(donorToken)).send(donationInput({ quantity_total: -2 }));
  assert.equal(invalidQuantity.status, 400);
  const pastDeadline = await request(app).post('/api/v1/donations').set(headers(donorToken)).send(donationInput({ collection_deadline: new Date(Date.now() - 60_000).toISOString() }));
  assert.equal(pastDeadline.status, 400);

  const created = await request(app).post('/api/v1/donations').set(headers(donorToken)).send(donationInput());
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const donationId = created.body.data.donation.id as string;
  assert.equal(Number(created.body.data.donation.quantity_remaining), 50);
  assert.equal(Number(created.body.data.donation.quantity_reserved), 0);

  const otherCreated = await request(app).post('/api/v1/donations').set(headers(otherDonorToken)).send(donationInput({ food_name: 'Bread boxes', category: 'bakery', quantity_total: 12, unit: 'boxes', locality: 'East', pincode: '144403' }));
  assert.equal(otherCreated.status, 201);
  const ownRows = await request(app).get('/api/v1/donations/mine').set(headers(donorToken));
  assert.equal(ownRows.status, 200);
  assert.equal(ownRows.body.data.pagination.total, 1);
  assert.equal(ownRows.body.data.summary.total_donations, 1);

  const discovered = await request(app).get('/api/v1/donations/available?city=Phagwara&pincode=144401&locality=Central').set(headers(ngoToken));
  assert.equal(discovered.status, 200, JSON.stringify(discovered.body));
  assert.ok(discovered.body.data.donations.some((item: { id: string }) => item.id === donationId));
  assert.equal(discovered.body.data.donations[0].donor_organization_name, 'Phase Three Donor Organization');
  assert.equal('donor_contact_phone' in discovered.body.data.donations[0], false);

  await testPool.query(`INSERT INTO service_areas (organization_id, city, locality, pincode) VALUES ($1,'Ludhiana','Model Town','141002')`, [ngoOrganizationId]);
  const serviceAreaFood = await request(app).post('/api/v1/donations').set(headers(donorToken)).send(donationInput({
    food_name: 'Ludhiana produce boxes', category: 'vegetables', quantity_total: 6, unit: 'boxes',
    city: 'Ludhiana', locality: 'Model Town', pincode: '141002', pickup_address: '2 Market Road, Ludhiana',
  }));
  assert.equal(serviceAreaFood.status, 201, JSON.stringify(serviceAreaFood.body));
  const multiCityDiscovery = await request(app).get('/api/v1/donations/available').set(headers(ngoToken));
  assert.equal(multiCityDiscovery.status, 200, JSON.stringify(multiCityDiscovery.body));
  assert.ok(multiCityDiscovery.body.data.donations.some((item: { id: string }) => item.id === serviceAreaFood.body.data.donation.id));
  const serviceAreaDetails = await request(app).get(`/api/v1/donations/${serviceAreaFood.body.data.donation.id}`).set(headers(ngoToken));
  assert.equal(serviceAreaDetails.status, 200);

  const details = await request(app).get(`/api/v1/donations/${donationId}`).set(headers(ngoToken));
  assert.equal(details.status, 200);
  const ownDonation = await request(app).get(`/api/v1/donations/${otherCreated.body.data.donation.id}`).set(headers(donorToken));
  assert.equal(ownDonation.status, 403);

  const firstRequest = await request(app).post(`/api/v1/donations/${donationId}/reservations`).set(headers(ngoToken)).send({ quantity: 20, message: 'We can collect before lunch.' });
  assert.equal(firstRequest.status, 201, JSON.stringify(firstRequest.body));
  const reservationOne = firstRequest.body.data.reservation.id as string;
  const duplicate = await request(app).post(`/api/v1/donations/${donationId}/reservations`).set(headers(ngoToken)).send({ quantity: 1 });
  assert.equal(duplicate.status, 409);
  const tooMuch = await request(app).post(`/api/v1/donations/${donationId}/reservations`).set(headers(secondNgoToken)).send({ quantity: 31 });
  assert.equal(tooMuch.status, 409);
  const secondRequest = await request(app).post(`/api/v1/donations/${donationId}/reservations`).set(headers(secondNgoToken)).send({ quantity: 30, message: 'Our kitchen can use these.' });
  assert.equal(secondRequest.status, 201);
  const reservationTwo = secondRequest.body.data.reservation.id as string;
  const full = await testPool.query('SELECT quantity_reserved,quantity_remaining,status FROM donations WHERE id=$1', [donationId]);
  assert.equal(Number(full.rows[0].quantity_reserved), 50);
  assert.equal(Number(full.rows[0].quantity_remaining), 0);
  assert.equal(full.rows[0].status, 'fully_reserved');

  const ownReservation = await request(app).get('/api/v1/reservations/mine').set(headers(ngoToken));
  assert.equal(ownReservation.status, 200);
  assert.equal(ownReservation.body.data.pagination.total, 1);
  const received = await request(app).get('/api/v1/reservations/received').set(headers(donorToken));
  assert.equal(received.status, 200);
  assert.equal(received.body.data.pagination.total, 2);
  const accepted = await request(app).patch(`/api/v1/reservations/${reservationOne}/accept`).set(headers(donorToken)).send({});
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.data.reservation.status, 'accepted');
  const wrongDonorAction = await request(app).patch(`/api/v1/reservations/${reservationTwo}/reject`).set(headers(otherDonorToken)).send({});
  assert.equal(wrongDonorAction.status, 403);
  const rejected = await request(app).patch(`/api/v1/reservations/${reservationTwo}/reject`).set(headers(donorToken)).send({ note: 'We need a later collection time.' });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.data.reservation.status, 'rejected');
  assert.equal(rejected.body.data.reservation.status_reason, 'We need a later collection time.');
  const released = await testPool.query('SELECT quantity_reserved,quantity_remaining,status FROM donations WHERE id=$1', [donationId]);
  assert.equal(Number(released.rows[0].quantity_reserved), 20);
  assert.equal(Number(released.rows[0].quantity_remaining), 30);
  assert.equal(released.rows[0].status, 'partially_reserved');
  const repeatDecision = await request(app).patch(`/api/v1/reservations/${reservationTwo}/reject`).set(headers(donorToken)).send({});
  assert.equal(repeatDecision.status, 409);

  const canReRequest = await request(app).post(`/api/v1/donations/${donationId}/reservations`).set(headers(secondNgoToken)).send({ quantity: 10 });
  assert.equal(canReRequest.status, 201);
  const cancelledPending = await request(app).post(`/api/v1/reservations/${canReRequest.body.data.reservation.id}/cancel`).set(headers(secondNgoToken)).send({});
  assert.equal(cancelledPending.status, 200);
  const unauthorizedEdit = await request(app).patch(`/api/v1/donations/${donationId}`).set(headers(otherDonorToken)).send({ food_name: 'Taken over' });
  assert.equal(unauthorizedEdit.status, 403);
  const belowReserved = await request(app).patch(`/api/v1/donations/${donationId}`).set(headers(donorToken)).send({ quantity_total: 10 });
  assert.equal(belowReserved.status, 400);
  const unitChange = await request(app).patch(`/api/v1/donations/${donationId}`).set(headers(donorToken)).send({ unit: 'kilograms' });
  assert.equal(unitChange.status, 409);
  const edited = await request(app).patch(`/api/v1/donations/${donationId}`).set(headers(donorToken)).send({ quantity_total: 25, description: 'Updated meal details.' });
  assert.equal(edited.status, 200);
  assert.equal(Number(edited.body.data.donation.quantity_remaining), 5);
  const cancelWithAccepted = await request(app).post(`/api/v1/donations/${donationId}/cancel`).set(headers(donorToken)).send({});
  assert.equal(cancelWithAccepted.status, 409);
  const cancelAccepted = await request(app).post(`/api/v1/reservations/${reservationOne}/cancel`).set(headers(ngoToken)).send({});
  assert.equal(cancelAccepted.status, 200);
  assert.equal(cancelAccepted.body.data.reservation.status, 'cancelled');
  const cancelDonation = await request(app).post(`/api/v1/donations/${donationId}/cancel`).set(headers(donorToken)).send({});
  assert.equal(cancelDonation.status, 200);
  assert.equal(cancelDonation.body.data.donation.status, 'cancelled');
  const cancelledRequest = await request(app).post(`/api/v1/donations/${donationId}/reservations`).set(headers(ngoToken)).send({ quantity: 1 });
  assert.equal(cancelledRequest.status, 409);

  const expiring = await request(app).post('/api/v1/donations').set(headers(donorToken)).send(donationInput({ food_name: 'Fresh fruit boxes', category: 'fruits', quantity_total: 10 }));
  assert.equal(expiring.status, 201);
  const expiringId = expiring.body.data.donation.id as string;
  const pending = await request(app).post(`/api/v1/donations/${expiringId}/reservations`).set(headers(ngoToken)).send({ quantity: 5 });
  assert.equal(pending.status, 201);
  await testPool.query('UPDATE donations SET collection_deadline=NOW() - interval \'1 minute\' WHERE id=$1', [expiringId]);
  const afterExpiry = await request(app).get('/api/v1/donations/available?city=Phagwara').set(headers(ngoToken));
  assert.equal(afterExpiry.status, 200);
  assert.equal(afterExpiry.body.data.donations.some((item: { id: string }) => item.id === expiringId), false);
  const expiredState = await testPool.query(`SELECT d.status,d.quantity_reserved,d.quantity_remaining,r.status AS reservation_status
    FROM donations d JOIN reservations r ON r.donation_id=d.id WHERE d.id=$1`, [expiringId]);
  assert.equal(expiredState.rows[0].status, 'expired');
  assert.equal(Number(expiredState.rows[0].quantity_reserved), 0);
  assert.equal(Number(expiredState.rows[0].quantity_remaining), 10);
  assert.equal(expiredState.rows[0].reservation_status, 'expired');

  const concurrentDonation = await request(app).post('/api/v1/donations').set(headers(donorToken)).send(donationInput({ food_name: 'Soup containers', quantity_total: 12 }));
  assert.equal(concurrentDonation.status, 201);
  const concurrentId = concurrentDonation.body.data.donation.id as string;
  const simultaneous = await Promise.all([
    request(app).post(`/api/v1/donations/${concurrentId}/reservations`).set(headers(ngoToken)).send({ quantity: 8 }),
    request(app).post(`/api/v1/donations/${concurrentId}/reservations`).set(headers(secondNgoToken)).send({ quantity: 8 }),
  ]);
  assert.deepEqual(simultaneous.map((item) => item.status).sort(), [201, 409]);
  const concurrentState = await testPool.query('SELECT quantity_reserved,quantity_remaining FROM donations WHERE id=$1', [concurrentId]);
  assert.equal(Number(concurrentState.rows[0].quantity_reserved), 8);
  assert.equal(Number(concurrentState.rows[0].quantity_remaining), 4);
  assert.ok(Number(concurrentState.rows[0].quantity_remaining) >= 0);

  const rollbackDonation = await request(app).post('/api/v1/donations').set(headers(donorToken)).send(donationInput({ food_name: 'Rollback proof meal', quantity_total: 9 }));
  assert.equal(rollbackDonation.status, 201);
  const rollbackId = rollbackDonation.body.data.donation.id as string;
  await testPool.query('ALTER TABLE donations ADD CONSTRAINT phase3_force_reservation_rollback CHECK (quantity_reserved = 0) NOT VALID');
  const failedReservation = await request(app).post(`/api/v1/donations/${rollbackId}/reservations`).set(headers(ngoToken)).send({ quantity: 3 });
  assert.equal(failedReservation.status, 500);
  await testPool.query('ALTER TABLE donations DROP CONSTRAINT phase3_force_reservation_rollback');
  const rollbackState = await testPool.query(`SELECT d.quantity_reserved,d.quantity_remaining,count(r.id)::int AS reservations
    FROM donations d LEFT JOIN reservations r ON r.donation_id=d.id WHERE d.id=$1 GROUP BY d.id`, [rollbackId]);
  assert.equal(Number(rollbackState.rows[0].quantity_reserved), 0);
  assert.equal(Number(rollbackState.rows[0].quantity_remaining), 9);
  assert.equal(rollbackState.rows[0].reservations, 0);

  const adminDonations = await request(app).get('/api/v1/admin/donations?status=all').set(headers(adminToken));
  assert.equal(adminDonations.status, 200);
  assert.ok(adminDonations.body.data.donations.length >= 3);
  const adminReservations = await request(app).get('/api/v1/admin/reservations?status=all').set(headers(adminToken));
  assert.equal(adminReservations.status, 200);
  assert.ok(adminReservations.body.data.reservations.length >= 5);
  assert.equal((await request(app).get('/api/v1/admin/donations').set(headers(donorToken))).status, 403);
  assert.equal((await request(app).get('/api/v1/admin/reservations').set(headers(ngoToken))).status, 403);
  assert.ok(ngoOrganizationId);
});
