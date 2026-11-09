import type { LatLng, ShareViewDto } from '@arriveshare/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BadgeCheck, Phone, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { LiveMap } from '@/components/map/LiveMap';
import { Card, EmptyState, PageLoader, Rating } from '@/components/ui/primitives';
import { groupStatusLabel } from '@/components/ui/StatusBadge';
import { useRoom, useSocketEvent } from '@/hooks/useSocket';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/utils';

/**
 * Public live-trip page for trusted contacts. No login, no app install — just the
 * link. Shows first name, vehicle and live position; never phone numbers or co-riders.
 */
export default function ShareTrip() {
  const { token } = useParams();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['share', token],
    queryFn: () => api.get<ShareViewDto>(`/share/${token}`),
    refetchInterval: 30_000,
    retry: false,
  });
  const [pos, setPos] = useState<(LatLng & { heading: number | null; at: string }) | null>(null);
  const [alert, setAlert] = useState<string | null>(null);

  useRoom('share', token);
  useSocketEvent<LatLng & { heading: number | null; at: string }>('driver:location', setPos);
  useSocketEvent<{ message: string }>('safety:alert', (a) => {
    setAlert(a.message);
    refetch();
  });

  if (isLoading) return <PageLoader />;
  if (error || !data)
    return (
      <div className="pt-safe mx-auto max-w-md px-4 py-16">
        <EmptyState icon={<ShieldCheck />} title="This trip link has expired" body="Live links stop working once the trip ends or the rider stops sharing." />
      </div>
    );

  const driverPos = pos ?? data.driver?.location ?? null;
  const updated = pos?.at ?? data.driver?.location?.updatedAt;
  const warn = alert ?? data.lastSafetyEvent?.message;

  return (
    <div className="pt-safe mx-auto min-h-screen max-w-3xl space-y-4 px-4 py-6">
      <div className="flex items-center gap-2 text-sm font-bold text-brand-600">
        <img src="/icon.svg" className="h-6 w-6" alt="" /> ArriveShare live trip
      </div>
      <h1 className="text-2xl font-extrabold">{data.riderFirstName} is on the way home</h1>
      <p className="text-sm text-slate-500">
        {groupStatusLabel(data.status)} · from {data.station.name} to {data.destinationLabel.split(',').slice(0, 2).join(',')}
      </p>

      {warn && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div>
            <b>Safety notice:</b> {warn}. We’ve asked {data.riderFirstName} to check in. If you can’t reach them, call 112.
          </div>
        </div>
      )}

      <LiveMap hub={data.station} hubType={data.station.type} route={data.route} destination={data.destination} driver={driverPos} follow className="h-[55vh]" />
      {updated && <div className="text-xs text-slate-500">Location updated {timeAgo(updated)}</div>}

      {data.driver && (
        <Card className="flex items-center justify-between gap-4 p-4">
          <div>
            <div className="flex items-center gap-1.5 font-bold">
              {data.driver.name} {data.driver.verified && <BadgeCheck className="h-4 w-4 text-sky-500" />}
            </div>
            <Rating value={data.driver.ratingAvg} count={data.driver.ratingCount} />
            <div className="mt-1 text-sm text-slate-500">
              {data.driver.vehicle.color} {data.driver.vehicle.model}
            </div>
          </div>
          <div className="rounded-md bg-yellow-300 px-3 py-1.5 font-mono text-lg font-extrabold tracking-widest text-black">{data.driver.vehicle.number}</div>
        </Card>
      )}

      <a href="tel:112" className="flex items-center justify-center gap-2 rounded-2xl bg-red-600 py-4 font-bold text-white">
        <Phone className="h-5 w-5" /> Emergency? Call 112
      </a>
    </div>
  );
}
