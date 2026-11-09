import { bearingDeg, formatINR, interpolatePolyline, type LatLng } from '@arriveshare/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Crosshair, Power, Route, ShieldCheck, Wallet } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LiveMap, type MapStop } from '@/components/map/LiveMap';
import { Button } from '@/components/ui/Button';
import { Badge, Card, PageLoader, Rating, Stat } from '@/components/ui/primitives';
import { Toggle } from '@/components/ui/Toggle';
import { qk, useConfig, useDriverMe, useDriverTrip, useEarnings, useOffer } from '@/hooks/queries';
import { useWatchPosition, type GeoFix } from '@/hooks/useGeolocation';
import { ApiError, api, errorMessage } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';
import { OfferSheet } from './components/OfferSheet';
import { TripPanel } from './components/TripPanel';

const SEND_EVERY_MS = 4000;

export default function DriverHome() {
  const qc = useQueryClient();
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Driver dashboard</h1>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            {d.vehicle.color} {d.vehicle.model} · <span className="font-mono">{d.vehicle.number}</span> · <Rating value={d.ratingAvg} count={d.ratingCount} />
          </div>
        </div>
        {!d.verified ? (
          <Badge tone="amber">Verification pending</Badge>
        ) : (
          <button
            onClick={() => toggle.mutate(!online)}
            disabled={toggle.isPending || d.status === 'busy'}
            className={cn(
              'flex h-14 items-center gap-3 rounded-full px-6 text-base font-bold text-white shadow-lg transition active:scale-95 disabled:opacity-70',
              online ? 'bg-emerald-600 shadow-emerald-600/30' : 'bg-slate-700 shadow-slate-700/30',
            )}
          >
            <Power className="h-5 w-5" />
            {d.status === 'busy' ? 'On a trip' : online ? 'Online' : 'Go online'}
          </button>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          <LiveMap
            hub={trip?.station}
            hubType={trip?.station.type}
            route={trip?.route ?? []}
            stops={stops}
            driver={pos}
            follow={!!trip}
            className="h-[42vh] sm:h-[460px]"
          />
          {online && (
            <Card className="px-4 py-2">
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
        </div>

        <div className="space-y-4">
          {trip ? (
            <TripPanel trip={trip} />
          ) : (
            <Card className="p-6 text-center">
              <div className={cn('mx-auto flex h-16 w-16 items-center justify-center rounded-full', online ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15' : 'bg-slate-100 text-slate-500 dark:bg-white/10')}>
                <Power className="h-8 w-8" />
              </div>
              <div className="mt-3 font-bold">{online ? 'Waiting for pooled trips nearby…' : 'You’re offline'}</div>
              <p className="mt-1 text-sm text-slate-500">
                {online ? 'Stay near a hub. Offers last ' + (config?.offerTimeoutSec ?? 30) + ' seconds.' : 'Go online to receive trip offers from airport and station pools.'}
              </p>
            </Card>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Today" value={formatINR(earnings?.summary.today.net ?? 0)} hint={`${earnings?.summary.today.trips ?? 0} trips`} icon={<Wallet className="h-4 w-4 text-emerald-600" />} />
            <Stat label="This week" value={formatINR(earnings?.summary.week.net ?? 0)} hint={`${earnings?.summary.week.passengers ?? 0} riders`} />
          </div>
          <Card className="flex items-start gap-3 p-4 text-xs text-slate-600 dark:text-slate-400">
            <ShieldCheck className="h-5 w-5 shrink-0 text-safe-600" />
            Trips are monitored for route deviations and long stops. Always verify each rider’s PIN before starting, and follow the suggested drop order.
          </Card>
        </div>
      </div>
      <OfferSheet offer={offer} timeoutSec={config?.offerTimeoutSec} />
    </div>
  );
}
