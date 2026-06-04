'use client';

import { useEffect, useState } from 'react';
import {
  Bot, Activity, Bell, ShieldCheck, Lock, Smartphone,
  Globe, ArrowRight, Check, CheckCircle2,
} from 'lucide-react';
import { BILLING, centsToUsd } from '@platform/shared';
import { getApiBase } from '@/lib/api';
import { ThemeToggle } from '@/components/ThemeToggle';

interface Branding {
  appName: string; tagline: string; heroSubtitle: string; logoUrl: string;
  webUrl: string; appUrl: string; supportEmail: string; feedbackEmail: string;
}

const FEATURES = [
  { icon: Bot, title: 'AI Trading Bot', body: '50-condition scoring engine trades your Binance Futures account automatically — EMA, RSI, MACD, ADX, VWAP, volume & multi-timeframe confirmation.' },
  { icon: Activity, title: 'Real-Time Dashboard', body: 'Live positions, P&L, win rate, equity curve and bot activity — streamed over WebSocket the instant anything changes.' },
  { icon: Bell, title: 'Transparent AI Signals', body: 'See every coin scored in real time with the exact reasons a trade passed or was blocked. No black box.' },
  { icon: ShieldCheck, title: 'Risk Management', body: 'Break-even, trailing stop, hard SL/TP, daily caps and a margin guard protect every position — even without exchange-side stops.' },
  { icon: Lock, title: 'Your Keys, Encrypted', body: 'Your Binance API keys are AES-256 encrypted and isolated. Trade-only — withdrawals never needed. Your funds stay on your account.' },
  { icon: Smartphone, title: 'Web & Mobile Ready', body: 'One responsive platform across web and PWA, with native mobile apps on the roadmap — same secure backend.' },
];

export default function Home() {
  const [b, setB] = useState<Branding | null>(null);

  useEffect(() => {
    fetch(`${getApiBase()}/api/public/branding`).then((r) => r.json())
      .then((j) => { if (j.ok) setB(j.data); }).catch(() => {});
  }, []);

  const name = b?.appName ?? 'DS2AuraTrading AI';
  const heroSub = b?.heroSubtitle ?? 'Connect your Binance Futures account, pick a risk mode, and let an AI-scored bot trade for you — fully isolated, fully yours.';
  const monthly = centsToUsd(BILLING.basicMonthlyCents);
  const overage = centsToUsd(BILLING.overagePerTradeCents);
  const proYear = centsToUsd(BILLING.proAnnualCents);

  return (
    <main className="min-h-screen bg-bg text-fg">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-border bg-surface/80 backdrop-blur-md">
        <nav className="max-w-6xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 h-14">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            {b?.logoUrl
              ? <img src={b.logoUrl} alt={name} className="h-7 w-auto rounded" />
              : <span className="grid place-items-center h-7 w-7 rounded-lg bg-accent text-[rgb(var(--accent-fg))] text-sm font-bold">A</span>}
            <span className="truncate max-w-[44vw] sm:max-w-none">{name}</span>
          </span>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <a href="/login" className="btn-ghost hidden sm:inline-flex">Sign in</a>
            <a href="/register" className="btn">Start free trial</a>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_50%_-10%,rgb(var(--accent)/0.10),transparent)]" />
        <div className="max-w-3xl mx-auto px-6 pt-20 pb-16 text-center">
          {b?.logoUrl && <img src={b.logoUrl} alt={name} className="h-14 w-auto mx-auto mb-6 rounded-xl" />}
          <span className="chip mb-5"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> Binance USDT-M Futures · Automated</span>
          <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight leading-[1.05]">
            {b?.tagline ?? 'Automated crypto trading on your own Binance account'}
          </h1>
          <p className="mt-6 text-base sm:text-lg text-muted max-w-2xl mx-auto leading-relaxed">{heroSub}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a href="/register" className="btn px-5 py-2.5 text-base">Start 30-day free trial <ArrowRight size={18} /></a>
            <a href="/login" className="btn-outline px-5 py-2.5 text-base">Live dashboard login</a>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted">
            {b?.webUrl && <a className="inline-flex items-center gap-1.5 hover:text-fg transition-colors" href={b.webUrl} target="_blank" rel="noreferrer"><Globe size={15} /> {b.webUrl.replace(/^https?:\/\//, '')}</a>}
            {b?.appUrl
              ? <a className="inline-flex items-center gap-1.5 hover:text-fg transition-colors" href={b.appUrl} target="_blank" rel="noreferrer"><Smartphone size={15} /> Get the app</a>
              : <span className="inline-flex items-center gap-1.5"><Smartphone size={15} /> Mobile app — coming soon</span>}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-16 sm:py-20">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Everything in one platform</h2>
          <p className="mt-3 text-muted">A complete trading stack — included with your plan.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="card hover:shadow-pop transition-shadow">
              <span className="grid place-items-center h-10 w-10 rounded-lg bg-accent/10 text-accent mb-4"><f.icon size={20} /></span>
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-6xl mx-auto px-6 py-16 sm:py-20 border-t border-border">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Simple, transparent pricing</h2>
          <p className="mt-3 text-muted">No profit-sharing. No hidden fees. Cancel anytime.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-4 items-start">
          {/* Trial */}
          <div className="card">
            <p className="label">Free Trial</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">30 Days</p>
            <p className="mt-2 text-sm text-muted">Full platform access. One trial per user &amp; Binance account.</p>
            <ul className="mt-5 space-y-2 text-sm">
              {['Full bot + AI signals', 'Real-time dashboard & analytics', 'No card required to start'].map((t) => <Li key={t}>{t}</Li>)}
            </ul>
            <a href="/register" className="btn-outline w-full mt-6">Start free</a>
          </div>
          {/* Basic — highlighted */}
          <div className="card relative ring-1 ring-accent border-accent/60 md:-mt-2 md:mb-2 shadow-pop">
            <span className="absolute -top-2.5 right-4 chip bg-accent text-[rgb(var(--accent-fg))] border-transparent">POPULAR</span>
            <p className="label">Basic Plan</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">${monthly}<span className="text-base font-normal text-muted">/mo</span></p>
            <p className="mt-2 text-sm text-muted">Includes <b className="text-fg">{BILLING.includedTrades} trades</b>/month, then <b className="text-fg">${overage.toFixed(2)}</b> per extra trade.</p>
            <ul className="mt-5 space-y-2 text-sm">
              {['Everything in the trial, billed monthly', 'Usage-based — pay only for what you trade', 'Live usage meter, no surprises'].map((t) => <Li key={t}>{t}</Li>)}
            </ul>
            <a href="/register" className="btn w-full mt-6">Get started</a>
          </div>
          {/* Pro */}
          <div className="card">
            <p className="label">Pro Plan</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">${proYear}<span className="text-base font-normal text-muted">/yr</span></p>
            <p className="mt-2 text-sm text-muted">{BILLING.proMonthsFree} months free vs monthly. Still <b className="text-fg">{BILLING.includedTrades} trades</b>/month, then <b className="text-fg">${overage.toFixed(2)}</b> per extra trade.</p>
            <ul className="mt-5 space-y-2 text-sm">
              {[`Everything in Basic, billed yearly`, `Save $${(monthly * 12 - proYear).toFixed(0)} a year (${BILLING.proMonthsFree} months free)`, `Same ${BILLING.includedTrades} trades/month + $${overage.toFixed(2)} overage`].map((t) => <Li key={t}>{t}</Li>)}
            </ul>
            <a href="/register" className="btn-outline w-full mt-6">Go Pro</a>
          </div>
        </div>
        <p className="mt-6 text-center text-sm text-muted">
          <b className="text-fg">Examples:</b> {BILLING.includedTrades} trades = ${monthly} · 200 trades = ${(monthly + 50 * overage).toFixed(0)} · 300 trades = ${(monthly + 150 * overage).toFixed(0)}
        </p>
      </section>

      {/* Feedback */}
      <FeedbackSection email={b?.feedbackEmail} />

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted">
          <span className="flex items-center gap-2 font-semibold text-fg">
            {b?.logoUrl
              ? <img src={b.logoUrl} alt={name} className="h-6 w-auto rounded" />
              : <span className="grid place-items-center h-6 w-6 rounded-md bg-accent text-[rgb(var(--accent-fg))] text-xs font-bold">A</span>}
            {name}
          </span>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
            <a href="/login" className="hover:text-fg transition-colors">Sign in</a>
            <a href="/register" className="hover:text-fg transition-colors">Register</a>
            {b?.webUrl && <a href={b.webUrl} className="hover:text-fg transition-colors" target="_blank" rel="noreferrer">Website</a>}
            {b?.supportEmail && <a href={`mailto:${b.supportEmail}`} className="hover:text-fg transition-colors">Support</a>}
          </div>
          <span>© {new Date().getFullYear()} {name}. Trading involves risk.</span>
        </div>
      </footer>
    </main>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-muted">
      <Check size={16} className="mt-0.5 shrink-0 text-accent" />
      <span>{children}</span>
    </li>
  );
}

function FeedbackSection({ email }: { email?: string }) {
  const [form, setForm] = useState({ name: '', email: '', message: '' });
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    try {
      const r = await fetch(`${getApiBase()}/api/public/feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      }).then((x) => x.json());
      if (r.ok) { setSent(true); setForm({ name: '', email: '', message: '' }); }
      else setErr(r.error?.message ?? 'Could not send');
    } catch { setErr('Network error'); }
  }

  return (
    <section className="max-w-2xl mx-auto px-6 py-16 sm:py-20 border-t border-border">
      <div className="text-center mb-8">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Feedback &amp; support</h2>
        <p className="mt-3 text-muted">Questions or ideas? Tell us — we read everything.{email && <> Or email <a className="text-accent hover:underline" href={`mailto:${email}`}>{email}</a>.</>}</p>
      </div>
      {sent ? (
        <div className="card flex items-center justify-center gap-2 py-8 text-accent">
          <CheckCircle2 size={18} /> Thanks for your feedback — we&apos;ll be in touch.
        </div>
      ) : (
        <form onSubmit={submit} className="card space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <input className="input" placeholder="Your name" value={form.name} onChange={set('name')} required />
            <input className="input" placeholder="Your email" type="email" value={form.email} onChange={set('email')} required />
          </div>
          <textarea className="input min-h-28" placeholder="Your message…" value={form.message} onChange={set('message')} required />
          {err && <p className="text-danger text-sm">{err}</p>}
          <button className="btn w-full">Send feedback</button>
        </form>
      )}
    </section>
  );
}
