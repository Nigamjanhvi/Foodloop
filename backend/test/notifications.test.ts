import '../src/config/env.js';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import bcrypt from 'bcrypt';
import type { Transporter } from 'nodemailer';
import { Pool } from 'pg';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { claimNotification, processNextNotification } from '../src/notifications/workerCore.js';

const databaseUrl=process.env.TEST_DATABASE_URL??process.env.DATABASE_URL;
if(!databaseUrl)throw new Error('Set TEST_DATABASE_URL or DATABASE_URL to run notification integration tests.');
const schema=`foodloop_phase5_test_${randomBytes(7).toString('hex')}`;
const bootstrap=new Pool({connectionString:databaseUrl,max:1});
const pool=new Pool({connectionString:databaseUrl,options:`-c search_path=${schema},public`,max:8});
const secret=randomBytes(48).toString('base64url');const app=createApp(pool,secret);const password='FoodLoop_Phase5_Test_2026';
const auth=(token:string)=>({Authorization:`Bearer ${token}`});
let server:ReturnType<typeof app.listen>;let origin='';let adminToken='';let donorToken='';let ngoToken='';let otherDonorToken='';let donorOrganization='';

async function register(role:'donor'|'ngo',email:string,locality='Central'){
  const response=await request(app).post('/api/v1/auth/register').send({fullName:email.split('@')[0],email,phone:`+91155${String(Math.floor(Math.random()*1e6)).padStart(6,'0')}`,password,role,
    organization:{name:`${email} Organization`,address:'1 FoodLoop Lane',city:'Phagwara',locality,pincode:'144401',...(role==='ngo'?{serviceAreas:[{city:'Phagwara',locality:'Central',pincode:'144401'}]}:{})}});
  assert.equal(response.status,201,JSON.stringify(response.body));return {token:response.body.data.token as string,organizationId:response.body.data.user.organizationId as string};
}
async function nextEvent(reader:ReadableStreamDefaultReader<Uint8Array>,timeoutMs=5000){
  let text='';const end=Date.now()+timeoutMs;
  while(Date.now()<end){const next=await Promise.race([reader.read(),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Timed out waiting for SSE event.')),Math.max(1,end-Date.now())))]);
    if(next.done)break;text+=new TextDecoder().decode(next.value);if(text.includes('event: update')&&text.includes('\n\n'))return text;
  }
  throw new Error('SSE stream ended before an update arrived.');
}

before(async()=>{
  await bootstrap.query(`CREATE SCHEMA ${schema}`);
  const directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../database/migrations');
  const migrations=(await readdir(directory)).filter((name)=>/^\d+_[a-z0-9_]+\.sql$/i.test(name)).sort();
  for(const migration of migrations)await pool.query(await readFile(path.join(directory,migration),'utf8'));
  const hash=await bcrypt.hash(password,10);
  await pool.query(`INSERT INTO users(full_name,email,password_hash,phone,phone_e164,role) VALUES('Phase Five Admin','phase5-admin@example.test',$1,'+911111111111','+911111111111','admin')`,[hash]);
  const login=await request(app).post('/api/v1/auth/login').send({email:'phase5-admin@example.test',password});assert.equal(login.status,200);adminToken=login.body.data.token;
  const donor=await register('donor','phase5-donor@example.test');donorToken=donor.token;donorOrganization=donor.organizationId;
  const ngo=await register('ngo','phase5-ngo@example.test');ngoToken=ngo.token;
  otherDonorToken=(await register('donor','phase5-other@example.test','North')).token;
  for(const id of [donorOrganization,ngo.organizationId]){const verified=await request(app).patch(`/api/v1/admin/organizations/${id}/verification`).set(auth(adminToken)).send({status:'verified'});assert.equal(verified.status,200);}
  server=app.listen(0);await new Promise<void>((resolve)=>server.once('listening',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('Test server did not bind a TCP port.');origin=`http://127.0.0.1:${address.port}`;
});

after(async()=>{
  const eventHub=app.locals.eventHub as {close():void}|undefined;eventHub?.close();
  await new Promise<void>((resolve)=>server?.close(()=>resolve()));
  await pool.end();await bootstrap.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await bootstrap.end();
});

test('business transactions create scoped notifications, deduplicated event history, and real admin analytics',async()=>{
  const donation=await request(app).post('/api/v1/donations').set(auth(donorToken)).send({food_name:'Phase five lunch',category:'cooked_meals',description:'Fresh meal boxes',quantity_total:12,unit:'boxes',prepared_at:new Date(Date.now()-30*60_000).toISOString(),storage_type:'ambient',handling_info:'Collect promptly',pickup_address:'1 FoodLoop Lane',city:'Phagwara',locality:'Central',pincode:'144401',collection_deadline:new Date(Date.now()+3*60*60_000).toISOString()});
  assert.equal(donation.status,201,JSON.stringify(donation.body));const donationId=donation.body.data.donation.id as string;
  const ngoNotices=await request(app).get('/api/v1/notifications').set(auth(ngoToken));assert.equal(ngoNotices.status,200);assert.ok(ngoNotices.body.data.notifications.some((item:any)=>item.event_type==='donation.created'));
  const outsider=await request(app).get('/api/v1/notifications').set(auth(otherDonorToken));assert.equal(outsider.status,200);assert.equal(outsider.body.data.notifications.length,0);
  const reservation=await request(app).post(`/api/v1/donations/${donationId}/reservations`).set(auth(ngoToken)).send({quantity:3,message:'Collection request'});assert.equal(reservation.status,201,JSON.stringify(reservation.body));
  const donorNotices=await request(app).get('/api/v1/notifications?unread=true').set(auth(donorToken));assert.equal(donorNotices.status,200);const unreadBefore=donorNotices.body.data.unread_count as number;const notice=donorNotices.body.data.notifications.find((item:any)=>item.event_type==='reservation.requested');assert.ok(notice);
  const forbidden=await request(app).patch(`/api/v1/notifications/${notice.id}/read`).set(auth(otherDonorToken)).send({});assert.equal(forbidden.status,404);
  const marked=await request(app).patch(`/api/v1/notifications/${notice.id}/read`).set(auth(donorToken)).send({});assert.equal(marked.status,200);
  assert.equal((await request(app).get('/api/v1/notifications/unread-count').set(auth(donorToken))).body.data.unread_count,unreadBefore-1);
  assert.equal((await request(app).get('/api/v1/analytics/overview').set(auth(donorToken))).status,403);
  const analytics=await request(app).get('/api/v1/analytics/overview').set(auth(adminToken));assert.equal(analytics.status,200);assert.ok(analytics.body.data.overview.total_donations>=1);
  const history=await pool.query(`SELECT count(*)::int AS count FROM user_events WHERE user_id=(SELECT id FROM users WHERE email='phase5-donor@example.test') AND event_type='reservation.requested'`);assert.equal(history.rows[0].count,1);
});

test('SSE authenticates users, streams only their events, and replays after Last-Event-ID',async()=>{
  const controller=new AbortController();const response=await fetch(`${origin}/api/v1/events/stream`,{headers:auth(donorToken),signal:controller.signal});assert.equal(response.status,200);assert.ok(response.headers.get('content-type')?.includes('text/event-stream'));
  const reader=response.body!.getReader();
  const reservation=await pool.query(`SELECT id FROM reservations WHERE message='Collection request' LIMIT 1`);
  const accepted=await request(app).patch(`/api/v1/reservations/${reservation.rows[0].id}/accept`).set(auth(donorToken)).send({});assert.equal(accepted.status,200);
  const frame=await nextEvent(reader);assert.match(frame,/event: update/);assert.match(frame,/reservation\.accepted/);const id=frame.match(/id: (\d+)/)?.[1];assert.ok(id);
  controller.abort();await reader.cancel().catch(()=>undefined);
  const donation=await request(app).post('/api/v1/donations').set(auth(donorToken)).send({food_name:'Replay meal',category:'cooked_meals',description:'Fresh meal boxes',quantity_total:8,unit:'boxes',prepared_at:new Date(Date.now()-30*60_000).toISOString(),storage_type:'ambient',handling_info:'Collect promptly',pickup_address:'1 FoodLoop Lane',city:'Phagwara',locality:'Central',pincode:'144401',collection_deadline:new Date(Date.now()+3*60*60_000).toISOString()});assert.equal(donation.status,201);
  const requested=await request(app).post(`/api/v1/donations/${donation.body.data.donation.id}/reservations`).set(auth(ngoToken)).send({quantity:2,message:'Replay event'});assert.equal(requested.status,201);
  const replayController=new AbortController();const replay=await fetch(`${origin}/api/v1/events/stream`,{headers:{...auth(donorToken),'Last-Event-ID':id!},signal:replayController.signal});assert.equal(replay.status,200);
  const replayReader=replay.body!.getReader();const replayFrame=await nextEvent(replayReader);assert.match(replayFrame,/reservation\.requested/);
  replayController.abort();await replayReader.cancel().catch(()=>undefined);
  const isolatedController=new AbortController();const isolated=await fetch(`${origin}/api/v1/events/stream`,{headers:auth(donorToken),signal:isolatedController.signal});const isolatedReader=isolated.body!.getReader();await isolatedReader.read();
  const other=await pool.query("SELECT id FROM users WHERE email='phase5-other@example.test'");await pool.query("INSERT INTO user_events(user_id,event_type,payload,idempotency_key) VALUES($1,'private.only',jsonb_build_object('secret','private'),'privacy-check')",[other.rows[0].id]);
  const isolatedChunk=await Promise.race([isolatedReader.read().then(({value})=>new TextDecoder().decode(value??new Uint8Array())),new Promise<string>((resolve)=>setTimeout(()=>resolve(''),1500))]);assert.equal(isolatedChunk.includes('private.only'),false);isolatedController.abort();await isolatedReader.cancel().catch(()=>undefined);
  const denied=await fetch(`${origin}/api/v1/events/stream`);assert.equal(denied.status,401);
});

test('production OTP issue endpoints queue encrypted email and return no plaintext code',async()=>{
  const signup=await request(app).post('/api/v1/auth/register').send({fullName:'Phase Five Volunteer',email:'phase5-volunteer@example.test',phone:'+911555555551',password,role:'volunteer',volunteerLocation:{city:'Phagwara',locality:'Central',pincode:'144401'}});
  assert.equal(signup.status,201,JSON.stringify(signup.body));const volunteerToken=signup.body.data.token as string;
  const accepted=await pool.query("SELECT id FROM reservations WHERE status='accepted' ORDER BY created_at LIMIT 1");assert.ok(accepted.rowCount);
  const assignment=await request(app).post(`/api/v1/reservations/${accepted.rows[0].id}/assignments`).set(auth(ngoToken)).send({});assert.equal(assignment.status,201,JSON.stringify(assignment.body));const assignmentId=assignment.body.data.assignment.id as string;
  const volunteerAccepted=await request(app).post(`/api/v1/assignments/${assignmentId}/accept`).set(auth(volunteerToken)).send({});assert.equal(volunteerAccepted.status,200,JSON.stringify(volunteerAccepted.body));
  const encryptionKey=randomBytes(32).toString('base64');process.env.NOTIFICATION_ENCRYPTION_KEY=encryptionKey;
  await pool.query("UPDATE notification_queue SET status='sent',processed_at=NOW(),updated_at=NOW() WHERE status IN ('pending','failed')");
  const pickup=await request(app).post(`/api/v1/assignments/${assignmentId}/pickup-otp/issue`).set(auth(donorToken)).send({});assert.equal(pickup.status,200,JSON.stringify(pickup.body));assert.equal(pickup.body.data.code,undefined);
  const queued=await pool.query("SELECT body,delivery_payload FROM notification_queue WHERE event_type='otp.pickup' ORDER BY created_at DESC LIMIT 1");assert.ok(queued.rowCount);assert.equal(queued.rows[0].body,'');
  const sent:{text?:string;subject?:string}[]=[];const transport={sendMail:async(message:{text?:string;subject?:string})=>{sent.push(message);return {messageId:'test'};}} as unknown as Transporter;
  await pool.query("INSERT INTO notification_worker_state(worker_id,started_at,heartbeat_at,jobs_processed) VALUES('phase5-test-worker',NOW(),NOW(),0) ON CONFLICT(worker_id) DO UPDATE SET heartbeat_at=NOW(),stopped_at=NULL");
  const workerOptions={maxAttempts:3,baseRetryMs:500,encryptionKey,from:'FoodLoop <test@example.test>',messageDomain:'test.local'};
  assert.equal(await processNextNotification(pool,transport,'phase5-test-worker',workerOptions),true);assert.match(sent[0].text??'',/\b\d{6}\b/);
  const pickupCode=(sent[0].text??'').match(/\b(\d{6})\b/)![1];const pickupVerified=await request(app).post(`/api/v1/assignments/${assignmentId}/pickup-otp/verify`).set(auth(volunteerToken)).send({code:pickupCode});assert.equal(pickupVerified.status,200,JSON.stringify(pickupVerified.body));
  await pool.query("UPDATE notification_queue SET status='sent',processed_at=NOW(),updated_at=NOW() WHERE status IN ('pending','failed')");
  const delivery=await request(app).post(`/api/v1/assignments/${assignmentId}/delivery-otp/issue`).set(auth(ngoToken)).send({});assert.equal(delivery.status,200,JSON.stringify(delivery.body));assert.equal(delivery.body.data.code,undefined);
  await processNextNotification(pool,transport,'phase5-test-worker',workerOptions);assert.match(sent[1].text??'',/\b\d{6}\b/);
  const deliveryCode=(sent[1].text??'').match(/\b(\d{6})\b/)![1];const delivered=await request(app).post(`/api/v1/assignments/${assignmentId}/delivery-otp/verify`).set(auth(volunteerToken)).send({code:deliveryCode});assert.equal(delivered.status,200,JSON.stringify(delivered.body));
});

test('notification worker retries SMTP errors, honors limits, and claims queue records once',async()=>{
  await pool.query("UPDATE notification_queue SET status='sent',processed_at=NOW(),updated_at=NOW() WHERE status IN ('pending','failed')");
  await pool.query("INSERT INTO notification_worker_state(worker_id,started_at,heartbeat_at,jobs_processed) VALUES('phase5-worker-concurrency',NOW(),NOW(),0) ON CONFLICT(worker_id) DO UPDATE SET heartbeat_at=NOW(),stopped_at=NULL");
  const insert=async(subject:string,maxAttempts=2)=>{const result=await pool.query(`INSERT INTO notification_queue(recipient_email,event_type,subject,body,status,attempts,max_attempts,next_attempt_at,updated_at,idempotency_key)
    VALUES('test@example.test','test.notification',$1,'worker test','pending',0,$2,NOW(),NOW(),$3) RETURNING id`,[subject,maxAttempts,randomBytes(10).toString('hex')]);return result.rows[0].id as string;};
  const options={maxAttempts:2,baseRetryMs:500,encryptionKey:'',from:'FoodLoop <test@example.test>',messageDomain:'test.local'};
  const retryId=await insert('retry test');let shouldFail=true;const flaky={sendMail:async()=>{if(shouldFail)throw new Error('Temporary SMTP failure');return {messageId:'ok'};}} as unknown as Transporter;
  assert.equal(await processNextNotification(pool,flaky,'phase5-worker-concurrency',options),true);let retry=await pool.query('SELECT status,attempts FROM notification_queue WHERE id=$1',[retryId]);assert.equal(retry.rows[0].status,'pending');assert.equal(Number(retry.rows[0].attempts),1);
  await pool.query('UPDATE notification_queue SET next_attempt_at=NOW() WHERE id=$1',[retryId]);shouldFail=false;assert.equal(await processNextNotification(pool,flaky,'phase5-worker-concurrency',options),true);retry=await pool.query('SELECT status,attempts FROM notification_queue WHERE id=$1',[retryId]);assert.equal(retry.rows[0].status,'sent');assert.equal(Number(retry.rows[0].attempts),2);
  const concurrentId=await insert('concurrency test');let sends=0;const slow={sendMail:async()=>{sends++;await new Promise((resolve)=>setTimeout(resolve,100));return {messageId:'ok'};}} as unknown as Transporter;
  const outcomes=await Promise.all([processNextNotification(pool,slow,'phase5-worker-concurrency',options),processNextNotification(pool,slow,'phase5-worker-concurrency',options)]);assert.equal(outcomes.filter(Boolean).length,1);assert.equal(sends,1);
  const concurrent=await pool.query('SELECT status,attempts FROM notification_queue WHERE id=$1',[concurrentId]);assert.equal(concurrent.rows[0].status,'sent');assert.equal(Number(concurrent.rows[0].attempts),1);
  const failedId=await insert('exhausted test',1);const broken={sendMail:async()=>{throw new Error('Permanent SMTP failure');}} as unknown as Transporter;
  await processNextNotification(pool,broken,'phase5-worker-concurrency',{...options,maxAttempts:1});const failed=await pool.query('SELECT status,attempts,last_error FROM notification_queue WHERE id=$1',[failedId]);assert.equal(failed.rows[0].status,'failed');assert.equal(Number(failed.rows[0].attempts),1);assert.equal(failed.rows[0].last_error,'Permanent SMTP failure');
  const abandonedId=await insert('abandoned test',1);await pool.query("UPDATE notification_queue SET status='processing',attempts=1,updated_at=NOW()-INTERVAL '6 minutes' WHERE id=$1",[abandonedId]);
  assert.equal(await claimNotification(pool,2),null);const abandoned=await pool.query('SELECT status,delivery_payload FROM notification_queue WHERE id=$1',[abandonedId]);assert.equal(abandoned.rows[0].status,'failed');
});
