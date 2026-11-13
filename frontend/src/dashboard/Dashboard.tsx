import { useEffect, useState } from 'react';
import { ArrowUpRight, BadgeCheck, Building2, Check, ChevronRight, Clock3, Heart, Leaf, LogOut, MapPin, RefreshCw, ShieldCheck, Users, X } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { api, type ApiErrorBody } from '../api/client';
import { errorMessage, useAuth, type CurrentUser } from '../auth/AuthContext';

const roleLabels = { donor: 'Food donor', ngo: 'NGO / recipient', volunteer: 'Volunteer', admin: 'Administrator' } as const;
const rolePaths = { donor: '/dashboard/donor', ngo: '/dashboard/ngo', volunteer: '/dashboard/volunteer', admin: '/dashboard/admin' } as const;

export function DashboardFrame() {
  const { user, logout } = useAuth();
  const location = useLocation();
  if (!user) return null;
  const isActive = location.pathname === rolePaths[user.role];
  return <div className="dashboard-shell">
    <aside className="dashboard-sidebar"><Link className="brand" to="/"><span className="brand-mark"><Leaf size={18} /></span>foodloop</Link>
      <div className="sidebar-section-label">WORKSPACE</div><Link className={`sidebar-link ${isActive ? 'active' : ''}`} to={rolePaths[user.role]}><Building2 size={17} /> Overview <ChevronRight size={14} /></Link>
      {user.role === 'admin' && <><div className="sidebar-section-label side-gap">ADMINISTRATION</div><div className="sidebar-static"><Users size={17} /> Organization review</div><div className="sidebar-static"><ShieldCheck size={17} /> Access &amp; trust</div></>}
      <div className="sidebar-bottom"><div className="side-help"><span className="help-orb"><Heart size={15} /></span><strong>Good things grow here.</strong><small>Thanks for being part of your local food loop.</small></div>
        <div className="sidebar-user"><span className="avatar">{user.fullName.slice(0, 1).toUpperCase()}</span><span className="sidebar-user-name"><strong>{user.fullName}</strong><small>{roleLabels[user.role]}</small></span><button className="logout-icon" onClick={logout} title="Sign out" aria-label="Sign out"><LogOut size={16} /></button></div>
      </div>
    </aside>
    <main className="dashboard-main"><header className="dashboard-topbar"><div><span className="breadcrumb-muted">FoodLoop</span><span className="breadcrumb-slash">/</span><span>{roleLabels[user.role]}</span></div><div className="topbar-user"><span className="online-dot" /> Secure workspace <span className="topbar-divider" /><span>{user.email}</span></div></header><div className="dashboard-content"><Outlet /></div></main>
  </div>;
}

function WelcomeHeader({ user, eyebrow, title, description }: { user: CurrentUser; eyebrow: string; title: string; description: string }) {
  return <div className="dash-welcome"><div><span className="eyebrow">{eyebrow}</span><h1>{title}<span className="greeting-name">{user.fullName.split(' ')[0]}</span></h1><p>{description}</p></div><div className="welcome-mark"><Leaf size={24} /></div></div>;
}

function VerificationCard({ user, kind }: { user: CurrentUser; kind: 'donor' | 'ngo' }) {
  const [organization, setOrganization] = useState<{ verification_status: 'pending' | 'verified' | 'rejected'; verification_note: string | null } | null>(null);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    api.get<{ data: { organization: { verification_status: 'pending' | 'verified' | 'rejected'; verification_note: string | null } } }>('/organizations/me')
      .then(({ data }) => setOrganization(data.data.organization))
      .catch((failure) => setLoadError(errorMessage(failure)));
  }, []);
  const state = organization?.verification_status ?? user.verificationStatus ?? 'pending';
  const copy = state === 'verified'
    ? { title: 'Organization verified', body: 'Your organization has been reviewed by a FoodLoop administrator. Verified features will be available as they are introduced.', icon: <BadgeCheck size={19} />, cls: 'verified' }
    : state === 'rejected'
      ? { title: 'More information needed', body: 'An administrator reviewed the organization. Check the review note or contact the FoodLoop team for the next step.', icon: <X size={18} />, cls: 'rejected' }
      : { title: 'Verification in progress', body: 'Your organization details have been received and are waiting for an administrator review.', icon: <Clock3 size={18} />, cls: 'pending' };
  const verificationNote = organization?.verification_note ?? user.verificationNote;
  return <section className={`verification-card ${copy.cls}`}><span className="verification-icon">{copy.icon}</span><div><span className="eyebrow">{kind === 'ngo' ? 'RECIPIENT ORGANIZATION' : 'DONOR ORGANIZATION'}</span><h2>{copy.title}</h2><p>{copy.body}</p>{loadError && <p role="status">{loadError}</p>}{verificationNote && <p className="verification-review-note"><strong>Admin review note:</strong> {verificationNote}</p>}<span className={`status-pill ${copy.cls}`}><span />{state}</span></div></section>;
}

export function DonorDashboard() {
  const { user } = useAuth();
  return <><WelcomeHeader user={user!} eyebrow="DONOR WORKSPACE" title="Welcome back, " description="Your organization workspace is ready. Food donation tools will appear here as the next FoodLoop phase is built." />
    <section className="dash-summary-grid"><div className="dash-summary-card"><span className="summary-card-icon"><Building2 size={18} /></span><span className="summary-label">ORGANIZATION</span><strong>{user!.organizationName ?? 'Not registered yet'}</strong><small>Organization profile</small></div><div className="dash-summary-card"><span className="summary-card-icon peach"><Leaf size={18} /></span><span className="summary-label">ACCOUNT TYPE</span><strong>Food donor</strong><small>Local food partner</small></div></section>
    {user!.organizationName ? <VerificationCard user={user!} kind="donor" /> : <ProfileIncomplete />}<UpcomingPanel title="Your next steps" items={['Organization details are saved to your account.', 'An administrator will review your organization.', 'Donation listing tools will be introduced in the next phase.']} />
  </>;
}

export function NgoDashboard() {
  const { user } = useAuth();
  return <><WelcomeHeader user={user!} eyebrow="RECIPIENT WORKSPACE" title="Welcome back, " description="Your community workspace is ready. Nearby food discovery will be added after verification and donation features are implemented." />
    <section className="dash-summary-grid"><div className="dash-summary-card"><span className="summary-card-icon"><Building2 size={18} /></span><span className="summary-label">ORGANIZATION</span><strong>{user!.organizationName ?? 'Not registered yet'}</strong><small>Recipient profile</small></div><div className="dash-summary-card"><span className="summary-card-icon lilac"><MapPin size={18} /></span><span className="summary-label">ACCOUNT TYPE</span><strong>NGO / recipient</strong><small>Community organization</small></div></section>
    {user!.organizationName ? <VerificationCard user={user!} kind="ngo" /> : <ProfileIncomplete />}<UpcomingPanel title="Your next steps" items={['Your organization review is managed by a FoodLoop administrator.', 'Service area matching will arrive with donation discovery.', 'Reservation tools are planned for a later phase.']} />
  </>;
}

export function VolunteerDashboard() {
  const { user } = useAuth();
  return <><WelcomeHeader user={user!} eyebrow="VOLUNTEER WORKSPACE" title="Welcome back, " description="Thank you for helping good food reach local communities. Your volunteer profile is ready." />
    <section className="volunteer-welcome-card"><span className="volunteer-icon"><Heart size={22} /></span><div><span className="eyebrow">COMMUNITY VOLUNTEER</span><h2>Every pickup makes a difference.</h2><p>Your account is active. Pickup assignments and delivery confirmation will be added in a future FoodLoop phase.</p></div></section>
    <UpcomingPanel title="Volunteer workspace" items={['Your sign-in and role are verified securely.', 'Availability and locality profile are saved.', 'Task assignment and OTP confirmation are planned for a later phase.']} />
  </>;
}

interface ReviewOrganization {
  id: string; name: string; organization_type: 'donor' | 'recipient'; verification_status: string;
  address: string; city: string; locality: string; pincode: string; created_at: string;
  owner_name: string; owner_email: string; owner_phone?: string;
}

export function AdminDashboard() {
  const [organizations, setOrganizations] = useState<ReviewOrganization[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadOrganizations() {
    setError(''); setLoading(true);
    try {
      const { data } = await api.get<{ data: { organizations: ReviewOrganization[] } }>('/admin/organizations?status=pending');
      setOrganizations(data.data.organizations);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadOrganizations(); }, []);

  async function review(id: string, status: 'verified' | 'rejected') {
    setBusyId(id); setError(''); setNotice('');
    try {
      await api.patch(`/admin/organizations/${id}/verification`, { status, note: notes[id] || undefined });
      setOrganizations((items) => items.filter((item) => item.id !== id));
      setNotice(status === 'verified' ? 'Organization verified. The status was saved.' : 'Organization review recorded as rejected.');
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusyId(''); }
  }

  return <><div className="dash-welcome"><div><span className="eyebrow">ADMINISTRATION</span><h1>Organization review</h1><p>Review submissions and record a real verification decision.</p></div><button className="outline-button" onClick={() => void loadOrganizations()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh queue</button></div>
    <div className="admin-trust-banner"><span><ShieldCheck size={19} /></span><p><strong>Verification is recorded, not simulated.</strong><br />Each decision stores the administrator, timestamp, status, and optional note in PostgreSQL.</p></div>
    {error && <div className="form-alert dash-alert" role="alert">{error}</div>}{notice && <div className="form-success" role="status"><Check size={16} />{notice}</div>}
    <div className="queue-heading"><div><span className="eyebrow">LIVE FROM YOUR DATABASE</span><h2>Pending submissions</h2></div><span className="queue-count">{loading ? '…' : organizations.length} {organizations.length === 1 ? 'organization' : 'organizations'}</span></div>
    {loading ? <div className="queue-loading"><span className="spinner" /> Loading organization records…</div> : organizations.length === 0 ? <div className="empty-queue"><span><Check size={22} /></span><h3>You’re all caught up.</h3><p>There are no pending organizations to review right now.</p></div> : <div className="review-list">{organizations.map((organization) => <article className="review-card" key={organization.id}>
      <div className="review-card-top"><span className="review-org-icon"><Building2 size={19} /></span><span className="review-type">{organization.organization_type === 'recipient' ? 'NGO / RECIPIENT' : 'FOOD DONOR'}</span><span className="status-pill pending"><span />pending</span></div>
      <h3>{organization.name}</h3><p className="review-location"><MapPin size={14} />{organization.address}, {organization.locality}, {organization.city} {organization.pincode}</p>
      <div className="review-owner"><div className="owner-avatar">{organization.owner_name.slice(0, 1).toUpperCase()}</div><span><strong>{organization.owner_name}</strong><small><a href={`mailto:${encodeURIComponent(organization.owner_email)}`}>{organization.owner_email}</a>{organization.owner_phone ? ` · ${organization.owner_phone}` : ''}</small></span><small className="submitted-date">Submitted {new Date(organization.created_at).toLocaleDateString()}</small></div>
      <label className="field-label" htmlFor={`note-${organization.id}`}>Review note <span className="optional">Optional</span></label><textarea id={`note-${organization.id}`} className="review-note" value={notes[organization.id] ?? ''} onChange={(event) => setNotes({ ...notes, [organization.id]: event.target.value })} maxLength={1000} placeholder="Add context for this decision…" />
      <div className="review-actions"><button className="reject-button" disabled={busyId === organization.id} onClick={() => void review(organization.id, 'rejected')}><X size={15} /> Reject</button><button className="verify-button" disabled={busyId === organization.id} onClick={() => void review(organization.id, 'verified')}>{busyId === organization.id ? <span className="spinner spinner-light" /> : <Check size={15} />} Verify organization</button></div>
    </article>)}</div>}
  </>;
}

function ProfileIncomplete() {
  return <div className="profile-incomplete"><span><Building2 size={19} /></span><div><strong>No organization profile is attached yet.</strong><p>Registration may have been completed before organization details were added. Contact the FoodLoop admin team for support.</p></div><ArrowUpRight size={17} /></div>;
}

function UpcomingPanel({ title, items }: { title: string; items: string[] }) {
  return <section className="next-steps"><div className="next-steps-heading"><span><Leaf size={17} /></span><h2>{title}</h2></div>{items.map((item, index) => <div className="next-step-row" key={item}><span className="next-step-index">0{index + 1}</span><p>{item}</p><span className="next-step-dot" />{index < items.length - 1 && <span className="next-step-line" />}</div>)}</section>;
}
