'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setAccessToken } from '@/lib/api';
import { COUNTRIES } from '@/lib/countries';
import { ThemeToggle } from '@/components/ThemeToggle';

const FIELDS: { k: 'fullName' | 'email' | 'mobile'; label: string; type?: string; required?: boolean }[] = [
  { k: 'fullName', label: 'Full name', required: true },
  { k: 'email', label: 'Email', type: 'email', required: true },
  { k: 'mobile', label: 'Mobile (optional)' },
];

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ fullName: '', email: '', mobile: '', country: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const data = await api.post<{ accessToken: string }>('/api/auth/register', form);
      setAccessToken(data.accessToken);
      router.push('/onboarding');
    } catch (err) { setError((err as Error).message); } finally { setLoading(false); }
  }

  return (
    <main className="min-h-screen grid place-items-center p-6 bg-bg">
      <div className="absolute top-4 right-4"><ThemeToggle /></div>
      <form onSubmit={submit} className="card w-full max-w-md space-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center h-8 w-8 rounded-lg bg-accent text-[rgb(var(--accent-fg))] text-sm font-bold">A</span>
            <h1 className="text-lg font-semibold tracking-tight">Create your account</h1>
          </div>
          <p className="text-sm text-muted">Start your 30-day free trial — no card required.</p>
        </div>
        <div className="space-y-3">
          {FIELDS.map((f) => (
            <input key={f.k} className="input" placeholder={f.label} type={f.type ?? 'text'}
              value={form[f.k]} onChange={set(f.k)} required={f.required} />
          ))}
          <select className="select" value={form.country}
            onChange={(e) => setForm({ ...form, country: e.target.value })} required>
            <option value="">Select your country…</option>
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input className="input" placeholder="Password" type="password" value={form.password} onChange={set('password')} required />
        </div>
        {error && <p className="text-danger text-sm">{error}</p>}
        <button className="btn w-full" disabled={loading}>{loading ? 'Creating…' : 'Create account'}</button>
        <a href="/login" className="block text-center text-muted text-sm hover:text-accent transition-colors">Have an account? Sign in</a>
      </form>
    </main>
  );
}
