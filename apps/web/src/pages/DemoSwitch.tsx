import type { UserDto } from '@arriveshare/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { homeFor } from '@/components/layout/Guards';
import { Button } from '@/components/ui/Button';
import { EmptyState, PageLoader } from '@/components/ui/primitives';
import { useConfig } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/store/auth';

const ACCOUNTS = ['rider', 'rider2', 'driver', 'admin'] as const;
type DemoAs = (typeof ACCOUNTS)[number];

/**
 * Demo-mode account switcher: /demo/rider, /demo/driver, /demo/admin (optional ?next=/path).
 * Works even when already signed in, so a presenter can hop between roles.
 */
export default function DemoSwitch() {
  const { as } = useParams();
  const [params] = useSearchParams();
  const { data: config, isLoading } = useConfig();
  const setSession = useAuth((s) => s.setSession);
  // Wait for the boot-time session restore, otherwise it could overwrite the new demo session.
  const ready = useAuth((s) => s.ready);
  const qc = useQueryClient();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!ready || !config?.demoMode || started.current || !ACCOUNTS.includes(as as DemoAs)) return;
    started.current = true;
    api
      .post<{ accessToken: string; user: UserDto }>('/auth/demo', { as })
      .then((s) => {
        qc.clear();
        setSession(s.accessToken, s.user);
        nav(params.get('next') ?? homeFor(s.user.role), { replace: true });
      })
      .catch((e) => setError(errorMessage(e)));
  }, [ready, config?.demoMode, as, params, qc, setSession, nav]);

  if (isLoading) return <PageLoader />;
  if (!config?.demoMode || !ACCOUNTS.includes(as as DemoAs) || error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <EmptyState
          icon={<span className="text-2xl">🔒</span>}
          title={error ?? 'Demo accounts are not available'}
          body="Demo switching only works when the server runs with DEMO_MODE=true."
          action={
            <Link to="/login">
              <Button>Go to sign in</Button>
            </Link>
          }
        />
      </div>
    );
  }
  return <PageLoader />;
}
