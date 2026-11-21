import { useEffect, useState } from 'react';
import { ArrowRight, Bell, CheckCheck, Clock3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth, errorMessage } from '../auth/AuthContext';
import { EmptyState, ErrorNotice, LoadingState, PageHeader, Pagination, StatusBadge, Toast } from '../components/ui';
import { useFoodLoopEvent } from '../realtime/useFoodLoopRealtime';

interface Notification { id:string;event_type:string;title:string;message:string;resource_type:string|null;resource_id:string|null;metadata:Record<string,unknown>;created_at:string;read_at:string|null }
interface Result { notifications:Notification[];unread_count:number;pagination:{page:number;limit:number;total:number;pages:number} }

export default function NotificationPage(){
  const {user}=useAuth();const navigate=useNavigate();const [result,setResult]=useState<Result|null>(null);const [page,setPage]=useState(1);const [unreadOnly,setUnreadOnly]=useState(false);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [toast,setToast]=useState('');
  async function load(){setLoading(true);setError('');try{const params=new URLSearchParams({page:String(page),limit:'20',...(unreadOnly?{unread:'true'}:{})});const {data}=await api.get<{data:Result}>(`/notifications?${params}`);setResult(data.data);}catch(failure){setError(errorMessage(failure));}finally{setLoading(false);}}
  useEffect(()=>{void load();},[page,unreadOnly]);
  useFoodLoopEvent(['*'],(event)=>{if(event.type.startsWith('notification.')||event.type==='donation.created'||event.type.startsWith('reservation.')||event.type.startsWith('assignment.')||event.type.startsWith('organization.')||event.type==='user.registered')void load();});
  async function markRead(item:Notification){if(!item.read_at){try{await api.patch(`/notifications/${item.id}/read`,{});setResult((current)=>current?{...current,notifications:current.notifications.map((entry)=>entry.id===item.id?{...entry,read_at:new Date().toISOString()}:entry),unread_count:Math.max(0,current.unread_count-1)}:current);}catch(failure){setError(errorMessage(failure));return;}}
    const meta=item.metadata??{};let target:string|undefined;
    if(item.resource_type==='donation'&&item.resource_id)target=user?.role==='admin'?`/dashboard/admin/donations/${item.resource_id}`:user?.role==='ngo'?`/dashboard/ngo/available/${item.resource_id}`:`/dashboard/donor/donations/${item.resource_id}`;
    if(item.resource_type==='reservation'&&item.resource_id)target=user?.role==='admin'?`/dashboard/admin/reservations/${item.resource_id}`:`/dashboard/${user?.role==='ngo'?'ngo':'donor'}/reservations/${item.resource_id}`;
    if(item.resource_type==='assignment'){const reservationId=typeof meta.reservation_id==='string'?meta.reservation_id:undefined;target=user?.role==='volunteer'&&item.resource_id?`/dashboard/volunteer/tasks/${item.resource_id}`:user?.role==='admin'?'/dashboard/admin/tasks':reservationId?`/dashboard/${user?.role==='ngo'?'ngo':'donor'}/reservations/${reservationId}`:undefined;}
    if(item.resource_type==='organization')target=user?.role==='admin'?'/dashboard/admin/organizations':'/dashboard';if(item.resource_type==='notification_job')target='/dashboard/admin/notifications';if(target)navigate(target);
  }
  async function markAll(){try{await api.patch('/notifications/read-all',{});setToast('All notifications marked as read.');await load();}catch(failure){setError(errorMessage(failure));}}
  const title=`${user?.role==='ngo'?'NGO / recipient':user?.role==='admin'?'Administrator':user?.role==='volunteer'?'Volunteer':'Donor'} notifications`;
  return <div className="page-content"><PageHeader eyebrow="YOUR ACTIVITY" title="Notifications" description="Saved updates for your FoodLoop account. New activity appears here automatically while you are signed in." actions={<button className="outline-button" onClick={()=>void markAll()} disabled={!result?.unread_count}><CheckCheck size={16}/> Mark all read</button>}/>
    <div className="notification-filter-row"><div className="status-tabs"><button className={!unreadOnly?'selected':''} onClick={()=>{setUnreadOnly(false);setPage(1);}}>All activity</button><button className={unreadOnly?'selected':''} onClick={()=>{setUnreadOnly(true);setPage(1);}}>Unread {result?.unread_count?`(${result.unread_count})`:''}</button></div><StatusBadge status={result?.unread_count?'pending':'complete'} label={`${result?.unread_count??0} unread`}/></div>
    {error&&<ErrorNotice message={error} onRetry={()=>void load()}/>} {loading?<LoadingState label="Loading notifications…"/>:result?.notifications.length?<div className="notification-list">{result.notifications.map((item)=><button className={`notification-item ${item.read_at?'read':'unread'}`} key={item.id} onClick={()=>void markRead(item)}><span className="notification-icon"><Bell size={18}/></span><span className="notification-copy"><strong>{item.title}</strong><span>{item.message}</span><small><Clock3 size={13}/>{new Date(item.created_at).toLocaleString()}</small></span><span className="notification-indicator">{!item.read_at&&<i/>}<ArrowRight size={16}/></span></button>)}</div>:<EmptyState icon={<Bell size={22}/>} title={unreadOnly?'You are all caught up':'No notifications yet'} description="Updates about donations, reservations, organization review, and volunteer work will appear here."/>}
    {!loading&&result&&result.pagination.pages>1&&<Pagination page={page} pages={result.pagination.pages} onChange={setPage}/>} {toast&&<Toast message={toast} onClose={()=>setToast('')}/>}</div>;
}
