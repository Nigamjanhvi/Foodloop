import '../config/env.js';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { pool } from '../db/pool.js';
import { processNextNotification } from './workerCore.js';

const workerId=`foodloop-mail-${process.pid}-${randomUUID().slice(0,8)}`;
const pollMs=boundedNumber(process.env.NOTIFICATION_POLL_MS,2000,250,60_000);
const maxAttempts=boundedNumber(process.env.NOTIFICATION_MAX_ATTEMPTS,8,1,20);
const baseRetryMs=boundedNumber(process.env.NOTIFICATION_RETRY_BASE_MS,5000,500,3_600_000);
let stopping=false;

function boundedNumber(value:string|undefined,fallback:number,min:number,max:number){const number=Number(value??fallback);return Number.isFinite(number)?Math.max(min,Math.min(max,number)):fallback;}
function createTransport(){
  if(process.env.NODE_ENV==='test'&&process.env.SMTP_TEST_TRANSPORT==='stream')return nodemailer.createTransport({streamTransport:true,buffer:true,newline:'unix'});
  const host=process.env.SMTP_HOST;const port=Number(process.env.SMTP_PORT??587);const user=process.env.SMTP_USER;const pass=process.env.SMTP_PASSWORD;
  if(!host||!Number.isInteger(port)||port<1||port>65535||!process.env.SMTP_FROM)throw new Error('SMTP_HOST, SMTP_PORT, and SMTP_FROM are required to run the notification worker.');
  return nodemailer.createTransport({host,port,secure:process.env.SMTP_SECURE==='true',...(user&&pass?{auth:{user,pass}}:{})});
}
async function main(){
  await pool.query(`INSERT INTO notification_worker_state(worker_id,started_at,heartbeat_at,stopped_at,last_error,jobs_processed)
    VALUES($1,NOW(),NOW(),NULL,NULL,0) ON CONFLICT(worker_id) DO UPDATE SET started_at=NOW(),heartbeat_at=NOW(),stopped_at=NULL,last_error=NULL`,[workerId]);
  let transport:ReturnType<typeof createTransport>;
  try{transport=createTransport();await transport.verify();}
  catch(error){const message=(error instanceof Error?error.message:'SMTP startup failed').slice(0,1000);await pool.query('UPDATE notification_worker_state SET heartbeat_at=NOW(),stopped_at=NOW(),last_error=$2 WHERE worker_id=$1',[workerId,message]);throw error;}
  console.info(JSON.stringify({event:'notification.worker.started',worker_id:workerId,poll_ms:pollMs}));
  const heartbeat=setInterval(()=>{void pool.query('UPDATE notification_worker_state SET heartbeat_at=NOW() WHERE worker_id=$1',[workerId]).catch(()=>undefined);},20_000);heartbeat.unref();
  try{
    while(!stopping){
      try{
        const processed=await processNextNotification(pool,transport,workerId,{maxAttempts,baseRetryMs,
          encryptionKey:process.env.NOTIFICATION_ENCRYPTION_KEY??'',from:process.env.SMTP_FROM??'',messageDomain:process.env.SMTP_MESSAGE_DOMAIN??'localhost'});
        if(!processed)await new Promise((resolve)=>setTimeout(resolve,pollMs));
      }catch(error){const message=(error instanceof Error?error.message:'Unknown worker error').slice(0,1000);console.error(JSON.stringify({event:'notification.worker.error',error:message}));await pool.query('UPDATE notification_worker_state SET heartbeat_at=NOW(),last_error=$2 WHERE worker_id=$1',[workerId,message]).catch(()=>undefined);await new Promise((resolve)=>setTimeout(resolve,pollMs));}
    }
  }finally{clearInterval(heartbeat);transport.close();await pool.query('UPDATE notification_worker_state SET heartbeat_at=NOW(),stopped_at=NOW() WHERE worker_id=$1',[workerId]);await pool.end();}
}
function shutdown(){stopping=true;}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
main().catch(async(error)=>{console.error(JSON.stringify({event:'notification.worker.fatal',error:error instanceof Error?error.message:'Unknown startup error'}));await pool.end();process.exitCode=1;});
