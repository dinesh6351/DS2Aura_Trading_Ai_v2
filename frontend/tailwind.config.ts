import type { Config } from 'tailwindcss';

/**
 * Design tokens are CSS variables (space-separated RGB triplets) defined in
 * globals.css for :root (light) and .dark (dark). Mapping them through
 * `rgb(var(--x) / <alpha-value>)` keeps every existing class (bg-bg, text-accent,
 * bg-panel, text-muted, border-border, …) working AND theme-aware, and still lets
 * Tailwind opacity modifiers like `border-border/70` resolve correctly.
 */
const token = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('--bg'),
        panel: token('--surface'),
        surface: token('--surface'),
        surface2: token('--surface-2'),
        border: token('--border'),
        fg: token('--fg'),
        muted: token('--muted'),
        accent: token('--accent'),
        danger: token('--danger'),
        warn: token('--warn'),
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem' },
      boxShadow: {
        // One soft, subtle elevation tier — used by .card. No heavy/neon shadows.
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        pop: '0 4px 16px -2px rgb(15 23 42 / 0.12), 0 2px 6px -2px rgb(15 23 42 / 0.08)',
      },
    },
  },
  plugins: [],
} satisfies Config;
