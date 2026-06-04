import { AuthGuard } from '@/components/AuthGuard';

/** All /dashboard, /chart, /settings, /onboarding routes require a valid session. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard>{children}</AuthGuard>;
}
