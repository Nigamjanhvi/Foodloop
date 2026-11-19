import '../src/config/env.js';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import bcrypt from 'bcrypt';
import { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../src/app.js';

const databaseUrl=process.env.TEST_DATABASE_URL??process.env.DATABASE_URL;
if(!databaseUrl) throw new Error('Set TEST_DATABASE_URL or DATABASE_URL to run assignment integration tests.');
const schema=`foodloop_assignment_test_${randomBytes(7).toString('hex')}`;
const bootstrapPool=new Pool({connectionString:databaseUrl,max:1});
const pool=new Pool({connectionString:databaseUrl,options:`-c search_path=${schema},public`,max:8});
const jwtSecret=randomBytes(48).toString('base64url');
const app=createApp(pool,jwtSecret);
const password='FoodLoop_Assignment_Test_2026';
const auth=(token:string)=>({Authorization:`Bearer ${token}`});
let donorToken='';let otherDonorToken='';let ngoToken='';let otherNgoToken='';
let volunteerOneToken='';let volunteerTwoToken='';let volunteerOtherCityToken='';let inactiveVolunteerToken='';
let volunteerOneId='';let volunteerTwoId='';let donorOrgId='';let ngoOrgId='';let otherNgoOrgId='';

async function register(role:'donor'|'ngo'|'volunteer',email:string,phone:string,city='Phagwara',locality='Central',pincode='144401'){
  const body:any={fullName:email.split('@')[0],email,phone,password,role};
  if(role==='volunteer') body.volunteerLocation={city,locality,pincode};
  else body.organization={name:`${email} Organization`,address:`1 Community Road, ${city}`,city,locality,pincode,
    ...(role==='ngo'?{serviceAreas:[{city,locality,pincode}]}:{})};
  const result=await request(app).post('/api/v1/auth/register').send(body);
  assert.equal(result.status,201,JSON.stringify(result.body));
  return {token:result.body.data.token as string,id:result.body.data.user.id as string,organizationId:result.body.data.user.organizationId as string};
}
async function verifyOrg(id:string){
  const result=await request(app).patch(`/api/v1/admin/organizations/${id}/verification`).set(auth(adminToken)).send({status:'verified'});
  assert.equal(result.status,200,JSON.stringify(result.body));
}
let adminToken='';
function food(){
  return {food_name:'Rescue meal boxes',category:'cooked_meals',description:'Prepared lunch.',quantity_total:20,unit:'boxes',
    prepared_at:new Date(Date.now()-30*60_000).toISOString(),storage_type:'refrigerated',handling_info:'Keep chilled.',
    pickup_address:'1 Community Road, Phagwara',city:'Phagwara',locality:'Central',pincode:'144401',
    collection_deadline:new Date(Date.now()+4*60*60_000).toISOString()};
}
async function issueCode(kind:'pickup'|'delivery',assignmentId:string,token:string){
  const result=await request(app).post(`/api/v1/assignments/${assignmentId}/${kind}-otp/dev-code`).set(auth(token)).send({});
  assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.data.development_only,true);
  return result.body.data.code as string;
}
async function verifyCode(kind:'pickup'|'delivery',assignmentId:string,token:string,code:string){
  return request(app).post(`/api/v1/assignments/${assignmentId}/${kind}-otp/verify`).set(auth(token)).send({code});
}

before(async()=>{
  await bootstrapPool.query(`CREATE SCHEMA ${schema}`);
  const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../database/migrations');
  const files=(await readdir(dir)).filter((name)=>/^\d+_[a-z0-9_]+\.sql$/i.test(name)).sort();
  for(const file of files) await pool.query(await readFile(path.join(dir,file),'utf8'));
  const hash=await bcrypt.hash('Admin_Assignment_Test_2026',10);
  await pool.query(`INSERT INTO users(full_name,email,password_hash,phone,phone_e164,role)
    VALUES('Assignment Test Admin','phase4-admin@example.test',$1,'+911111111111','+911111111111','admin')`,[hash]);
  const admin=await request(app).post('/api/v1/auth/login').send({email:'phase4-admin@example.test',phone:'+911111111111',password:'Admin_Assignment_Test_2026'});
  assert.equal(admin.status,200);adminToken=admin.body.data.token;
  const donor=await register('donor','phase4-donor@example.test','+911111111112'); donorToken=donor.token;donorOrgId=donor.organizationId;
  const otherDonor=await register('donor','phase4-donor2@example.test','+911111111113');otherDonorToken=otherDonor.token;
  const ngo=await register('ngo','phase4-ngo@example.test','+911111111114');ngoToken=ngo.token;ngoOrgId=ngo.organizationId;
  const otherNgo=await register('ngo','phase4-ngo2@example.test','+911111111115');otherNgoToken=otherNgo.token;otherNgoOrgId=otherNgo.organizationId;
  const volunteer1=await register('volunteer','phase4-volunteer1@example.test','+911111111116');volunteerOneToken=volunteer1.token;volunteerOneId=volunteer1.id;
  const volunteer2=await register('volunteer','phase4-volunteer2@example.test','+911111111117');volunteerTwoToken=volunteer2.token;volunteerTwoId=volunteer2.id;
  volunteerOtherCityToken=(await register('volunteer','phase4-volunteer3@example.test','+911111111118','Jalandhar','Model Town','144001')).token;
  inactiveVolunteerToken=(await register('volunteer','phase4-volunteer4@example.test','+911111111119')).token;
  await pool.query("UPDATE users SET is_active=FALSE WHERE email='phase4-volunteer4@example.test'");
  await verifyOrg(donorOrgId);await verifyOrg(ngoOrgId);await verifyOrg(otherNgoOrgId);
});

after(async()=>{await pool.end();await bootstrapPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await bootstrapPool.end();});

test('volunteer assistance, OTP verification, authorization, concurrency, rollback, and delivered quantities persist correctly',async()=>{
  const donation=await request(app).post('/api/v1/donations').set(auth(donorToken)).send(food());
  assert.equal(donation.status,201,JSON.stringify(donation.body));
  const donationId=donation.body.data.donation.id as string;
  const reserveOne=await request(app).post(`/api/v1/donations/${donationId}/reservations`).set(auth(ngoToken)).send({quantity:4});
  assert.equal(reserveOne.status,201);
  const pendingAssignment=await request(app).post(`/api/v1/reservations/${reserveOne.body.data.reservation.id}/assignments`).set(auth(ngoToken)).send({});
  assert.equal(pendingAssignment.status,409);
  await request(app).patch(`/api/v1/reservations/${reserveOne.body.data.reservation.id}/accept`).set(auth(donorToken)).send({}).then((r)=>assert.equal(r.status,200));
  const assignmentResult=await request(app).post(`/api/v1/reservations/${reserveOne.body.data.reservation.id}/assignments`).set(auth(ngoToken)).send({});
  assert.equal(assignmentResult.status,201,JSON.stringify(assignmentResult.body));
  const assignmentId=assignmentResult.body.data.assignment.id as string;
  assert.equal(assignmentResult.body.data.assignment.status,'offered');
  assert.equal((await request(app).post(`/api/v1/reservations/${reserveOne.body.data.reservation.id}/assignments`).set(auth(ngoToken)).send({})).status,409);
  assert.equal((await request(app).post(`/api/v1/reservations/${reserveOne.body.data.reservation.id}/assignments`).set(auth(otherNgoToken)).send({})).status,404);

  const profile=await request(app).get('/api/v1/volunteers/me').set(auth(volunteerOneToken));
  assert.equal(profile.status,200);assert.equal(profile.body.data.profile.locality,'Central');
  const profileUpdated=await request(app).patch('/api/v1/volunteers/me').set(auth(volunteerOneToken)).send({locality:'Central',is_available:true});
  assert.equal(profileUpdated.status,200);
  assert.equal((await request(app).patch('/api/v1/volunteers/me').set(auth(donorToken)).send({is_available:false})).status,403);

  const offered=await request(app).get('/api/v1/volunteers/assignments/available').set(auth(volunteerOneToken));
  assert.equal(offered.status,200);assert.ok(offered.body.data.assignments.some((item:any)=>item.id===assignmentId));
  const outside=await request(app).get('/api/v1/volunteers/assignments/available').set(auth(volunteerOtherCityToken));
  assert.equal(outside.status,200);assert.equal(outside.body.data.assignments.length,0);
  assert.equal((await request(app).get('/api/v1/volunteers/assignments/available').set(auth(inactiveVolunteerToken))).status,401);
  assert.equal((await request(app).get(`/api/v1/assignments/${assignmentId}`).set(auth(otherDonorToken))).status,403);
  assert.equal((await request(app).get(`/api/v1/assignments/${assignmentId}`).set(auth(volunteerOtherCityToken))).status,403);

  const attempts=await Promise.all([
    request(app).post(`/api/v1/assignments/${assignmentId}/accept`).set(auth(volunteerOneToken)).send({}),
    request(app).post(`/api/v1/assignments/${assignmentId}/accept`).set(auth(volunteerTwoToken)).send({}),
  ]);
  assert.deepEqual(attempts.map((item)=>item.status).sort(),[200,409]);
  const assignedToken=attempts[0].status===200?volunteerOneToken:volunteerTwoToken;
  const assignedId=attempts[0].status===200?volunteerOneId:volunteerTwoId;
  const loserToken=attempts[0].status===409?volunteerOneToken:volunteerTwoToken;
  assert.equal((await request(app).get(`/api/v1/assignments/${assignmentId}`).set(auth(loserToken))).status,403);
  const acceptedAssignment=await pool.query('SELECT status,volunteer_user_id,pickup_otp_hash,pickup_otp_expires_at FROM reservation_assignments WHERE id=$1',[assignmentId]);
  assert.equal(acceptedAssignment.rows[0].status,'accepted');assert.equal(acceptedAssignment.rows[0].volunteer_user_id,assignedId);
  assert.ok(acceptedAssignment.rows[0].pickup_otp_hash);assert.equal(typeof acceptedAssignment.rows[0].pickup_otp_hash,'string');

  assert.equal((await request(app).post(`/api/v1/assignments/${assignmentId}/delivery-otp/dev-code`).set(auth(ngoToken)).send({})).status,409);
  assert.equal((await request(app).post(`/api/v1/assignments/${assignmentId}/pickup-otp/dev-code`).set(auth(otherDonorToken)).send({})).status,403);
  await pool.query('UPDATE reservation_assignments SET pickup_otp_expires_at=NOW()-INTERVAL \'1 minute\' WHERE id=$1',[assignmentId]);
  assert.equal((await verifyCode('pickup',assignmentId,assignedToken,'000000')).status,410);
  const pickupCode=await issueCode('pickup',assignmentId,donorToken);
  const pickupHash=await pool.query('SELECT pickup_otp_hash FROM reservation_assignments WHERE id=$1',[assignmentId]);
  assert.notEqual(pickupHash.rows[0].pickup_otp_hash,pickupCode);
  assert.equal(pickupHash.rows[0].pickup_otp_hash,createHmac('sha256',jwtSecret).update(`${assignmentId}:pickup:${pickupCode}`).digest('hex'));
  for(let i=0;i<5;i++) assert.equal((await verifyCode('pickup',assignmentId,assignedToken,'999999')).status,400);
  assert.equal((await verifyCode('pickup',assignmentId,assignedToken,'999999')).status,429);
  const renewedPickupCode=await issueCode('pickup',assignmentId,donorToken);
  const pickup=await verifyCode('pickup',assignmentId,assignedToken,renewedPickupCode);
  assert.equal(pickup.status,200,JSON.stringify(pickup.body));assert.equal(pickup.body.data.assignment.status,'picked_up');
  assert.equal((await verifyCode('pickup',assignmentId,assignedToken,renewedPickupCode)).status,409);
  assert.equal((await request(app).post(`/api/v1/assignments/${assignmentId}/delivery-otp/dev-code`).set(auth(otherNgoToken)).send({})).status,403);
  assert.equal((await request(app).get('/api/v1/volunteers/assignments/mine?status=active').set(auth(assignedToken))).body.data.assignments[0].status,'picked_up');

  const deliveryCode=await issueCode('delivery',assignmentId,ngoToken);
  const deliveryHash=await pool.query('SELECT delivery_otp_hash FROM reservation_assignments WHERE id=$1',[assignmentId]);
  assert.ok(deliveryHash.rows[0].delivery_otp_hash);assert.notEqual(deliveryHash.rows[0].delivery_otp_hash,pickupHash.rows[0].pickup_otp_hash);
  assert.equal((await verifyCode('delivery',assignmentId,assignedToken,'123456')).status,400);
  await pool.query('UPDATE reservation_assignments SET delivery_otp_expires_at=NOW()-INTERVAL \'1 minute\' WHERE id=$1',[assignmentId]);
  assert.equal((await verifyCode('delivery',assignmentId,assignedToken,deliveryCode)).status,410);
  const renewedDeliveryCode=await issueCode('delivery',assignmentId,ngoToken);
  await pool.query('ALTER TABLE donations ADD CONSTRAINT phase4_force_delivery_rollback CHECK (quantity_delivered=0) NOT VALID');
  const failedDelivery=await verifyCode('delivery',assignmentId,assignedToken,renewedDeliveryCode);
  assert.equal(failedDelivery.status,500);
  await pool.query('ALTER TABLE donations DROP CONSTRAINT phase4_force_delivery_rollback');
  const rollbackState=await pool.query(`SELECT a.status AS assignment_status,r.status AS reservation_status,d.quantity_delivered
    FROM reservation_assignments a JOIN reservations r ON r.id=a.reservation_id JOIN donations d ON d.id=r.donation_id WHERE a.id=$1`,[assignmentId]);
  assert.equal(rollbackState.rows[0].assignment_status,'picked_up');assert.equal(rollbackState.rows[0].reservation_status,'picked_up');assert.equal(Number(rollbackState.rows[0].quantity_delivered),0);
  const delivery=await verifyCode('delivery',assignmentId,assignedToken,renewedDeliveryCode);
  assert.equal(delivery.status,200,JSON.stringify(delivery.body));assert.equal(delivery.body.data.assignment.status,'delivered');
  assert.equal((await verifyCode('delivery',assignmentId,assignedToken,renewedDeliveryCode)).status,409);
  const final=await pool.query(`SELECT a.status AS assignment_status,r.status AS reservation_status,d.quantity_delivered
    FROM reservation_assignments a JOIN reservations r ON r.id=a.reservation_id JOIN donations d ON d.id=r.donation_id WHERE a.id=$1`,[assignmentId]);
  assert.equal(final.rows[0].assignment_status,'delivered');assert.equal(final.rows[0].reservation_status,'delivered');assert.equal(Number(final.rows[0].quantity_delivered),4);

  const secondReservation=await request(app).post(`/api/v1/donations/${donationId}/reservations`).set(auth(otherNgoToken)).send({quantity:3});
  assert.equal(secondReservation.status,201);
  assert.equal((await request(app).patch(`/api/v1/reservations/${secondReservation.body.data.reservation.id}/accept`).set(auth(donorToken)).send({})).status,200);
  const secondAssignment=await request(app).post(`/api/v1/reservations/${secondReservation.body.data.reservation.id}/assignments`).set(auth(otherNgoToken)).send({});
  assert.equal(secondAssignment.status,201);
  const nextVolunteer=await request(app).post(`/api/v1/assignments/${secondAssignment.body.data.assignment.id}/accept`).set(auth(assignedToken)).send({});
  assert.equal(nextVolunteer.status,200,JSON.stringify(nextVolunteer.body));
  const secondId=secondAssignment.body.data.assignment.id as string;
  const secondPickup=await verifyCode('pickup',secondId,assignedToken,await issueCode('pickup',secondId,donorToken));
  assert.equal(secondPickup.status,200);
  const secondDeliveryCode=await issueCode('delivery',secondId,otherNgoToken);
  assert.equal((await verifyCode('delivery',secondId,assignedToken,secondDeliveryCode)).status,200);
  const delivered=await pool.query('SELECT quantity_delivered FROM donations WHERE id=$1',[donationId]);
  assert.equal(Number(delivered.rows[0].quantity_delivered),7);
  assert.equal((await request(app).get('/api/v1/volunteers/assignments/mine?status=completed').set(auth(assignedToken))).body.data.assignments.length,2);
  assert.ok(ngoOrgId);assert.ok(otherNgoOrgId);
});
