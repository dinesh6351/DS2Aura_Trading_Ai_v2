'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ensureSession } from '@/lib/api';

/**
 * Gates the authenticated app. It only bounces to the public home page when the
 * server CONFIRMS there is no session (logged out / expired) — a transient
 * network hiccup keeps you on the page, and an in-memory token (client-side
 * navigation) passes instantly. So clicking Charts/Profile/Admin while logged in
 * never throws you home; only a finished session does. `requireAdmin` adds an
 * ADMIN-role check on top.
 */
export function AuthGuard({ children, requireAdmin = false }: { children: React.ReactNode; requireAdmin?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<'checking' | 'ok'>('checking');

  useEffect(() => {
    let alive = true;
    (async () => {
      const session = await ensureSession();
      if (!alive) return;
      if (session === 'none') { router.replace('/'); return; } // confirmed logged out → home
      // 'valid' or 'error' (ambiguous): render the page. For admin routes verify
      // the role, but a failed role check never bounces a valid session home.
      if (requireAdmin) {
        try {
          const me = await api.get<{ role: string }>('/api/me');
          if (!alive) return;
          if (me.role !== 'ADMIN') { router.replace('/dashboard'); return; }
        } catch { /* best-effort; keep the valid session on the page */ }
      }
      if (alive) setState('ok');
    })();
    return () => { alive = false; };
  }, [requireAdmin, router]);

  if (state === 'checking') {
    return (
      <main className="min-h-screen grid place-items-center text-muted">
        <div className="animate-pulse text-sm">Loading…</div>
      </main>
    );
  }
  return <>{children}</>;
}
