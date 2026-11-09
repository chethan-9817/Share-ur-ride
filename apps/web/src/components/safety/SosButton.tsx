import { useMutation } from '@tanstack/react-query';
import { Phone, ShieldAlert } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { currentPosition } from '@/hooks/useGeolocation';
import { api, errorMessage } from '@/lib/api';
import { cn, vibrate } from '@/lib/utils';

const HOLD_MS = 1500;

/**
 * Press-and-hold SOS. Holding (instead of tapping) prevents pocket-dials while
 * staying fast in a real emergency. The alert is silent: nothing is shown or sent
 * to the driver.
 */
export function SosButton({ rideId, compact }: { rideId?: string; compact?: boolean }) {
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState<{ contactsNotified?: number } | null>(null);
  const timer = useRef<number | null>(null);
  const started = useRef(0);

  const sos = useMutation({
    mutationFn: async () => {
      const location = await currentPosition();
      return api.post<{ id: string; contactsNotified?: number }>('/safety/sos', {
        rideId,
        location: location ?? undefined,
      });
    },
    onSuccess: (r) => {
      vibrate([200, 100, 200, 100, 400]);
      setDone(r);
    },
    onError: (e) => toast.error(`SOS failed: ${errorMessage(e)} — call 112 now`),
  });

  const start = () => {
    started.current = Date.now();
    vibrate(30);
    const step = () => {
      const p = Math.min(1, (Date.now() - started.current) / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        stop();
        sos.mutate();
        return;
      }
      timer.current = requestAnimationFrame(step);
    };
    timer.current = requestAnimationFrame(step);
  };
  const stop = () => {
    if (timer.current) cancelAnimationFrame(timer.current);
    timer.current = null;
    setProgress(0);
  };

  return (
    <>
      <button
        type="button"
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onContextMenu={(e) => e.preventDefault()}
        disabled={sos.isPending}
        aria-label="Hold for SOS"
        className={cn(
          'relative select-none overflow-hidden rounded-2xl bg-red-600 font-bold text-white shadow-lg shadow-red-600/40 transition active:scale-95',
          compact ? 'h-12 px-4 text-sm' : 'h-16 w-full text-base',
        )}
      >
        <span className="absolute inset-y-0 left-0 bg-red-800/70" style={{ width: `${progress * 100}%` }} />
        <span className="relative flex items-center justify-center gap-2">
          <ShieldAlert className="h-5 w-5" />
          {sos.isPending ? 'Sending SOS…' : progress > 0 ? 'Keep holding…' : compact ? 'SOS' : 'Hold for SOS'}
        </span>
      </button>

      <Sheet open={!!done} onClose={() => setDone(null)} title="🚨 SOS sent">
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Our safety team has been alerted with your live location
            {done?.contactsNotified ? ` and ${done.contactsNotified} trusted contact(s) were emailed a live trip link` : ''}. Your
            driver has <b>not</b> been notified.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <a href="tel:112">
              <Button variant="danger" size="lg" block icon={<Phone className="h-5 w-5" />}>
                Call 112
              </Button>
            </a>
            <a href="tel:1091">
              <Button variant="safe" size="lg" block icon={<Phone className="h-5 w-5" />}>
                Women 1091
              </Button>
            </a>
          </div>
          <p className="text-xs text-slate-500">Press SOS again any time to refresh your location for the team.</p>
        </div>
      </Sheet>
    </>
  );
}
