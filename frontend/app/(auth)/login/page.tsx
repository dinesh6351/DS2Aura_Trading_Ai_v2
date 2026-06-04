'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setAccessToken } from '@/lib/api';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const data = await api.post<{ user: { role: string }; accessToken: string }>(
        '/api/auth/login', { email, password, totp: totp || undefined });
      setAccessToken(data.accessToken);
      router.push(data.user.role === 'ADMIN' ? '/admin' : '/dashboard');
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('2FA')) setNeeds2fa(true);
      setError(msg);
    } finally { setLoading(false); }
  }

  return (
    <main className="min-h-screen grid place-items-center p-6 bg-bg">
      <div className="absolute top-4 right-4"><ThemeToggle /></div>
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="grid place-items-center h-8 w-8 rounded-lg bg-accent text-[rgb(var(--accent-fg))] text-sm font-bold">A</span>
            <h1 className="text-lg font-semibold tracking-tight">Welcome back</h1>
          </div>
          <p className="text-sm text-muted">Sign in to your account</p>
        </div>
        <div className="space-y-3">
          <input className="input" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="input" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {needs2fa && (
            <input className="input" placeholder="2FA code" value={totp} onChange={(e) => setTotp(e.target.value)} />
          )}
        </div>
        {error && <p className="text-danger text-sm">{error}</p>}
        <button className="btn w-full" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        <a href="/register" className="block text-center text-muted text-sm hover:text-accent transition-colors">Create account</a>
      </form>
    </main>
  );
}
