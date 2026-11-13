import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, BadgeCheck, Building2, Check, Clock3, FileCheck2, Heart, RefreshCw, Search, ShieldCheck, Users, Utensils, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { errorMessage } from '../auth/AuthContext';
import { ConfirmDialog, ComingSoonPanel, EmptyState, ErrorNotice, PageHeader, Pagination, StatCard, StatusBadge, Toast } from '../components/ui';

interface AdminCounts { total_users: number; donors: number; ngos: number; volunteers: number; pending_organizations: number; verified_organizations: number; rejected_organizations: number }
interface RecentUser { id: string; full_name: string; email: string; role: string; is_active: boolean; created_at: string }
interface RecentReview { id: string; name: string; organization_type: string; verification_status: string; verified_at: string; owner_name: string; reviewer_name: string | null }
interface AdminOverviewData { counts: AdminCounts; recentUsers: RecentUser[]; recentReviews: RecentReview[] }

export function AdminOverview() {
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try { const { data } = await api.get<{ data: AdminOverviewData }>('/admin/overview'); setOverview(data.data); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const counts = overview?.counts;
  return <div className="page-content admin-overview-page">
    <PageHeader eyebrow="FOODLOOP ADMINISTRATION" title="Platform overview" description="A live view of users and organization verification records." actions={<button className="outline-button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh data</button>} />
    {error && <ErrorNotice message={error} onRetry={() => void load()} />}
    {loading ? <div className="skeleton-grid admin-stats-skeleton">{Array.from({ length: 7 }, (_, index) => <div className="skeleton skeleton-card" key={index} />)}</div> : counts && <div className="stat-grid admin-stat-grid">
      <StatCard icon={<Users size={18} />} label="REGISTERED USERS" value={counts.total_users} note="Actual user records" tone="sage" />
      <StatCard icon={<Utensils size={18} />} label="DONORS" value={counts.donors} note="Donor accounts" tone="orange" />
      <StatCard icon={<Heart size={18} />} label="NGOS / RECIPIENTS" value={counts.ngos} note="Recipient accounts" tone="blue" />
      <StatCard icon={<Activity size={18} />} label="VOLUNTEERS" value={counts.volunteers} note="Volunteer accounts" tone="plum" />
      <StatCard icon={<Clock3 size={18} />} label="PENDING REVIEWS" value={counts.pending_organizations} note="Needs administrator review" tone="orange" />
      <StatCard icon={<BadgeCheck size={18} />} label="VERIFIED ORGS" value={counts.verified_organizations} note="Recorded admin decisions" tone="sage" />
      <StatCard icon={<X size={18} />} label="REJECTED ORGS" value={counts.rejected_organizations} note="Recorded admin decisions" tone="plum" />
    </div>}
    {counts?.pending_organizations ? <Link className="pending-review-banner" to="/dashboard/admin/organizations"><span><FileCheck2 size={20} /></span><div><strong>{counts.pending_organizations} organization{counts.pending_organizations === 1 ? '' : 's'} awaiting review</strong><small>Open the queue to review submitted details and record a decision.</small></div><ArrowRight size={18} /></Link> : null}
    <div className="admin-overview-panels"><section className="dashboard-card admin-table-panel"><div className="section-heading"><div><span className="eyebrow">LATEST ACCOUNTS</span><h2>Recent registrations</h2></div><Link className="subtle-link" to="/dashboard/admin/users">View all users <ArrowRight size={14} /></Link></div>
      {loading ? <SkeletonTable rows={4} /> : overview?.recentUsers.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>USER</th><th>ROLE</th><th>STATUS</th><th>REGISTERED</th></tr></thead><tbody>{overview.recentUsers.map((item) => <tr key={item.id}><td><strong>{item.full_name}</strong><small>{item.email}</small></td><td><span className="role-tag">{item.role}</span></td><td><StatusBadge status={item.is_active ? 'active' : 'inactive'} /></td><td>{new Date(item.created_at).toLocaleDateString()}</td></tr>)}</tbody></table></div> : <EmptyState title="No user records yet" description="Registrations will appear here when users join FoodLoop." />}
    </section><section className="dashboard-card admin-table-panel"><div className="section-heading"><div><span className="eyebrow">REVIEW ACTIVITY</span><h2>Recent decisions</h2></div><Link className="subtle-link" to="/dashboard/admin/organizations?status=all">View organizations <ArrowRight size={14} /></Link></div>
      {loading ? <SkeletonTable rows={4} /> : overview?.recentReviews.length ? <div className="decision-list">{overview.recentReviews.map((item) => <div className="decision-row" key={item.id}><span className={`decision-icon ${item.verification_status}`}><ShieldCheck size={17} /></span><span><strong>{item.name}</strong><small>{item.owner_name} · reviewed by {item.reviewer_name ?? 'FoodLoop admin'}</small></span><span className="decision-date">{new Date(item.verified_at).toLocaleDateString()}</span><StatusBadge status={item.verification_status} /></div>)}</div> : <EmptyState title="No review decisions yet" description="Administrator decisions will appear here when recorded." />}
    </section></div>
    <section className="quick-links-row"><QuickLink to="/dashboard/admin/organizations" icon={<FileCheck2 size={19} />} title="Review organizations" detail="Approve or reject real submissions." /><QuickLink to="/dashboard/admin/users" icon={<Users size={19} />} title="Browse users" detail="Search actual registered accounts." /><QuickLink to="/dashboard/admin/trust" icon={<ShieldCheck size={19} />} title="Access & trust" detail="See current and planned controls." /></section>
  </div>;
}

function QuickLink({ to, icon, title, detail }: { to: string; icon: React.ReactNode; title: string; detail: string }) {
  return <Link className="admin-quick-link" to={to}><span>{icon}</span><strong>{title}</strong><small>{detail}</small><ArrowRight size={15} /></Link>;
}

interface AdminOrganization {
  id: string; name: string; organization_type: 'donor' | 'recipient'; verification_status: 'pending' | 'verified' | 'rejected';
  address: string; city: string; locality: string; pincode: string; created_at: string; verification_note: string | null;
  verified_at: string | null; owner_name: string; owner_email: string; owner_phone: string | null; reviewer_name: string | null;
}
interface OrganizationResult { organizations: AdminOrganization[]; pagination: { page: number; limit: number; total: number; pages: number } }

export function OrganizationReviewPage() {
  const location = useLocation();
  const [status, setStatus] = useState(new URLSearchParams(location.search).get('status') ?? 'pending');
  const [type, setType] = useState('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<OrganizationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<{ organization: AdminOrganization; decision: 'verified' | 'rejected' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => { const timer = window.setTimeout(() => { setQuery(search.trim()); setPage(1); }, 250); return () => window.clearTimeout(timer); }, [search]);
  async function load() {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ status, type, page: String(page), limit: '8' });
      if (query) params.set('search', query);
      const { data } = await api.get<{ data: OrganizationResult }>(`/admin/organizations?${params}`);
      setResult(data.data);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [status, type, query, page]);
  async function confirmDecision() {
    if (!confirmation) return;
    setBusy(true); setError('');
    try {
      await api.patch(`/admin/organizations/${confirmation.organization.id}/verification`, { status: confirmation.decision, note: notes[confirmation.organization.id] || undefined });
      setToast(`${confirmation.organization.name} marked ${confirmation.decision}.`); setConfirmation(null); await load();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  return <div className="page-content"><PageHeader eyebrow="USER & ORGANIZATION MANAGEMENT" title="Organization verification" description="Review submitted organization details and record a decision in PostgreSQL." actions={<button className="outline-button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh queue</button>} />
    <div className="admin-trust-banner"><span><ShieldCheck size={19} /></span><p><strong>Every decision is saved with its reviewer and timestamp.</strong><br />Pending, verified, and rejected states below come from the organization records.</p></div>
    <div className="review-filter-card"><div className="status-tabs" role="tablist" aria-label="Verification status">{['pending', 'verified', 'rejected', 'all'].map((item) => <button key={item} role="tab" aria-selected={status === item} className={status === item ? 'selected' : ''} onClick={() => { setStatus(item); setPage(1); }}>{item === 'all' ? 'All organizations' : item[0].toUpperCase() + item.slice(1)}</button>)}</div>
      <div className="filter-controls"><label className="search-control"><Search size={16} /><input aria-label="Search organizations" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, contact, or email" /></label><label className="select-control"><span>Type</span><select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}><option value="all">All types</option><option value="donor">Food donors</option><option value="recipient">NGOs / recipients</option></select></label></div>
    </div>
    {error && <ErrorNotice message={error} onRetry={() => void load()} />}
    <div className="review-results-heading"><div><span className="eyebrow">ORGANIZATION RECORDS</span><h2>{status === 'all' ? 'All organizations' : `${status[0].toUpperCase()}${status.slice(1)} organizations`}</h2></div><span className="result-count">{loading ? 'Loading…' : `${result?.pagination.total ?? 0} records`}</span></div>
    {loading ? <div className="review-list-admin-skeleton">{[1, 2, 3].map((item) => <div className="skeleton skeleton-card" key={item} />)}</div> : result?.organizations.length ? <div className="review-list">{result.organizations.map((organization) => <article className="review-card admin-org-card" key={organization.id}>
      <div className="review-card-top"><span className="review-org-icon"><Building2 size={19} /></span><span className="review-type">{organization.organization_type === 'recipient' ? 'NGO / RECIPIENT' : 'FOOD DONOR'}</span><StatusBadge status={organization.verification_status} /></div>
      <h3>{organization.name}</h3><p className="review-location">{organization.address}, {organization.locality}, {organization.city} {organization.pincode}</p>
      <div className="review-owner"><div className="owner-avatar">{organization.owner_name.slice(0, 1).toUpperCase()}</div><span><strong>{organization.owner_name}</strong><small><a href={`mailto:${encodeURIComponent(organization.owner_email)}`}>{organization.owner_email}</a></small><small>{organization.owner_phone ?? 'No phone supplied'}</small></span><small className="submitted-date">Joined {new Date(organization.created_at).toLocaleDateString()}</small></div>
      {organization.verification_note && <div className="stored-review-note"><strong>Review note</strong><p>{organization.verification_note}</p>{organization.reviewer_name && <small>Reviewed by {organization.reviewer_name}{organization.verified_at ? ` · ${new Date(organization.verified_at).toLocaleDateString()}` : ''}</small>}</div>}
      {organization.verification_status === 'pending' && <><label className="field-label" htmlFor={`note-${organization.id}`}>Decision note <span className="optional">Optional</span></label><textarea id={`note-${organization.id}`} className="review-note" value={notes[organization.id] ?? ''} onChange={(event) => setNotes({ ...notes, [organization.id]: event.target.value })} maxLength={1000} placeholder="Tell the organization what you reviewed…" /><div className="review-actions"><button className="reject-button" onClick={() => setConfirmation({ organization, decision: 'rejected' })}><X size={15} /> Reject</button><button className="verify-button" onClick={() => setConfirmation({ organization, decision: 'verified' })}><Check size={15} /> Verify organization</button></div></>}
      {organization.verification_status !== 'pending' && <div className="decision-recorded"><ShieldCheck size={15} /> Decision recorded {organization.verified_at ? `on ${new Date(organization.verified_at).toLocaleDateString()}` : ''}</div>}
    </article>)}</div> : <EmptyState icon={<FileCheck2 size={22} />} title={query ? 'No matching organizations' : 'No organizations in this view'} description={query ? 'Try a different name, contact, or email.' : 'When organizations register, their real verification records will appear here.'} />}
    {!loading && result?.pagination && <Pagination page={page} pages={result.pagination.pages} onChange={setPage} />}
    <ConfirmDialog open={Boolean(confirmation)} title={confirmation?.decision === 'verified' ? 'Verify this organization?' : 'Reject this organization?'} description={confirmation ? `${confirmation.organization.name} will be marked ${confirmation.decision}. The decision and optional note will be recorded for this admin account.` : ''} confirmLabel={confirmation?.decision === 'verified' ? 'Confirm verification' : 'Confirm rejection'} danger={confirmation?.decision === 'rejected'} busy={busy} onClose={() => setConfirmation(null)} onConfirm={() => void confirmDecision()} />
    {toast && <Toast message={toast} onClose={() => setToast('')} />}
  </div>;
}

interface AdminUser { id: string; full_name: string; email: string; phone: string | null; role: string; is_active: boolean; created_at: string }
interface UserResult { users: AdminUser[]; pagination: { page: number; limit: number; total: number; pages: number } }
export function AdminUsersPage() {
  const location = useLocation();
  const roleFilter = location.pathname.endsWith('/donors') ? 'donor' : location.pathname.endsWith('/ngos') ? 'ngo' : location.pathname.endsWith('/volunteers') ? 'volunteer' : 'all';
  const title = roleFilter === 'all' ? 'All users' : roleFilter === 'ngo' ? 'NGO & recipient accounts' : `${roleFilter[0].toUpperCase()}${roleFilter.slice(1)} accounts`;
  const [search, setSearch] = useState('');
  const [active, setActive] = useState('all');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<UserResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ role: roleFilter, active, page: String(page), limit: '12' });
      if (search.trim()) params.set('search', search.trim());
      const { data } = await api.get<{ data: UserResult }>(`/admin/users?${params}`);
      setResult(data.data);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setLoading(false); }
  }
  useEffect(() => { const timer = window.setTimeout(() => { setPage(1); void load(); }, 180); return () => window.clearTimeout(timer); }, [search, active, page, roleFilter]);
  return <div className="page-content"><PageHeader eyebrow="USER & ORGANIZATION MANAGEMENT" title={title} description="Search registered FoodLoop accounts. This page does not offer unsupported suspend or delete actions." />
    <div className="review-filter-card user-filter-card"><label className="search-control"><Search size={16} /><input aria-label="Search users" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or email" /></label><label className="select-control"><span>Account status</span><select value={active} onChange={(event) => { setActive(event.target.value); setPage(1); }}><option value="all">All accounts</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label></div>
    {error && <ErrorNotice message={error} onRetry={() => void load()} />}
    <section className="dashboard-card admin-table-panel users-table-panel"><div className="section-heading"><div><span className="eyebrow">LIVE USER RECORDS</span><h2>{loading ? 'Loading users…' : `${result?.pagination.total ?? 0} account records`}</h2></div></div>
      {loading ? <SkeletonTable rows={7} /> : result?.users.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>USER</th><th>CONTACT</th><th>ROLE</th><th>STATUS</th><th>REGISTERED</th></tr></thead><tbody>{result.users.map((user) => <tr key={user.id}><td><strong>{user.full_name}</strong><small>{user.email}</small></td><td>{user.phone ?? 'Phone not enrolled'}</td><td><span className="role-tag">{user.role}</span></td><td><StatusBadge status={user.is_active ? 'active' : 'inactive'} /></td><td>{new Date(user.created_at).toLocaleDateString()}</td></tr>)}</tbody></table></div> : <EmptyState title="No users found" description="Try changing the search or status filter." />}
    </section>
    {!loading && result?.pagination && <Pagination page={page} pages={result.pagination.pages} onChange={setPage} />}
  </div>;
}

export function AccessTrustPage() {
  const implemented = [
    ['JWT authentication', 'Signed, expiring access tokens; active user status is checked from PostgreSQL.'],
    ['Password hashing', 'bcrypt hashes are stored; passwords are never returned by the API.'],
    ['Role-based authorization', 'Backend middleware checks the current database role for protected admin routes.'],
    ['Organization verification', 'Admin decisions and notes are persisted with reviewer and timestamp.'],
    ['Sign-in rate limiting', 'Registration and login endpoints share a bounded attempt window.'],
    ['Input validation', 'Zod validates request bodies and query parameters on the server.'],
  ];
  const planned = ['Phone ownership SMS verification', 'Password reset and recovery', 'HttpOnly cookie sessions and CSRF controls', 'Audit log for all administrative changes'];
  return <div className="page-content"><PageHeader eyebrow="SYSTEM & TRUST" title="Access & trust" description="Controls verified from the current application code, separated from planned safeguards." />
    <section className="dashboard-card trust-panel"><div className="section-heading"><div><span className="eyebrow">IMPLEMENTED CONTROLS</span><h2>Active in this application</h2></div><StatusBadge status="active" label="Configured" /></div><div className="trust-control-list">{implemented.map(([title, detail]) => <div className="trust-control" key={title}><span><ShieldCheck size={17} /></span><div><strong>{title}</strong><p>{detail}</p></div><StatusBadge status="active" label="Implemented" /></div>)}</div></section>
    <section className="dashboard-card trust-panel planned-trust"><div className="section-heading"><div><span className="eyebrow">FUTURE HARDENING</span><h2>Not connected yet</h2></div><StatusBadge status="planned" label="Planned" /></div><div className="trust-control-list">{planned.map((title) => <div className="trust-control" key={title}><span><Clock3 size={17} /></span><div><strong>{title}</strong><p>This control has not been implemented or verified.</p></div><StatusBadge status="planned" label="Planned" /></div>)}</div></section>
  </div>;
}

export function AdminComingSoonPage({ title, description, features }: { title: string; description: string; features: string[] }) {
  return <div className="page-content"><PageHeader eyebrow="PLATFORM OPERATIONS" title={title} description={description} /><ComingSoonPanel title={title} description="This section is planned, but no backend API or trusted data feed is connected yet." features={features} /></div>;
}

function SkeletonTable({ rows }: { rows: number }) {
  return <div className="skeleton-table">{Array.from({ length: rows }, (_, index) => <div className="skeleton-table-row" key={index}><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>)}</div>;
}
