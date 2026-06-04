// Backend origin the production frontend proxies /api/* to (see rewrites below).
// Defaults to the deployed Railway backend so no env var is required in prod;
// falls back to the local backend in dev.
const BACKEND_ORIGIN =
  process.env.BACKEND_ORIGIN ||
  (process.env.NODE_ENV === 'production'
    ? 'https://ds2auratradingai-production.up.railway.app'
    : 'http://localhost:4000');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@platform/shared'],
  // Allow Next's dev HMR/asset (/_next/*) requests when the app is opened via a
  // LAN IP instead of localhost (e.g. from a phone on the same Wi-Fi). Add your
  // machine's LAN IP here if it differs. Harmless in production.
  allowedDevOrigins: ['192.168.0.201', '192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12'],
  // NOTE: do NOT inject a NEXT_PUBLIC_API_URL fallback here. Baking in
  // 'http://localhost:4000' forces every browser (even one opened at
  // 127.0.0.1 or a LAN IP) to call localhost, which makes the SameSite=Lax
  // refresh cookie cross-site and bounces users to /login on reload. When the
  // var is unset, the client derives the API base from the page's own host
  // (see getApiBase in lib/api.ts).
  //
  // Proxy /api/* to the backend so the browser only ever talks to THIS origin.
  // This keeps the auth refresh cookie first-party — critical in production
  // where the frontend and backend are on different *.up.railway.app subdomains
  // (a cross-site cookie gets blocked by the browser → "Authentication required"
  // on every reload). In dev the client calls :4000 directly, so this is unused.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${BACKEND_ORIGIN}/api/:path*` }];
  },
};
export default nextConfig;
