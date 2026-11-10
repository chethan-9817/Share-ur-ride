import { formatINR, type SafetyEventDto, type SosDto } from '@arriveshare/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, Car, MapPin, Phone, ShieldAlert, Users } from 'lucide-react';
import { useMemo } from 'react';
import { Marker, Polyline, Tooltip } from 'react-leaflet';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { LiveMap } from '@/components/map/LiveMap';
import { carIcon, destIcon } from '@/components/map/markers';
import { Button } from '@/components/ui/Button';
import { Badge, Card, DASH_MAP, DashboardHero, EmptyState, MAIN_GRID, MapCard, SectionTitle, Stat, StatGrid } from '@/components/ui/primitives';
import { qk, useAdminOverview } from '@/hooks/queries';
import { useSocketEvent } from '@/hooks/useSocket';
import { api, errorMessage } from '@/lib/api';
import { greeting, timeAgo, vibrate } from '@/lib/utils';

interface Live {
  drivers: { id: string; name: string; status: string; lat: number; lng: number; heading: number | null; vehicleNumber: string }[];
  groups: { id: string; status: string; route: { lat: number; lng: number }[]; womenOnly: boolean }[];
}

function SosItem({ s }: { s: SosDto }) {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: (status: 'acknowledged' | 'resolved' | 'false_alarm') => api.patch(`/admin/sos/${s.id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className={`rounded-2xl border p-4 ${s.status === 'open' ? 'border-red-300 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10' : 'border-slate-200 dark:border-white/10'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-bold">
            <ShieldAlert className="h-4 w-4 text-red-600" /> {s.user.name}
            {s.user.gender === 'female' && <Badge tone="pink">Woman rider</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            {timeAgo(s.createdAt)} · {s.message ?? 'SOS triggered'}
          </div>
        </div>
        <Badge tone={s.status === 'open' ? 'red' : 'amber'}>{s.status}</Badge>
      </div>
      <div className="mt-3 grid gap-1 text-sm">
        {s.user.phone && (
          <a href={`tel:${s.user.phone}`} className="flex items-center gap-2 font-semibold text-brand-600">
            <Phone className="h-4 w-4" /> Call rider {s.user.phone}
          </a>
        )}
        {s.driver && (
          <div className="text-slate-600 dark:text-slate-300">
            Driver {s.driver.name} · <span className="font-mono">{s.driver.vehicleNumber}</span>
          </div>
        )}
        {s.location && (
          <a className="flex items-center gap-2 text-slate-600 underline dark:text-slate-300" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${s.location.lat},${s.location.lng}`}>
            <MapPin className="h-4 w-4" /> {s.location.lat.toFixed(5)}, {s.location.lng.toFixed(5)}
          </a>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {s.status === 'open' && (
          <Button size="sm" variant="danger" loading={update.isPending} onClick={() => update.mutate('acknowledged')}>
            Acknowledge
          </Button>
        )}
        <Button size="sm" variant="success" onClick={() => update.mutate('resolved')}>
          Resolve
        </Button>
        <Button size="sm" variant="ghost" onClick={() => update.mutate('false_alarm')}>
          False alarm
        </Button>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const qc = useQueryClient();
  const { data: o } = useAdminOverview();
  const sos = useQuery({ queryKey: qk.admin('sos'), queryFn: () => api.get<SosDto[]>('/admin/sos?open=true'), refetchInterval: 30_000 });
  const events = useQuery({ queryKey: qk.admin('events'), queryFn: () => api.get<SafetyEventDto[]>('/admin/safety-events'), refetchInterval: 30_000 });
  const live = useQuery({ queryKey: qk.admin('live'), queryFn: () => api.get<Live>('/admin/live'), refetchInterval: 5_000 });

  useSocketEvent<SosDto>('sos:raised', (s) => {
    vibrate([500, 200, 500]);
    toast.error(`🚨 SOS from ${s.user.name}`, { duration: 15_000 });
    qc.invalidateQueries({ queryKey: ['admin'] });
  });
  useSocketEvent<{ message: string }>('safety:alert', (a) => {
    toast.warning(a.message);
    qc.invalidateQueries({ queryKey: qk.admin('events') });
  });

  const center = { lat: 13.05, lng: 77.62 };
  const fleet = useMemo(() => (live.data?.drivers ?? []).map((d) => ({ lat: d.lat, lng: d.lng })), [live.data?.drivers]);

  return (
    <div className="space-y-6">
      <DashboardHero
        eyebrow={`${greeting()} · Safety desk`}
        title={
          <>
            Every ride, <span className="sm:block">watched over.</span>
          </>
        }
        chips={[
          `${o?.pooledRatePct ?? 0}% pooled today`,
          `${formatINR(o?.savingsToday ?? 0)} saved by riders`,
          `${o?.co2SavedKg ?? 0} kg CO₂ avoided`,
        ]}
        action={
          <Link to="/admin/drivers">
            <Button size="lg" variant="light" className="w-full md:w-auto" icon={<Car className="h-5 w-5" />}>
              Review drivers
            </Button>
          </Link>
        }
      />

      <StatGrid>
        <Stat label="Open SOS" value={<span className={o?.openSos ? 'text-red-600' : ''}>{o?.openSos ?? '—'}</span>} hint="needs attention" icon={<ShieldAlert className="h-4 w-4 text-red-600" />} />
        <Stat label="Active cabs" value={o?.activeGroups ?? '—'} hint="on the road now" icon={<Activity className="h-4 w-4 text-brand-600" />} />
        <Stat label="Drivers online" value={o ? `${o.driversOnline}/${o.drivers}` : '—'} hint="available or busy" icon={<Car className="h-4 w-4 text-brand-600" />} />
        <Stat label="Rides today" value={o?.ridesToday ?? '—'} hint={o ? `${o.pooledRatePct}% pooled` : undefined} icon={<Users className="h-4 w-4 text-brand-600" />} />
      </StatGrid>

      <div className={MAIN_GRID}>
        <section>
          <SectionTitle>Live fleet</SectionTitle>
          <MapCard
            footer={
              <>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-brand-600" /> Active trip</span>
                <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-safe-600" /> Women-only trip</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-slate-900" /> Driver</span>
              </>
            }
          >
          <LiveMap center={center} extraFit={fleet} className={DASH_MAP}>
            {live.data?.groups.map((g) => (
              <Polyline key={g.id} positions={g.route} pathOptions={{ color: g.womenOnly ? '#db2777' : '#4f46e5', weight: 3, opacity: 0.7 }} />
            ))}
            {live.data?.drivers.map((d) => (
              <Marker key={d.id} position={d} icon={carIcon(d.heading)} opacity={d.status === 'busy' ? 1 : 0.6}>
                <Tooltip>
                  {d.name} · {d.vehicleNumber} · {d.status}
                </Tooltip>
              </Marker>
            ))}
            {sos.data?.filter((s) => s.location).map((s) => (
              <Marker key={s.id} position={s.location!} icon={destIcon}>
                <Tooltip permanent direction="top" offset={[0, -32]}>SOS · {s.user.name.split(' ')[0]}</Tooltip>
              </Marker>
            ))}
          </LiveMap>
          </MapCard>
        </section>

        <div className="space-y-6">
          <section>
            <SectionTitle>Open incidents</SectionTitle>
            {sos.data?.length ? (
              <div className="space-y-3">{sos.data.map((s) => <SosItem key={s.id} s={s} />)}</div>
            ) : (
              <Card>
                <EmptyState icon={<ShieldAlert />} title="No open SOS" body="New alerts appear here instantly with sound and vibration." />
              </Card>
            )}
          </section>
          <section>
            <SectionTitle>Safety signals</SectionTitle>
            <Card className="max-h-96 divide-y divide-slate-100 overflow-y-auto dark:divide-white/5">
              {(events.data ?? []).length === 0 && <div className="p-4 text-sm text-slate-500">No route deviations or missed check-ins.</div>}
              {events.data?.map((e) => (
                <div key={e.id} className="flex items-start gap-3 p-3">
                  <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${e.severity === 'critical' ? 'text-red-600' : 'text-amber-500'}`} />
                  <div className="text-sm">
                    <div className="font-medium">{e.message}</div>
                    <div className="text-xs text-slate-500">
                      {e.type.replace(/_/g, ' ')} · {timeAgo(e.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}
