import { formatINR } from '@arriveshare/shared';
import { ArrowRight, Bus, Leaf, PiggyBank, Plane, Route, ShieldAlert, Star, TrainFront } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, DashboardHero, MAIN_GRID, SectionTitle, Stat, StatGrid } from '@/components/ui/primitives';
import { RideStatusBadge } from '@/components/ui/StatusBadge';
import { useContacts, useRides, useStations } from '@/hooks/queries';
import { fmtDateTime, greeting } from '@/lib/utils';
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

  return (
    <div className="space-y-6">
      <DashboardHero
        eyebrow={`${greeting()}, ${user.name.split(' ')[0]} 👋`}
        title={
          <>
            Landed? Let’s get you <span className="sm:block">home together.</span>
          </>
        }
        chips={['Verified drivers', 'PIN pickup', 'Live trip sharing', 'Silent SOS']}
        action={
          !active && (
            <Link to="/book">
              <Button size="lg" variant="light" className="w-full md:w-auto" icon={<ArrowRight className="h-5 w-5" />}>
                Book a shared ride
              </Button>
            </Link>
          )
        }
      />

      {contacts && contacts.length === 0 && (
        <Link to="/safety" className="flex items-center gap-3 rounded-2xl border border-safe-200 bg-safe-50 p-4 text-sm">
          <ShieldAlert className="h-6 w-6 shrink-0 text-safe-600" />
          <div className="flex-1">
            <div className="font-bold text-safe-700">Add a trusted contact</div>
            <div className="text-slate-600">They’ll get your live trip link and SOS alerts.</div>
          </div>
          <ArrowRight className="h-5 w-5 text-safe-600" />
        </Link>
      )}

      {active && (
        <Link to={`/rides/${active.id}`}>
          <Card className="flex items-center gap-4 border-0 bg-gradient-to-r from-brand-600 to-brand-700 p-5 text-white">
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

      <StatGrid>
        <Stat label="Saved" value={formatINR(saved)} hint="vs solo cabs" icon={<PiggyBank className="h-4 w-4 text-emerald-600" />} />
        <Stat label="Shared trips" value={done.length} hint="completed" icon={<Route className="h-4 w-4 text-brand-600" />} />
        <Stat label="CO₂ avoided" value={`${(km * 0.12 * 0.5).toFixed(1)} kg`} hint="estimated" icon={<Leaf className="h-4 w-4 text-emerald-600" />} />
        <Stat label="Your rating" value={user.ratingAvg?.toFixed(1) ?? '—'} hint={`${user.ratingCount} reviews`} icon={<Star className="h-4 w-4 text-amber-500" />} />
      </StatGrid>

      <div className={MAIN_GRID}>
        <section>
          <SectionTitle>{active ? 'Other hubs' : 'Book from a hub'}</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {stations.map((s) => (
              <Link key={s.id} to={`/book?station=${s.id}`}>
                <Card className="flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-lg">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-50 to-safe-50 text-brand-600 ring-1 ring-indigo-100">{hubIcon(s.type)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">{s.name}</div>
                    <div className="text-xs uppercase text-slate-500">
                      {s.code} · {s.city}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </Card>
              </Link>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle action={<Link to="/rides" className="text-sm font-semibold text-brand-600">See all</Link>}>Recent rides</SectionTitle>
          {rides.length === 0 ? (
            <Card className="p-6 text-center">
              <p className="text-sm text-slate-500">No rides yet. Your first shared ride is a tap away.</p>
              <Link to="/book">
                <Button className="mt-4">Book a ride</Button>
              </Link>
            </Card>
          ) : (
            <div className="space-y-3">
              {rides.slice(0, 5).map((r) => (
                <Link key={r.id} to={`/rides/${r.id}`} className="block">
                  <Card className="flex items-center justify-between gap-3 p-4 transition hover:shadow-lg">
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
    </div>
  );
}
