import { formatINR, type OfferDto } from '@arriveshare/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, MapPin, Users, X } from 'lucide-react';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/Sheet';
import { useCountdown } from '@/hooks/useCountdown';
import { qk } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { fmtTime, vibrate } from '@/lib/utils';

/** Incoming trip offer with a hard countdown — unanswered offers go to the next driver. */
export function OfferSheet({ offer, timeoutSec = 30 }: { offer: OfferDto | null | undefined; timeoutSec?: number }) {
  const qc = useQueryClient();
  const left = useCountdown(offer?.expiresAt);
  const open = !!offer && left > 0;

  useEffect(() => {
    if (offer) vibrate([400, 200, 400, 200, 400]);
  }, [offer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const respond = useMutation({
    mutationFn: (accept: boolean) => api.post<{ accepted: boolean }>(`/driver/offers/${offer!.id}/${accept ? 'accept' : 'reject'}`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: qk.offer });
      qc.invalidateQueries({ queryKey: qk.trip });
      qc.invalidateQueries({ queryKey: qk.driverMe });
      if (r.accepted) toast.success('Trip accepted — head to the pickup point');
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      qc.invalidateQueries({ queryKey: qk.offer });
    },
  });

  if (!offer) return null;
  const pct = Math.max(0, Math.min(100, (left / timeoutSec) * 100));

  return (
    <Sheet open={open} onClose={() => undefined} persistent>
      <div className="space-y-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
          <div className="h-full bg-brand-600 transition-all duration-1000 ease-linear" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-brand-600">New pooled trip</div>
            <div className="mt-1 text-3xl font-extrabold">{formatINR(offer.payout.net)}</div>
            <div className="text-xs text-slate-500">
              after commission{offer.payout.bonus > 0 && ` · incl. ${formatINR(offer.payout.bonus)} full-cab bonus`}
            </div>
          </div>
          <div className="text-right text-3xl font-extrabold tabular-nums text-slate-400">{left}s</div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
            <Users className="mx-auto mb-1 h-4 w-4" />
            {offer.passengers} riders
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">
            <MapPin className="mx-auto mb-1 h-4 w-4" />
            {offer.distanceToHubKm} km away
          </div>
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/5">{offer.routeKm.toFixed(0)} km trip</div>
        </div>
        <div className="text-sm">
          Pickup at <b>{offer.station.name}</b> · {fmtTime(offer.pickupAt)}
        </div>
        {offer.womenOnly && <Badge tone="pink">Women-only group — please be extra courteous</Badge>}
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <Button size="lg" variant="secondary" icon={<X className="h-5 w-5" />} loading={respond.isPending && respond.variables === false} onClick={() => respond.mutate(false)}>
            Skip
          </Button>
          <Button size="lg" variant="success" icon={<Check className="h-5 w-5" />} loading={respond.isPending && respond.variables === true} onClick={() => respond.mutate(true)}>
            Accept
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
