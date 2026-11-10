import { bearingDeg, formatINR, interpolatePolyline, type LatLng } from '@arriveshare/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Crosshair, Power, Route, ShieldCheck, Star, Users, Wallet } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LiveMap, type MapStop } from '@/components/map/LiveMap';
import { Button } from '@/components/ui/Button';
import { Badge, Card, DASH_MAP, DashboardHero, MAIN_GRID, MapCard, PageLoader, SectionTitle, Stat, StatGrid } from '@/components/ui/primitives';
import { Toggle } from '@/components/ui/Toggle';
import { qk, useConfig, useDriverMe, useDriverTrip, useEarnings, useOffer } from '@/hooks/queries';
import { useWatchPosition, type GeoFix } from '@/hooks/useGeolocation';
import { ApiError, api, errorMessage } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { cn, greeting } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { OfferSheet } from './components/OfferSheet';
import { TripPanel } from './components/TripPanel';

const SEND_EVERY_MS = 4000;

export default function DriverHome() {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user)!;
  const { data: config } = useConfig();
  const me = useDriverMe();
  const online = me.data?.status === 'online' || me.data?.status === 'busy';
  const { data: offer } = useOffer(me.data?.status === 'online');
  const { data: trip } = useDriverTrip();
  const { data: earnings } = useEarnings();
  const [useGps, setUseGps] = useState(!config?.demoMode);
  const [simulating, setSimulating] = useState(false);
  const [pos, setPos] = useState<LatLng & { heading?: number | null } | null>(null);
  const lastSent = useRef(0);

  useEffect(() => {
    if (config) setUseGps(!config.demoMode);
  }, [config]);
  useEffect(() => {
    if (me.data?.location && !pos) setPos(me.data.location);
  }, [me.data, pos]);

  const push = useCallback((p: LatLng & { heading?: number | null; speedKmh?: number | null; accuracyM?: number | null }) => {
    setPos(p);
    if (Date.now() - lastSent.current < SEND_EVERY_MS) return;
    lastSent.current = Date.now();
    getSocket().emit('driver:location:push', {
      lat: p.lat,
      lng: p.lng,
      heading: p.heading ?? null,
      speedKmh: p.speedKmh ?? null,
      accuracyM: p.accuracyM ?? null,
    });
  }, []);

  const gps = useWatchPosition(online && useGps && !simulating, (f: GeoFix) => push(f));

  // Demo helper: drive the current route from the browser so riders see live movement.
  useEffect(() => {
    if (!simulating || !trip) return;
    const pts = trip.status === 'on_trip' ? trip.route : [pos ?? trip.station, trip.station];
    if (pts.length < 2) return;
    let t = 0;
    const id = setInterval(() => {
      t = Math.min(1, t + (trip.status === 'on_trip' ? 0.02 : 0.1));
      const p = interpolatePolyline(pts, t);
      const ahead = interpolatePolyline(pts, Math.min(1, t + 0.01));
      lastSent.current = 0;
      push({ ...p, heading: bearingDeg(p, ahead), speedKmh: 35 });
      if (t >= 1) setSimulating(false);
    }, 2000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulating, trip?.status, trip?.id]);

  const toggle = useMutation({
    mutationFn: (next: boolean) => api.post<{ status: string }>('/driver/status', { online: next }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: qk.driverMe });
      toast.success(r.status === 'online' ? 'You’re online — offers will appear here' : 'You’re offline');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const stops: MapStop[] = useMemo(
    () => (trip?.members ?? []).filter((m) => m.destination).map((m) => ({ ...m.destination!, index: m.dropIndex ?? 0, label: m.firstName, done: m.status === 'completed' })),
    [trip],
  );

  if (me.isLoading) return <PageLoader />;
  if (me.error instanceof ApiError && me.error.status === 403) return <Navigate to="/driver/onboard" replace />;
  const d = me.data!;
  const sum = earnings?.summary;

  return (
    <div className="space-y-6">
      <DashboardHero
        eyebrow={`${greeting()}, ${user.name.split(' ')[0]} 👋`}
        title={
          <>
            {online ? 'You’re live.' : 'Ready to drive?'} <span className="sm:block">{online ? 'Pooled trips are on their way.' : 'Go online to get pooled trips.'}</span>
          </>
        }
        chips={[`${d.vehicle.color} ${d.vehicle.model}`, d.vehicle.number, d.verified ? 'Verified driver' : 'Verification pending']}
        action={
          d.verified ? (
            <button
              onClick={() => toggle.mutate(!online)}
              disabled={toggle.isPending || d.status === 'busy'}
              className={cn(
                'flex h-14 items-center justify-center gap-3 rounded-2xl px-6 text-base font-bold shadow-lg transition active:scale-95 disabled:opacity-70',
                online ? 'bg-emerald-500 text-white ring-2 ring-white/70' : 'bg-white text-brand-700',
              )}
            >
              <span className={cn('h-2.5 w-2.5 rounded-full', online ? 'animate-pulse bg-white' : 'bg-slate-400')} />
              {d.status === 'busy' ? 'On a trip' : online ? 'Online' : 'Go online'}
            </button>
          ) : (
            <Badge tone="amber">Verification pending</Badge>
          )
        }
      />

      <StatGrid>
        <Stat label="Today" value={formatINR(sum?.today.net ?? 0)} hint={`${sum?.today.trips ?? 0} trips`} icon={<Wallet className="h-4 w-4 text-emerald-600" />} />
        <Stat label="This week" value={formatINR(sum?.week.net ?? 0)} hint={`${sum?.week.trips ?? 0} trips`} icon={<Route className="h-4 w-4 text-brand-600" />} />
        <Stat label="Riders carried" value={sum?.lifetime.passengers ?? 0} hint="lifetime" icon={<Users className="h-4 w-4 text-brand-600" />} />
        <Stat label="Your rating" value={d.ratingAvg?.toFixed(1) ?? '—'} hint={`${d.ratingCount} reviews`} icon={<Star className="h-4 w-4 text-amber-500" />} />
      </StatGrid>

      <div className={MAIN_GRID}>
        <section>
          <SectionTitle>Live map</SectionTitle>
          <MapCard>
            <LiveMap hub={trip?.station} hubType={trip?.station.type} route={trip?.route ?? []} stops={stops} driver={pos} follow={!!trip} className={DASH_MAP} />
          </MapCard>
          {online && (
            <Card className="mt-4 px-4 py-2">
              <Toggle checked={useGps} onChange={setUseGps} icon={<Crosshair className="h-5 w-5" />} label="Share device GPS" description={gps.error ?? (gps.fix ? `Accuracy ±${gps.fix.accuracyM} m` : 'Your live position is shared only with riders on your trip')} />
              {config?.demoMode && trip && (
                <div className="pb-2">
                  <Button size="sm" variant="secondary" icon={<Route className="h-4 w-4" />} disabled={simulating} onClick={() => setSimulating(true)}>
                    {simulating ? 'Simulating drive…' : trip.status === 'on_trip' ? 'Simulate driving the route' : 'Simulate driving to pickup'}
                  </Button>
                </div>
              )}
            </Card>
          )}
        </section>

        <section className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <SectionTitle>{trip ? 'Current trip' : 'Status'}</SectionTitle>
          {trip ? (
            <TripPanel trip={trip} />
          ) : (
            <Card className="p-6 text-center">
              <div className={cn('mx-auto flex h-16 w-16 items-center justify-center rounded-full', online ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500')}>
                <Power className="h-8 w-8" />
              </div>
              <div className="mt-3 font-bold">{online ? 'Waiting for pooled trips nearby…' : 'You’re offline'}</div>
              <p className="mt-1 text-sm text-slate-500">
                {online ? 'Stay near a hub. Offers last ' + (config?.offerTimeoutSec ?? 30) + ' seconds.' : 'Go online to receive trip offers from airport and station pools.'}
              </p>
            </Card>
          )}
          <Card className="flex items-start gap-3 p-4 text-xs text-slate-600">
            <ShieldCheck className="h-5 w-5 shrink-0 text-safe-600" />
            Trips are monitored for route deviations and long stops. Always verify each rider’s PIN before starting, and follow the suggested drop order.
          </Card>
        </section>
      </div>
      <OfferSheet offer={offer} timeoutSec={config?.offerTimeoutSec} />
    </div>
  );
}
