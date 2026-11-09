import type { UserDto } from '@arriveshare/shared';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, Car, Mail, ShieldCheck, User, UserCog } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { homeFor } from '@/components/layout/Guards';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/primitives';
import { useConfig } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/store/auth';

type Session = { accessToken: string; user: UserDto };

export default function Login() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [devCode, setDevCode] = useState<string | null>(null);
  const setSession = useAuth((s) => s.setSession);
  const nav = useNavigate();
  const loc = useLocation();
  const { data: config } = useConfig();
  const from = (loc.state as { from?: string } | null)?.from ?? new URLSearchParams(loc.search).get('next') ?? undefined;

  const finish = (s: Session) => {
    setSession(s.accessToken, s.user);
    toast.success(`Welcome, ${s.user.name.split(' ')[0]}!`);
    nav(!s.user.onboarded && s.user.role === 'rider' ? '/onboarding' : from ?? homeFor(s.user.role), { replace: true });
  };

  const request = useMutation({
    mutationFn: () => api.post<{ delivered: boolean; devCode?: string }>('/auth/otp/request', { email }),
    onSuccess: (r) => {
      setStep('code');
      setDevCode(r.devCode ?? null);
      toast.success(r.delivered ? 'Code sent — check your inbox' : 'Code generated (demo mode)');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const verify = useMutation({
    mutationFn: (c: string) => api.post<Session>('/auth/otp/verify', { email, code: c }),
    onSuccess: finish,
    onError: (e) => {
      setCode('');
      toast.error(errorMessage(e));
    },
  });

  const demo = useMutation({
    mutationFn: (as: 'rider' | 'rider2' | 'driver' | 'admin') => api.post<Session>('/auth/demo', { as }),
    onSuccess: finish,
    onError: (e) => toast.error(errorMessage(e)),
  });

  // Demo deep link: /login?demo=rider (or rider2, driver, admin) signs straight in.
  const [params] = useSearchParams();
  const demoAs = params.get('demo');
  const tried = useRef(false);
  useEffect(() => {
    if (!config?.demoMode || tried.current) return;
    if (demoAs === 'rider' || demoAs === 'rider2' || demoAs === 'driver' || demoAs === 'admin') {
      tried.current = true;
      demo.mutate(demoAs);
    }
  }, [config?.demoMode, demoAs, demo]);

  return (
    <div className="pt-safe flex min-h-screen flex-col ">
      <div className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <Link to="/" className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 dark:text-slate-400">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <div className="mb-6 flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-12 w-12" />
          <div>
            <h1 className="text-2xl font-extrabold">Sign in to ArriveShare</h1>
            <p className="text-sm text-slate-500">No passwords. We’ll email you a 6-digit code.</p>
          </div>
        </div>

        <Card className="p-5">
          {step === 'email' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                request.mutate();
              }}
              className="space-y-4"
            >
              <div>
                <label className="label" htmlFor="email">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input
                    id="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    className="input pl-12"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>
              <Button type="submit" size="lg" block loading={request.isPending}>
                Send code
              </Button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                verify.mutate(code);
              }}
              className="space-y-4"
            >
              <div>
                <label className="label" htmlFor="code">Enter the code sent to {email}</label>
                <input
                  id="code"
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  className="input text-center text-2xl font-bold tracking-[0.6em]"
                  value={code}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setCode(v);
                    if (v.length === 6) verify.mutate(v);
                  }}
                />
              </div>
              {devCode && (
                <button type="button" onClick={() => { setCode(devCode); verify.mutate(devCode); }} className="w-full rounded-xl border border-dashed border-brand-300 bg-brand-50 p-3 text-sm text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
                  Demo mode — your code is <b className="tracking-widest">{devCode}</b>. Tap to autofill.
                </button>
              )}
              <Button type="submit" size="lg" block loading={verify.isPending} disabled={code.length !== 6}>
                Verify & continue
              </Button>
              <button type="button" onClick={() => setStep('email')} className="w-full text-sm font-semibold text-slate-500">
                Use a different email
              </button>
            </form>
          )}
        </Card>

        {config?.demoMode && (
          <div className="mt-6">
            <div className="mb-3 text-center text-xs font-bold uppercase tracking-wide text-slate-500">or try a demo account</div>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['rider', 'Priya · rider', <User key="r" className="h-4 w-4" />],
                  ['rider2', 'Arjun · rider', <User key="r2" className="h-4 w-4" />],
                  ['driver', 'Ravi · driver', <Car key="d" className="h-4 w-4" />],
                  ['admin', 'Safety ops', <UserCog key="a" className="h-4 w-4" />],
                ] as const
              ).map(([as, label, icon]) => (
                <Button key={as} variant="secondary" icon={icon} loading={demo.isPending && demo.variables === as} onClick={() => demo.mutate(as)}>
                  {label}
                </Button>
              ))}
            </div>
          </div>
        )}

        <p className="mt-8 flex items-start gap-2 text-xs text-slate-500">
          <ShieldCheck className="h-4 w-4 shrink-0 text-safe-600" />
          ArriveShare staff will never ask for your sign-in code or your ride PIN.
        </p>
      </div>
    </div>
  );
}
