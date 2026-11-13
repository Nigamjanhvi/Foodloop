import { useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Leaf, LockKeyhole, Mail, MapPin, ShieldCheck, Sparkles, UserRound } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage, useAuth, type UserRole } from './AuthContext';

function AuthFrame({ children, title, subtitle, mode }: { children: ReactNode; title: string; subtitle: string; mode: 'login' | 'register' }) {
  return <main className="auth-page">
    <section className="auth-story"><Link to="/" className="brand auth-brand"><span className="brand-mark"><Leaf size={19} /></span>foodloop</Link>
      <div className="story-content"><span className="story-pill"><Sparkles size={14} /> Good food, closer to home</span><h1>Small acts.<br /><em>Shared impact.</em></h1><p>Every local connection can help good food find its next table.</p>
        <div className="story-proof"><div className="proof-icon"><ShieldCheck size={19} /></div><span><strong>Built around trust</strong><small>Organizations are reviewed by our admin team.</small></span></div>
      </div><div className="story-visual"><span className="visual-orbit orbit-one" /><span className="visual-orbit orbit-two" /><span className="visual-leaf"><Leaf size={42} /></span><span className="visual-dot dot-one" /><span className="visual-dot dot-two" /><span className="visual-dot dot-three" /></div>
      <span className="story-foot">A community effort, from the very first meal.</span>
    </section>
    <section className="auth-panel"><div className="auth-mobile-brand"><Link to="/" className="brand"><span className="brand-mark"><Leaf size={19} /></span>foodloop</Link></div>
      <div className="auth-form-wrap"><Link to="/" className="back-home"><ArrowLeft size={15} /> Back to home</Link><div className="auth-heading"><span className="eyebrow">{mode === 'login' ? 'Welcome back' : 'Join the community'}</span><h2>{title}</h2><p>{subtitle}</p></div>{children}</div>
      <p className="auth-legal">By continuing, you agree to use FoodLoop responsibly and share accurate information.</p>
    </section>
  </main>;
}

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (user) return <NavigateToDashboard />;
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try { await login(email, password); navigate((location.state as { from?: string } | null)?.from ?? '/dashboard', { replace: true }); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  return <AuthFrame mode="login" title="Welcome back." subtitle="Sign in to pick up where your community left off.">
    <form className="auth-form" onSubmit={submit}>
      <label className="field-label" htmlFor="email">Email address</label><div className="input-wrap"><Mail size={17} /><input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required maxLength={254} /></div>
      <div className="label-row"><label className="field-label" htmlFor="password">Password</label></div><div className="input-wrap"><LockKeyhole size={17} /><input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" required maxLength={128} /><button className="icon-button" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
      {error && <div className="form-alert" role="alert">{error}</div>}
      <button className="button auth-submit" type="submit" disabled={busy}>{busy ? <><span className="spinner spinner-light" /> Signing in…</> : <>Sign in <ArrowRight size={17} /></>}</button>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  if (user) return <NavigateToDashboard />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    const form = new FormData(event.currentTarget);
    const common = {
      fullName: String(form.get('fullName')), email: String(form.get('email')),
      password: String(form.get('password')), phone: String(form.get('phone') || '') || undefined, role,
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
      <div className="form-grid"><div className="form-field full-field"><label className="field-label" htmlFor="fullName">Your name</label><div className="input-wrap"><UserRound size={17} /><input id="fullName" name="fullName" autoComplete="name" placeholder="Full name" required minLength={2} maxLength={120} /></div></div>
        <div className="form-field"><label className="field-label" htmlFor="registerEmail">Email address</label><div className="input-wrap"><Mail size={17} /><input id="registerEmail" name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} /></div></div>
        <div className="form-field"><label className="field-label" htmlFor="phone">Phone <span className="optional">Optional</span></label><div className="input-wrap"><span className="country-code">+91</span><input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="98765 43210" maxLength={20} /></div></div>
        <div className="form-field full-field"><label className="field-label" htmlFor="registerPassword">Create password</label><div className="input-wrap"><LockKeyhole size={17} /><input id="registerPassword" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="At least 12 characters" required minLength={12} maxLength={128} pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{12,}" title="Use at least 12 characters including uppercase, lowercase, and a number." /><button className="icon-button" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div><small className="field-hint">Use 12+ characters with uppercase, lowercase, and a number.</small></div>
        {role !== 'volunteer' && <div className="form-field full-field"><label className="field-label" htmlFor="organizationName">{role === 'ngo' ? 'Organization name' : 'Business / canteen name'}</label><div className="input-wrap"><Leaf size={17} /><input id="organizationName" name="organizationName" placeholder="Organization name" required minLength={2} maxLength={160} /></div></div>}
        <div className="form-field full-field"><label className="field-label" htmlFor="address">{role === 'volunteer' ? 'Local area' : 'Pickup / organization address'}</label><div className="input-wrap"><MapPin size={17} /><input id="address" name="address" placeholder={role === 'volunteer' ? 'Neighborhood or landmark' : 'Street, building, locality'} required={role !== 'volunteer'} minLength={role === 'volunteer' ? undefined : 5} maxLength={500} /></div></div>
        <div className="form-field"><label className="field-label" htmlFor="city">City</label><input className="plain-input" id="city" name="city" placeholder="Phagwara" required minLength={2} maxLength={100} /></div>
        <div className="form-field"><label className="field-label" htmlFor="locality">Locality</label><input className="plain-input" id="locality" name="locality" placeholder="Your locality" required minLength={2} maxLength={120} /></div>
        <div className="form-field full-field"><label className="field-label" htmlFor="pincode">Pincode</label><input className="plain-input pincode-input" id="pincode" name="pincode" inputMode="numeric" pattern="[0-9]{5,10}" placeholder="144401" required /></div>
      </div>
      {role !== 'volunteer' && <p className="verification-note"><ShieldCheck size={15} /> Your organization starts as pending and is reviewed by a FoodLoop administrator.</p>}
      {error && <div className="form-alert" role="alert">{error}</div>}
      <button className="button auth-submit" type="submit" disabled={busy}>{busy ? <><span className="spinner spinner-light" /> Creating your account…</> : <>Create account <ArrowRight size={17} /></>}</button>
    </form><p className="auth-switch">Already part of FoodLoop? <Link to="/login">Sign in</Link></p>
  </AuthFrame>;
}
