import type { Role } from '@arriveshare/shared';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { PageLoader } from '@/components/ui/primitives';
import { useAuth } from '@/store/auth';

export const homeFor = (role: Role) => (role === 'driver' ? '/driver' : role === 'admin' ? '/admin' : '/');

/** Requires a session (and optionally a role); unfinished profiles go to onboarding. */
export function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { ready, user } = useAuth();
  const loc = useLocation();
  if (!ready) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (!user.onboarded && loc.pathname !== '/onboarding' && user.role === 'rider') return <Navigate to="/onboarding" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const { ready, user } = useAuth();
  if (!ready) return <PageLoader />;
  if (user) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}
