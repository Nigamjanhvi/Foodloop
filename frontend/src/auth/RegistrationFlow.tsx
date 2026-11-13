import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, CheckCircle2, ChevronLeft, Eye, EyeOff, HeartHandshake, Leaf, LockKeyhole, Mail, MapPin, Phone, ShieldCheck, Truck, UserRound, UtensilsCrossed } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { errorMessage, useAuth, type UserRole } from './AuthContext';

const countryCodes = ['+91', '+1', '+44', '+61'];
const normalizePhone = (countryCode: string, phone: string) => {
  const national = phone.replace(/\D/g, '');
  const calling = countryCode.replace(/\D/g, '');
  return national.length >= 7 && calling.length + national.length <= 15 ? `+${calling}${national}` : '';
};

export default function RegistrationFlow() {
  const { register, user } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<Exclude<UserRole, 'admin'>>('donor');
  const [step, setStep] = useState(1);
  const [country, setCountry] = useState('+91');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (user) return <Navigate replace to={`/dashboard/${user.role}`} />;

  const stepName = ['Account', role === 'volunteer' ? 'Volunteer profile' : 'Organization', 'Location'];
  const rules = [
    { label: '12+ characters', valid: password.length >= 12 },
    { label: 'Uppercase letter', valid: /[A-Z]/.test(password) },
    { label: 'Lowercase letter', valid: /[a-z]/.test(password) },
    { label: 'Number', valid: /[0-9]/.test(password) },
  ];

  function validate(form: HTMLFormElement, targetStep: number) {
    if (targetStep === 1 && !normalizePhone(country, phone)) {
      setError('Enter a valid contact number with country code.');
      document.getElementById('register-phone')?.focus();
      return false;
    }
    const inputs = Array.from(form.querySelectorAll<HTMLInputElement>(`[data-step="${targetStep}"] input`));
    const invalid = inputs.find((input) => input.willValidate && !input.checkValidity());
    if (invalid) {
      setError(invalid.validationMessage || 'Complete the required fields to continue.');
      invalid.focus();
      return false;
    }
    setError('');
    return true;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (step < 3) {
      if (!validate(form, step)) return;
      setStep((current) => current + 1);
      return;
    }
    if (!validate(form, 2) || !validate(form, 3)) return;
    if (!normalizePhone(country, phone)) { setStep(1); setError('Enter a valid contact number with country code.'); return; }
    const data = new FormData(form);
    const accountPassword = String(data.get('password') ?? '');
    const confirmation = form.querySelector<HTMLInputElement>('#confirmPassword');
    if (accountPassword !== String(data.get('confirmPassword') ?? '')) {
      setError('Your passwords do not match.'); setStep(1); confirmation?.focus(); return;
    }
    setBusy(true); setError('');
    const common = {
      fullName: String(data.get('fullName') ?? ''), email: String(data.get('email') ?? '').trim(),
      password: accountPassword, phone: normalizePhone(country, phone), role,
    };
    const payload = role === 'volunteer' ? {
      ...common,
      volunteerLocation: { city: String(data.get('city') ?? ''), locality: String(data.get('locality') ?? ''), pincode: String(data.get('pincode') ?? '') },
    } : {
      ...common,
      organization: {
        name: String(data.get('organizationName') ?? ''), address: String(data.get('address') ?? ''),
        city: String(data.get('city') ?? ''), locality: String(data.get('locality') ?? ''), pincode: String(data.get('pincode') ?? ''),
      },
    };
    try { await register(payload); navigate('/dashboard', { replace: true }); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }

  return <main className="auth-page">
    <section className="auth-story"><Link to="/" className="brand auth-brand"><span className="brand-mark"><Leaf size={20} /></span>foodloop</Link><div className="story-content"><span className="story-pill"><ShieldCheck size={16} /> ORGANIZATIONS REVIEWED</span><h1>Small acts.<br /><mark>Shared impact.</mark></h1><p>Every local connection can help good food find its next table.</p><div className="story-proof"><div className="proof-icon"><ShieldCheck size={22} /></div><span><strong>Built around trust</strong><small>Your organization is reviewed by a FoodLoop administrator.</small></span></div></div><div className="story-visual"><span className="visual-orbit orbit-one" /><span className="visual-orbit orbit-two" /><span className="visual-leaf"><Leaf size={44} /></span></div><span className="story-foot">A community effort, from the very first meal.</span></section>
    <section className="auth-panel"><div className="auth-mobile-brand"><Link to="/" className="brand"><span className="brand-mark"><Leaf size={19} /></span>foodloop</Link></div><div className="auth-form-wrap"><Link to="/" className="back-home">â† Back to home</Link><div className="auth-heading"><span className="eyebrow">JOIN THE COMMUNITY</span><h2>Letâ€™s make<br />good happen.</h2><p>Create an account for your place in the local food loop.</p></div>
      <form className="auth-form register-form" onSubmit={submit} noValidate>
        <div className="registration-progress" aria-label={`Registration step ${step} of 3`}><div className="progress-track"><span style={{ width: `${step / 3 * 100}%` }} /></div><div className="progress-steps">{stepName.map((name, index) => <div key={name} className={step === index + 1 ? 'progress-step current' : step > index + 1 ? 'progress-step complete' : 'progress-step'}><span>{step > index + 1 ? <Check size={15} /> : `0${index + 1}`}</span>{name}</div>)}</div></div>
        <section data-step="1" className="registration-step" hidden={step !== 1}><div className="role-picker" aria-label="Choose account type">{([['donor', 'Food donor', <UtensilsCrossed size={21} />], ['ngo', 'NGO / recipient', <HeartHandshake size={21} />], ['volunteer', 'Volunteer', <Truck size={21} />]] as const).map(([value, label, icon]) => <button key={value} type="button" className={role === value ? 'role-option selected' : 'role-option'} onClick={() => setRole(value)} aria-pressed={role === value}><span className="role-option-icon">{icon}</span><span>{label}</span>{role === value && <Check size={16} />}</button>)}</div>
          <div className="form-grid"><div className="form-field full-field"><label className="field-label" htmlFor="fullName">Full name <span className="required-mark">*</span></label><div className="input-wrap"><UserRound size={18} /><input id="fullName" name="fullName" autoComplete="name" placeholder="Full name" required minLength={2} maxLength={120} /></div></div><div className="form-field"><label className="field-label" htmlFor="registerEmail">Email address <span className="required-mark">*</span></label><div className="input-wrap"><Mail size={18} /><input id="registerEmail" name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} /></div></div>
            <div className="form-field"><label className="field-label" htmlFor="register-phone">Contact number <span className="required-mark">*</span></label><div className="input-wrap phone-input-wrap"><Phone size={18} /><select className="country-select" aria-label="Country calling code" value={country} onChange={(event) => setCountry(event.target.value)}>{countryCodes.map((code) => <option key={code}>{code}</option>)}</select><input id="register-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="98765 43210" value={phone} onChange={(event) => setPhone(event.target.value)} required maxLength={20} /></div><small className="field-hint">Use a number where FoodLoop can reach you.</small></div>
            <div className="form-field"><label className="field-label" htmlFor="registerPassword">Create password <span className="required-mark">*</span></label><div className="input-wrap"><LockKeyhole size={18} /><input id="registerPassword" name="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="At least 12 characters" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} maxLength={128} pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{12,}" /><button className="icon-button" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div><div className="password-checklist" aria-live="polite">{rules.map((rule) => <span key={rule.label} className={rule.valid ? 'password-rule met' : 'password-rule'}><CheckCircle2 size={14} />{rule.label}</span>)}</div></div><div className="form-field"><label className="field-label" htmlFor="confirmPassword">Confirm password <span className="required-mark">*</span></label><div className="input-wrap"><LockKeyhole size={18} /><input id="confirmPassword" name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="Enter it again" required maxLength={128} /></div></div></div>
        </section>
        <section data-step="2" className="registration-step" hidden={step !== 2}><div className="step-intro"><span className="step-intro-icon">{role === 'volunteer' ? <Truck size={27} /> : <Leaf size={27} />}</span><div><h3>{role === 'volunteer' ? 'Your volunteer profile' : 'Organization details'}</h3><p>{role === 'volunteer' ? 'Tell us where you can help.' : 'Organization details are reviewed before workspace access.'}</p></div></div>{role === 'volunteer' ? <div className="volunteer-note"><ShieldCheck size={21} /><p>Volunteer task assignments will appear when that workflow is connected. Your profile can be created now.</p></div> : <div className="form-grid"><div className="form-field full-field"><label className="field-label" htmlFor="organizationName">{role === 'ngo' ? 'Organization name' : 'Business / canteen name'} <span className="required-mark">*</span></label><div className="input-wrap"><Leaf size={18} /><input id="organizationName" name="organizationName" placeholder="Organization name" required minLength={2} maxLength={160} /></div></div><div className="form-field full-field"><label className="field-label" htmlFor="address">Pickup / organization address <span className="required-mark">*</span></label><div className="input-wrap"><MapPin size={18} /><input id="address" name="address" placeholder="Street, building, locality" required minLength={5} maxLength={500} /></div></div><p className="verification-note"><ShieldCheck size={18} /> Your organization starts as pending and is reviewed by a FoodLoop administrator.</p></div>}</section>
        <section data-step="3" className="registration-step" hidden={step !== 3}><div className="step-intro"><span className="step-intro-icon"><MapPin size={27} /></span><div><h3>Where are you based?</h3><p>FoodLoop is starting with Phagwara and nearby communities.</p></div></div><div className="form-grid"><div className="form-field"><label className="field-label" htmlFor="city">City <span className="required-mark">*</span></label><input className="plain-input" id="city" name="city" placeholder="Phagwara" required minLength={2} maxLength={100} /></div><div className="form-field"><label className="field-label" htmlFor="locality">Locality <span className="required-mark">*</span></label><input className="plain-input" id="locality" name="locality" placeholder="Your locality" required minLength={2} maxLength={120} /></div><div className="form-field full-field"><label className="field-label" htmlFor="pincode">Pincode <span className="required-mark">*</span></label><input className="plain-input" id="pincode" name="pincode" inputMode="numeric" pattern="[0-9]{5,10}" placeholder="144401" required /></div></div></section>
        {error && <div className="form-alert" role="alert">{error}</div>}<div className="registration-actions">{step > 1 && <button className="outline-button" type="button" disabled={busy} onClick={() => { setError(''); setStep((current) => current - 1); }}><ChevronLeft size={19} /> Back</button>}<button className="button auth-submit" type="submit" disabled={busy}>{busy ? <><span className="spinner spinner-light" /> Creating accountâ€¦</> : step < 3 ? <>Continue <ArrowRight size={19} /></> : <>Create account <ArrowRight size={19} /></>}</button></div>
      </form><p className="auth-switch">Already part of FoodLoop? <Link to="/login">Sign in</Link></p></div><p className="auth-legal">By continuing, you agree to use FoodLoop responsibly and share accurate information.</p></section>
  </main>;
}
