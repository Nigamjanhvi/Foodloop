import { useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Leaf, LockKeyhole, Mail, MapPin, Phone, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { errorCode, errorMessage, useAuth, type UserRole } from './AuthContext';

const countryCodes = ['+91', '+1', '+44', '+61'];

function fullPhone(countryCode: string, localPhone: string) {
  const digits = localPhone.replace(/\D/g, '');
  const countryDigits = countryCode.replace(/\D/g, '');
  const combined = `${countryDigits}${digits}`;
  if (digits.length < 7 || combined.length > 15) return '';
  return `+${combined}`;
}

function AuthFrame({ children, title, subtitle, mode }: { children: ReactNode; title: string; subtitle: string; mode: 'login' | 'register' }) {
  return <main className="auth-page">
    <section className="auth-story"><Link to="/" className="brand auth-brand"><span className="brand-mark"><Leaf size={19} /></span>foodloop</Link>
      <div className="story-content"><span className="story-pill"><Sparkles size={14} /> Good food, closer to home</span><h1>Small acts.<br /><mark>Shared impact.</mark></h1><p>Every local connection can help good food find its next table.</p>
        <div className="story-proof"><div className="proof-icon"><ShieldCheck size={19} /></div><span><strong>Built around trust</strong><small>Organizations are reviewed by our admin team.</small></span></div>
      </div><div className="story-visual"><span className="visual-orbit orbit-one" /><span className="visual-orbit orbit-two" /><span className="visual-leaf"><Leaf size={42} /></span><span className="visual-dot dot-one" /><span className="visual-dot dot-two" /><span className="visual-dot dot-three" /></div>
      <span className="story-foot">A community effort, from the very first meal.</span>
    </section>
    <section className="auth-panel"><div className="auth-mobile-brand"><Link to="/" className="brand"><span className="brand-mark"><Leaf size={19} /></span>foodloop</Link></div>
      <div className="auth-form-wrap"><Link to="/" className="back-home"><ArrowLeft size={15} /> Back to home</Link><div className="auth-heading"><span className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'JOIN THE COMMUNITY'}</span><h2>{title}</h2><p>{subtitle}</p></div>{children}</div>
      <p className="auth-legal">By continuing, you agree to use FoodLoop responsibly and share accurate information.</p>
    </section>
  </main>;
}

function PhoneInput({ id, name, value, onChange, label = 'Phone number', countryCode, onCountryCodeChange }: { id: string; name: string; value: string; onChange(value: string): void; label?: string; countryCode?: string; onCountryCodeChange?(value: string): void }) {
  const [localCountryCode, setLocalCountryCode] = useState('+91');
  const selectedCountryCode = countryCode ?? localCountryCode;
  return <>
    <label className="field-label" htmlFor={id}>{label} <span className="required-mark">*</span></label>
    <div className="input-wrap phone-input-wrap"><Phone size={17} />
      <select className="country-select" aria-label="Country calling code" value={selectedCountryCode} onChange={(event) => { setLocalCountryCode(event.target.value); onCountryCodeChange?.(event.target.value); }}>{countryCodes.map((code) => <option key={code}>{code}</option>)}</select>
      <input id={id} name={name} type="tel" autoComplete="tel-national" inputMode="tel" value={value} onChange={(event) => onChange(event.target.value)} placeholder="98765 43210" required maxLength={20} aria-describedby={`${id}-hint`} />
    </div><small id={`${id}-hint`} className="field-hint">Include a valid number for the selected country code.</small>
    <input type="hidden" name={`${name}E164`} value={fullPhone(selectedCountryCode, value)} />
  </>;
}

function getPhone(event: FormEvent<HTMLFormElement>) {
  const data = new FormData(event.currentTarget);
  return String(data.get('phoneE164') ?? '');
}

export function LoginPage() {
  const { login, enrollPhone, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enrollmentNeeded, setEnrollmentNeeded] = useState(false);
  const [error, setError] = useState('');

  if (user) return <NavigateToDashboard />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setEnrollmentNeeded(false); setBusy(true);
    const normalizedPhone = getPhone(event);
    if (!normalizedPhone) { setError('Enter a valid phone number with country code.'); setBusy(false); return; }
    try { await login(email, normalizedPhone, password); navigate((location.state as { from?: string } | null)?.from ?? '/dashboard', { replace: true }); }
    catch (failure) {
      if (errorCode(failure) === 'PHONE_ENROLLMENT_REQUIRED') setEnrollmentNeeded(true);
      setError(errorMessage(failure));
    } finally { setBusy(false); }
  }
  async function enroll() {
    setBusy(true); setError('');
    const normalizedPhone = fullPhone(countryCode, phone);
    if (!normalizedPhone) { setError('Enter a valid phone number with country code.'); setBusy(false); return; }
    try { await enrollPhone(email, normalizedPhone, password); navigate('/dashboard', { replace: true }); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  return <AuthFrame mode="login" title="Welcome back." subtitle="Sign in to pick up where your community left off.">
    <form className="auth-form" onSubmit={submit}>
      <div className="form-field"><label className="field-label" htmlFor="email">Email address <span className="required-mark">*</span></label><div className="input-wrap"><Mail size={17} /><input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required maxLength={254} /></div></div>
      <div className="form-field"><PhoneInput id="login-phone" name="phone" value={phone} onChange={setPhone} countryCode={countryCode} onCountryCodeChange={setCountryCode} /></div>
      <div className="form-field"><label className="field-label" htmlFor="password">Password <span className="required-mark">*</span></label><div className="input-wrap"><LockKeyhole size={17} /><input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" required maxLength={128} /><button className="icon-button" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></div>
      {error && <div className="form-alert" role="alert">{error}</div>}
      {enrollmentNeeded && <div className="phone-enrollment"><p>This existing account has no saved phone number yet. Confirm your number to add it securely to your account.</p><button type="button" className="text-button" disabled={busy} onClick={() => void enroll()}>Add this number and sign in <ArrowRight size={15} /></button></div>}
      <button className="button auth-submit" type="submit" disabled={busy}>{busy ? <><span className="spinner spinner-light" /> Signing inâ€¦</> : <>Sign in <ArrowRight size={17} /></>}</button>
    </form><p className="auth-switch">New to FoodLoop? <Link to="/register">Create an account</Link></p>
  </AuthFrame>;
}

function NavigateToDashboard() {
  const { user } = useAuth();
  return <>{user && <Navigate replace to={`/dashboard/${user.role}`} />}</>;
}

export function RegisterPage() {
  const { register, user } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<Exclude<UserRole, 'admin'>>('donor');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  if (user) return <NavigateToDashboard />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    const form = new FormData(event.currentTarget);
    const phoneE164 = getPhone(event);
    const password = String(form.get('password'));
    if (!phoneE164) { setError('Enter a valid phone number with country code.'); setBusy(false); return; }
    if (password !== String(form.get('confirmPassword'))) { setError('Your passwords do not match.'); setBusy(false); return; }
    const common = {
      fullName: String(form.get('fullName')), email: String(form.get('email')).trim(), password, phone: phoneE164, role,
    };
    const payload = role === 'volunteer' ? {
      ...common,
      volunteerLocation: { city: String(form.get('city')), locality: String(form.get('locality')), pincode: String(form.get('pincode')) },
    } : {
      ...common,
      organization: {
        name: String(form.get('organizationName')), address: String(form.get('address')),
        city: String(form.get('city')), locality: String(form.get('locality')), pincode: String(form.get('pincode')),
      },
    };
    try { await register(payload); navigate('/dashboard', { replace: true }); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  return <AuthFrame mode="register" title="Let’s make good happen." subtitle="Create your account and join a growing local food rescue community.">
    <form className="auth-form register-form" onSubmit={submit}>
      <div className="role-picker" aria-label="Choose account type">
        {([
          ['donor', 'Food donor'], ['ngo', 'NGO / recipient'], ['volunteer', 'Volunteer'],
        ] as const).map(([value, label]) => <button key={value} type="button" className={role === value ? 'role-option selected' : 'role-option'} onClick={() => setRole(value)} aria-pressed={role === value}>{role === value && <Check size={14} />}{label}</button>)}
      </div>
      <div className="form-grid"><div className="form-field full-field"><label className="field-label" htmlFor="fullName">Full name <span className="required-mark">*</span></label><div className="input-wrap"><UserRound size={17} /><input id="fullName" name="fullName" autoComplete="name" placeholder="Full name" required minLength={2} maxLength={120} /></div></div>
        <div className="form-field"><label className="field-label" htmlFor="registerEmail">Email address <span className="required-mark">*</span></label><div className="input-wrap"><Mail size={17} /><input id="registerEmail" name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} /></div></div>
        <div className="form-field"><PhoneInput id="register-phone" name="phone" value={phone} onChange={setPhone} /></div>
        <div className="form-field"><label className="field-label" htmlFor="registerPassword">Create password <span className="required-mark">*</span></label><div className="input-wrap"><LockKeyhole size={17} /><input id="registerPassword" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="At least 12 characters" required minLength={12} maxLength={128} pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{12,}" title="Use at least 12 characters including uppercase, lowercase, and a number." /><button className="icon-button" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div><small className="field-hint">Use 12+ characters, including uppercase, lowercase, and a number.</small></div>
        <div className="form-field"><label className="field-label" htmlFor="confirmPassword">Confirm password <span className="required-mark">*</span></label><div className="input-wrap"><LockKeyhole size={17} /><input id="confirmPassword" name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="Enter it again" required maxLength={128} /></div></div>
        {role !== 'volunteer' && <div className="form-field full-field"><label className="field-label" htmlFor="organizationName">{role === 'ngo' ? 'Organization name' : 'Business / canteen name'} <span className="required-mark">*</span></label><div className="input-wrap"><Leaf size={17} /><input id="organizationName" name="organizationName" placeholder="Organization name" required minLength={2} maxLength={160} /></div></div>}
        {role !== 'volunteer' && <div className="form-field full-field"><label className="field-label" htmlFor="address">Pickup / organization address <span className="required-mark">*</span></label><div className="input-wrap"><MapPin size={17} /><input id="address" name="address" placeholder="Street, building, locality" required minLength={5} maxLength={500} /></div></div>}
        <div className="form-field"><label className="field-label" htmlFor="city">City <span className="required-mark">*</span></label><input className="plain-input" id="city" name="city" placeholder="Phagwara" required minLength={2} maxLength={100} /></div>
        <div className="form-field"><label className="field-label" htmlFor="locality">Locality <span className="required-mark">*</span></label><input className="plain-input" id="locality" name="locality" placeholder="Your locality" required minLength={2} maxLength={120} /></div>
        <div className="form-field full-field"><label className="field-label" htmlFor="pincode">Pincode <span className="required-mark">*</span></label><input className="plain-input pincode-input" id="pincode" name="pincode" inputMode="numeric" pattern="[0-9]{5,10}" placeholder="144401" required /></div>
      </div>
      {role !== 'volunteer' && <p className="verification-note"><ShieldCheck size={15} /> Your organization starts as pending and is reviewed by a FoodLoop administrator.</p>}
      {error && <div className="form-alert" role="alert">{error}</div>}
      <button className="button auth-submit" type="submit" disabled={busy}>{busy ? <><span className="spinner spinner-light" /> Creating your accountâ€¦</> : <>Create account <ArrowRight size={17} /></>}</button>
    </form><p className="auth-switch">Already part of FoodLoop? <Link to="/login">Sign in</Link></p>
  </AuthFrame>;
}
