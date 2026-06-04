import { AuthGuard } from '@/components/AuthGuard';

/** /admin requires a valid session AND the ADMIN role. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard requireAdmin>{children}</AuthGuard>;
}
