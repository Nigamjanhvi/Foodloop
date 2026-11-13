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

const schema = `foodloop_test_${randomBytes(8).toString('hex')}`;
const bootstrapPool = new Pool({ connectionString: databaseUrl, max: 1 });
const testPool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 4 });
const jwtSecret = randomBytes(48).toString('base64url');
const app = createApp(testPool, jwtSecret);
const testPassword = 'FoodLoop_Test_Pass_2026';
let donorToken = '';
let adminToken = '';
let adminId = '';
let organizationId = '';

before(async () => {
  await bootstrapPool.query(`CREATE SCHEMA ${schema}`);
  const migrationDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../database/migrations');
  const migrations = (await readdir(migrationDir)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name)).sort();
  for (const migration of migrations) {
    await testPool.query(await readFile(path.join(migrationDir, migration), 'utf8'));
  }
});

after(async () => {
  await testPool.end();
  await bootstrapPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await bootstrapPool.end();
});

test('registration validates input and atomically creates donor account and pending organization', async () => {
  const missingEmail = await request(app).post('/api/v1/auth/register').send({ fullName: 'Test User', phone: '+911234567890', password: testPassword, role: 'volunteer', volunteerLocation: { city: 'Phagwara', locality: 'Central', pincode: '144401' } });
  const missingPhone = await request(app).post('/api/v1/auth/register').send({ fullName: 'Test User', email: 'missing-phone@example.test', password: testPassword, role: 'volunteer', volunteerLocation: { city: 'Phagwara', locality: 'Central', pincode: '144401' } });
  const invalid = await request(app).post('/api/v1/auth/register').send({ email: 'not-an-email' });
  assert.equal(missingEmail.status, 400);
  assert.equal(missingPhone.status, 400);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');

  const response = await request(app).post('/api/v1/auth/register').send({
    fullName: 'Test Donor', email: 'donor@example.test', phone: '+911234567801', password: testPassword, role: 'donor',
    organization: {
      name: 'Test Community Kitchen', address: '12 Green Road, Phagwara', city: 'Phagwara',
      locality: 'Central', pincode: '144401', serviceAreas: [{ city: 'Phagwara', locality: 'Central', pincode: '144401' }],
    },
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.user.role, 'donor');
  assert.equal(response.body.data.user.verificationStatus, 'pending');
  assert.ok(response.body.data.token);
  assert.equal('password_hash' in response.body.data.user, false);
  organizationId = response.body.data.user.organizationId;
  const stored = await testPool.query('SELECT password_hash FROM users WHERE email = $1', ['donor@example.test']);
  assert.notEqual(stored.rows[0].password_hash, testPassword);
  assert.equal(await bcrypt.compare(testPassword, stored.rows[0].password_hash), true);

  const duplicateEmail = await request(app).post('/api/v1/auth/register').send({
    fullName: 'Duplicate Donor', email: 'donor@example.test', phone: '+911234567802', password: testPassword, role: 'donor',
    organization: { name: 'Duplicate Org', address: '12 Green Road', city: 'Phagwara', locality: 'Central', pincode: '144401' },
  });
  assert.equal(duplicateEmail.status, 409);
  assert.equal(duplicateEmail.body.error.code, 'EMAIL_IN_USE');

  const duplicatePhone = await request(app).post('/api/v1/auth/register').send({
    fullName: 'Duplicate Phone', email: 'duplicate-phone@example.test', phone: '+911234567801', password: testPassword, role: 'volunteer',
    volunteerLocation: { city: 'Phagwara', locality: 'Central', pincode: '144401' },
  });
  assert.equal(duplicatePhone.status, 409);
  assert.equal(duplicatePhone.body.error.code, 'PHONE_IN_USE');
});

test('login issues a signed session, /me requires it, and bad credentials are rejected', async () => {
  const wrong = await request(app).post('/api/v1/auth/login').send({ email: 'donor@example.test', phone: '+911234567801', password: 'wrong-password' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS');

  const mismatch = await request(app).post('/api/v1/auth/login').send({ email: 'donor@example.test', phone: '+911234567899', password: testPassword });
  assert.equal(mismatch.status, 401);

  const missingPhone = await request(app).post('/api/v1/auth/login').send({ email: 'donor@example.test', password: testPassword });
  assert.equal(missingPhone.status, 400);

  const login = await request(app).post('/api/v1/auth/login').send({ email: 'donor@example.test', phone: '+911234567801', password: testPassword });
  assert.equal(login.status, 200);
  donorToken = login.body.data.token;
  assert.ok(donorToken);
  assert.equal(login.body.data.user.organizationId, organizationId);

  const noToken = await request(app).get('/api/v1/auth/me');
  assert.equal(noToken.status, 401);
  const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${donorToken}`);
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.email, 'donor@example.test');
});

test('NGO and volunteer roles can register; admin cannot register publicly', async () => {
  const ngo = await request(app).post('/api/v1/auth/register').send({
    fullName: 'Test NGO', email: 'ngo@example.test', phone: '+911234567803', password: testPassword, role: 'ngo',
    organization: { name: 'Test NGO Organization', address: '8 Hope Street', city: 'Phagwara', locality: 'North', pincode: '144402' },
  });
  assert.equal(ngo.status, 201);
  const ngoOrganization = await testPool.query('SELECT organization_type FROM organizations WHERE owner_user_id = $1', [ngo.body.data.user.id]);
  assert.equal(ngoOrganization.rows[0].organization_type, 'recipient');

  const volunteer = await request(app).post('/api/v1/auth/register').send({
    fullName: 'Test Volunteer', email: 'volunteer@example.test', phone: '+911234567804', password: testPassword, role: 'volunteer',
    volunteerLocation: { city: 'Phagwara', locality: 'Central', pincode: '144401' },
  });
  assert.equal(volunteer.status, 201);
  const profile = await testPool.query('SELECT city, pincode FROM volunteer_profiles WHERE user_id = $1', [volunteer.body.data.user.id]);
  assert.equal(profile.rowCount, 1);

  const forbiddenRole = await request(app).post('/api/v1/auth/register').send({
    fullName: 'Public Admin', email: 'public-admin@example.test', phone: '+911234567805', password: testPassword, role: 'admin',
  });
  assert.equal(forbiddenRole.status, 400);
});

test('legacy accounts can securely enroll a missing phone without resetting their password', async () => {
  const legacyPassword = 'Legacy_User_Pass_2026';
  const legacyHash = await bcrypt.hash(legacyPassword, 12);
  const legacy = await testPool.query("INSERT INTO users (full_name, email, password_hash, role) VALUES ('Legacy User', 'legacy@example.test', $1, 'volunteer') RETURNING id", [legacyHash]);
  const needsPhone = await request(app).post('/api/v1/auth/login').send({ email: 'legacy@example.test', phone: '+911234567806', password: legacyPassword });
  assert.equal(needsPhone.status, 428);
  assert.equal(needsPhone.body.error.code, 'PHONE_ENROLLMENT_REQUIRED');

  const enrolled = await request(app).post('/api/v1/auth/enroll-phone').send({ email: 'legacy@example.test', phone: '+911234567806', password: legacyPassword });
  assert.equal(enrolled.status, 200);
  assert.ok(enrolled.body.data.token);
  const saved = await testPool.query('SELECT phone_e164, password_hash FROM users WHERE id = $1', [legacy.rows[0].id]);
  assert.equal(saved.rows[0].phone_e164, '+911234567806');
  assert.equal(saved.rows[0].password_hash, legacyHash);
});

test('role authorization denies donors and admin verification records real reviewer and timestamp', async () => {
  const donorDenied = await request(app).get('/api/v1/admin/organizations').set('Authorization', `Bearer ${donorToken}`);
  assert.equal(donorDenied.status, 403);

  const adminHash = await bcrypt.hash('Admin_Test_Pass_2026_Strong', 12);
  const admin = await testPool.query(
    "INSERT INTO users (full_name, email, password_hash, phone, phone_e164, role) VALUES ($1, $2, $3, $4, $4, 'admin') RETURNING id",
    ['Test Admin', 'admin@example.test', adminHash, '+911234567807'],
  );
  adminId = admin.rows[0].id;
  const login = await request(app).post('/api/v1/auth/login').send({ email: 'admin@example.test', phone: '+911234567807', password: 'Admin_Test_Pass_2026_Strong' });
  assert.equal(login.status, 200);
  adminToken = login.body.data.token;

  const queue = await request(app).get('/api/v1/admin/organizations').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(queue.status, 200);
  assert.ok(queue.body.data.organizations.some((organization: { id: string }) => organization.id === organizationId));

  const badId = await request(app).patch('/api/v1/admin/organizations/not-a-uuid/verification')
    .set('Authorization', `Bearer ${adminToken}`).send({ status: 'verified' });
  assert.equal(badId.status, 400);

  const result = await request(app).patch(`/api/v1/admin/organizations/${organizationId}/verification`)
    .set('Authorization', `Bearer ${adminToken}`).send({ status: 'verified', note: 'Documents reviewed in the demo.' });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.organization.verification_status, 'verified');

  const saved = await testPool.query('SELECT verification_status, verified_by_user_id, verified_at FROM organizations WHERE id = $1', [organizationId]);
  assert.equal(saved.rows[0].verification_status, 'verified');
  assert.equal(saved.rows[0].verified_by_user_id, adminId);
  assert.ok(saved.rows[0].verified_at);

  const rejectAgain = await request(app).patch(`/api/v1/admin/organizations/${organizationId}/verification`)
    .set('Authorization', `Bearer ${adminToken}`).send({ status: 'rejected', note: 'Please provide more organization details.' });
  assert.equal(rejectAgain.status, 200);
  assert.equal(rejectAgain.body.data.organization.verification_status, 'rejected');

  const overview = await request(app).get('/api/v1/admin/overview').set('Authorization', `Bearer ${adminToken}`);
  assert.equal(overview.status, 200);
  assert.ok(overview.body.data.counts.total_users >= 4);
  assert.equal(typeof overview.body.data.counts.rejected_organizations, 'number');

  const userList = await request(app).get('/api/v1/admin/users?role=donor&active=active&page=1&limit=5')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(userList.status, 200);
  assert.ok(userList.body.data.users.some((item: { email: string }) => item.email === 'donor@example.test'));
});
