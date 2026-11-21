import { Router, type Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { createAuthenticate, requireRoles } from '../auth/middleware.js';
import type { AuthUser } from '../auth/types.js';
import { ApiError } from '../http/errors.js';

const pageSchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(20), unread: z.enum(['true','false']).optional() });
const uuid = z.string().uuid();
const monitoringQuerySchema=z.object({page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(50).default(20),status:z.enum(['all','pending','processing','sent','failed']).default('all'),search:z.string().trim().max(160).optional(),from:z.coerce.date().optional(),to:z.coerce.date().optional()}).refine((value)=>!value.from||!value.to||value.from<=value.to,{path:['to'],message:'End date must not be before start date.'});

export function createPhase5Router(pool: Pool, jwtSecret: string, hub: EventHub) {
  const router = Router();
  router.use(createAuthenticate(pool, jwtSecret));
  const streamLimiter=rateLimit({windowMs:60_000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,message:{error:{code:'STREAM_RATE_LIMITED',message:'Too many live update connections. Try again shortly.'}}});

  router.get('/events/stream',streamLimiter, async (request, response, next) => {
    try {
      if(hub.connectionsFor(request.auth!.id)>=8)throw new ApiError(429,'STREAM_LIMIT_REACHED','Too many live update tabs are open for this account.');
      const lastHeader = request.header('last-event-id');
      let cursor: string;
      if (lastHeader !== undefined) {
        if (!/^\d{1,19}$/.test(lastHeader)||BigInt(lastHeader)>9_223_372_036_854_775_807n) throw new ApiError(400,'INVALID_EVENT_CURSOR','Last-Event-ID must be a valid numeric event id.');
        cursor=lastHeader;
      } else {
        const latest=await pool.query('SELECT COALESCE(MAX(id),0)::text AS cursor FROM user_events WHERE user_id=$1',[request.auth!.id]);
        cursor=latest.rows[0].cursor;
      }
      hub.connect(request.auth!,response,cursor,request.header('authorization')!.slice(7));
    } catch(error) { next(error); }
  });

  router.get('/notifications', async (request,response,next) => {
    try {
      const query=pageSchema.parse(request.query); const unread=query.unread==='true'?true:query.unread==='false'?false:null;
      const params=[request.auth!.id,unread,query.limit,(query.page-1)*query.limit];
      const [rows,total,count]=await Promise.all([
        pool.query(`SELECT id,event_type,title,message,resource_type,resource_id,metadata,created_at,read_at
          FROM in_app_notifications WHERE user_id=$1 AND ($2::boolean IS NULL OR (read_at IS NULL)=$2)
          ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4`,params),
        pool.query(`SELECT count(*)::int AS total FROM in_app_notifications WHERE user_id=$1 AND ($2::boolean IS NULL OR (read_at IS NULL)=$2)`,params.slice(0,2)),
        pool.query('SELECT count(*)::int AS unread_count FROM in_app_notifications WHERE user_id=$1 AND read_at IS NULL',[request.auth!.id]),
      ]);
      const totalCount=total.rows[0].total as number;
      response.json({data:{notifications:rows.rows,unread_count:count.rows[0].unread_count,pagination:{page:query.page,limit:query.limit,total:totalCount,pages:Math.ceil(totalCount/query.limit)}}});
    } catch(error){next(error);}
  });
  router.get('/notifications/unread-count',async(request,response,next)=>{
    try { const result=await pool.query('SELECT count(*)::int AS unread_count FROM in_app_notifications WHERE user_id=$1 AND read_at IS NULL',[request.auth!.id]);response.json({data:result.rows[0]}); }
    catch(error){next(error);}
  });
  router.patch('/notifications/read-all',async(request,response,next)=>{
    try {
      const updated=await withTransaction(pool,async(client)=>{
        const result=await client.query('UPDATE in_app_notifications SET read_at=NOW() WHERE user_id=$1 AND read_at IS NULL RETURNING id',[request.auth!.id]);
        if(result.rowCount)await client.query(`INSERT INTO user_events(user_id,event_type,payload,idempotency_key)
          VALUES($1,'notifications.read_all',jsonb_build_object('count',$2::int),'notifications-read-all:'||gen_random_uuid())`,[request.auth!.id,result.rowCount]);
        return result.rowCount??0;
      });
      response.json({data:{updated}});
    } catch(error){next(error);}
  });
  router.patch('/notifications/:id/read',async(request,response,next)=>{
    try {
      const id=uuid.parse(request.params.id);
      const notification=await withTransaction(pool,async(client)=>{
        const changed=await client.query(`UPDATE in_app_notifications SET read_at=NOW() WHERE id=$1 AND user_id=$2 AND read_at IS NULL RETURNING id,read_at`,[id,request.auth!.id]);
        if(changed.rowCount){await client.query(`INSERT INTO user_events(user_id,event_type,resource_type,resource_id,payload,idempotency_key)
          VALUES($1,'notification.read','notification',$2::uuid,jsonb_build_object('notification_id',$2::uuid),$3) ON CONFLICT(user_id,idempotency_key) DO NOTHING`,[request.auth!.id,id,`notification-read:${id}`]);return changed.rows[0];}
        const existing=await client.query('SELECT id,read_at FROM in_app_notifications WHERE id=$1 AND user_id=$2',[id,request.auth!.id]);
        if(!existing.rowCount)throw new ApiError(404,'NOTIFICATION_NOT_FOUND','Notification was not found.');return existing.rows[0];
      });
      response.json({data:{notification}});
    } catch(error){next(error);}
  });

  router.get('/analytics/overview',requireRoles('admin'),async(_request,response,next)=>{
    try {
      const result=await pool.query(`SELECT
        (SELECT count(*)::int FROM donations) AS total_donations,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('unit',unit,'quantity',quantity) ORDER BY unit),'[]'::jsonb) FROM (SELECT unit,sum(quantity_total)::numeric(14,2) quantity FROM donations GROUP BY unit) q) AS offered_quantity_by_unit,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('unit',unit,'quantity',quantity) ORDER BY unit),'[]'::jsonb) FROM (SELECT unit,sum(quantity_delivered)::numeric(14,2) quantity FROM donations GROUP BY unit) q) AS delivered_quantity_by_unit,
        (SELECT count(*)::int FROM reservations WHERE status='delivered') AS completed_deliveries,
        (SELECT count(*)::int FROM reservations WHERE status IN ('pending','accepted','approved','picked_up')) AS active_reservations,
        (SELECT count(*)::int FROM reservations WHERE status='pending') AS pending_reservations,
        (SELECT count(*)::int FROM reservations WHERE status IN ('accepted','approved')) AS accepted_reservations,
        (SELECT count(*)::int FROM reservations WHERE status='rejected') AS rejected_reservations,
        (SELECT count(*)::int FROM reservations WHERE status='cancelled') AS cancelled_reservations,
        (SELECT count(*)::int FROM donations WHERE status='cancelled') AS cancelled_donations,
        (SELECT count(*)::int FROM donations WHERE status='expired') AS expired_donations,
        (SELECT count(DISTINCT u.id)::int FROM users u JOIN organizations o ON o.owner_user_id=u.id WHERE u.role='donor' AND u.is_active) AS active_donors,
        (SELECT count(*)::int FROM organizations WHERE organization_type='recipient' AND verification_status='verified') AS verified_ngos,
        (SELECT count(*)::int FROM users u JOIN volunteer_profiles p ON p.user_id=u.id WHERE u.role='volunteer' AND u.is_active AND p.is_available) AS active_volunteers,
        (SELECT count(*) FILTER(WHERE a.pickup_verified_at IS NOT NULL)::int FROM reservation_assignments a WHERE a.status IN ('picked_up','delivered')) AS pickup_completed,
        (SELECT count(*)::int FROM reservation_assignments WHERE status IN ('accepted','picked_up','delivered')) AS pickup_eligible,
        (SELECT count(*) FILTER(WHERE delivery_verified_at IS NOT NULL)::int FROM reservation_assignments WHERE status IN ('delivered')) AS delivery_completed,
        (SELECT count(*)::int FROM reservation_assignments WHERE status IN ('picked_up','delivered')) AS delivery_eligible`);
      response.json({data:{overview:result.rows[0]}});
    }catch(error){next(error);}
  });
  router.get('/analytics/donations/monthly',requireRoles('admin'),async(_request,response,next)=>{
    try { const result=await pool.query(`WITH months AS (
        SELECT generate_series(date_trunc('month',NOW())-INTERVAL '11 months',date_trunc('month',NOW()),INTERVAL '1 month')::date AS month
      ), monthly_units AS (
        SELECT date_trunc('month',created_at)::date AS month,unit,sum(quantity_total)::numeric(14,2) AS quantity,count(*)::int AS donation_count
        FROM donations WHERE created_at>=date_trunc('month',NOW())-INTERVAL '11 months' GROUP BY 1,unit
      ) SELECT m.month,COALESCE(sum(mu.donation_count),0)::int AS donations,
        COALESCE(jsonb_agg(jsonb_build_object('unit',mu.unit,'quantity',mu.quantity) ORDER BY mu.unit) FILTER(WHERE mu.unit IS NOT NULL),'[]'::jsonb) AS quantity_by_unit
        FROM months m LEFT JOIN monthly_units mu USING(month) GROUP BY m.month ORDER BY m.month`);
      response.json({data:{months:result.rows}});
    }catch(error){next(error);}
  });
  router.get('/analytics/donations/locality',requireRoles('admin'),async(_request,response,next)=>{
    try { const result=await pool.query(`SELECT city,locality,count(*)::int AS donations,
      jsonb_agg(jsonb_build_object('unit',unit,'quantity',quantity) ORDER BY unit) AS quantity_by_unit
      FROM (SELECT city,locality,unit,sum(quantity_total)::numeric(14,2) quantity FROM donations GROUP BY city,locality,unit) x
      GROUP BY city,locality ORDER BY donations DESC,city,locality LIMIT 100`);
      response.json({data:{localities:result.rows}});
    }catch(error){next(error);}
  });
  router.get('/analytics/reservations',requireRoles('admin'),async(_request,response,next)=>{
    try { const result=await pool.query(`SELECT status,count(*)::int AS total FROM reservations GROUP BY status ORDER BY status`);response.json({data:{statuses:result.rows}}); }
    catch(error){next(error);}
  });
  router.get('/analytics/delivery',requireRoles('admin'),async(_request,response,next)=>{
    try { const result=await pool.query(`SELECT count(*)::int AS assignments,
      count(*) FILTER(WHERE pickup_verified_at IS NOT NULL)::int AS pickups_verified,
      count(*) FILTER(WHERE delivery_verified_at IS NOT NULL)::int AS deliveries_verified,
      CASE WHEN count(*) FILTER(WHERE status IN ('accepted','picked_up','delivered'))=0 THEN 0
        ELSE round(100.0*count(*) FILTER(WHERE pickup_verified_at IS NOT NULL)/count(*) FILTER(WHERE status IN ('accepted','picked_up','delivered')),2) END AS pickup_completion_rate,
      CASE WHEN count(*) FILTER(WHERE status IN ('picked_up','delivered'))=0 THEN 0
        ELSE round(100.0*count(*) FILTER(WHERE delivery_verified_at IS NOT NULL)/count(*) FILTER(WHERE status IN ('picked_up','delivered')),2) END AS delivery_completion_rate
      FROM reservation_assignments`);response.json({data:{delivery:result.rows[0]}}); }
    catch(error){next(error);}
  });

  router.get('/admin/notifications/stats',requireRoles('admin'),async(_request,response,next)=>{
    try {
      const [stats,worker,events]=await Promise.all([
        pool.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE status='pending')::int AS pending,
          count(*) FILTER(WHERE status='processing')::int AS processing,count(*) FILTER(WHERE status='sent')::int AS sent,
          count(*) FILTER(WHERE status='failed')::int AS failed,COALESCE(sum(attempts),0)::int AS attempts,
          max(processed_at) FILTER(WHERE status='sent') AS last_success FROM notification_queue`),
        pool.query(`SELECT worker_id,started_at,heartbeat_at,stopped_at,last_error,jobs_processed,
          (stopped_at IS NULL AND heartbeat_at>NOW()-INTERVAL '90 seconds') AS online
          FROM notification_worker_state ORDER BY (stopped_at IS NULL AND heartbeat_at>NOW()-INTERVAL '90 seconds') DESC,heartbeat_at DESC LIMIT 1`),
        pool.query(`SELECT event_type,count(*)::int AS total,max(created_at) AS latest FROM user_events
          WHERE created_at>NOW()-INTERVAL '24 hours' GROUP BY event_type ORDER BY latest DESC LIMIT 20`),
      ]);
      response.json({data:{stats:stats.rows[0],worker:worker.rows[0]??null,recent_events:events.rows}});
    }catch(error){next(error);}
  });
  router.get('/admin/notifications',requireRoles('admin'),async(request,response,next)=>{
    try {
      const query=monitoringQuerySchema.parse(request.query);
      const status=query.status==='all'?null:query.status;const search=query.search?`%${query.search}%`:null; const args=[status,search,query.from??null,query.to??null,query.limit,(query.page-1)*query.limit];
      const [rows,count]=await Promise.all([
        pool.query(`SELECT id,event_type,recipient_email,subject,status,attempts,max_attempts,next_attempt_at,last_error,created_at,updated_at,processed_at FROM notification_queue
          WHERE ($1::text IS NULL OR status=$1) AND ($2::text IS NULL OR recipient_email ILIKE $2 OR subject ILIKE $2 OR event_type ILIKE $2)
            AND ($3::timestamptz IS NULL OR created_at >= $3) AND ($4::timestamptz IS NULL OR created_at <= $4)
          ORDER BY created_at DESC LIMIT $5 OFFSET $6`,args),
        pool.query(`SELECT count(*)::int AS total FROM notification_queue WHERE ($1::text IS NULL OR status=$1)
          AND ($2::text IS NULL OR recipient_email ILIKE $2 OR subject ILIKE $2 OR event_type ILIKE $2)
          AND ($3::timestamptz IS NULL OR created_at >= $3) AND ($4::timestamptz IS NULL OR created_at <= $4)`,args.slice(0,4)),
      ]);
      const total=count.rows[0].total as number;
      response.json({data:{jobs:rows.rows,pagination:{page:query.page,limit:query.limit,total,pages:Math.ceil(total/query.limit)}}});
    }catch(error){next(error);}
  });
  return router;
}

interface StreamClient { userId:string; role:string; token:string; response:Response; cursor:bigint; heartbeatAt:number; closed:boolean }
export class EventHub {
  private clients=new Set<StreamClient>();
  private timer:NodeJS.Timeout;
  private running=false;
  constructor(private pool:Pool,private jwtSecret:string){this.timer=setInterval(()=>void this.dispatch(),1000);this.timer.unref();}
  connect(user:AuthUser,response:Response,cursor:string,token:string){
    response.status(200);response.set({'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});response.flushHeaders();
    const client:StreamClient={userId:user.id,role:user.role,token,response,cursor:BigInt(cursor),heartbeatAt:Date.now(),closed:false};
    this.clients.add(client); response.write(': connected\n\n');
    response.on('close',()=>{client.closed=true;this.clients.delete(client);});
  }
  close(){clearInterval(this.timer);for(const client of this.clients){client.response.end();client.closed=true;}this.clients.clear();}
  connectionsFor(userId:string){let total=0;for(const client of this.clients)if(client.userId===userId&&!client.closed)total++;return total;}
  private async dispatch(){
    if(this.running||this.clients.size===0)return;this.running=true;
    try{
      const active=[...this.clients].filter((client)=>!client.closed);if(!active.length)return;
      const users=[...new Set(active.map((client)=>client.userId))];const min=active.reduce((lowest,client)=>client.cursor<lowest?client.cursor:lowest,active[0].cursor);
      const events=await this.pool.query(`SELECT e.id,e.user_id,e.event_type,e.resource_type,e.resource_id,e.payload,e.created_at
        FROM user_events e JOIN users u ON u.id=e.user_id WHERE e.user_id=ANY($1::uuid[]) AND e.id>$2 AND u.is_active=TRUE ORDER BY e.id ASC LIMIT 1000`,[users,min.toString()]);
      for(const row of events.rows){for(const client of active){const id=BigInt(row.id);if(client.userId!==row.user_id||id<=client.cursor||client.closed)continue;
        const data=JSON.stringify({type:row.event_type,resource_type:row.resource_type,resource_id:row.resource_id,payload:row.payload,created_at:row.created_at});
        if(client.response.write(`id: ${id}\nevent: update\ndata: ${data}\n\n`))client.cursor=id;
      }}
      const now=Date.now();const heartbeatClients=[...this.clients].filter((client)=>now-client.heartbeatAt>=20_000);
      if(heartbeatClients.length){
        const activeUsers=await this.pool.query('SELECT id,is_active,role FROM users WHERE id=ANY($1::uuid[])',[[...new Set(heartbeatClients.map((client)=>client.userId))]]);
        const states=new Map(activeUsers.rows.map((row)=>[row.id,{active:row.is_active as boolean,role:row.role as string}]));
        for(const client of heartbeatClients){
          let tokenValid=true;try{jwt.verify(client.token,this.jwtSecret,{issuer:'foodloop-api',audience:'foodloop-web'});}catch{tokenValid=false;}
          const state=states.get(client.userId);
          if(!tokenValid||!state?.active||state.role!==client.role){client.response.write('event: auth-expired\ndata: {}\n\n');client.response.end();client.closed=true;this.clients.delete(client);continue;}
          client.response.write(`: heartbeat ${new Date(now).toISOString()}\n\n`);client.heartbeatAt=now;
        }
      }
    }catch(error){console.error('FoodLoop SSE dispatcher failed:',error instanceof Error?error.message:'unknown error');}
    finally{this.running=false;}
  }
}

async function withTransaction<T>(pool:Pool,callback:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();try{await client.query('BEGIN');const value=await callback(client);await client.query('COMMIT');return value;}
  catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
}
