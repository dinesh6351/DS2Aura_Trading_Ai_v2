'use client';

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

/** Read the theme currently applied to <html> (set pre-paint by the inline script). */
export function getTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** Apply + persist a theme and notify subscribers (charts, TradingView, toggles). */
export function setTheme(t: Theme): void {
  const d = document.documentElement;
  d.classList.toggle('dark', t === 'dark');
  d.style.colorScheme = t;
  try { localStorage.setItem('theme', t); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('themechange', { detail: t }));
}

/** Resolve token colors (for libraries like recharts/TradingView that need hex/rgb). */
export function themeColors(theme: Theme) {
  return theme === 'dark'
    ? { fg: '#e6edf3', muted: '#97a3b2', border: '#272e38', surface: '#161b22', accent: '#34d399', danger: '#f87171', tvTheme: 'dark' as const }
    : { fg: '#0f172a', muted: '#64748b', border: '#e2e8f0', surface: '#ffffff', accent: '#059669', danger: '#dc2626', tvTheme: 'light' as const };
}

/** Subscribe to the active theme; re-renders on toggle via the `themechange` event. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>('dark');
  useEffect(() => {
    setThemeState(getTheme());
    const on = () => setThemeState(getTheme());
    window.addEventListener('themechange', on);
    return () => window.removeEventListener('themechange', on);
  }, []);
  const update = useCallback((t: Theme) => setTheme(t), []);
  return [theme, update];
}
