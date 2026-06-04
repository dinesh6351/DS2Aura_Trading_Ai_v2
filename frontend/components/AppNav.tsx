'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LogOut, Menu, X } from 'lucide-react';
import { api, setAccessToken, getApiBase } from '@/lib/api';
import { ThemeToggle } from '@/components/ThemeToggle';

/** Shared top navigation for the authenticated app (dashboard, chart, admin).
 *  Horizontal links on desktop; a slide-down sheet on phones. */
export function AppNav({ active }: { active?: 'dashboard' | 'chart' | 'settings' | 'admin' }) {
  const [brand, setBrand] = useState<{ appName: string; logoUrl: string }>();
  const [role, setRole] = useState<string>();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch(`${getApiBase()}/api/public/branding`).then((r) => r.json()).then((j) => j.ok && setBrand(j.data)).catch(() => {});
    api.get<{ role: string }>('/api/me').then((m) => setRole(m.role)).catch(() => {});
  }, []);

  async function logout() {
    await api.post('/api/auth/logout').catch(() => {});
    setAccessToken(null);
    window.location.href = '/'; // session finished → public home page
  }

  const items = [
    { href: '/dashboard', label: 'Dashboard', key: 'dashboard' },
    { href: '/chart/BTCUSDT', label: 'Charts', key: 'chart' },
    { href: '/settings', label: 'Profile', key: 'settings' },
    ...(role === 'ADMIN' ? [{ href: '/admin', label: 'Admin', key: 'admin' }] : []),
  ];
  const cls = (key: string, block = false) =>
    `${block ? 'block ' : ''}px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
      active === key ? 'bg-accent/10 text-accent' : 'text-muted hover:text-fg hover:bg-surface2'
    }`;

  return (
    <nav className="sticky top-0 z-30 border-b border-border bg-surface/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 px-3 sm:px-4 h-14">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold text-fg shrink-0 min-w-0">
          {brand?.logoUrl
            ? <img src={brand.logoUrl} alt="" className="h-7 w-auto rounded shrink-0" />
            : <span className="grid place-items-center h-7 w-7 rounded-lg bg-accent text-[rgb(var(--accent-fg))] text-sm font-bold">A</span>}
          <span className="truncate max-w-[52vw] sm:max-w-none tracking-tight">{brand?.appName ?? 'DS2AuraTrading AI'}</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden sm:flex items-center gap-1">
          {items.map((i) => <Link key={i.key} href={i.href} className={cls(i.key)}>{i.label}</Link>)}
          <span className="mx-1 h-6 w-px bg-border" />
          <ThemeToggle />
          <button onClick={logout} className="ml-1 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-muted hover:text-danger hover:bg-danger/10 transition-colors">
            <LogOut size={15} /> Logout
          </button>
        </div>

        {/* Mobile controls */}
        <div className="flex items-center gap-2 sm:hidden">
          <ThemeToggle />
          <button onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}
            className="grid place-items-center h-9 w-9 shrink-0 rounded-lg border border-border bg-surface text-fg">
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {open && (
        <div className="sm:hidden border-t border-border bg-surface px-3 py-2 space-y-1">
          {items.map((i) => <Link key={i.key} href={i.href} className={cls(i.key, true)} onClick={() => setOpen(false)}>{i.label}</Link>)}
          <button onClick={logout} className="flex w-full items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-danger hover:bg-danger/10 transition-colors">
            <LogOut size={15} /> Logout
          </button>
        </div>
      )}
    </nav>
  );
}
