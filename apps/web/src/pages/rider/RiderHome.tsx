import { formatINR } from '@arriveshare/shared';
import { ArrowRight, Leaf, PiggyBank, Plane, ShieldAlert, TrainFront, Bus, Route } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, SectionTitle, Stat } from '@/components/ui/primitives';
import { RideStatusBadge } from '@/components/ui/StatusBadge';
import { useContacts, useRides, useStations } from '@/hooks/queries';
import { fmtDateTime } from '@/lib/utils';
import { useAuth } from '@/store/auth';

const hubIcon = (t: string) => (t === 'airport' ? <Plane className="h-4 w-4" /> : t === 'bus' ? <Bus className="h-4 w-4" /> : <TrainFront className="h-4 w-4" />);

export default function RiderHome() {
  const user = useAuth((s) => s.user)!;
  const { data: rides = [] } = useRides('all');
  const { data: stations = [] } = useStations();
  const { data: contacts } = useContacts();

  const active = rides.find((r) => ['pending', 'matched', 'confirmed', 'picked_up'].includes(r.status));
  const done = rides.filter((r) => r.status === 'completed');
  const saved = done.reduce((s, r) => s + (r.savings ?? 0), 0);
  const km = done.reduce((s, r) => s + r.soloKm, 0);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-indigo-500 to-safe-500 p-6 text-white shadow-xl shadow-brand-600/25 sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/15 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 left-1/3 h-56 w-56 rounded-full bg-sky-300/30 blur-3xl" />
        <div className="relative grid items-center gap-6 md:grid-cols-[1fr_auto]">
          <div>
            <p className="text-sm font-semibold text-white/80">{greet}, {user.name.split(' ')[0]} 👋</p>
            <h1 className="mt-1 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
              Landed? Let’s get you <span className="sm:block">home together.</span>
            </h1>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
              {['Verified drivers', 'PIN pickup', 'Live trip sharing', 'Silent SOS'].map((t) => (
                <span key={t} className="rounded-full bg-white/15 px-3 py-1 ring-1 ring-white/25 backdrop-blur">
                  {t}
                </span>
              ))}
            </div>
          </div>
          {!active && (
            <Link to="/book">
              <Button size="lg" variant="light" className="w-full md:w-auto" icon={<ArrowRight className="h-5 w-5" />}>
                Book a shared ride
              </Button>
            </Link>
          )}
        </div>
      </section>

      {contacts && contacts.length === 0 && (
        <Link to="/safety" className="flex items-center gap-3 rounded-2xl border border-safe-200 bg-safe-50 p-4 text-sm dark:border-safe-500/20 dark:bg-safe-500/10">
          <ShieldAlert className="h-6 w-6 shrink-0 text-safe-600" />
          <div className="flex-1">
            <div className="font-bold text-safe-700 dark:text-safe-400">Add a trusted contact</div>
            <div className="text-slate-600 dark:text-slate-300">They’ll get your live trip link and SOS alerts.</div>
          </div>
          <ArrowRight className="h-5 w-5 text-safe-600" />
        </Link>
      )}

      {active && (
        <Link to={`/rides/${active.id}`}>
          <Card className="flex items-center gap-4 border-brand-200 bg-gradient-to-r from-brand-600 to-brand-700 p-5 text-white dark:border-brand-500/30">
            <div className="flex-1">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-white/70">Current ride</div>
              <div className="font-bold">
                {active.station.name} → {active.destinationLabel.split(',')[0]}
              </div>
              <div className="mt-2">
                <RideStatusBadge status={active.status} />
              </div>
            </div>
            <ArrowRight className="h-6 w-6" />
          </Card>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Saved" value={formatINR(saved)} icon={<PiggyBank className="h-4 w-4 text-emerald-600" />} hint="vs solo cabs" />
        <Stat label="Shared trips" value={done.length} icon={<Route className="h-4 w-4 text-brand-600" />} />
        <Stat label="CO₂ avoided" value={`${(km * 0.12 * 0.5).toFixed(1)} kg`} icon={<Leaf className="h-4 w-4 text-emerald-600" />} hint="estimated" />
        <Stat label="Your rating" value={user.ratingAvg?.toFixed(1) ?? '—'} hint={`${user.ratingCount} reviews`} />
      </div>

      {!active && (
        <section>
          <SectionTitle>Book from a hub</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {stations.map((s) => (
              <Link key={s.id} to={`/book?station=${s.id}`}>
                <Card className="flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:border-brand-300">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-500/10">{hubIcon(s.type)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{s.name}</div>
                    <div className="text-xs uppercase text-slate-500">
                      {s.code} · {s.type}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle action={<Link to="/rides" className="text-sm font-semibold text-brand-600">See all</Link>}>Recent</SectionTitle>
        {rides.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-slate-500">No rides yet. Your first shared ride is a tap away.</p>
            <Link to="/book">
              <Button className="mt-4">Book a ride</Button>
            </Link>
          </Card>
        ) : (
          <div className="space-y-2">
            {rides.slice(0, 4).map((r) => (
              <Link key={r.id} to={`/rides/${r.id}`}>
                <Card className="mb-2 flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{r.destinationLabel.split(',')[0]}</div>
                    <div className="text-xs text-slate-500">
                      {r.station.code} · {fmtDateTime(r.arrivalAt)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold">{formatINR(r.finalFare ?? r.acceptedFare ?? r.quotedFare ?? r.soloFare)}</div>
                    <RideStatusBadge status={r.status} />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
