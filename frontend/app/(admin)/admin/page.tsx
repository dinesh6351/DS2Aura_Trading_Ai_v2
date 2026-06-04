'use client';

import { useEffect, useState } from 'react';
import { api, getApiBase } from '@/lib/api';
import { ThemeToggle } from '@/components/ThemeToggle';

interface Overview {
  totalUsers: number; activeUsers: number; inactiveUsers: number; connectedAccounts: number;
  openPositions: number; totalTrades: number; totalVolume: number;
  activeSubscriptions: number; trialingUsers: number; pastDueUsers: number;
  mrrUsd: number; collectedRevenueUsd: number; outstandingRevenueUsd: number;
  binanceBanActive: boolean;
}
interface AdminUser {
  id: string; email: string; role: string; status: string; botStatus?: string; plan?: string;
  subStatus?: string; tradesThisPeriod: number;
  lifetimeProfit: number; openPositions: number; totalTrades: number;
}
interface Branding {
  appName: string; tagline: string; heroSubtitle: string; logoUrl: string;
  webUrl: string; appUrl: string; supportEmail: string; feedbackEmail: string;
}
interface Report {
  newUsers7d: number; newUsers30d: number; trades7d: number; trades30d: number;
  paidInvoices: number; paidUsd: number; openInvoices: number; openUsd: number;
  subscriptionsByStatus: Record<string, number>;
  feedback: { at: string; name?: string; email?: string; message?: string }[];
}

export default function AdminPage() {
  const [ov, setOv] = useState<Overview>();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState<Branding>();
  const [brandSaved, setBrandSaved] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [report, setReport] = useState<Report>();

  async function load() {
    setOv(await api.get<Overview>('/api/admin/overview'));
    const r = await api.get<{ users: AdminUser[] }>(`/api/admin/users?search=${encodeURIComponent(search)}`);
    setUsers(r.users);
  }
  useEffect(() => {
    api.refresh().then(load).catch(() => { window.location.href = '/login'; });
    api.get<Branding>('/api/admin/settings/branding').then(setBrand).catch(() => {});
    api.get<Report>('/api/admin/reports').then(setReport).catch(() => {});
  }, []);

  function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 250_000) { setNote('❌ Logo too large — please use an image under 250 KB.'); return; }
    const reader = new FileReader();
    reader.onload = () => setBrand((p) => (p ? { ...p, logoUrl: String(reader.result) } : p));
    reader.readAsDataURL(file);
  }
  async function delUser(u: AdminUser) {
    if (!confirm(`Permanently DELETE ${u.email} and ALL their data? This cannot be undone.`)) return;
    void act(`${u.id}:del`, `Deleted ${u.email}`, () => api.del(`/api/admin/users/${u.id}`));
  }

  // Generic action runner: shows success/error feedback + a busy lock so failures
  // (e.g. an expired session) are never silent dead-buttons.
  async function act(busyKey: string, okMsg: string, fn: () => Promise<unknown>) {
    setBusy(busyKey); setNote('');
    try {
      await fn();
      await load();
      setNote(`✅ ${okMsg}`); setTimeout(() => setNote(''), 2500);
    } catch (e) {
      const m = (e as Error).message;
      setNote(`❌ ${okMsg} failed: ${m}${/token|expired|Unauthorized/i.test(m) ? ' — please sign in again.' : ''}`);
    } finally { setBusy(''); }
  }
  const bot = (id: string, action: 'PAUSE' | 'RESUME' | 'STOP') =>
    act(`${id}:${action}`, `Bot ${action.toLowerCase()}`, () => api.post(`/api/admin/users/${id}/bot`, { action }));
  const status = (id: string, s: 'ACTIVE' | 'SUSPENDED' | 'DISABLED') =>
    act(`${id}:${s}`, `User ${s.toLowerCase()}`, () => api.post(`/api/admin/users/${id}/status`, { status: s }));
  function toggleAdmin(u: AdminUser) {
    const role = u.role === 'ADMIN' ? 'TRADER' : 'ADMIN';
    if (!confirm(`Set ${u.email} role to ${role}? ${role === 'ADMIN' ? '(grants free, unlimited access)' : ''}`)) return;
    void act(`${u.id}:role`, `Role → ${role}`, () => api.post(`/api/admin/users/${u.id}/role`, { role }));
  }
  async function saveBranding() {
    if (!brand) return;
    const saved = await api.put<Branding>('/api/admin/settings/branding', brand);
    setBrand(saved); setBrandSaved(true); setTimeout(() => setBrandSaved(false), 2500);
  }
  const setB = (k: keyof Branding) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setBrand((p) => (p ? { ...p, [k]: e.target.value } : p));

  return (
    <main className="p-3 sm:p-4 md:p-6 space-y-5 md:space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-semibold tracking-tight">Admin CRM</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <a href="/dashboard" className="btn-outline text-sm">← Dashboard</a>
          <a href="/settings" className="btn-outline text-sm">Profile</a>
        </div>
      </div>
      {ov?.binanceBanActive && <p className="text-danger">⚠ Binance rate-limit ban active on worker IP</p>}
      {note && (
        <div className={`card ${note.startsWith('❌') ? 'border-danger/50 text-danger' : 'border-accent/50 text-accent'}`}>{note}</div>
      )}

      <section className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Stat label="Total Users" v={ov?.totalUsers} />
        <Stat label="Active Bots" v={ov?.activeUsers} />
        <Stat label="Active Subs" v={ov?.activeSubscriptions} />
        <Stat label="On Trial" v={ov?.trialingUsers} />
        <Stat label="Past Due" v={ov?.pastDueUsers} />
        <Stat label="MRR" v={ov?.mrrUsd} money />
        <Stat label="Collected Rev" v={ov?.collectedRevenueUsd} money />
        <Stat label="Outstanding" v={ov?.outstandingRevenueUsd} money />
        <Stat label="Connected Keys" v={ov?.connectedAccounts} />
        <Stat label="Total Trades" v={ov?.totalTrades} />
      </section>

      {/* Reports */}
      {report && (
        <div className="card space-y-3">
          <p className="label">Reports</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Mini label="New users (7d)" v={report.newUsers7d} />
            <Mini label="New users (30d)" v={report.newUsers30d} />
            <Mini label="Trades (7d)" v={report.trades7d} />
            <Mini label="Trades (30d)" v={report.trades30d} />
            <Mini label="Paid invoices" v={report.paidInvoices} />
            <Mini label="Collected" v={`$${report.paidUsd.toFixed(2)}`} />
            <Mini label="Open invoices" v={report.openInvoices} />
            <Mini label="Outstanding" v={`$${report.openUsd.toFixed(2)}`} />
          </div>
          <div className="text-sm">
            <span className="label">Subscriptions:</span>{' '}
            {Object.entries(report.subscriptionsByStatus).map(([k, v]) => <span key={k} className="mr-3 text-fg">{k}: {v}</span>)}
          </div>
          <div>
            <p className="label mb-1">Recent feedback</p>
            {report.feedback.length === 0 ? <p className="text-muted text-sm">No feedback yet.</p> : (
              <div className="space-y-1 max-h-48 overflow-auto">
                {report.feedback.map((f, i) => (
                  <div key={i} className="text-sm border-t border-border/70 py-1">
                    <span className="text-accent">{f.name ?? 'Anon'}</span> <span className="text-muted">({f.email ?? '—'})</span>: {f.message ?? ''}
                  </div>
                ))}
              </div>
            )}
          </div>
          <a className="btn inline-block" href={`${getApiBase()}/api/trading/export/trades.csv`} target="_blank" rel="noreferrer">⤓ My trades CSV</a>
        </div>
      )}

      {/* Branding / site settings — change app name + links without a redeploy */}
      {brand && (
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <p className="label">Branding &amp; Site Settings (live on the landing page)</p>
            {brandSaved && <span className="text-accent text-sm">✅ Saved</span>}
          </div>
          {/* Logo upload + preview */}
          <div className="flex items-center gap-4 p-3 rounded border border-border bg-bg">
            <div className="h-14 w-14 rounded bg-panel border border-border grid place-items-center overflow-hidden">
              {brand.logoUrl ? <img src={brand.logoUrl} alt="logo" className="h-full w-full object-contain" /> : <span className="text-muted text-xs">no logo</span>}
            </div>
            <div className="flex-1">
              <p className="label">Brand Logo (shown on landing &amp; headers)</p>
              <input type="file" accept="image/*" onChange={onLogoFile} className="text-xs text-muted mt-1" />
              <p className="text-xs text-muted mt-1">PNG/SVG/JPG under 250 KB. Or paste an image URL below.</p>
            </div>
            {brand.logoUrl && <button className="btn-danger text-xs" onClick={() => setBrand((p) => (p ? { ...p, logoUrl: '' } : p))}>Remove</button>}
          </div>
          <Field label="Logo URL (optional)" value={brand.logoUrl} onChange={setB('logoUrl')} />

          <div className="grid md:grid-cols-2 gap-3">
            <Field label="App / Website Name" value={brand.appName} onChange={setB('appName')} />
            <Field label="Tagline" value={brand.tagline} onChange={setB('tagline')} />
            <Field label="Website Link" value={brand.webUrl} onChange={setB('webUrl')} />
            <Field label="App Link (mobile/PWA)" value={brand.appUrl} onChange={setB('appUrl')} />
            <Field label="Support Email" value={brand.supportEmail} onChange={setB('supportEmail')} />
            <Field label="Feedback Email" value={brand.feedbackEmail} onChange={setB('feedbackEmail')} />
            <div className="md:col-span-2">
              <Field label="Hero Subtitle" value={brand.heroSubtitle} onChange={setB('heroSubtitle')} />
            </div>
          </div>
          <button className="btn" onClick={saveBranding}>Save branding</button>
        </div>
      )}

      <CouponsAdmin users={users} onNote={setNote} />

      <div className="card overflow-x-auto">
        <div className="flex gap-2 mb-3">
          <input className="input flex-1 min-w-0"
            placeholder="search email" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn" onClick={load}>Search</button>
        </div>
        <table className="w-full text-sm min-w-[640px]">
          <thead><tr className="text-muted text-left">
            <th>Email</th><th>Status</th><th>Bot</th><th>Plan</th><th>Sub</th><th>Profit</th><th>Mo. Trades</th><th>Actions</th>
          </tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id} className="border-t border-border">
              <td>{u.email}</td><td>{u.status}</td><td>{u.botStatus}</td><td>{u.plan}</td>
              <td>{u.subStatus}</td>
              <td className={u.lifetimeProfit >= 0 ? 'badge-up' : 'badge-down'}>${u.lifetimeProfit.toFixed(2)}</td>
              <td>{u.tradesThisPeriod}</td>
              <td className="flex flex-wrap gap-1 py-1">
                <button className="btn text-xs disabled:opacity-40" disabled={!!busy} onClick={() => bot(u.id, 'PAUSE')}>Pause</button>
                <button className="btn text-xs disabled:opacity-40" disabled={!!busy} onClick={() => bot(u.id, 'RESUME')}>Resume</button>
                {u.status === 'SUSPENDED'
                  ? <button className="btn text-xs disabled:opacity-40" disabled={!!busy} onClick={() => status(u.id, 'ACTIVE')}>Activate</button>
                  : <button className="btn-danger text-xs disabled:opacity-40" disabled={!!busy} onClick={() => status(u.id, 'SUSPENDED')}>Suspend</button>}
                <button className={`text-xs disabled:opacity-40 ${u.role === 'ADMIN' ? 'btn-danger' : 'btn'}`} disabled={!!busy} onClick={() => toggleAdmin(u)}>
                  {u.role === 'ADMIN' ? '★ Remove Admin' : 'Make Admin'}
                </button>
                <button className="btn-danger text-xs disabled:opacity-40" disabled={!!busy} onClick={() => delUser(u)}>🗑 Delete</button>
              </td>
            </tr>))}</tbody>
        </table>
      </div>
    </main>
  );
}

function Stat({ label, v, money }: { label: string; v?: number; money?: boolean }) {
  return (
    <div className="card">
      <p className="label">{label}</p>
      <p className="stat">{v == null ? '…' : money ? `$${v.toFixed(2)}` : v}</p>
    </div>
  );
}
function Mini({ label, v }: { label: string; v: number | string }) {
  return (
    <div className="bg-bg rounded p-2 border border-border">
      <p className="label">{label}</p>
      <p className="text-fg font-bold">{v}</p>
    </div>
  );
}
function Field({ label, value, onChange }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input mt-1" value={value} onChange={onChange} />
    </label>
  );
}

// ── Coupons ──────────────────────────────────────────────────────────────────
interface CouponRow {
  id: string; code: string | null; discountPercent: number; note: string | null;
  active: boolean; expiresAt: string | null; maxRedemptions: number | null;
  timesRedeemed: number; redemptions: number; createdAt: string;
}
function CouponsAdmin({ users, onNote }: { users: AdminUser[]; onNote: (msg: string) => void }) {
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [form, setForm] = useState({ code: '', discountPercent: 50, note: '', maxRedemptions: '' });
  const [applyCoupon, setApplyCoupon] = useState('');
  const [applyUser, setApplyUser] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() { setCoupons(await api.get<CouponRow[]>('/api/admin/coupons').catch(() => [])); }
  useEffect(() => { load(); }, []);

  async function create() {
    setBusy(true);
    try {
      await api.post('/api/admin/coupons', {
        code: form.code.trim() || undefined,
        discountPercent: Number(form.discountPercent),
        note: form.note.trim() || undefined,
        maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : undefined,
      });
      onNote('✅ Coupon created');
      setForm({ code: '', discountPercent: 50, note: '', maxRedemptions: '' }); load();
    } catch (e) { onNote(`❌ ${(e as Error).message}`); } finally { setBusy(false); }
  }
  async function toggle(c: CouponRow) {
    try { await api.post(`/api/admin/coupons/${c.id}/active`, { active: !c.active }); load(); }
    catch (e) { onNote(`❌ ${(e as Error).message}`); }
  }
  async function apply() {
    if (!applyCoupon || !applyUser) return;
    setBusy(true);
    try {
      const r = await api.post<{ discountPercent: number }>(`/api/admin/coupons/${applyCoupon}/apply`, { userId: applyUser });
      onNote(`✅ Applied ${r.discountPercent}% to user's next invoice`); setApplyUser(''); load();
    } catch (e) { onNote(`❌ ${(e as Error).message}`); } finally { setBusy(false); }
  }

  const inp = 'input';
  return (
    <div className="card space-y-4">
      <p className="label">🎟️ Coupons — discount codes &amp; grants</p>

      {/* Create */}
      <div className="grid sm:grid-cols-2 md:grid-cols-5 gap-2 items-end">
        <label className="block"><span className="label">Code (optional)</span><input className={inp} placeholder="WELCOME50" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></label>
        <label className="block"><span className="label">Discount %</span><input type="number" min={1} max={100} className={inp} value={form.discountPercent} onChange={(e) => setForm({ ...form, discountPercent: Number(e.target.value) })} /></label>
        <label className="block"><span className="label">Max uses (optional)</span><input type="number" min={1} className={inp} value={form.maxRedemptions} onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })} /></label>
        <label className="block"><span className="label">Note (optional)</span><input className={inp} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        <button className="btn" disabled={busy} onClick={create}>Create coupon</button>
      </div>
      <p className="text-muted text-xs">Leave the code blank for an admin-only grant (apply it directly to a user below). 100% = free. One-time — applies to the user’s next invoice.</p>

      {/* Apply to a user */}
      <div className="grid sm:grid-cols-3 gap-2 items-end border-t border-border/70 pt-3">
        <label className="block"><span className="label">Coupon</span>
          <select className={inp} value={applyCoupon} onChange={(e) => setApplyCoupon(e.target.value)}>
            <option value="">Select coupon…</option>
            {coupons.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.code ?? '(grant)'} · {c.discountPercent}%</option>)}
          </select>
        </label>
        <label className="block"><span className="label">User</span>
          <select className={inp} value={applyUser} onChange={(e) => setApplyUser(e.target.value)}>
            <option value="">Select user…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
          </select>
        </label>
        <button className="btn" disabled={busy || !applyCoupon || !applyUser} onClick={apply}>Apply to user</button>
      </div>

      {/* List */}
      {coupons.length > 0 && (
        <table className="w-full text-sm">
          <thead><tr className="text-muted text-left"><th>Code</th><th>%</th><th>Used</th><th>Limit</th><th>Note</th><th>Status</th><th></th></tr></thead>
          <tbody>{coupons.map((c) => (
            <tr key={c.id} className="border-t border-border">
              <td className="font-mono">{c.code ?? <span className="text-muted">— grant —</span>}</td>
              <td>{c.discountPercent}%</td>
              <td>{c.timesRedeemed}</td>
              <td>{c.maxRedemptions ?? '∞'}</td>
              <td className="text-muted">{c.note ?? ''}</td>
              <td><span className={c.active ? 'badge-up' : 'text-muted'}>{c.active ? 'active' : 'inactive'}</span></td>
              <td><button className="btn text-xs" onClick={() => toggle(c)}>{c.active ? 'Disable' : 'Enable'}</button></td>
            </tr>))}</tbody>
        </table>
      )}
    </div>
  );
}
