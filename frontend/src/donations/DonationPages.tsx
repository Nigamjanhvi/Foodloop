import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Building2, Check, Clock3, Filter, MapPin, PackageCheck, RefreshCw, Search, ShieldCheck, Truck, Utensils, X } from 'lucide-react';
import { api } from '../api/client';
import { errorMessage } from '../auth/AuthContext';
import { ComingSoonPanel, ConfirmDialog, EmptyState, ErrorNotice, LoadingState, PageHeader, Pagination, StatusBadge, Toast } from '../components/ui';

type DonationStatus = 'available' | 'partially_reserved' | 'fully_reserved' | 'expired' | 'cancelled' | 'reserved' | 'completed';
interface Donation {
  id: string; donor_organization_id: string; donor_organization_name?: string; donor_organization_type?: string; donor_verification_status?: string;
  food_name: string; category: string; description: string; quantity_total: number | string; quantity_reserved: number | string;
  quantity_remaining: number | string; unit: string; prepared_at: string; storage_type: string; handling_info: string;
  pickup_address: string; city: string; locality: string; pincode: string; collection_deadline: string; status: DonationStatus;
  created_at: string; updated_at: string;
}
interface Reservation {
  id: string; donation_id: string; recipient_organization_id: string; quantity: number | string; status: string;
  message: string | null; status_reason: string | null; created_at: string; updated_at: string;
  food_name: string; category: string; unit: string; city: string; locality: string; pincode: string; pickup_address: string;
  collection_deadline: string; donation_status: string; donor_organization_id: string; donor_organization_name: string;
  recipient_organization_name: string; recipient_verification_status: string;
}
interface PageData<T> { items: T[]; pagination: { page: number; limit: number; total: number; pages: number } }
const categoryLabels: Record<string, string> = { cooked_meals: 'Cooked meals', rice_grains: 'Rice & grains', fruits: 'Fruits', vegetables: 'Vegetables', bakery: 'Bakery', packaged_food: 'Packaged food', other: 'Other' };
const unitLabels: Record<string, string> = { meals: 'meals', packets: 'packets', kilograms: 'kg', litres: 'litres', boxes: 'boxes', other: 'units' };
const categoryOptions = Object.entries(categoryLabels);
const unitOptions = Object.entries(unitLabels);
const storageOptions = [['ambient', 'Ambient'], ['refrigerated', 'Refrigerated'], ['frozen', 'Frozen'], ['hot', 'Kept hot'], ['other', 'Other']] as const;
const statusOptions = ['all', 'available', 'partially_reserved', 'fully_reserved', 'expired', 'cancelled'] as const;
const reservationStatusOptions = ['all', 'pending', 'accepted', 'rejected', 'cancelled', 'expired'] as const;
const formatDate = (date: string) => new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const toDateTimeLocal = (value?: string) => {
  const date = value ? new Date(value) : new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};
const prettyStatus = (status: string) => status.replaceAll('_', ' ');

function useQueryPage<T>(url: string, dependencies: unknown[]): { data: PageData<T> | null; loading: boolean; error: string; refresh(): void } {
  const [data, setData] = useState<PageData<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const dependencyKey = JSON.stringify(dependencies);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    api.get<{ data: { donations?: T[]; reservations?: T[]; pagination: PageData<T>['pagination'] } }>(url)
      .then(({ data: response }) => { if (active) setData({ items: response.data.donations ?? response.data.reservations ?? [], pagination: response.data.pagination }); })
      .catch((failure) => { if (active) setError(errorMessage(failure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  // dependencyKey intentionally represents the query values in a stable scalar.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, dependencyKey, revision]);
  return { data, loading, error, refresh: () => setRevision((value) => value + 1) };
}

function ListToolbar({ search, setSearch, status, setStatus, category, setCategory, locality, setLocality, deadline, setDeadline, statuses = statusOptions }: {
  search: string; setSearch(value: string): void; status: string; setStatus(value: string): void;
  category?: string; setCategory?(value: string): void; locality?: string; setLocality?(value: string): void;
  deadline?: string; setDeadline?(value: string): void; statuses?: readonly string[];
}) {
  return <section className="dashboard-card donation-toolbar"><label className="search-control"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search food name" aria-label="Search food name" /></label>
    <label className="select-control"><Filter size={16} /><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}>{statuses.map((value) => <option key={value} value={value}>{value === 'all' ? 'All statuses' : prettyStatus(value)}</option>)}</select></label>
    {setCategory && <label className="select-control"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categoryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
    {setLocality && <label className="search-control locality-search"><MapPin size={17} /><input value={locality} onChange={(event) => setLocality(event.target.value)} placeholder="Filter locality" aria-label="Filter locality" /></label>}
    {setDeadline && <label className="deadline-filter">Deadline before<input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} aria-label="Filter collection deadline" /></label>}
  </section>;
}

function DonationCard({ donation, action }: { donation: Donation; action?: ReactNode }) {
  return <article className="donation-card"><div className="donation-card-top"><span className="donation-icon"><Utensils size={23} /></span><StatusBadge status={donation.status} /></div><span className="donation-category">{categoryLabels[donation.category] ?? donation.category}</span><h2>{donation.food_name}</h2><p className="donation-quantity"><strong>{donation.quantity_remaining}</strong> {unitLabels[donation.unit] ?? donation.unit} available <span>of {donation.quantity_total}</span></p><div className="donation-location"><MapPin size={16} /><span>{donation.locality}, {donation.city} · {donation.pincode}</span></div><div className="donation-deadline"><Clock3 size={16} /><span>Collect by {formatDate(donation.collection_deadline)}</span></div>{donation.donor_organization_name && <div className="donation-donor"><Building2 size={16} />{donation.donor_organization_name}</div>}{action}</article>;
}

function DonationFields({ values, setValues, editing = false }: { values: Record<string, string>; setValues(value: Record<string, string>): void; editing?: boolean }) {
  function field(name: string, value: string) { setValues({ ...values, [name]: value }); }
  return <>
    <section className="donation-form-section"><div className="form-section-heading"><span>01</span><div><h2>Food information</h2><p>Tell recipient organizations what you can share.</p></div></div><div className="form-grid">
      <label className="form-field full-field"><span className="field-label">Food name <b className="required-mark">*</b></span><input className="plain-input" name="food_name" value={values.food_name ?? ''} onChange={(event) => field('food_name', event.target.value)} minLength={2} maxLength={160} required placeholder="e.g. Vegetable rice meal" /></label>
      <label className="form-field"><span className="field-label">Category <b className="required-mark">*</b></span><select className="plain-input" name="category" value={values.category ?? 'cooked_meals'} onChange={(event) => field('category', event.target.value)} required>{categoryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="form-field"><span className="field-label">Total quantity <b className="required-mark">*</b></span><div className="quantity-field"><input className="plain-input" type="number" name="quantity_total" value={values.quantity_total ?? ''} onChange={(event) => field('quantity_total', event.target.value)} min="0.01" max="1000000" step="0.01" required placeholder="0" /><select className="plain-input" name="unit" value={values.unit ?? 'packets'} disabled={editing && Number(values.quantity_reserved ?? 0) > 0} onChange={(event) => field('unit', event.target.value)} aria-label="Quantity unit">{unitOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></label>
      <label className="form-field full-field"><span className="field-label">Description</span><textarea className="plain-input donation-textarea" name="description" value={values.description ?? ''} onChange={(event) => field('description', event.target.value)} maxLength={2000} placeholder="What is included? Mention ingredients or packaging where useful." /></label>
    </div></section>
    <section className="donation-form-section"><div className="form-section-heading"><span>02</span><div><h2>Preparation & storage</h2><p>Information provided by you; FoodLoop does not certify food safety.</p></div></div><div className="form-grid">
      <label className="form-field"><span className="field-label">Prepared at <b className="required-mark">*</b></span><input className="plain-input" type="datetime-local" name="prepared_at" value={values.prepared_at ?? ''} onChange={(event) => field('prepared_at', event.target.value)} required /></label>
      <label className="form-field"><span className="field-label">Storage type <b className="required-mark">*</b></span><select className="plain-input" name="storage_type" value={values.storage_type ?? 'ambient'} onChange={(event) => field('storage_type', event.target.value)} required>{storageOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="form-field full-field"><span className="field-label">Storage & handling notes</span><textarea className="plain-input donation-textarea" name="handling_info" value={values.handling_info ?? ''} onChange={(event) => field('handling_info', event.target.value)} maxLength={2000} placeholder="Share storage instructions and handling details." /></label>
    </div></section>
    <section className="donation-form-section"><div className="form-section-heading"><span>03</span><div><h2>Pickup information</h2><p>Use the exact collection location and a clear deadline.</p></div></div><div className="form-grid">
      <label className="form-field full-field"><span className="field-label">Pickup address <b className="required-mark">*</b></span><input className="plain-input" name="pickup_address" value={values.pickup_address ?? ''} onChange={(event) => field('pickup_address', event.target.value)} minLength={5} maxLength={500} required /></label>
      <label className="form-field"><span className="field-label">City <b className="required-mark">*</b></span><input className="plain-input" name="city" value={values.city ?? ''} onChange={(event) => field('city', event.target.value)} minLength={2} maxLength={100} required /></label>
      <label className="form-field"><span className="field-label">Locality <b className="required-mark">*</b></span><input className="plain-input" name="locality" value={values.locality ?? ''} onChange={(event) => field('locality', event.target.value)} minLength={2} maxLength={120} required /></label>
      <label className="form-field"><span className="field-label">Pincode <b className="required-mark">*</b></span><input className="plain-input" name="pincode" value={values.pincode ?? ''} onChange={(event) => field('pincode', event.target.value)} pattern="[0-9]{5,10}" inputMode="numeric" required /></label>
      <label className="form-field"><span className="field-label">Collection deadline <b className="required-mark">*</b></span><input className="plain-input" type="datetime-local" name="collection_deadline" value={values.collection_deadline ?? ''} onChange={(event) => field('collection_deadline', event.target.value)} required /></label>
    </div><p className="food-safety-note"><ShieldCheck size={17} /> FoodLoop records donor-provided preparation and handling details. Donors and recipients remain responsible for following applicable food safety requirements.</p></section>
  </>;
}

function defaultDonationValues(organization?: { address: string; city: string; locality: string; pincode: string }) {
  return { food_name: '', category: 'cooked_meals', description: '', quantity_total: '', quantity_reserved: '0', unit: 'packets',
    prepared_at: toDateTimeLocal(), storage_type: 'ambient', handling_info: '', pickup_address: organization?.address ?? '',
    city: organization?.city ?? 'Phagwara', locality: organization?.locality ?? '', pincode: organization?.pincode ?? '',
    collection_deadline: toDateTimeLocal(new Date(Date.now() + 4 * 60 * 60_000).toISOString()) };
}

function apiPayload(values: Record<string, string>) {
  return { ...values, quantity_total: Number(values.quantity_total), prepared_at: new Date(values.prepared_at).toISOString(), collection_deadline: new Date(values.collection_deadline).toISOString() };
}

export function CreateDonationPage() {
  const navigate = useNavigate();
  const [organization, setOrganization] = useState<{ verification_status: string; address: string; city: string; locality: string; pincode: string } | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() => defaultDonationValues());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api.get<{ data: { organization: typeof organization } }>('/organizations/me').then(({ data }) => { setOrganization(data.data.organization); setValues(defaultDonationValues(data.data.organization ?? undefined)); }).catch((failure) => setError(errorMessage(failure))).finally(() => setLoading(false)); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (!event.currentTarget.checkValidity()) { setError('Check the required fields and values before publishing.'); return; }
    setBusy(true);
    try { const { data } = await api.post<{ data: { donation: Donation } }>('/donations', apiPayload(values)); navigate(`/dashboard/donor/donations/${data.data.donation.id}`, { state: { created: true } }); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <div className="page-content"><PageHeader eyebrow="DONOR WORKSPACE · NEW LISTING" title="Create a donation" description="Share clear food, quantity, preparation, and pickup information with nearby organizations." breadcrumbs={[{ label: 'Overview', to: '/dashboard/donor' }, { label: 'My donations', to: '/dashboard/donor/donations' }, { label: 'Create donation' }]} />
    {loading ? <LoadingState label="Loading your organization profile…" /> : error && !organization ? <ErrorNotice message={error} /> : organization?.verification_status !== 'verified' ? <ComingSoonPanel title="Verified organization required" description="Only active donor organizations approved by an administrator can publish donation listings." features={['Your organization’s recorded review status', 'Donation tools open automatically after verification']} /> : <form className="dashboard-card donation-form" onSubmit={submit} noValidate><DonationFields values={values} setValues={setValues} />{error && <ErrorNotice message={error} />}<div className="donation-form-footer"><Link className="outline-button" to="/dashboard/donor/donations"><ArrowLeft size={17} /> Back to donations</Link><button className="button" type="submit" disabled={busy}>{busy ? 'Saving…' : <>Publish donation <ArrowRight size={18} /></>}</button></div></form>}
  </div>;
}

export function DonorDonationsPage({ historyOnly = false }: { historyOnly?: boolean }) {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState(historyOnly ? 'history' : 'all');
  const [category, setCategory] = useState('all'); const [locality, setLocality] = useState(''); const [deadline, setDeadline] = useState(''); const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), limit: '12' });
  if (search.trim()) params.set('search', search.trim()); if (status !== 'all') params.set('status', status);
  if (category !== 'all') params.set('category', category); if (locality.trim()) params.set('locality', locality.trim());
  if (deadline) params.set('deadline_before', new Date(deadline).toISOString());
  const url = `/donations/mine?${params}`;
  const { data, loading, error } = useQueryPage<Donation>(url, [search, status, category, locality, deadline, page]);
  const rows = data?.items ?? [];
  return <div className="page-content"><PageHeader eyebrow={historyOnly ? 'DONOR WORKSPACE · ARCHIVE' : 'DONOR WORKSPACE'} title={historyOnly ? 'Donation history' : 'My donations'} description={historyOnly ? 'Browse fulfilled, expired, and cancelled donation records.' : 'Manage real food listings saved by your organization.'} actions={!historyOnly && <Link className="button" to="/dashboard/donor/donations/new"><Utensils size={18} /> Create donation</Link>} />
    <div className="donation-status-tabs" aria-label="Donation status">{(historyOnly ? ['history', 'fully_reserved', 'expired', 'cancelled'] : statusOptions).map((item) => <button key={item} className={status === item ? 'selected' : ''} onClick={() => { setStatus(item); setPage(1); }}>{item === 'all' ? 'All' : item === 'history' ? 'All history' : prettyStatus(item)}</button>)}</div>
    <ListToolbar search={search} setSearch={(value) => { setSearch(value); setPage(1); }} status={status} setStatus={(value) => { setStatus(value); setPage(1); }} category={category} setCategory={(value) => { setCategory(value); setPage(1); }} locality={locality} setLocality={(value) => { setLocality(value); setPage(1); }} deadline={deadline} setDeadline={(value) => { setDeadline(value); setPage(1); }} />
    {error && <ErrorNotice message={error} />} {loading ? <div className="skeleton-grid">{[1,2,3].map((item) => <div className="skeleton skeleton-card" key={item} />)}</div> : rows.length ? <div className="donation-grid">{rows.map((item) => <DonationCard key={item.id} donation={item} action={<Link className="outline-button" to={`/dashboard/donor/donations/${item.id}`}>View details <ArrowRight size={16} /></Link>} />)}</div> : <EmptyState icon={<Utensils size={25} />} title={historyOnly ? 'No donation history yet' : 'No donations match these filters'} description={historyOnly ? 'Completed, expired, and cancelled listings will appear here when you have records.' : 'Create your first listing or adjust the search and filters.'} action={!historyOnly && <Link className="button" to="/dashboard/donor/donations/new">Create donation <ArrowRight size={17} /></Link>} />}
    {!loading && data && <Pagination page={data.pagination.page} pages={data.pagination.pages} onChange={setPage} />}
  </div>;
}

function ReservationCard({ reservation, mode, onAction, readOnly = false }: { reservation: Reservation; mode: 'donor' | 'recipient' | 'admin'; onAction?: (reservation: Reservation, action: 'accept' | 'reject' | 'cancel') => void; readOnly?: boolean }) {
  return <article className="reservation-card"><div className="donation-card-top"><span className="donation-icon"><PackageCheck size={23} /></span><StatusBadge status={reservation.status} /></div><span className="donation-category">{categoryLabels[reservation.category] ?? reservation.category}</span><h2>{reservation.food_name}</h2><p className="reservation-quantity"><strong>{reservation.quantity}</strong> {unitLabels[reservation.unit] ?? reservation.unit} requested</p><div className="reservation-parties"><p><strong>Donor</strong><span>{reservation.donor_organization_name}</span></p><p><strong>Recipient</strong><span>{reservation.recipient_organization_name}</span></p></div><div className="donation-location"><MapPin size={16} /><span>{reservation.pickup_address}, {reservation.locality}, {reservation.city} {reservation.pincode}</span></div><div className="donation-deadline"><Clock3 size={16} /><span>Request {formatDate(reservation.created_at)} · collect by {formatDate(reservation.collection_deadline)}</span></div>{reservation.message && <blockquote className="reservation-message">“{reservation.message}”</blockquote>}{reservation.status_reason && <p className="reservation-reason"><strong>Update:</strong> {reservation.status_reason}</p>}
    {!readOnly && <div className="reservation-card-actions"><Link className="outline-button" to={mode === 'admin' ? `/dashboard/admin/reservations/${reservation.id}` : mode === 'recipient' ? `/dashboard/ngo/reservations/${reservation.id}` : `/dashboard/donor/reservations/${reservation.id}`}>Details <ArrowRight size={16} /></Link>{mode === 'donor' && reservation.status === 'pending' && <><button className="reject-button" onClick={() => onAction?.(reservation, 'reject')}><X size={16} /> Reject</button><button className="verify-button" onClick={() => onAction?.(reservation, 'accept')}><Check size={16} /> Accept</button></>}{mode === 'recipient' && ['pending', 'accepted', 'approved'].includes(reservation.status) && <button className="reject-button" onClick={() => onAction?.(reservation, 'cancel')}>Cancel request</button>}</div>}
  </article>;
}

function ReservationsPage({ mode, historyOnly = false }: { mode: 'donor' | 'recipient' | 'admin'; historyOnly?: boolean }) {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState(historyOnly ? 'history' : 'all'); const [page, setPage] = useState(1);
  const [pendingAction, setPendingAction] = useState<{ reservation: Reservation; action: 'accept' | 'reject' | 'cancel' } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [toast, setToast] = useState(''); const [revision, setRevision] = useState(0);
  const urlParams = new URLSearchParams({ page: String(page), limit: '12' }); if (status !== 'all') urlParams.set('status', status);
  const path = mode === 'donor' ? '/reservations/received' : mode === 'admin' ? '/admin/reservations' : '/reservations/mine';
  if (mode === 'admin' && search.trim()) urlParams.set('search', search.trim());
  const url = `${path}?${urlParams}`;
  const { data, loading, error: loadError, refresh } = useQueryPage<Reservation>(url, [status, search, page, revision]);
  const rows = data?.items ?? [];
  async function runAction() {
    if (!pendingAction) return;
    const { reservation, action } = pendingAction;
    setBusy(true); setError('');
    try {
      if (action === 'accept') await api.patch(`/reservations/${reservation.id}/accept`, {});
      else if (action === 'reject') await api.patch(`/reservations/${reservation.id}/reject`, {});
      else await api.post(`/reservations/${reservation.id}/cancel`, {});
      setToast(`Reservation ${action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'cancelled'}.`); setPendingAction(null); refresh(); setRevision((value) => value + 1);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  const title = mode === 'donor' ? 'Reservation requests' : mode === 'recipient' ? historyOnly ? 'Reservation history' : 'My reservations' : 'Reservation management';
  return <div className="page-content"><PageHeader eyebrow={`${mode === 'recipient' ? 'NGO' : mode.toUpperCase()} WORKSPACE · RESERVATIONS`} title={title} description={mode === 'donor' ? 'Review real requests for your organization’s donation listings.' : mode === 'recipient' ? 'Track your organization’s requests and their saved status.' : 'Inspect reservation records without altering donor or recipient decisions.'} actions={mode === 'admin' && <button className="outline-button" onClick={() => { refresh(); setRevision((value) => value + 1); }}><RefreshCw size={17} /> Refresh</button>} />
    <div className="donation-status-tabs">{(historyOnly ? ['history', 'accepted', 'rejected', 'cancelled', 'expired'] : reservationStatusOptions).map((item) => <button key={item} className={status === item ? 'selected' : ''} onClick={() => { setStatus(item); setPage(1); }}>{item === 'all' ? 'All' : item === 'history' ? 'All history' : prettyStatus(item)}</button>)}</div>
    {mode === 'admin' && <label className="search-control"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} aria-label="Search reservations" placeholder="Search food, donor, or recipient" /></label>}
    {(error || loadError) && <ErrorNotice message={error || loadError} onRetry={() => { refresh(); setRevision((value) => value + 1); }} />}
    {loading ? <LoadingState label="Loading reservation records…" /> : rows.length ? <div className="reservation-grid">{rows.map((item) => <ReservationCard key={item.id} reservation={item} mode={mode} onAction={(reservation, action) => setPendingAction({ reservation, action })} />)}</div> : <EmptyState icon={<PackageCheck size={24} />} title="No reservations in this view" description="Reservation records will appear here when an organization submits a real request." />}
    {!loading && data && <Pagination page={data.pagination.page} pages={data.pagination.pages} onChange={setPage} />}
    <ConfirmDialog open={Boolean(pendingAction)} title={pendingAction?.action === 'accept' ? 'Accept this request?' : pendingAction?.action === 'reject' ? 'Reject this request?' : 'Cancel this request?'} description={pendingAction ? `${pendingAction.reservation.quantity} ${unitLabels[pendingAction.reservation.unit] ?? pendingAction.reservation.unit} for ${pendingAction.reservation.food_name}. This action updates the saved reservation and available quantity.` : ''} confirmLabel={pendingAction?.action === 'accept' ? 'Accept request' : pendingAction?.action === 'reject' ? 'Reject request' : 'Cancel request'} danger={pendingAction?.action !== 'accept'} busy={busy} onClose={() => setPendingAction(null)} onConfirm={() => void runAction()} />
    {toast && <Toast message={toast} onClose={() => setToast('')} />}
  </div>;
}

export function DonorReservationRequestsPage() { return <ReservationsPage mode="donor" />; }
export function RecipientReservationsPage({ historyOnly = false }: { historyOnly?: boolean }) { return <ReservationsPage mode="recipient" historyOnly={historyOnly} />; }
export function AdminReservationManagementPage() { return <ReservationsPage mode="admin" />; }

export function FoodDiscoveryPage() {
  const [search, setSearch] = useState(''); const [category, setCategory] = useState('all'); const [city, setCity] = useState('');
  const [locality, setLocality] = useState(''); const [pincode, setPincode] = useState(''); const [minimum, setMinimum] = useState(''); const [page, setPage] = useState(1);
  const [deadline, setDeadline] = useState('');
  const query = new URLSearchParams({ page: String(page), limit: '12' });
  if (search.trim()) query.set('search', search.trim()); if (category !== 'all') query.set('category', category);
  if (city.trim()) query.set('city', city.trim()); if (locality.trim()) query.set('locality', locality.trim()); if (pincode.trim()) query.set('pincode', pincode.trim());
  if (minimum) query.set('min_quantity', minimum); if (deadline) query.set('deadline_before', new Date(deadline).toISOString());
  const url = `/donations/available?${query}`;
  const { data, loading, error } = useQueryPage<Donation>(url, [search, category, city, locality, pincode, minimum, deadline, page]);
  return <div className="page-content"><PageHeader eyebrow="NGO WORKSPACE · FOOD DISCOVERY" title="Find food nearby" description="Browse donor listings matched to your saved service area. Locality ordering uses stored city, locality, and pincode; FoodLoop does not estimate distance." />
    <section className="dashboard-card discovery-filters"><label className="search-control"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search food name" aria-label="Search food" /></label><label className="select-control"><span>Food category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categoryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="plain-field-label">City<input className="plain-input" value={city} onChange={(event) => setCity(event.target.value)} placeholder="Your organization city" /></label><label className="plain-field-label">Locality<input className="plain-input" value={locality} onChange={(event) => setLocality(event.target.value)} placeholder="Any locality" /></label><label className="plain-field-label">Pincode<input className="plain-input" value={pincode} onChange={(event) => setPincode(event.target.value)} inputMode="numeric" pattern="[0-9]{5,10}" placeholder="144401" /></label><label className="plain-field-label">Minimum amount<input className="plain-input" type="number" min="0" step=".01" value={minimum} onChange={(event) => setMinimum(event.target.value)} placeholder="Any quantity" /></label><label className="plain-field-label">Deadline before<input className="plain-input" type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label></section>
    {error && <ErrorNotice message={error} />} {loading ? <div className="skeleton-grid">{[1,2,3].map((item) => <div className="skeleton skeleton-card" key={item} />)}</div> : data?.items.length ? <div className="donation-grid">{data.items.map((donation) => <DonationCard key={donation.id} donation={donation} action={<Link className="button" to={`/dashboard/ngo/available/${donation.id}`}>View food details <ArrowRight size={17} /></Link>} />)}</div> : <EmptyState icon={<MapPin size={24} />} title="No available food matched your area" description="Try another city, locality, pincode, or category. Expired and cancelled listings are excluded." />}
    {!loading && data && <Pagination page={data.pagination.page} pages={data.pagination.pages} onChange={setPage} />}
  </div>;
}

export function DonationDetailsPage() {
  const { id = '' } = useParams(); const location = useLocation(); const navigate = useNavigate();
  const isRecipient = location.pathname.includes('/dashboard/ngo/'); const isAdmin = location.pathname.includes('/dashboard/admin/');
  const [donation, setDonation] = useState<Donation | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [quantity, setQuantity] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({}); const [confirmCancel, setConfirmCancel] = useState(false); const [toast, setToast] = useState('');
  async function load() { setLoading(true); setError(''); try { const { data } = await api.get<{ data: { donation: Donation } }>(`/donations/${id}`); setDonation(data.data.donation); setValues(donationToForm(data.data.donation)); } catch (failure) { setError(errorMessage(failure)); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, [id]);
  async function reserve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); if (!event.currentTarget.checkValidity()) { setError('Enter a valid quantity no greater than the available amount.'); return; }
    setBusy(true); try { const { data } = await api.post(`/donations/${id}/reservations`, { quantity: Number(quantity), message }); navigate('/dashboard/ngo/reservations', { state: { created: data.data.reservation.id } }); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); if (!event.currentTarget.checkValidity()) { setError('Check the required fields before saving.'); return; }
    setBusy(true); try { const { data } = await api.patch<{ data: { donation: Donation } }>(`/donations/${id}`, apiPayload(values)); setDonation(data.data.donation); setEditing(false); setToast('Donation changes saved.'); await load(); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  async function cancelDonation() {
    setBusy(true); setError(''); try { const { data } = await api.post<{ data: { donation: Donation } }>(`/donations/${id}/cancel`, {}); setDonation(data.data.donation); setConfirmCancel(false); setToast('Donation cancelled. Its reservation history was preserved.'); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  }
  if (loading) return <div className="page-content"><LoadingState label="Loading donation details…" /></div>;
  if (error && !donation) return <div className="page-content"><ErrorNotice message={error} onRetry={() => void load()} /></div>;
  if (!donation) return null;
  const canManage = !isRecipient && !isAdmin && ['available', 'partially_reserved', 'reserved'].includes(donation.status);
  const active = ['available', 'partially_reserved', 'reserved'].includes(donation.status) && new Date(donation.collection_deadline) > new Date() && Number(donation.quantity_remaining) > 0;
  return <div className="page-content"><PageHeader eyebrow={isAdmin ? 'ADMIN · DONATION RECORD' : isRecipient ? 'NEARBY FOOD · DETAILS' : 'DONOR WORKSPACE · DONATION'} title={donation.food_name} description={`${categoryLabels[donation.category] ?? donation.category} · posted ${formatDate(donation.created_at)}`} breadcrumbs={[{ label: 'Donations', to: isRecipient ? '/dashboard/ngo/available' : isAdmin ? '/dashboard/admin/donations' : '/dashboard/donor/donations' }, { label: donation.food_name }]} actions={<StatusBadge status={donation.status} />} />
    {location.state && (location.state as { created?: boolean }).created && <div className="success-banner"><Check size={19} /> Donation saved to PostgreSQL and now appears in your listing.</div>}
    {error && <ErrorNotice message={error} />} {toast && <Toast message={toast} onClose={() => setToast('')} />}
    {editing ? <form className="dashboard-card donation-form" onSubmit={saveEdit} noValidate><DonationFields values={values} setValues={setValues} editing />{error && <ErrorNotice message={error} />}<div className="donation-form-footer"><button className="outline-button" type="button" onClick={() => setEditing(false)}>Discard edits</button><button className="button" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save changes'}</button></div></form> : <>
      <div className="donation-detail-grid"><section className="dashboard-card donation-detail-main"><div className="section-heading"><div><span className="eyebrow">AVAILABLE QUANTITY</span><h2>{donation.quantity_remaining} <small>{unitLabels[donation.unit] ?? donation.unit}</small></h2></div><span className="donation-icon"><Utensils size={24} /></span></div><div className="detail-quantity-track"><span style={{ width: `${Math.min(100, Math.max(0, Number(donation.quantity_remaining) / Number(donation.quantity_total) * 100))}%` }} /></div><p>{donation.quantity_reserved} {unitLabels[donation.unit] ?? donation.unit} currently reserved out of {donation.quantity_total}.</p><div className="detail-description"><h3>About this food</h3><p>{donation.description || 'The donor did not add a description.'}</p></div><div className="detail-meta-grid"><div><span>Prepared at</span><strong>{formatDate(donation.prepared_at)}</strong></div><div><span>Storage</span><strong>{donation.storage_type}</strong></div><div><span>Collection deadline</span><strong>{formatDate(donation.collection_deadline)}</strong></div><div><span>Pickup locality</span><strong>{donation.locality}, {donation.city} {donation.pincode}</strong></div><div className="full-field"><span>Pickup address</span><strong>{donation.pickup_address}</strong></div><div className="full-field"><span>Handling notes</span><strong>{donation.handling_info || 'No additional handling notes supplied.'}</strong></div></div></section>
        <aside className="donation-detail-aside"><section className="dashboard-card donor-organization-detail"><span className="donation-icon"><Building2 size={23} /></span><span className="eyebrow">DONOR ORGANIZATION</span><h2>{donation.donor_organization_name ?? 'Your organization'}</h2>{donation.donor_verification_status && <StatusBadge status={donation.donor_verification_status} label={`${donation.donor_verification_status} organization`} />}{donation.donor_organization_type && <small>{donation.donor_organization_type === 'recipient' ? 'Recipient organization' : 'Food donor'}</small>}</section>
          {isRecipient && <form className="dashboard-card reservation-request-form" onSubmit={reserve} noValidate><span className="eyebrow">REQUEST A QUANTITY</span><h2>Reserve food</h2>{active ? <><label className="field-label">Quantity requested <span className="required-mark">*</span></label><div className="quantity-field"><input className="plain-input" type="number" min="0.01" step="0.01" max={donation.quantity_remaining} value={quantity} onChange={(event) => setQuantity(event.target.value)} required placeholder="0" /><span className="unit-suffix">{unitLabels[donation.unit] ?? donation.unit}</span></div><label className="field-label" htmlFor="requestMessage">Message to donor <span className="optional">Optional</span></label><textarea id="requestMessage" className="plain-input donation-textarea" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={1000} placeholder="When can you collect?" /><p className="reservation-hold-note">A pending request temporarily reserves this amount so the listing cannot be overbooked.</p><button className="button" disabled={busy} type="submit">{busy ? 'Sending request…' : 'Send reservation request'}</button></> : <p>This donation is no longer accepting reservation requests.</p>}</form>}
          {canManage && <section className="dashboard-card donation-management-actions"><span className="eyebrow">DONOR ACTIONS</span><button className="outline-button" onClick={() => setEditing(true)}>Edit donation</button><button className="reject-button" onClick={() => setConfirmCancel(true)}>Cancel donation</button><Link className="subtle-link" to="/dashboard/donor/reservations">Review reservation requests <ArrowRight size={15} /></Link></section>}
        </aside></div>
    </>}
    <ConfirmDialog open={confirmCancel} title="Cancel this donation?" description="Pending reservation requests will be marked cancelled and their quantities released. Accepted requests must be resolved first. Donation history will be retained." confirmLabel="Cancel donation" danger busy={busy} onClose={() => setConfirmCancel(false)} onConfirm={() => void cancelDonation()} />
  </div>;
}

function donationToForm(donation: Donation) {
  return { food_name: donation.food_name, category: donation.category, description: donation.description ?? '', quantity_total: String(donation.quantity_total), quantity_reserved: String(donation.quantity_reserved), unit: donation.unit, prepared_at: toDateTimeLocal(donation.prepared_at), storage_type: donation.storage_type, handling_info: donation.handling_info ?? '', pickup_address: donation.pickup_address, city: donation.city, locality: donation.locality, pincode: donation.pincode, collection_deadline: toDateTimeLocal(donation.collection_deadline) };
}

export function AdminDonationManagementPage() {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('all'); const [category, setCategory] = useState('all'); const [locality, setLocality] = useState(''); const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), limit: '12', status }); if (search.trim()) query.set('search', search.trim()); if (category !== 'all') query.set('category', category); if (locality.trim()) query.set('locality', locality.trim());
  const { data, loading, error } = useQueryPage<Donation>(`/admin/donations?${query}`, [search, status, category, locality, page]);
  return <div className="page-content"><PageHeader eyebrow="ADMIN · PLATFORM OPERATIONS" title="Donation management" description="Inspect saved listings, quantities, donor organization, location, deadline, and status. Administrative edits are intentionally unavailable." />
    <ListToolbar search={search} setSearch={(value) => { setSearch(value); setPage(1); }} status={status} setStatus={(value) => { setStatus(value); setPage(1); }} category={category} setCategory={(value) => { setCategory(value); setPage(1); }} locality={locality} setLocality={(value) => { setLocality(value); setPage(1); }} />
    {error && <ErrorNotice message={error} />} {loading ? <LoadingState label="Loading donation records…" /> : data?.items.length ? <div className="donation-grid">{data.items.map((item) => <DonationCard key={item.id} donation={item} action={<Link className="outline-button" to={`/dashboard/admin/donations/${item.id}`}>Inspect record <ArrowRight size={16} /></Link>} />)}</div> : <EmptyState icon={<Utensils size={24} />} title="No donation records in this view" description="Admin views show only real donation rows saved by verified donor organizations." />}
    {!loading && data && <Pagination page={data.pagination.page} pages={data.pagination.pages} onChange={setPage} />}
  </div>;
}

export function ReservationDetailsPage() {
  const { id = '' } = useParams(); const location = useLocation(); const [reservation, setReservation] = useState<Reservation | null>(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  useEffect(() => { api.get<{ data: { reservation: Reservation } }>(`/reservations/${id}`).then(({ data }) => setReservation(data.data.reservation)).catch((failure) => setError(errorMessage(failure))).finally(() => setLoading(false)); }, [id]);
  if (loading) return <LoadingState label="Loading reservation details…" />;
  if (error) return <ErrorNotice message={error} />;
  if (!reservation) return null;
  return <div className="page-content"><PageHeader eyebrow="RESERVATION RECORD" title={reservation.food_name} description={`${reservation.quantity} ${unitLabels[reservation.unit] ?? reservation.unit} · requested ${formatDate(reservation.created_at)}`} actions={<StatusBadge status={reservation.status} />} breadcrumbs={[{ label: 'Reservations', to: location.pathname.includes('/admin/') ? '/dashboard/admin/reservations' : location.pathname.includes('/ngo/') ? '/dashboard/ngo/reservations' : '/dashboard/donor/reservations' }, { label: 'Details' }]} /><ReservationCard reservation={reservation} mode="admin" readOnly /><Link className="outline-button" to={location.pathname.includes('/admin/') ? '/dashboard/admin/reservations' : location.pathname.includes('/ngo/') ? '/dashboard/ngo/reservations' : '/dashboard/donor/reservations'}><ArrowLeft size={17} /> Back to reservations</Link></div>;
}
