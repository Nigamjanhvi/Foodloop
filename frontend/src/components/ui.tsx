import { useEffect, type ReactNode } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Clock3, Leaf, X } from 'lucide-react';
import { Link } from 'react-router-dom';

export function PageHeader({ eyebrow, title, description, actions, breadcrumbs }: {
  eyebrow?: string; title: ReactNode; description?: string; actions?: ReactNode; breadcrumbs?: { label: string; to?: string }[];
}) {
  return <header className="page-heading">
    {breadcrumbs?.length ? <nav className="breadcrumbs" aria-label="Breadcrumb">{breadcrumbs.map((crumb, index) => <span key={`${crumb.label}-${index}`}>{index > 0 && <ChevronRight size={13} />}{crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span aria-current="page">{crumb.label}</span>}</span>)}</nav> : null}
    <div className="page-heading-row"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-heading-actions">{actions}</div>}</div>
  </header>;
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const normalized = status.toLowerCase();
  const variant = normalized === 'verified' || normalized === 'active' || normalized === 'delivered' || normalized === 'complete' ? 'success'
    : normalized === 'rejected' || normalized === 'inactive' || normalized === 'cancelled' ? 'danger'
      : normalized === 'pending' || normalized === 'processing' ? 'warning' : 'neutral';
  return <span className={`status-badge ${variant}`}><span className="status-badge-dot" />{label ?? status.replaceAll('_', ' ')}</span>;
}

export function StatCard({ icon, label, value, note, tone = 'sage' }: { icon: ReactNode; label: string; value: string | number; note?: string; tone?: 'sage' | 'orange' | 'blue' | 'plum' }) {
  return <article className="stat-card"><span className={`stat-icon ${tone}`}>{icon}</span><span className="stat-label">{label}</span><strong className={typeof value === 'string' && value === '—' ? 'stat-value stat-placeholder' : 'stat-value'}>{value}</strong>{note && <small>{note}</small>}</article>;
}

export function EmptyState({ icon = <Leaf size={22} />, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-state-icon">{icon}</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading-state" role="status"><span className="spinner" />{label}</div>;
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="error-notice" role="alert"><AlertCircle size={17} /><span>{message}</span>{onRetry && <button onClick={onRetry}>Retry</button>}</div>;
}

export function Toast({ message, tone = 'success', onClose }: { message: string; tone?: 'success' | 'error'; onClose(): void }) {
  useEffect(() => { const timer = window.setTimeout(onClose, 4500); return () => window.clearTimeout(timer); }, [message, onClose]);
  return <div className={`toast-message ${tone}`} role="status"><span>{tone === 'success' ? <Check size={17} /> : <AlertCircle size={17} />}</span>{message}<button onClick={onClose} aria-label="Dismiss notification"><X size={15} /></button></div>;
}

export function ConfirmDialog({ open, title, description, confirmLabel, busy, danger, onConfirm, onClose }: {
  open: boolean; title: string; description: string; confirmLabel: string; busy?: boolean; danger?: boolean; onConfirm(): void; onClose(): void;
}) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, busy, onClose]);
  if (!open) return null;
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
      <button className="dialog-close" onClick={onClose} aria-label="Close dialog" disabled={busy}><X size={18} /></button><span className={`dialog-symbol ${danger ? 'danger' : ''}`}>{danger ? <AlertCircle size={21} /> : <Check size={21} />}</span>
      <h2 id="confirm-title">{title}</h2><p id="confirm-description">{description}</p><div className="dialog-actions"><button className="outline-button" onClick={onClose} disabled={busy}>Cancel</button><button className={danger ? 'button button-danger' : 'button'} onClick={onConfirm} disabled={busy}>{busy ? <><span className="spinner spinner-light" /> Saving…</> : <>{confirmLabel} <ArrowRight size={15} /></>}</button></div>
    </section>
  </div>;
}

export function Pagination({ page, pages, onChange }: { page: number; pages: number; onChange(page: number): void }) {
  if (pages <= 1) return null;
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const pageList = Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);
  return <nav className="pagination" aria-label="Pagination"><span>Page {page} of {pages}</span><div><button className="page-button" onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={16} /></button>{pageList.map((item) => <button key={item} className={`page-button ${item === page ? 'active' : ''}`} onClick={() => onChange(item)} aria-current={item === page ? 'page' : undefined}>{item}</button>)}<button className="page-button" onClick={() => onChange(page + 1)} disabled={page >= pages} aria-label="Next page"><ChevronRight size={16} /></button></div></nav>;
}

export function ComingSoonPanel({ title, description, features = [] }: { title: string; description: string; features?: string[] }) {
  return <section className="coming-panel"><div className="coming-art"><span className="coming-orbit" /><span className="coming-leaf"><Clock3 size={27} /></span></div><span className="coming-tag">UPCOMING WORKSPACE</span><h2>{title}</h2><p>{description}</p>{features.length > 0 && <ul>{features.map((feature) => <li key={feature}>{feature}</li>)}</ul>}<span className="coming-safe-note">This area stays empty until its real API and data are ready.</span></section>;
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="back-link" to={to}><ArrowLeft size={14} />{children}</Link>;
}
