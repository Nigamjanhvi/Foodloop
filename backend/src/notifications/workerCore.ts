import { createDecipheriv } from 'node:crypto';
import type { Pool } from 'pg';
import type { Transporter } from 'nodemailer';

export interface NotificationJob { id:string;recipient_email:string;event_type:string;subject:string;body:string;delivery_payload:unknown;attempts:number;max_attempts:number;created_at:Date|string }
export interface WorkerOptions { maxAttempts:number;baseRetryMs:number;encryptionKey:string;from:string;messageDomain:string }

export async function claimNotification(pool:Pool,maxAttempts:number):Promise<NotificationJob|null>{
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`UPDATE notification_queue SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'pending' END,
      updated_at=NOW(),last_error='Recovered abandoned worker claim.',processed_at=CASE WHEN attempts>=max_attempts THEN NOW() ELSE processed_at END,
      delivery_payload=CASE WHEN attempts>=max_attempts THEN NULL ELSE delivery_payload END,
      body=CASE WHEN attempts>=max_attempts AND event_type LIKE 'otp.%' THEN '' ELSE body END
      WHERE status='processing' AND updated_at<NOW()-INTERVAL '5 minutes'`);
    const result=await client.query(`SELECT id,recipient_email,event_type,subject,body,delivery_payload,attempts,max_attempts,created_at
      FROM notification_queue WHERE status IN ('pending','failed') AND next_attempt_at<=NOW() AND attempts<LEAST(max_attempts,$1)
      ORDER BY next_attempt_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,[maxAttempts]);
    if(!result.rowCount){await client.query('COMMIT');return null;}
    const job=result.rows[0] as NotificationJob;
    await client.query(`UPDATE notification_queue SET status='processing',attempts=attempts+1,max_attempts=LEAST(max_attempts,$2),updated_at=NOW() WHERE id=$1`,[job.id,maxAttempts]);
    await client.query('COMMIT');return {...job,attempts:Number(job.attempts)+1,max_attempts:Math.min(Number(job.max_attempts),maxAttempts)};
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}

function decryptPayload(value:unknown,encodedKey:string):{text:string;subject?:string}{
  const payload=typeof value==='string'?JSON.parse(value):value as Record<string,string>|null;
  if(!payload||payload.algorithm!=='aes-256-gcm')throw new Error('Unsupported protected email payload.');
  const key=Buffer.from(encodedKey,'base64');if(key.length!==32)throw new Error('NOTIFICATION_ENCRYPTION_KEY must decode to 32 bytes.');
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(payload.iv,'base64'));decipher.setAuthTag(Buffer.from(payload.auth_tag,'base64'));
  const clear=Buffer.concat([decipher.update(Buffer.from(payload.ciphertext,'base64')),decipher.final()]).toString('utf8');
  return JSON.parse(clear) as {text:string;subject?:string};
}

export async function processNextNotification(pool:Pool,transport:Transporter,workerId:string,options:WorkerOptions):Promise<boolean>{
  const job=await claimNotification(pool,options.maxAttempts);if(!job)return false;
  try{
    if(job.event_type.startsWith('otp.')&&Date.now()-new Date(job.created_at).getTime()>=10*60_000){
      await pool.query(`UPDATE notification_queue SET status='failed',attempts=max_attempts,last_error='Protected code expired before email delivery.',processed_at=NOW(),updated_at=NOW(),delivery_payload=NULL,body=''
        WHERE id=$1 AND status='processing'`,[job.id]);
      return true;
    }
    const protectedBody=job.delivery_payload?decryptPayload(job.delivery_payload,options.encryptionKey):null;
    await transport.sendMail({from:options.from,to:job.recipient_email,subject:protectedBody?.subject??job.subject,
      text:protectedBody?.text??job.body,messageId:`<foodloop-${job.id}@${options.messageDomain}>`});
    await pool.query(`UPDATE notification_queue SET status='sent',last_error=NULL,processed_at=NOW(),updated_at=NOW(),delivery_payload=NULL,body=''
      WHERE id=$1 AND status='processing'`,[job.id]);
    await pool.query(`UPDATE notification_worker_state SET heartbeat_at=NOW(),jobs_processed=jobs_processed+1,last_error=NULL WHERE worker_id=$1`,[workerId]);
    console.info(JSON.stringify({event:'notification.sent',job_id:job.id,event_type:job.event_type}));return true;
  }catch(error){
    const message=(error instanceof Error?error.message:'Unknown SMTP failure').slice(0,1000);const exhausted=job.attempts>=job.max_attempts;
    const delay=Math.round(Math.min(24*60*60_000,options.baseRetryMs*2**Math.min(job.attempts-1,12))*(0.8+Math.random()*0.4));
    await pool.query(`UPDATE notification_queue SET status=$2,last_error=$3,next_attempt_at=NOW()+($4::bigint*INTERVAL '1 millisecond'),updated_at=NOW(),
      delivery_payload=CASE WHEN $2='failed' AND attempts>=max_attempts THEN NULL ELSE delivery_payload END WHERE id=$1 AND status='processing'`,
      [job.id,exhausted?'failed':'pending',message,delay]);
    await pool.query('UPDATE notification_worker_state SET heartbeat_at=NOW(),last_error=$2 WHERE worker_id=$1',[workerId,message]);
    console.error(JSON.stringify({event:'notification.failed',job_id:job.id,event_type:job.event_type,attempt:job.attempts,exhausted,error:message}));return true;
  }
}
