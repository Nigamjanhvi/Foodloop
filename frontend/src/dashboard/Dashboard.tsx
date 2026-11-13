import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, Bell, Building2, Check, ChevronDown, ChevronRight, ClipboardList, FileCheck2, Heart, Leaf, LogOut, Menu, PackageCheck, Settings, ShieldCheck, Truck, Users, Utensils, X } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth, errorMessage, type CurrentUser, type UserRole } from '../auth/AuthContext';
import { donorDashboardMode } from './dashboardState';
import { ComingSoonPanel, EmptyState, ErrorNotice, PageHeader, StatCard, StatusBadge } from '../components/ui';

// The role navigation intentionally points only at implemented overview/review
// routes or explicit coming-soon pages.
interface NavEntry { label: string; to: string; icon: ReactNode }
interface NavGroup { label: string; items: NavEntry[] }
const navByRole: Record<UserRole, NavGroup[]> = {
  donor: [{ label: 'WORKSPACE', items: [
    { label: 'Overview', to: '/dashboard/donor', icon: <Activity size={17} /> },
    { label: 'My donations', to: '/dashboard/donor/donations', icon: <Utensils size={17} /> },
    { label: 'Reservation requests', to: '/dashboard/donor/reservations', icon: <ClipboardList size={17} /> },
    { label: 'Donation history', to: '/dashboard/donor/history', icon: <PackageCheck size={17} /> },
    { label: 'Notifications', to: '/dashboard/donor/notifications', icon: <Bell size={17} /> },
  ] }],
  ngo: [{ label: 'RECIPIENT WORKSPACE', items: [
    { label: 'Overview', to: '/dashboard/ngo', icon: <Activity size={17} /> },
    { label: 'Browse available food', to: '/dashboard/ngo/available', icon: <Utensils size={17} /> },
    { label: 'My reservations', to: '/dashboard/ngo/reservations', icon: <ClipboardList size={17} /> },
    { label: 'Pickup & delivery', to: '/dashboard/ngo/tracking', icon: <Truck size={17} /> },
    { label: 'Reservation history', to: '/dashboard/ngo/history', icon: <PackageCheck size={17} /> },
  ] }],
  volunteer: [{ label: 'VOLUNTEER SPACE', items: [
    { label: 'Overview', to: '/dashboard/volunteer', icon: <Activity size={17} /> },
    { label: 'Assigned tasks', to: '/dashboard/volunteer/tasks', icon: <ClipboardList size={17} /> },
    { label: 'Task history', to: '/dashboard/volunteer/history', icon: <PackageCheck size={17} /> },
  ] }],
  admin: [
    { label: 'OVERVIEW', items: [{ label: 'Dashboard', to: '/dashboard/admin', icon: <Activity size={17} /> }] },
    { label: 'PEOPLE & ORGANIZATIONS', items: [
      { label: 'All users', to: '/dashboard/admin/users', icon: <Users size={17} /> },
      { label: 'Donors', to: '/dashboard/admin/donors', icon: <Utensils size={17} /> },
      { label: 'NGOs & recipients', to: '/dashboard/admin/ngos', icon: <Heart size={17} /> },
      { label: 'Volunteers', to: '/dashboard/admin/volunteers', icon: <Truck size={17} /> },
      { label: 'Organization review', to: '/dashboard/admin/organizations', icon: <FileCheck2 size={17} /> },
    ] },
    { label: 'PLATFORM OPERATIONS', items: [
      { label: 'Donations', to: '/dashboard/admin/donations', icon: <Utensils size={17} /> },
      { label: 'Reservations', to: '/dashboard/admin/reservations', icon: <ClipboardList size={17} /> },
      { label: 'Volunteer tasks', to: '/dashboard/admin/tasks', icon: <Truck size={17} /> },
      { label: 'Notifications', to: '/dashboard/admin/notifications', icon: <Bell size={17} /> },
    ] },
    { label: 'INSIGHTS & SYSTEM', items: [
      { label: 'Reports & impact', to: '/dashboard/admin/analytics', icon: <Activity size={17} /> },
      { label: 'Access & trust', to: '/dashboard/admin/trust', icon: <ShieldCheck size={17} /> },
      { label: 'DevOps control center', to: '/dashboard/admin/devops', icon: <Settings size={17} /> },
      { label: 'Settings', to: '/dashboard/admin/settings', icon: <Settings size={17} /> },
    ] },
  ],
};

const roleLabels: Record<UserRole, string> = { donor: 'Food donor', ngo: 'NGO / recipient', volunteer: 'Volunteer', admin: 'Administrator' };

export function DashboardFrame() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileNav, setMobileNav] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  if (!user) return null;
  const groups = navByRole[user.role];
  const pageTitle = useMemo(() => groups.flatMap((group) => group.items).find((entry) => entry.to === location.pathname)?.label ?? roleLabels[user.role], [groups, location.pathname, user.role]);
  const notificationPath = `/dashboard/${user.role}/notifications`;
  function signOut() { logout(); navigate('/login', { replace: true }); }
  return <div className="dashboard-shell">
    {mobileNav && <button className="mobile-nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`dashboard-sidebar ${mobileNav ? 'mobile-open' : ''}`}>
      <Link className="brand" to="/"><span className="brand-mark"><Leaf size={18} /></span>foodloop</Link>
      <div className="sidebar-scroll">{groups.map((group) => <section className="sidebar-group" key={group.label}><div className="sidebar-section-label">{group.label}</div>{group.items.map((item) => <NavLink key={item.to} to={item.to} end={item.to === `/dashboard/${user.role}`} onClick={() => setMobileNav(false)} className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}><span className="sidebar-nav-icon">{item.icon}</span>{item.label}<ChevronRight className="sidebar-link-chevron" size={14} /></NavLink>)}</section>)}</div>
      <div className="sidebar-bottom"><div className="side-help"><span className="help-orb"><Heart size={15} /></span><strong>Good things grow here.</strong><small>Thanks for being part of your local food loop.</small></div>
        <div className="sidebar-user"><span className="avatar">{user.fullName.slice(0, 1).toUpperCase()}</span><span className="sidebar-user-name"><strong>{user.fullName}</strong><small>{roleLabels[user.role]}</small></span><button className="logout-icon" onClick={signOut} title="Sign out" aria-label="Sign out"><LogOut size={16} /></button></div>
      </div>
    </aside>
    <main className="dashboard-main"><header className="dashboard-topbar"><button className="mobile-menu-button" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={19} /></button><div className="topbar-crumb"><span className="breadcrumb-muted">FoodLoop</span><ChevronRight size={13} /><span>{pageTitle}</span></div><div className="topbar-actions"><Link className="topbar-icon-button" to={notificationPath} aria-label="Notifications"><Bell size={17} /><span className="notification-dot" /></Link><div className="profile-menu-wrap"><button className="profile-menu-trigger" onClick={() => setProfileOpen(!profileOpen)} aria-expanded={profileOpen}><span className="avatar avatar-small">{user.fullName.slice(0, 1).toUpperCase()}</span><span className="profile-menu-name"><strong>{user.fullName}</strong><small>{roleLabels[user.role]}</small></span><ChevronDown size={15} /></button>{profileOpen && <div className="profile-popover"><span>{user.email}</span><span>{user.phone ?? 'Phone not set'}</span><button onClick={signOut}><LogOut size={15} /> Sign out</button></div>}</div></div></header><div className="dashboard-content"><Outlet /></div></main>
  </div>;
}

interface OrganizationProfile {
  id: string; name: string; organization_type: string; verification_status: 'pending' | 'verified' | 'rejected';
  verification_note: string | null; address: string; city: string; locality: string; pincode: string; created_at: string;
  contact_name: string; contact_email: string; contact_phone: string | null;
}

function useOrganization() {
  const [organization, setOrganization] = useState<OrganizationProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = () => {
    setLoading(true); setError('');
    return api.get<{ data: { organization: OrganizationProfile } }>('/organizations/me')
      .then(({ data }) => setOrganization(data.data.organization))
      .catch((failure) => setError(errorMessage(failure)))
      .finally(() => setLoading(false));
  };
  useEffect(() => { void refresh(); }, []);
  return { organization, loading, error, refresh };
}

function OrgDetailsCard({ organization }: { organization: OrganizationProfile }) {
  return <section className="dashboard-card org-details-card"><div className="card-title-row"><div><span className="eyebrow">ORGANIZATION PROFILE</span><h2>{organization.name}</h2></div><Building2 size={20} /></div><div className="org-detail-grid">
    <div><span>Contact person</span><strong>{organization.contact_name}</strong></div><div><span>Email</span><strong>{organization.contact_email}</strong></div><div><span>Phone</span><strong>{organization.contact_phone ?? 'Not provided'}</strong></div><div><span>Location</span><strong>{organization.address}, {organization.locality}, {organization.city} {organization.pincode}</strong></div><div><span>Submitted</span><strong>{new Date(organization.created_at).toLocaleDateString()}</strong></div>
  </div></section>;
}

function DashboardWelcome({ user, eyebrow, title, subtitle, badge }: { user: CurrentUser; eyebrow: string; title: ReactNode; subtitle: string; badge?: ReactNode }) {
  return <PageHeader eyebrow={eyebrow} title={<>{title}<span className="welcome-name">{user.fullName.split(' ')[0]}</span></>} description={subtitle} actions={badge} />;
}

export function DonorDashboard() {
  const { user } = useAuth();
  const { organization, loading, error, refresh } = useOrganization();
  if (loading) return <DashboardSkeleton />;
  if (error) return <div className="page-content"><ErrorNotice message={error} onRetry={() => void refresh()} /></div>;
  if (!organization) return <div className="page-content"><PageHeader eyebrow="DONOR WORKSPACE" title="Organization profile missing" description="This account has no linked donor organization yet." /><ComingSoonPanel title="Organization setup" description="Organization registration is attached to donor signup. Contact the FoodLoop administrator to link an existing account." /></div>;

  const mode = donorDashboardMode(organization.verification_status);
  if (mode === 'onboarding') return <DonorOnboarding user={user!} organization={organization} onRefresh={() => void refresh()} />;
  if (mode === 'review') return <DonorRejected user={user!} organization={organization} onRefresh={() => void refresh()} />;
  return <DonorWorkspace user={user!} organization={organization} onRefresh={() => void refresh()} />;
}

function DonorOnboarding({ user, organization, onRefresh }: { user: CurrentUser; organization: OrganizationProfile; onRefresh(): void }) {
  return <div className="page-content donor-state-page">
    <DashboardWelcome user={user} eyebrow="DONOR ONBOARDING" title="Welcome back, " subtitle="Your organization is in the review queue. Here’s what happens next." badge={<StatusBadge status="pending" label="Pending approval" />} />
    <div className="onboarding-grid"><section className="dashboard-card verification-progress"><div className="section-heading"><div><span className="eyebrow">VERIFICATION PROGRESS</span><h2>Almost ready to join the loop</h2></div><button className="icon-action" onClick={onRefresh} aria-label="Refresh organization status"><Activity size={16} /></button></div>
      <div className="progress-steps"><ProgressStep number="01" title="Organization submitted" detail="Your details are saved securely." state="done" /><ProgressStep number="02" title="Administrator review" detail="A FoodLoop administrator is reviewing your organization." state="current" /><ProgressStep number="03" title="Donation workspace" detail="Your donor workspace opens after approval." state="locked" /></div>
      <div className="approval-info"><ShieldCheck size={18} /><p><strong>Why do we review organizations?</strong><br />A review helps keep community pickups clear and accountable. You can revisit this page to see the recorded decision and any administrator note.</p></div>
    </section><OrgDetailsCard organization={organization} /></div>
    <div className="onboarding-bottom"><section className="dashboard-card next-step-card"><div className="section-heading"><div><span className="eyebrow">WHAT TO EXPECT</span><h2>Your next steps</h2></div></div><div className="expectation-list"><div><span className="step-check"><Check size={15} /></span><p><strong>Details submitted</strong><small>Your organization profile is in FoodLoop.</small></p><StatusBadge status="complete" /></div><div><span className="step-current"><span /></span><p><strong>Review in progress</strong><small>We’ll record the decision here.</small></p><StatusBadge status="pending" /></div><div><span className="step-lock"><span /></span><p><strong>Donations unlock after approval</strong><small>Food listings are intentionally unavailable while review is pending.</small></p><span className="status-badge neutral">LOCKED</span></div></div></section><section className="donor-help-card"><span className="help-icon-large"><Heart size={20} /></span><span className="eyebrow">HERE TO HELP</span><h2>Questions about your review?</h2><p>Use the administrator review note if more information is requested. The current profile details above are what the review is based on.</p></section></div>
  </div>;
}

function ProgressStep({ number, title, detail, state }: { number: string; title: string; detail: string; state: 'done' | 'current' | 'locked' }) {
  return <div className={`progress-step ${state}`}><span className="progress-step-number">{state === 'done' ? <Check size={16} /> : number}</span><div><strong>{title}</strong><small>{detail}</small></div><span className="progress-step-state">{state === 'done' ? 'DONE' : state === 'current' ? 'IN REVIEW' : 'UP NEXT'}</span></div>;
}

function DonorRejected({ user, organization, onRefresh }: { user: CurrentUser; organization: OrganizationProfile; onRefresh(): void }) {
  return <div className="page-content donor-state-page"><DashboardWelcome user={user} eyebrow="DONOR ORGANIZATION" title="Organization review" subtitle="An administrator has recorded a decision for your organization." badge={<StatusBadge status="rejected" label="Review required" />} />
    <section className="rejected-panel"><span className="rejected-symbol"><X size={22} /></span><div><span className="eyebrow">DECISION RECORDED</span><h2>More information is needed</h2><p>Your donation workspace remains locked until the organization review is resolved.</p>{organization.verification_note ? <blockquote><strong>Administrator note</strong><br />{organization.verification_note}</blockquote> : <p className="review-note-empty">No review note was provided. Contact the FoodLoop administrator for guidance.</p>}<button className="outline-button" onClick={onRefresh}><Activity size={15} /> Refresh review status</button></div></section>
    <OrgDetailsCard organization={organization} /><section className="dashboard-card access-locked"><ShieldCheck size={19} /><div><strong>Donation actions are unavailable</strong><p>Creating or managing donations will be available only after an administrator changes this organization’s status to verified.</p></div><StatusBadge status="locked" /></section>
  </div>;
}

function DonorWorkspace({ user, organization, onRefresh }: { user: CurrentUser; organization: OrganizationProfile; onRefresh(): void }) {
  const metrics = [
    ['Total donations', 'Soon', 'Available when donation records are introduced', <Utensils size={18} />, 'sage'],
    ['Active donations', 'Soon', 'No donation API is connected yet', <Activity size={18} />, 'orange'],
    ['Food donated', 'Soon', 'Quantity metrics will use saved donations', <Leaf size={18} />, 'blue'],
    ['Completed deliveries', 'Soon', 'Delivery records are not available yet', <PackageCheck size={18} />, 'plum'],
  ] as const;
  return <div className="page-content donor-state-page">
    <PageHeader eyebrow="VERIFIED DONOR WORKSPACE" title={<>Good to have you here, <span className="welcome-name">{user.fullName.split(' ')[0]}</span></>} description={organization.name} actions={<div className="header-actions"><StatusBadge status="verified" label="Verified organization" /><button className="outline-button" onClick={onRefresh}>Refresh status</button></div>} />
    <section className="dashboard-card verified-banner"><span className="verified-banner-icon"><ShieldCheck size={21} /></span><div><strong>Your organization is verified.</strong><p>The workspace is ready. Donation and reservation actions will become active when their APIs are implemented.</p></div><button className="button disabled-feature" disabled title="Donation creation is coming in Phase 3">Create donation <ChevronRight size={16} /></button></section>
    <div className="stat-grid donor-stat-grid">{metrics.map(([label, value, note, icon, tone]) => <StatCard key={label} label={label} value={value} note={note} icon={icon} tone={tone} />)}</div>
    <div className="quick-action-grid"><FeatureAction icon={<Utensils size={19} />} title="Create new donation" detail="Post surplus food and pickup details." /><FeatureAction icon={<ClipboardList size={19} />} title="Manage my donations" detail="Review active and completed listings." /><FeatureAction icon={<Users size={19} />} title="Reservation requests" detail="Coordinate with nearby recipients." /><FeatureAction icon={<PackageCheck size={19} />} title="Donation history" detail="See completed and expired listings." /></div>
    <section className="dashboard-card donor-empty-workspace"><EmptyState icon={<Utensils size={28} />} title="Your first donation starts here" description="This organization is verified. Donation listings will appear here when the donation workflow is connected." action={<span className="coming-tag">COMING SOON</span>} /></section>
    <section className="workspace-section-grid"><ComingSoonPanel title="My donations" description="Donation records and listing APIs are part of the next application phase." features={['Food item, quantity and category', 'Pickup locality and collection deadline', 'Remaining quantity and current status']} /><ComingSoonPanel title="Reservation activity" description="Reservation requests will appear here when the reservation workflow is available." features={['Recipient organization and reserved quantity', 'Decision and pickup progress']} /></section>
    <div className="workspace-section-grid"><ComingSoonPanel title="Impact from your donations" description="Impact totals and trends will be calculated only from completed database records." features={['Food delivered', 'Organizations reached', 'Monthly trends']} /><ComingSoonPanel title="Notifications" description="There is no notification feed yet, so this panel will stay empty until real notification records are connected." features={['Organization status updates', 'Reservation and delivery updates']} /></div>
  </div>;
}

function FeatureAction({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <button className="feature-action" type="button" disabled title="Coming soon"><span>{icon}</span><strong>{title}</strong><small>{detail}</small><em>Coming soon</em></button>;
}

export function NgoDashboard() {
  const { user } = useAuth();
  const { organization, loading, error, refresh } = useOrganization();
  if (loading) return <DashboardSkeleton />;
  if (error) return <div className="page-content"><ErrorNotice message={error} onRetry={() => void refresh()} /></div>;
  if (!organization) return <div className="page-content"><PageHeader eyebrow="RECIPIENT WORKSPACE" title="Organization profile missing" description="This account has no linked recipient organization." /></div>;
  return <div className="page-content"><PageHeader eyebrow="NGO & RECIPIENT WORKSPACE" title={<>Welcome, <span className="welcome-name">{user!.fullName.split(' ')[0]}</span></>} description={organization.name} actions={<StatusBadge status={organization.verification_status} label={`${organization.verification_status} organization`} />} />
    <OrgDetailsCard organization={organization} />
    <div className="ngo-welcome-card"><span><Heart size={21} /></span><div><span className="eyebrow">COMMUNITY RECIPIENT</span><h2>Good food, in reach.</h2><p>Once verified, your organization will be ready to discover nearby surplus food. Donation discovery is coming in a later phase.</p></div><button className="outline-button" onClick={() => void refresh()}>Refresh status</button></div>
    <div className="workspace-section-grid"><ComingSoonPanel title="Nearby food" description="There are no live donation listings until the donation and locality matching APIs are built." features={['City, locality and pincode filters', 'Food category and quantity filters', 'Collection deadlines']} /><ComingSoonPanel title="Reservations & pickup" description="No reservation or delivery records are shown before those workflows are implemented." features={['Reservation status', 'Pickup and delivery progress', 'Reservation history']} /></div>
  </div>;
}

interface VolunteerProfile { city: string; pincode: string; is_available: boolean }
export function VolunteerDashboard() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<VolunteerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try { const { data } = await api.get<{ data: { profile: VolunteerProfile } }>('/volunteers/me'); setProfile(data.data.profile); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  if (loading) return <DashboardSkeleton />;
  return <div className="page-content"><PageHeader eyebrow="VOLUNTEER WORKSPACE" title={<>Welcome, <span className="welcome-name">{user!.fullName.split(' ')[0]}</span></>} description="Your volunteer profile and service area." actions={profile && <StatusBadge status={profile.is_available ? 'active' : 'inactive'} label={profile.is_available ? 'Available' : 'Unavailable'} />} />
    {error && <ErrorNotice message={error} onRetry={() => void load()} />}
    {profile && <section className="dashboard-card volunteer-profile-card"><span className="volunteer-avatar-large"><Truck size={23} /></span><div><span className="eyebrow">YOUR SERVICE AREA</span><h2>{profile.city}</h2><p>Pincode {profile.pincode} · Availability is stored in your volunteer profile.</p></div></section>}
    <div className="workspace-section-grid"><ComingSoonPanel title="Assigned tasks" description="No task assignment API is connected yet. No pickup has been assigned to you." features={['Donor and recipient pickup details', 'Collection deadline', 'OTP confirmation once implemented']} /><ComingSoonPanel title="Completed deliveries" description="Task history will appear once volunteer assignments and delivery verification are available." features={['Completed pickup and delivery records', 'Delivery history']} /></div>
  </div>;
}

function DashboardSkeleton() {
  return <div className="page-content" aria-label="Loading dashboard"><div className="skeleton skeleton-title" /><div className="skeleton skeleton-copy" /><div className="skeleton-grid">{[1, 2, 3].map((value) => <div key={value} className="skeleton skeleton-card" />)}</div></div>;
}
