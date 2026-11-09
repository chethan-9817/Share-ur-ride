import { formatINR, type RideDto } from '@arriveshare/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Car, Radar, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { fmtTime } from '@/lib/utils';

/** Shown while the ride is in the pool. Matching runs server-side on every booking and every few seconds. */
export function MatchingRadar({ ride }: { ride: RideDto }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['ride', ride.id] });

  const solo = useMutation({
    mutationFn: () => api.post(`/rides/${ride.id}/solo`),
    onSuccess: () => {
      refresh();
      toast.success('Booked as a private cab');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/rides/${ride.id}/cancel`, { reason: 'Rider cancelled while searching' }),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card className="overflow-hidden p-6 text-center">
      <div className="relative mx-auto my-4 flex h-48 w-48 items-center justify-center">
        {[0, 0.8, 1.6].map((d) => (
          <span key={d} className="absolute inset-0 animate-radar rounded-full border-2 border-brand-500/60" style={{ animationDelay: `${d}s` }} />
        ))}
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-600 text-white shadow-xl shadow-brand-600/40">
          <Radar className="h-9 w-9" />
        </div>
      </div>
      <h2 className="text-xl font-extrabold">Finding co-riders on your route</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
        We’re looking for travellers arriving at {ride.station.code} around {fmtTime(ride.arrivalAt)} (±{ride.toleranceMin} min) heading
        towards {ride.destinationLabel.split(',')[0]}.
      </p>
      {ride.womenOnly && <p className="mt-2 text-sm font-semibold text-safe-600">Women-only pool</p>}
      <div className="mx-auto mt-6 grid max-w-sm gap-3">
        <Button variant="secondary" icon={<Car className="h-4 w-4" />} loading={solo.isPending} onClick={() => solo.mutate()}>
          Don’t wait — ride solo for {formatINR(ride.soloFare)}
        </Button>
        <Button variant="ghost" icon={<X className="h-4 w-4" />} loading={cancel.isPending} onClick={() => cancel.mutate()}>
          Cancel request
        </Button>
      </div>
    </Card>
  );
}
