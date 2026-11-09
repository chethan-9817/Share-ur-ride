import type { CoRiderDto } from '@arriveshare/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, Navigation, Play, UserX } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Avatar, Badge, Card } from '@/components/ui/primitives';
import { groupStatusLabel } from '@/components/ui/StatusBadge';
import { qk, type DriverTrip } from '@/hooks/queries';
import { useElapsed } from '@/hooks/useCountdown';
import { api, errorMessage } from '@/lib/api';
import { googleMapsNav } from '@/lib/utils';

function PinEntry({ rider, onDone }: { rider: CoRiderDto; onDone: () => void }) {
  const [pin, setPin] = useState('');
  const verify = useMutation({
    mutationFn: (p: string) => api.post('/driver/trip/verify-pin', { rideId: rider.rideId, pin: p }),
    onSuccess: () => {
      toast.success(`${rider.firstName} is on board`);
      onDone();
    },
    onError: (e) => {
      setPin('');
      toast.error(errorMessage(e));
    },
  });
  return (
    <div className="mt-3 flex gap-2">
      <input
        className="input h-11 text-center font-mono text-lg tracking-[0.5em]"
        inputMode="numeric"
        maxLength={4}
        placeholder="PIN"
        aria-label={`PIN for ${rider.firstName}`}
        value={pin}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 4);
          setPin(v);
          if (v.length === 4) verify.mutate(v);
        }}
      />
      <Button icon={<KeyRound className="h-4 w-4" />} loading={verify.isPending} disabled={pin.length !== 4} onClick={() => verify.mutate(pin)}>
        Verify
      </Button>
    </div>
  );
}

/** Step-by-step trip controls: arrive → verify PINs → start → drop in order. */
export function TripPanel({ trip }: { trip: DriverTrip }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: qk.trip });
  const waited = useElapsed(trip.arrivedAt);
  const canNoShow = trip.status === 'arrived' && waited >= trip.noShowWaitMin * 60;

  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.post(`/driver/trip/${path}`, body ?? {}),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const ordered = [...trip.members].sort((a, b) => (a.dropIndex ?? 0) - (b.dropIndex ?? 0));
  const waiting = ordered.filter((m) => m.status === 'confirmed');
  const onboard = ordered.filter((m) => m.status === 'picked_up');
  const nextDrop = onboard[0];

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-brand-600">{groupStatusLabel(trip.status)}</div>
          <div className="text-lg font-extrabold">{trip.station.name}</div>
        </div>
        <a href={googleMapsNav(trip.station.lat, trip.station.lng)} target="_blank" rel="noreferrer">
          <Button size="sm" variant="secondary" icon={<Navigation className="h-4 w-4" />}>
            Navigate
          </Button>
        </a>
      </div>

      {trip.status === 'assigned' && (
        <Button block size="lg" loading={action.isPending} onClick={() => action.mutate({ path: 'arrive' })}>
          I’ve arrived at pickup
        </Button>
      )}

      <ol className="space-y-3">
        {ordered.map((m) => (
          <li key={m.rideId} className="rounded-2xl border border-slate-200 p-3 dark:border-white/10">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-700 text-sm font-bold text-white">{(m.dropIndex ?? 0) + 1}</div>
              <Avatar name={m.firstName} size={36} />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{m.firstName}</div>
                <div className="truncate text-xs text-slate-500">{m.destinationLabel}</div>
              </div>
              {m.status === 'picked_up' && <Badge tone="green">On board</Badge>}
              {m.status === 'completed' && <Badge tone="slate"><CheckCircle2 className="h-3 w-3" /> Dropped</Badge>}
              {m.status === 'no_show' && <Badge tone="red">No-show</Badge>}
              {m.status === 'confirmed' && <Badge tone="amber">Waiting</Badge>}
            </div>
            {m.status === 'confirmed' && trip.status !== 'assigned' && (
              <>
                {m.pickupPin && <p className="mt-2 text-xs text-slate-500">Demo rider — PIN is {m.pickupPin}</p>}
                <PinEntry rider={m} onDone={refresh} />
                {canNoShow && (
                  <Button size="sm" variant="ghost" className="mt-2 text-red-600" icon={<UserX className="h-4 w-4" />} onClick={() => action.mutate({ path: 'no-show', body: { rideId: m.rideId } })}>
                    Mark no-show
                  </Button>
                )}
              </>
            )}
            {m.status === 'picked_up' && trip.status === 'on_trip' && m.destination && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <a href={googleMapsNav(m.destination.lat, m.destination.lng)} target="_blank" rel="noreferrer">
                  <Button block size="sm" variant="secondary" icon={<Navigation className="h-4 w-4" />}>
                    Navigate
                  </Button>
                </a>
                <Button size="sm" variant={m === nextDrop ? 'success' : 'secondary'} loading={action.isPending && action.variables?.path === 'drop'} onClick={() => action.mutate({ path: 'drop', body: { rideId: m.rideId } })}>
                  Dropped
                </Button>
              </div>
            )}
          </li>
        ))}
      </ol>

      {trip.status === 'arrived' && !canNoShow && waiting.length > 0 && (
        <p className="text-xs text-slate-500">No-show is available after {trip.noShowWaitMin} min of waiting.</p>
      )}

      {(trip.status === 'arrived' || trip.status === 'assigned') && waiting.length === 0 && onboard.length > 0 && (
        <Button block size="lg" variant="success" icon={<Play className="h-5 w-5" />} loading={action.isPending} onClick={() => action.mutate({ path: 'start' })}>
          Start trip
        </Button>
      )}
    </Card>
  );
}
