import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DS2AuraTrading AI — Automated Crypto Trading',
  description: 'Multi-user automated crypto trading on your own Binance account',
};

/**
 * Sets the theme class on <html> BEFORE first paint to avoid a flash of the wrong
 * theme. Reads a saved choice, else falls back to the OS preference. Kept inline
 * (not a component) so it runs synchronously ahead of hydration.
 */
const themeScript = `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}var d=document.documentElement;d.classList.toggle('dark',t==='dark');d.style.colorScheme=t;}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Inter loaded at runtime (non-blocking) — falls back to the system sans
            stack if Google Fonts is unreachable, so the build never depends on it. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
