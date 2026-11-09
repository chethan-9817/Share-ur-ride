import { ArrowRight, BadgeIndianRupee, Leaf, MapPinned, Moon, Route, ShieldCheck, Sparkles, UserCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/hooks/useTheme';

const features = [
  { icon: <Users />, title: 'Women-only pools', body: 'Ride only with verified women co-riders, with female drivers offered first.' },
  { icon: <ShieldCheck />, title: 'Silent SOS', body: 'Hold to alert our safety team and your family. Your driver is never notified.' },
  { icon: <MapPinned />, title: 'Live trip sharing', body: 'Family follows your cab in real time — no app needed on their side.' },
  { icon: <Route />, title: 'Route watch', body: 'Detours, long stops and speeding trigger an "Are you okay?" check-in.' },
  { icon: <UserCheck />, title: 'PIN-verified pickup', body: 'Your 4-digit PIN proves you are in the right cab with the right driver.' },
  { icon: <Moon />, title: 'Night-ride check-ins', body: 'Gentle check-ins on late-night trips, escalated if you don’t respond.' },
];

export default function Landing() {
  const { theme, toggle } = useTheme();
  return (
    <div className="min-h-screen bg-white dark:bg-ink-950">
      <header className="pt-safe mx-auto flex max-w-6xl items-center justify-between px-4 py-4 lg:px-8">
        <div className="flex items-center gap-2 text-lg font-extrabold">
          <img src="/icon.svg" alt="" className="h-8 w-8" /> ArriveShare
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggle} className="rounded-full px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10">
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <Link to="/login">
            <Button size="sm">Sign in</Button>
          </Link>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-6 lg:grid-cols-2 lg:px-8 lg:pt-16">
        <div>
          <span className="chip bg-safe-100 text-safe-700 dark:bg-safe-500/15 dark:text-safe-400">
            <Sparkles className="h-3.5 w-3.5" /> Built safety-first for women travellers
          </span>
          <h1 className="mt-4 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            Landed? Share the cab home.{' '}
            <span className="bg-gradient-to-r from-brand-600 to-safe-600 bg-clip-text text-transparent">Pay up to 60% less.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-slate-600 dark:text-slate-400">
            ArriveShare pools travellers arriving at the same airport or railway station and heading the same way — with fair,
            transparent fares, verified drivers and real-time safety tools.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/login">
              <Button size="lg" icon={<ArrowRight className="h-5 w-5" />} className="w-full sm:w-auto">
                Book a shared ride
              </Button>
            </Link>
            <Link to="/login?as=driver">
              <Button size="lg" variant="secondary" className="w-full sm:w-auto">
                Drive with us
              </Button>
            </Link>
          </div>
          <div className="mt-8 grid max-w-md grid-cols-3 gap-4 text-center">
            {[
              ['≤ 30%', 'max detour'],
              ['₹0', 'surge pricing'],
              ['24×7', 'safety desk'],
            ].map(([v, l]) => (
              <div key={l}>
                <div className="text-2xl font-extrabold">{v}</div>
                <div className="text-xs text-slate-500">{l}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card relative overflow-hidden p-6">
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-brand-500/20 blur-3xl" />
          <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-safe-500/20 blur-3xl" />
          <div className="relative space-y-4">
            <div className="text-sm font-semibold text-slate-500">Example · BLR Airport → Indiranagar</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-slate-100 p-4 dark:bg-white/5">
                <div className="text-xs text-slate-500">Solo cab</div>
                <div className="text-2xl font-extrabold line-through decoration-red-500/70">₹465</div>
              </div>
              <div className="rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-500/10">
                <div className="text-xs text-emerald-700 dark:text-emerald-300">Shared with 2</div>
                <div className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-300">₹188</div>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              {[
                [<BadgeIndianRupee key="i" className="h-4 w-4" />, 'Base fare charged once per cab, split by distance'],
                [<ShieldCheck key="s" className="h-4 w-4" />, 'Price locked when you accept — never goes up'],
                [<Leaf key="l" className="h-4 w-4" />, '6.8 kg CO₂ saved on this trip'],
              ].map(([icon, text], i) => (
                <div key={i} className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <span className="text-brand-600">{icon}</span>
                  {text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-slate-50 py-16 dark:bg-ink-900">
        <div className="mx-auto max-w-6xl px-4 lg:px-8">
          <h2 className="text-center text-3xl font-extrabold tracking-tight">Safety isn’t a feature. It’s the foundation.</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-slate-600 dark:text-slate-400">
            Late-night arrivals and shared cars with strangers deserve more than a panic button.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="card p-5">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-safe-100 text-safe-600 dark:bg-safe-500/15">{f.icon}</div>
                <div className="font-bold">{f.title}</div>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 lg:px-8">
        <h2 className="text-center text-3xl font-extrabold tracking-tight">How it works</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {[
            ['1', 'Tell us your arrival', 'Pick your hub, drop a pin for home and how long you can wait.'],
            ['2', 'Get matched in minutes', 'We pool riders on the same corridor and lock your fare when you accept.'],
            ['3', 'Ride verified & tracked', 'Check the plate, share your PIN, and let family follow you home.'],
          ].map(([n, t, b]) => (
            <div key={n} className="flex gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 font-bold text-white">{n}</div>
              <div>
                <div className="font-bold">{t}</div>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{b}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-slate-200 py-8 text-center text-sm text-slate-500 dark:border-white/5">
        ArriveShare · Emergency? Call <a className="font-semibold text-red-600" href="tel:112">112</a> · Women helpline{' '}
        <a className="font-semibold text-safe-600" href="tel:1091">1091</a>
      </footer>
    </div>
  );
}
