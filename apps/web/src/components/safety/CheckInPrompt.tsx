import { useMutation } from '@tanstack/react-query';
import { HeartHandshake, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { mmss, useCountdown } from '@/hooks/useCountdown';
import { useSocketEvent } from '@/hooks/useSocket';
import { api } from '@/lib/api';
import { vibrate } from '@/lib/utils';

interface CheckIn {
  eventId: string;
  rideId: string;
  message: string;
  deadline: string;
}

/**
 * Mounted once at app level. When the server notices something unusual on a trip
 * (route deviation, long stop, speeding, or a periodic night check), it asks the
 * rider to confirm they're safe. No answer → trusted contacts + ops are alerted.
 */
export function CheckInPrompt() {
  const [prompt, setPrompt] = useState<CheckIn | null>(null);
  const left = useCountdown(prompt?.deadline);

  useSocketEvent<CheckIn>('safety:check_in', (p) => {
    setPrompt(p);
    vibrate([300, 150, 300, 150, 300]);
    try {
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('ArriveShare safety check', { body: `${p.message}. Are you okay?`, tag: 'checkin' });
      }
    } catch {
      /* ignore */
    }
  });

  const respond = useMutation({
    mutationFn: (safe: boolean) => api.post<{ escalated: boolean }>('/safety/check-in', { rideId: prompt!.rideId, safe }),
    onSuccess: (r) => {
      setPrompt(null);
      if (r.escalated) toast.error('SOS raised — our safety team and your contacts have been alerted.');
      else toast.success('Thanks for confirming. We will keep watching the trip.');
    },
  });

  return (
    <Sheet open={!!prompt} onClose={() => undefined} persistent title="Are you okay?">
      <div className="space-y-4">
        <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          {prompt?.message}.
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          If you don&apos;t respond in <b className="tabular-nums">{mmss(left)}</b>, we&apos;ll alert your trusted contacts and our safety team.
        </p>
        <div className="grid gap-3">
          <Button size="lg" variant="success" icon={<HeartHandshake className="h-5 w-5" />} loading={respond.isPending && respond.variables === true} onClick={() => respond.mutate(true)}>
            I&apos;m safe
          </Button>
          <Button size="lg" variant="danger" icon={<ShieldAlert className="h-5 w-5" />} loading={respond.isPending && respond.variables === false} onClick={() => respond.mutate(false)}>
            I need help
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
