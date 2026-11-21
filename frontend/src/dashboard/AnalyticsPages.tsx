import { useEffect, useState } from 'react';
import { Activity, PackageCheck, RefreshCw, Truck, Utensils } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api/client';
import { errorMessage } from '../auth/AuthContext';
import { EmptyState, ErrorNotice, LoadingState, PageHeader, StatCard } from '../components/ui';
import { useFoodLoopEvent } from '../realtime/useFoodLoopRealtime';

type Qty={unit:string;quantity:string|number};
interface Overview {total_donations:number;offered_quantity_by_unit:Qty[];delivered_quantity_by_unit:Qty[];completed_deliveries:number;active_reservations:number;pending_reservations:number;accepted_reservations:number;rejected_reservations:number;cancelled_reservations:number;cancelled_donations:number;expired_donations:number;active_donors:number;verified_ngos:number;active_volunteers:number;pickup_completed:number;pickup_eligible:number;delivery_completed:number;delivery_eligible:number}
interface Month {month:string;donations:number;quantity_by_unit:Qty[]}
interface Locality {city:string;locality:string;donations:number;quantity_by_unit:Qty[]}
const colors=['#a3e635','#14532d','#fb923c','#60a5fa','#a78bfa','#f87171','#14b8a6'];
const number=(value:unknown)=>Number(value??0);
const monthLabel=(value:string)=>new Date(`${value}T00:00:00`).toLocaleDateString(undefined,{month:'short',year:'2-digit'});

export function AdminAnalyticsPage(){
  const [overview,setOverview]=useState<Overview|null>(null);const [months,setMonths]=useState<Month[]>([]);const [localities,setLocalities]=useState<Locality[]>([]);const [statuses,setStatuses]=useState<{status:string;total:number}[]>([]);const [delivery,setDelivery]=useState<Record<string,number|string>|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [refresh,setRefresh]=useState(0);
  async function load(){setLoading(true);setError('');try{const [a,b,c,d,e]=await Promise.all([
    api.get<{data:{overview:Overview}}>('/analytics/overview'),api.get<{data:{months:Month[]}}>('/analytics/donations/monthly'),api.get<{data:{localities:Locality[]}}>('/analytics/donations/locality'),api.get<{data:{statuses:{status:string;total:number}[]}}>('/analytics/reservations'),api.get<{data:{delivery:Record<string,number|string>}}>('/analytics/delivery'),
  ]);setOverview(a.data.data.overview);setMonths(b.data.data.months);setLocalities(c.data.data.localities);setStatuses(d.data.data.statuses);setDelivery(e.data.data.delivery);}catch(failure){setError(errorMessage(failure));}finally{setLoading(false);}}
  useEffect(()=>{void load();},[refresh]);
  useFoodLoopEvent(['donation.created','donation.cancelled','donation.expired','reservation.created','reservation.accepted','reservation.rejected','reservation.cancelled','reservation.picked_up','reservation.delivered','assignment.picked_up','assignment.delivered'],()=>setRefresh((value)=>value+1));
  const trend=months.map((item)=>({month:monthLabel(item.month),donations:number(item.donations)}));
  const statusData=statuses.map((item)=>({name:item.status.replaceAll('_',' '),value:number(item.total)}));
  const localityData=localities.slice(0,10).map((item)=>({name:`${item.locality}, ${item.city}`,donations:number(item.donations)}));
  const deliveredUnits=overview?.delivered_quantity_by_unit??[];
  const metrics=overview?[
    {label:'TOTAL DONATIONS',value:overview.total_donations,note:'Saved donation records',icon:<Utensils size={18}/>,tone:'sage'},
    {label:'FOOD DELIVERED',value:deliveredUnits.length?deliveredUnits.map((item)=>`${number(item.quantity)} ${item.unit==='kilograms'?'kg':item.unit}`).join(' · '):'0',note:'Verified completed reservations, grouped by unit',icon:<PackageCheck size={18}/>,tone:'orange'},
    {label:'COMPLETED DELIVERIES',value:overview.completed_deliveries,note:'Delivery verification recorded',icon:<Truck size={18}/>,tone:'blue'},
    {label:'ACTIVE RESERVATIONS',value:overview.active_reservations,note:'Pending, accepted, or picked up',icon:<Activity size={18}/>,tone:'plum'},
    {label:'ACTIVE DONORS',value:overview.active_donors,note:'Active accounts with donor organizations',icon:<Utensils size={18}/>,tone:'sage'},
    {label:'VERIFIED NGOS',value:overview.verified_ngos,note:'Organizations with verified status',icon:<Activity size={18}/>,tone:'blue'},
    {label:'AVAILABLE VOLUNTEERS',value:overview.active_volunteers,note:'Active profiles marked available',icon:<Truck size={18}/>,tone:'orange'},
    {label:'EXPIRED DONATIONS',value:overview.expired_donations,note:'Listings marked expired',icon:<Activity size={18}/>,tone:'plum'},
  ]:[];
  return <div className="page-content"><PageHeader eyebrow="PLATFORM INSIGHTS" title="Reports & impact" description="Metrics calculated from saved FoodLoop records. Food quantities remain grouped by their recorded unit." actions={<button className="outline-button" onClick={()=>setRefresh((value)=>value+1)} disabled={loading}><RefreshCw size={15}/> Refresh analytics</button>}/>
    {error&&<ErrorNotice message={error} onRetry={()=>setRefresh((value)=>value+1)}/>} {loading&&!overview?<LoadingState label="Calculating platform analytics…"/>:overview&&<>
      <div className="stat-grid admin-analytics-kpis">{metrics.map((item)=><StatCard key={item.label} icon={item.icon} label={item.label} value={item.value} note={item.note} tone={item.tone as 'sage'|'orange'|'blue'|'plum'}/>)}</div>
      <div className="analytics-grid"><section className="dashboard-card analytics-panel"><div className="section-heading"><div><span className="eyebrow">LAST 12 MONTHS</span><h2>Donation trend</h2></div></div>{trend.length?<ResponsiveContainer width="100%" height={290}><LineChart data={trend} margin={{top:10,right:16,bottom:4,left:-18}}><CartesianGrid strokeDasharray="4 4"/><XAxis dataKey="month"/><YAxis allowDecimals={false}/><Tooltip/><Line type="monotone" dataKey="donations" stroke="#14532d" strokeWidth={3} dot={{r:4}}/></LineChart></ResponsiveContainer>:<EmptyState title="No donation trend yet" description="Donation records will be charted as they are created."/>}</section>
      <section className="dashboard-card analytics-panel"><div className="section-heading"><div><span className="eyebrow">RESERVATION RECORDS</span><h2>Status breakdown</h2></div></div>{statusData.length?<ResponsiveContainer width="100%" height={290}><PieChart><Pie data={statusData} dataKey="value" nameKey="name" outerRadius={92} label>{statusData.map((entry,index)=><Cell key={entry.name} fill={colors[index%colors.length]}/>)}</Pie><Tooltip/><Legend/></PieChart></ResponsiveContainer>:<EmptyState title="No reservation records" description="Status categories appear after real reservations are saved."/>}</section>
      <section className="dashboard-card analytics-panel"><div className="section-heading"><div><span className="eyebrow">MOST ACTIVE AREAS</span><h2>Donations by locality</h2></div></div>{localityData.length?<ResponsiveContainer width="100%" height={320}><BarChart data={localityData} layout="vertical" margin={{top:5,right:18,bottom:5,left:30}}><CartesianGrid strokeDasharray="4 4"/><XAxis type="number" allowDecimals={false}/><YAxis type="category" dataKey="name" width={145}/><Tooltip/><Bar dataKey="donations" fill="#a3e635" radius={[0,4,4,0]}/></BarChart></ResponsiveContainer>:<EmptyState title="No locality data yet" description="Locations will appear after donations are recorded."/>}</section>
      <section className="dashboard-card analytics-panel"><div className="section-heading"><div><span className="eyebrow">VERIFIED PICKUP & DELIVERY</span><h2>Completion rates</h2></div></div>{delivery&&<div className="completion-metrics"><div><span>Pickup completion</span><strong>{number(delivery.pickup_completion_rate)}%</strong><small>{number(delivery.pickups_verified)} of {number(delivery.assignments)} assignments have verified pickup</small></div><div><span>Delivery completion</span><strong>{number(delivery.delivery_completion_rate)}%</strong><small>{number(delivery.deliveries_verified)} verified deliveries</small></div></div>}<div className="unit-quantity-list"><h3>Quantity summary</h3><p>Offered: {overview.offered_quantity_by_unit.length?overview.offered_quantity_by_unit.map((item)=>`${number(item.quantity)} ${item.unit==='kilograms'?'kg':item.unit}`).join(' · '):'0'}</p><p>Delivered: {deliveredUnits.length?deliveredUnits.map((item)=>`${number(item.quantity)} ${item.unit==='kilograms'?'kg':item.unit}`).join(' · '):'0'}</p></div></section></div>
    </>}</div>;
}
