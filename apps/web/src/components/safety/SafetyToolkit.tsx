import { useMutation } from '@tanstack/react-query';
import { Copy, PhoneCall, PhoneIncoming, Share2, ShieldCheck, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { api, errorMessage } from '@/lib/api';
import { FakeCall } from './FakeCall';
import { SosButton } from './SosButton';

/** Everything safety-related, one tap away during a trip. */
export function SafetyToolkit({ rideId, open, onClose }: { rideId?: string; open: boolean; onClose: () => void }) {
  const [fakeCall, setFakeCall] = useState(false);

  const share = useMutation({
    mutationFn: (notifyContacts: boolean) =>
      api.post<{ url: string; emailed?: number }>(`/rides/${rideId}/share`, { notifyContacts }),
    onSuccess: async (r, notify) => {
      if (notify) {
        toast.success(r.emailed ? `Live link emailed to ${r.emailed} contact(s)` : 'Add trusted contacts with an email to auto-notify them');
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: 'Follow my ArriveShare trip', text: 'Track my cab live until I get home', url: r.url }).catch(() => undefined);
      } else {
        await navigator.clipboard.writeText(r.url);
        toast.success('Live trip link copied');
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <Sheet open={open} onClose={onClose} title={<span className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-safe-600" />Safety toolkit</span>}>
        <div className="space-y-3">
          <SosButton rideId={rideId} />
          {rideId && (
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" icon={<Share2 className="h-4 w-4" />} loading={share.isPending && share.variables === false} onClick={() => share.mutate(false)}>
                Share live trip
              </Button>
              <Button variant="secondary" icon={<Users className="h-4 w-4" />} loading={share.isPending && share.variables === true} onClick={() => share.mutate(true)}>
                Alert contacts
              </Button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" icon={<PhoneIncoming className="h-4 w-4" />} onClick={() => { setFakeCall(true); onClose(); toast('A fake call will ring in 5 seconds'); }}>
              Fake call
            </Button>
            <a href="tel:1091">
              <Button variant="secondary" block icon={<PhoneCall className="h-4 w-4" />}>
                Women helpline
              </Button>
            </a>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:bg-white/5 dark:text-slate-400">
            <b>Before you board:</b> match the number plate and driver photo, then share your PIN. Sit in the back, keep your phone charged, and never share your PIN over a call.
          </div>
          <Link to="/safety" onClick={onClose} className="flex items-center justify-center gap-1 text-sm font-semibold text-brand-600">
            <Copy className="h-4 w-4" /> Manage trusted contacts
          </Link>
        </div>
      </Sheet>
      <FakeCall open={fakeCall} onClose={() => setFakeCall(false)} />
    </>
  );
}
