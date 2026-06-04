'use client';

import { useEffect, useState, useCallback } from 'react';
import { TradingMode, REGIONS, tpLadder } from '@platform/shared';
import { api } from '@/lib/api';
import { AppNav } from '@/components/AppNav';

interface KeyRow { id: string; label: string; status: string; canTrade: boolean; canWithdraw: boolean; lastValidatedAt: string | null; }
interface ConnTest { connected: boolean; canTrade: boolean; canWithdraw: boolean; totalBalance: number; availableBalance: number; warning?: string; }
interface TgStatus { enabled: boolean; configured: boolean; chatId: string | null; }
interface BotCfg {
  status: string; mode: string; paperTrading: boolean; telegramEnabled: boolean; telegramChatId: string | null;
  scoreThreshold: number; leverage: number; marginPerTradeUsd: string; slPercent: string; tpRR: string; trailArmPct?: string; trailGapPct?: string;
  useScaledTp?: boolean; tp1Pct?: string; tp1SizePct?: number; tp2Frac?: string; tp2SizePct?: number;
  maxConcurrentPositions: number; maxTradesPerDay: number; maxConsecutiveLosses: number; lossCooldownMin: number; marginGuardPct: number;
  useAdxFilter: boolean; useEmaTrend: boolean; useRsi: boolean; useVolume: boolean; useAtr: boolean; useBreakEven: boolean; useTrailingStop: boolean; useAdaptiveLearning?: boolean;
}

type Tab = 'basic' | 'setup' | 'coupon' | 'password';
interface Me {
  id: string; email: string; role: string; status: string; emailVerified: boolean;
  profile: { fullName: string; mobile: string | null; country: string | null; timezone: string } | null;
  subscription: { plan: string; status: string } | null;
}

export default function SettingsPage() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [tg, setTg] = useState<TgStatus>();
  const [bot, setBot] = useState<BotCfg>();
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [me, setMe] = useState<Me>();
  const [tab, setTab] = useState<Tab>('basic');

  const load = useCallback(async () => {
    const [k, t, b, wl, m] = await Promise.all([
      api.get<KeyRow[]>('/api/apikeys').catch(() => []),
      api.get<TgStatus>('/api/notifications/telegram').catch(() => undefined),
      api.get<BotCfg>('/api/bot/status').catch(() => undefined),
      api.get<string[]>('/api/trading/watchlist').catch(() => []),
      api.get<Me>('/api/me').catch(() => undefined),
    ]);
    setKeys(k); setTg(t); setBot(b); setWatchlist(wl); setMe(m);
  }, []);

  useEffect(() => { api.refresh().then(load).catch(() => { window.location.href = '/login'; }); }, [load]);

  const hasKey = keys.some((k) => k.status === 'VALID');
  const ready = hasKey; // bot can start once a valid key exists

  const tabs: { id: Tab; label: string }[] = [
    { id: 'basic', label: '👤 Basic Information' },
    { id: 'setup', label: '⚙️ Setup' },
    { id: 'coupon', label: '🎟️ Coupon' },
    { id: 'password', label: '🔒 Change Password' },
  ];

  return (
    <>
      <AppNav active="settings" />
      <main className="p-3 sm:p-4 md:p-6 space-y-5 md:space-y-6 max-w-4xl mx-auto">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">Profile</h1>
          <p className="text-muted text-sm">Your account details, trading setup, coupons and security — all in one place.</p>
        </header>

        <nav className="flex flex-wrap gap-1 border-b border-border overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm rounded-t border-b-2 -mb-px whitespace-nowrap transition ${tab === t.id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-accent'}`}>
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'basic' && <BasicInfoSection me={me} onChange={load} />}

        {tab === 'setup' && (
          me?.emailVerified ? (
            <>
              <SetupChecklist hasKey={hasKey} tgConfigured={!!tg?.configured} paper={bot?.paperTrading ?? true} running={bot?.status === 'RUNNING'} />
              <BinanceSection keys={keys} onChange={load} />
              <TelegramSection tg={tg} onChange={load} />
              {bot && <TradingConfigSection bot={bot} watchlist={watchlist} isAdmin={me?.role === 'ADMIN'} onChange={load} />}
              {bot && <ActivationSection bot={bot} ready={ready} onChange={load} />}
            </>
          ) : <EmailVerifyGate email={me?.email} onVerified={load} />
        )}

        {tab === 'coupon' && <CouponSection />}
        {tab === 'password' && <ChangePasswordSection />}
      </main>
    </>
  );
}

// ── Basic information (profile) ───────────────────────────────────────────────
function BasicInfoSection({ me, onChange }: { me?: Me; onChange: () => void }) {
  const [form, setForm] = useState({ fullName: '', mobile: '', country: '', timezone: 'UTC' });
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me?.profile && !loaded) {
      setForm({
        fullName: me.profile.fullName ?? '', mobile: me.profile.mobile ?? '',
        country: me.profile.country ?? '', timezone: me.profile.timezone ?? 'UTC',
      });
      setLoaded(true);
    }
  }, [me, loaded]);

  const inp = 'input';
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function save() {
    setErr(''); setNote(''); setBusy(true);
    try {
      await api.patch('/api/me/profile', {
        fullName: form.fullName, mobile: form.mobile || undefined,
        country: form.country || undefined, timezone: form.timezone || undefined,
      });
      setNote('✅ Profile saved'); onChange(); setTimeout(() => setNote(''), 2500);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="card space-y-4">
      <p className="label">👤 Basic information</p>
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <KV k="Email" v={me?.email ?? '—'} />
        <KV k="Account role" v={me?.role ?? '—'} />
        <KV k="Plan" v={me?.subscription ? `${me.subscription.plan} · ${me.subscription.status}` : '—'} />
        <KV k="Email verified" v={me?.emailVerified ? 'Yes' : 'No'} />
      </div>
      <div className="grid sm:grid-cols-2 gap-3 border-t border-border/70 pt-3">
        <label className="block"><span className="label">Full name</span><input className={inp} value={form.fullName} onChange={set('fullName')} placeholder="Your name" /></label>
        <label className="block"><span className="label">Mobile</span><input className={inp} value={form.mobile} onChange={set('mobile')} placeholder="+91 …" /></label>
        <label className="block"><span className="label">Country</span><input className={inp} value={form.country} onChange={set('country')} placeholder="Country" /></label>
        <label className="block"><span className="label">Region / timezone</span><select className={inp} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}>{REGIONS.map((r) => <option key={r.tz} value={r.tz}>{r.label}</option>)}</select></label>
      </div>
      <button className="btn w-full" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save profile'}</button>
      {note && <p className="text-accent text-sm">{note}</p>}
      {err && <p className="text-danger text-sm">{err}</p>}
    </section>
  );
}

// ── Email verification gate (unlocks the Setup tab) ───────────────────────────
function EmailVerifyGate({ email, onVerified }: { email?: string; onVerified: () => void }) {
  const [code, setCode] = useState('');
  const [dev, setDev] = useState('');
  const [note, setNote] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const inp = 'input';

  async function send() {
    setErr(''); setNote(''); setDev(''); setBusy(true);
    try {
      const r = await api.post<{ sent: boolean; devCode?: string }>('/api/auth/email-otp/request');
      if (r.devCode) { setDev(r.devCode); setNote('Email delivery isn’t set up yet — use this code:'); }
      else setNote('A 6-digit code was sent to your email.');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function verify() {
    setErr(''); setBusy(true);
    try { await api.post('/api/auth/email-otp/verify', { code: code.trim() }); onVerified(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="card space-y-3 max-w-md">
      <p className="label">🔒 Verify your email to unlock Setup</p>
      <p className="text-muted text-sm">For security, connecting a Binance key and trading stays locked until your email{email ? ` (${email})` : ''} is verified. Send yourself a 6-digit code, then enter it below.</p>
      <button className="btn w-full" disabled={busy} onClick={send}>{busy ? '…' : 'Send verification code'}</button>
      {dev && <p className="text-warn text-sm">Your code: <b className="font-mono text-base">{dev}</b></p>}
      <input className={inp} placeholder="Enter 6-digit code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} maxLength={6} />
      <button className="btn w-full" disabled={busy || code.trim().length < 4} onClick={verify}>Verify &amp; unlock</button>
      {note && <p className="text-accent text-sm">{note}</p>}
      {err && <p className="text-danger text-sm">{err}</p>}
    </section>
  );
}

// ── Coupon ────────────────────────────────────────────────────────────────────
interface CouponStatus {
  nextInvoiceDiscountPct: number;
  history: { code: string | null; note: string | null; discountPercent: number; source: string; at: string }[];
}
function CouponSection() {
  const [status, setStatus] = useState<CouponStatus>();
  const [code, setCode] = useState('');
  const [note, setNote] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { setStatus(await api.get<CouponStatus>('/api/billing/coupon').catch(() => undefined)); }, []);
  useEffect(() => { load(); }, [load]);

  async function redeem() {
    setErr(''); setNote(''); setBusy(true);
    try {
      const r = await api.post<{ discountPercent: number }>('/api/billing/coupon/redeem', { code: code.trim() });
      setNote(r.discountPercent >= 100 ? '✅ Applied — your next invoice is FREE!' : `✅ ${r.discountPercent}% off your next invoice applied.`);
      setCode(''); load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const pct = status?.nextInvoiceDiscountPct ?? 0;
  const inp = 'input';
  return (
    <section className="card space-y-3 max-w-md">
      <p className="label">🎟️ Coupons &amp; discounts</p>
      {pct > 0 ? (
        <div className="rounded p-3 border border-accent/40 bg-accent/5 text-sm">
          <p className="text-accent font-bold">{pct >= 100 ? 'Your next invoice is FREE (100% off) 🎉' : `${pct}% off your next invoice`}</p>
          <p className="text-muted text-xs">Applied automatically to your next billing charge.</p>
        </div>
      ) : (
        <p className="text-muted text-sm">Have a coupon code? Redeem it here — the discount applies to your next invoice.</p>
      )}
      <div className="flex gap-2">
        <input className={inp} placeholder="Coupon code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <button className="btn" disabled={busy || !code.trim()} onClick={redeem}>{busy ? '…' : 'Redeem'}</button>
      </div>
      {note && <p className="text-accent text-sm">{note}</p>}
      {err && <p className="text-danger text-sm">{err}</p>}
      {!!status?.history.length && (
        <div className="border-t border-border/70 pt-2 text-xs space-y-1">
          <p className="label">History</p>
          {status.history.map((h, i) => (
            <div key={i} className="flex justify-between text-muted">
              <span>{h.code ?? (h.source === 'ADMIN' ? 'Admin grant' : 'Coupon')} · {h.discountPercent}% off</span>
              <span>{new Date(h.at).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Change password ───────────────────────────────────────────────────────────
function ChangePasswordSection() {
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [confirm, setConfirm] = useState('');
  const [note, setNote] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const inp = 'input';

  async function submit() {
    setErr(''); setNote('');
    if (next.length < 8) { setErr('New password must be at least 8 characters.'); return; }
    if (next !== confirm) { setErr('New password and confirmation do not match.'); return; }
    setBusy(true);
    try {
      await api.post('/api/auth/change-password', { currentPassword: cur, newPassword: next });
      setNote('✅ Password changed. Your other devices have been signed out.');
      setCur(''); setNext(''); setConfirm('');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="card space-y-3 max-w-md">
      <p className="label">🔒 Change password</p>
      <p className="text-muted text-xs">For your security, changing your password signs out all your other devices.</p>
      <input className={inp} type="password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} />
      <input className={inp} type="password" placeholder="New password (min 8 chars)" value={next} onChange={(e) => setNext(e.target.value)} />
      <input className={inp} type="password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <button className="btn w-full" disabled={busy || !cur || !next || !confirm} onClick={submit}>{busy ? 'Updating…' : 'Update password'}</button>
      {note && <p className="text-accent text-sm">{note}</p>}
      {err && <p className="text-danger text-sm">{err}</p>}
    </section>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3"><span className="text-muted">{k}</span><span className="text-right">{v}</span></div>;
}

// ── Setup checklist ──────────────────────────────────────────────────────────
function SetupChecklist({ hasKey, tgConfigured, paper, running }: { hasKey: boolean; tgConfigured: boolean; paper: boolean; running: boolean }) {
  const steps = [
    { done: hasKey, label: '1. Connect Binance Futures API key' },
    { done: tgConfigured, label: '2. Connect Telegram alerts (optional)', optional: true },
    { done: true, label: `3. Trading mode: ${paper ? 'PAPER (safe test)' : 'LIVE (real funds)'}` },
    { done: running, label: '4. Start the bot' },
  ];
  return (
    <section className="card">
      <p className="label mb-2">Setup checklist</p>
      <div className="grid sm:grid-cols-2 gap-2 text-sm">
        {steps.map((s) => (
          <div key={s.label} className={`flex items-center gap-2 ${s.done ? 'text-accent' : 'text-muted'}`}>
            <span>{s.done ? '✅' : s.optional ? '⚪' : '⬜'}</span><span>{s.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Binance ──────────────────────────────────────────────────────────────────
function BinanceSection({ keys, onChange }: { keys: KeyRow[]; onChange: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [warn, setWarn] = useState('');
  const [test, setTest] = useState<ConnTest>();
  const [err, setErr] = useState('');
  const existing = keys[0];

  async function connect() {
    setErr(''); setNote(''); setWarn(''); setBusy(true);
    try {
      const r = await api.post<{ warning?: string }>('/api/apikeys', { apiKey, secret });
      setNote('✅ Key validated against Binance and stored encrypted.');
      if (r.warning) setWarn(r.warning);
      setApiKey(''); setSecret(''); onChange();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function runTest() {
    setErr(''); setTest(undefined); setBusy(true);
    try { setTest(await api.post<ConnTest>('/api/apikeys/test')); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!confirm('Remove this API key? The bot will stop.')) return;
    await api.del(`/api/apikeys/${id}`); onChange();
  }

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <p className="label">🔑 Binance Futures API key</p>
        {existing && <span className={existing.status === 'VALID' ? 'badge-up text-xs' : 'text-warn text-xs'}>{existing.status}</span>}
      </div>

      {existing ? (
        <div className="text-sm space-y-1">
          <div className="flex justify-between"><span className="text-muted">Trade permission</span><span className={existing.canTrade ? 'badge-up' : 'badge-down'}>{existing.canTrade ? 'YES' : 'NO'}</span></div>
          <div className="flex justify-between"><span className="text-muted">Withdraw permission</span><span className={existing.canWithdraw ? 'badge-down' : 'badge-up'}>{existing.canWithdraw ? '⚠ ENABLED (disable it!)' : 'disabled (good)'}</span></div>
          <div className="flex justify-between"><span className="text-muted">Last validated</span><span>{existing.lastValidatedAt ? new Date(existing.lastValidatedAt).toLocaleString() : '—'}</span></div>
          <div className="flex gap-2 pt-2">
            <button className="btn text-xs" disabled={busy} onClick={runTest}>{busy ? '…' : '🔌 Test connection'}</button>
            <button className="btn-danger text-xs" onClick={() => remove(existing.id)}>Remove key</button>
          </div>
          {test && (
            <div className="bg-bg rounded p-2 border border-border mt-2 text-xs">
              <p className="badge-up">✅ Connected to Binance</p>
              <p>Balance: <b>${test.totalBalance.toFixed(2)}</b> · Available: <b>${test.availableBalance.toFixed(2)}</b></p>
              {test.warning && <p className="text-warn mt-1">⚠ {test.warning}</p>}
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="text-muted text-xs">Create a <b>Futures-enabled, trade-only</b> key on Binance (API Management). <b>Do NOT enable withdrawals.</b> See the setup guide below for exact steps.</p>
          <input className="input" placeholder="API Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          <input className="input" placeholder="Secret Key" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
          <button className="btn w-full" disabled={busy || !apiKey || !secret} onClick={connect}>{busy ? 'Validating…' : 'Validate & connect'}</button>
        </>
      )}
      {note && <p className="text-accent text-sm">{note}</p>}
      {warn && <p className="text-warn text-sm">⚠ {warn}</p>}
      {err && <p className="text-danger text-sm">{err}</p>}
      <BinanceGuide />
    </section>
  );
}

function BinanceGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-border/70 pt-2">
      <button className="text-accent text-xs" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} How to create a Binance Futures API key (no withdrawals)</button>
      {open && (
        <ol className="list-decimal ml-5 mt-2 text-xs text-muted space-y-1">
          <li>Log in to Binance → profile menu → <b>API Management</b>.</li>
          <li>Click <b>Create API</b> → choose <b>System generated</b> → name it (e.g. &quot;DS2Aura bot&quot;) → verify with 2FA.</li>
          <li>Copy the <b>API Key</b> and <b>Secret Key</b> (the secret is shown only once).</li>
          <li>Click <b>Edit restrictions</b>: enable <b>Enable Futures</b>. Leave <b>Enable Withdrawals OFF</b>.</li>
          <li>(Recommended) Restrict access to trusted IPs only.</li>
          <li>Make sure your Binance <b>Futures (USDⓈ-M) wallet is funded</b> with USDT.</li>
          <li>Paste both keys above and click <b>Validate &amp; connect</b>.</li>
        </ol>
      )}
    </div>
  );
}

// ── Telegram ───────────────────────────────────────────────────────────────
function TelegramSection({ tg, onChange }: { tg?: TgStatus; onChange: () => void }) {
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');

  async function save() {
    setErr(''); setNote(''); setBusy(true);
    try {
      const r = await api.post<{ botName: string }>('/api/notifications/telegram', { botToken, chatId });
      setNote(`✅ Connected${r.botName ? ` to @${r.botName}` : ''}. Sending a test message…`);
      await api.post('/api/notifications/telegram/test');
      setNote(`✅ Connected${r.botName ? ` to @${r.botName}` : ''}. Test message sent — check your Telegram.`);
      setBotToken(''); setChatId(''); onChange();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function test() {
    setErr(''); setNote(''); setBusy(true);
    try { await api.post('/api/notifications/telegram/test'); setNote('✅ Test message sent — check your Telegram.'); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function disable() { await api.post('/api/notifications/telegram/disable'); onChange(); }

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <p className="label">📨 Telegram alerts (your own bot)</p>
        {tg?.enabled && <span className="badge-up text-xs">ENABLED{tg.chatId ? ` · chat ${tg.chatId}` : ''}</span>}
      </div>

      {tg?.configured && tg.enabled ? (
        <div className="flex gap-2">
          <button className="btn text-xs" disabled={busy} onClick={test}>{busy ? '…' : '📨 Send test message'}</button>
          <button className="btn-danger text-xs" onClick={disable}>Disable</button>
        </div>
      ) : (
        <>
          <p className="text-muted text-xs">Get trade alerts in <b>your</b> Telegram. Create a bot with @BotFather and paste its token + your chat id (guide below).</p>
          <input className="input" placeholder="Bot token (123456:ABC-...)" value={botToken} onChange={(e) => setBotToken(e.target.value)} />
          <input className="input" placeholder="Chat ID (e.g. 123456789)" value={chatId} onChange={(e) => setChatId(e.target.value)} />
          <button className="btn w-full" disabled={busy || !botToken || !chatId} onClick={save}>{busy ? 'Saving…' : 'Save & send test'}</button>
        </>
      )}
      {note && <p className="text-accent text-sm">{note}</p>}
      {err && <p className="text-danger text-sm">{err}</p>}
      <TelegramGuide />
    </section>
  );
}

function TelegramGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-border/70 pt-2">
      <button className="text-accent text-xs" onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} How to create your Telegram bot &amp; find your chat id</button>
      {open && (
        <ol className="list-decimal ml-5 mt-2 text-xs text-muted space-y-1">
          <li>In Telegram, open <b>@BotFather</b> → send <code>/newbot</code>.</li>
          <li>Pick a name and a username ending in <code>bot</code> (e.g. <code>my_ds2aura_bot</code>).</li>
          <li>BotFather replies with a <b>token</b> like <code>123456789:ABCdef...</code> — copy it into &quot;Bot token&quot; above.</li>
          <li>Open <b>your new bot</b> and press <b>Start</b> (send any message) so it can message you.</li>
          <li>To get your <b>chat id</b>: message <b>@userinfobot</b> — it replies with your numeric id. (For a group, add <b>@RawDataBot</b> and read <code>chat.id</code>.)</li>
          <li>Paste the chat id above → <b>Save &amp; send test</b>. You should receive a confirmation message.</li>
        </ol>
      )}
    </div>
  );
}

// ── Trading config ───────────────────────────────────────────────────────────
function TradingConfigSection({ bot, watchlist, isAdmin, onChange }: { bot: BotCfg; watchlist: string[]; isAdmin: boolean; onChange: () => void }) {
  const [cfg, setCfg] = useState({
    scoreThreshold: bot.scoreThreshold, leverage: bot.leverage, marginPerTradeUsd: Number(bot.marginPerTradeUsd),
    slPercent: Number(bot.slPercent), tpRR: Number(bot.tpRR),
    trailArmPct: Number(bot.trailArmPct ?? 0.5), trailGapPct: Number(bot.trailGapPct ?? 0.5),
    tp1Pct: Number(bot.tp1Pct ?? 0.6), tp1SizePct: bot.tp1SizePct ?? 40,
    tp2Frac: Number(bot.tp2Frac ?? 0.5), tp2SizePct: bot.tp2SizePct ?? 30,
    maxConcurrentPositions: bot.maxConcurrentPositions,
    maxTradesPerDay: bot.maxTradesPerDay, maxConsecutiveLosses: bot.maxConsecutiveLosses,
    lossCooldownMin: bot.lossCooldownMin, marginGuardPct: bot.marginGuardPct,
  });
  const [scaledTp, setScaledTp] = useState(!!bot.useScaledTp);
  const [toggles, setToggles] = useState({
    useAdxFilter: bot.useAdxFilter, useEmaTrend: bot.useEmaTrend, useRsi: bot.useRsi, useVolume: bot.useVolume,
    useAtr: bot.useAtr, useBreakEven: bot.useBreakEven, useTrailingStop: bot.useTrailingStop,
  });
  const [wl, setWl] = useState(watchlist.join(', '));
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const set = (k: keyof typeof cfg) => (e: React.ChangeEvent<HTMLInputElement>) => setCfg({ ...cfg, [k]: Number(e.target.value) });
  const tog = (k: keyof typeof toggles) => () => setToggles({ ...toggles, [k]: !toggles[k] });

  async function setMode(mode: string) { setErr(''); try { await api.post('/api/bot/mode', { mode }); setNote(`Mode → ${mode}`); onChange(); } catch (e) { setErr((e as Error).message); } }
  async function setPaper(paper: boolean) {
    setErr('');
    try { await api.patch('/api/bot/config', { paperTrading: paper }); setNote(paper ? 'Switched to PAPER (safe test)' : 'Switched to LIVE — real funds at risk'); onChange(); }
    catch (e) { setErr((e as Error).message); }
  }
  // Quick-fill the watchlist with the top-N USDT futures coins by 24h volume (applied instantly).
  async function setTopN(n: number) {
    setErr(''); setNote('');
    try {
      const syms = await api.get<string[]>(`/api/trading/top-symbols?limit=${n}`);
      setWl(syms.join(', '));
      await api.put('/api/trading/watchlist', { symbols: syms });
      setNote(`Watchlist set to the top ${n} coins`); onChange(); setTimeout(() => setNote(''), 2500);
    } catch (e) { setErr((e as Error).message); }
  }
  async function saveAll() {
    setErr(''); setNote('');
    try {
      await api.patch('/api/bot/config', { ...cfg, ...toggles, useScaledTp: scaledTp });
      const symbols = wl.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      await api.put('/api/trading/watchlist', { symbols });
      setNote('✅ Settings + watchlist saved'); onChange(); setTimeout(() => setNote(''), 2500);
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <section className="card space-y-4">
      <p className="label">📊 Trading configuration</p>

      {/* Paper / Live toggle */}
      <div className={`rounded p-3 border ${bot.paperTrading ? 'border-accent/40 bg-accent/5' : 'border-warn/50 bg-warn/10'}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-bold">{bot.paperTrading ? '🧪 Paper Trading (safe test)' : '🔴 Live Trading (real funds)'}</p>
            <p className="text-muted text-xs">{bot.paperTrading ? 'Simulated fills on live market data — no real orders. Test the full pipeline risk-free.' : 'The bot places REAL orders on your Binance account. Make sure you tested in Paper first.'}</p>
          </div>
          <div className="flex gap-1">
            <button className={`text-xs ${bot.paperTrading ? 'btn' : 'btn opacity-60'}`} onClick={() => setPaper(true)}>Paper</button>
            <button className={`text-xs ${!bot.paperTrading ? 'btn-danger' : 'btn opacity-60'}`} onClick={() => setPaper(false)}>Live</button>
          </div>
        </div>
      </div>

      {/* Mode presets */}
      <div>
        <p className="label mb-1">Risk preset</p>
        <div className="flex gap-2">
          {Object.values(TradingMode).map((m) => (
            <button key={m} className={`text-xs flex-1 ${bot.mode === m ? 'btn' : 'btn opacity-60'}`} onClick={() => setMode(m)}>{m}</button>
          ))}
        </div>
      </div>

      {/* Numeric params */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <Num label="Score threshold" v={cfg.scoreThreshold} onChange={set('scoreThreshold')} />
        <Num label="Leverage (×)" v={cfg.leverage} onChange={set('leverage')} />
        <Num label="Margin / trade ($)" v={cfg.marginPerTradeUsd} onChange={set('marginPerTradeUsd')} />
        <Num label="Stop loss (%)" v={cfg.slPercent} onChange={set('slPercent')} step="0.1" />
        <Num label="Take profit (R:R)" v={cfg.tpRR} onChange={set('tpRR')} step="0.1" />
        <Num label="Arm trailing (+%)" v={cfg.trailArmPct} onChange={set('trailArmPct')} step="0.1" />
        <Num label="Trail gap (%)" v={cfg.trailGapPct} onChange={set('trailGapPct')} step="0.1" />
        <Num label="Max positions" v={cfg.maxConcurrentPositions} onChange={set('maxConcurrentPositions')} />
        {isAdmin ? (
          <label className="block">
            <span className="label">Max trades / day <span className="text-accent/70">(admin)</span></span>
            <div className="flex gap-1 mt-0.5">
              {cfg.maxTradesPerDay === 0 ? (
                <input readOnly value="Unlimited"
                  className="input border-accent/60 text-accent font-medium" />
              ) : (
                <input type="number" min={1} value={cfg.maxTradesPerDay}
                  onChange={(e) => setCfg({ ...cfg, maxTradesPerDay: Math.max(1, Number(e.target.value)) })}
                  className="input" />
              )}
              <button type="button" title="Toggle unlimited daily trades (admin only)"
                onClick={() => setCfg({ ...cfg, maxTradesPerDay: cfg.maxTradesPerDay === 0 ? 10 : 0 })}
                className={`text-xs px-2 rounded whitespace-nowrap ${cfg.maxTradesPerDay === 0 ? 'btn' : 'btn opacity-60'}`}>
                ∞ Unlimited
              </button>
            </div>
          </label>
        ) : (
          <Num label="Max trades / day" v={cfg.maxTradesPerDay} onChange={set('maxTradesPerDay')} />
        )}
        <Num label="Max consec. losses" v={cfg.maxConsecutiveLosses} onChange={set('maxConsecutiveLosses')} />
        <Num label="Loss cooldown (min)" v={cfg.lossCooldownMin} onChange={set('lossCooldownMin')} />
        <Num label="Margin guard (%)" v={cfg.marginGuardPct} onChange={set('marginGuardPct')} />
      </div>

      {/* Scaled take-profit ladder (opt-in) */}
      <div className="border-t border-border/70 pt-3">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={scaledTp} onChange={(e) => setScaledTp(e.target.checked)} />
          <span>
            <b>🎯 Scaled take-profit (TP1 / TP2 / runner)</b> <span className="text-muted text-xs">(opt-in)</span>
            <span className="block text-muted text-xs">Book partial profit in tranches instead of one all-or-nothing exit: TP1 banks a chunk and moves the stop to <b>break-even</b> (the trade can’t turn into a loss), TP2 banks more, and the remaining runner trails for extended upside. All levels derive from your Stop-loss % and R:R. Saved with “Save all settings”. Test in Paper first.</span>
          </span>
        </label>
        {scaledTp && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mt-3">
              <Num label="TP1 (+%)" v={cfg.tp1Pct} onChange={set('tp1Pct')} step="0.1" />
              <Num label="TP1 close (%)" v={cfg.tp1SizePct} onChange={set('tp1SizePct')} />
              <Num label="TP2 (frac of target)" v={cfg.tp2Frac} onChange={set('tp2Frac')} step="0.05" />
              <Num label="TP2 close (%)" v={cfg.tp2SizePct} onChange={set('tp2SizePct')} />
            </div>
            <TpLadderPreview cfg={cfg} />
          </>
        )}
      </div>

      {/* Strategy toggles */}
      <div>
        <p className="label mb-1">Strategy filters &amp; protection</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <Toggle label="ADX filter" on={toggles.useAdxFilter} onClick={tog('useAdxFilter')} />
          <Toggle label="EMA trend" on={toggles.useEmaTrend} onClick={tog('useEmaTrend')} />
          <Toggle label="RSI" on={toggles.useRsi} onClick={tog('useRsi')} />
          <Toggle label="Volume" on={toggles.useVolume} onClick={tog('useVolume')} />
          <Toggle label="ATR" on={toggles.useAtr} onClick={tog('useAtr')} />
          <Toggle label="Break-even" on={toggles.useBreakEven} onClick={tog('useBreakEven')} />
          <Toggle label="Trailing stop" on={toggles.useTrailingStop} onClick={tog('useTrailingStop')} />
        </div>
      </div>

      {/* Adaptive learning (opt-in) — toggles immediately */}
      <label className="flex items-start gap-2 text-sm border-t border-border/70 pt-3">
        <input type="checkbox" className="mt-1" checked={!!bot.useAdaptiveLearning}
          onChange={async (e) => {
            setErr('');
            try { await api.patch('/api/bot/config', { useAdaptiveLearning: e.target.checked }); setNote(`Adaptive learning ${e.target.checked ? 'ON' : 'OFF'}`); onChange(); setTimeout(() => setNote(''), 2500); }
            catch (e2) { setErr((e2 as Error).message); }
          }} />
        <span>
          <b>🧠 Self-learning (auto-improve)</b> <span className="text-muted text-xs">(opt-in)</span>
          <span className="block text-muted text-xs">The bot learns from its own closed trades like a disciplined senior trader — automatically raising the quality bar on coins that lose, easing it for proven winners, and pausing coins that keep losing. It re-checks after every trade; never touches your leverage, size, or safety stops. Test in Paper first.</span>
        </span>
      </label>

      {/* Watchlist */}
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <p className="label">Watchlist (comma-separated)</p>
          <span className="text-muted text-xs">quick-fill:</span>
          {[5, 10, 20, 50].map((n) => (
            <button key={n} type="button" className="btn text-xs py-0.5 px-2" onClick={() => setTopN(n)}>Top {n}</button>
          ))}
        </div>
        <textarea className="input text-sm" rows={2} value={wl} onChange={(e) => setWl(e.target.value)} />
        <p className="text-muted text-xs mt-1">Top N = most-traded USDT futures coins by 24h volume, applied instantly. Or type your own symbols and click “Save all settings”.</p>
      </div>

      <button className="btn w-full" onClick={saveAll}>Save all settings</button>
      {note && <p className="text-accent text-sm">{note}</p>}
      {err && <p className="text-danger text-sm">{err}</p>}
    </section>
  );
}

// ── Activation ───────────────────────────────────────────────────────────────
function ActivationSection({ bot, ready, onChange }: { bot: BotCfg; ready: boolean; onChange: () => void }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function act(action: 'start' | 'pause' | 'stop') {
    setErr(''); setBusy(true);
    try { await api.post(`/api/bot/${action}`); onChange(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between">
        <p className="label">🚀 Activate</p>
        <span className={bot.status === 'RUNNING' ? 'badge-up' : 'text-muted'}>{bot.status} · {bot.paperTrading ? 'PAPER' : 'LIVE'}</span>
      </div>
      {!ready && <p className="text-warn text-sm">Connect a valid Binance API key above before starting the bot.</p>}
      <p className="text-muted text-xs">Recommended: start in <b>Paper</b> mode, watch a few trades on the dashboard &amp; Telegram, confirm everything works, then switch to <b>Live</b>.</p>
      <div className="flex gap-2">
        <button className="btn" disabled={busy || !ready} onClick={() => act('start')}>▶ Start bot</button>
        <button className="btn" disabled={busy} onClick={() => act('pause')}>⏸ Pause</button>
        <button className="btn-danger" disabled={busy} onClick={() => act('stop')}>⏹ Stop</button>
      </div>
      {err && <p className="text-danger text-sm">{err}</p>}
    </section>
  );
}

// ── small inputs ─────────────────────────────────────────────────────────────
function Num({ label, v, onChange, step }: { label: string; v: number; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; step?: string }) {
  return <label className="block"><span className="label">{label}</span><input type="number" step={step} value={v} onChange={onChange} className="input mt-0.5" /></label>;
}
function TpLadderPreview({ cfg }: { cfg: { slPercent: number; tpRR: number; tp1Pct: number; tp1SizePct: number; tp2Frac: number; tp2SizePct: number } }) {
  const lad = tpLadder(cfg);
  const pct = (f: number) => `+${(f * 100).toFixed(2)}%`;
  const rows = [
    { k: `TP1  ${pct(lad.tp1)}`, v: `close ${lad.tp1SizePct}% · stop → break-even` },
    { k: `TP2  ${pct(lad.tp2)}`, v: `close ${lad.tp2SizePct}%` },
    { k: `Runner ${pct(lad.tp3)}`, v: `${lad.runnerSizePct}% trails to the full 1:${cfg.tpRR} target` },
  ];
  return (
    <div className="mt-3 rounded border border-accent/30 bg-accent/5 p-3 text-xs space-y-1">
      <p className="label">Ladder preview — SL {cfg.slPercent}% · R:R 1:{cfg.tpRR}</p>
      {rows.map((r) => (
        <div key={r.k} className="flex justify-between gap-3"><span className="text-accent font-mono">{r.k}</span><span className="text-muted text-right">{r.v}</span></div>
      ))}
      {lad.runnerSizePct === 0 && <p className="text-warn">⚠ TP1 + TP2 = 100% — no runner left. Lower a size to keep a trailing runner.</p>}
    </div>
  );
}
function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex items-center justify-between rounded px-2 py-1.5 border ${on ? 'border-accent/50 text-accent' : 'border-border text-muted'}`}>
      <span>{label}</span><span>{on ? 'ON' : 'OFF'}</span>
    </button>
  );
}
