import { Phone, PhoneOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from '@/components/ui/primitives';
import { mmss, useElapsed } from '@/hooks/useCountdown';
import { vibrate } from '@/lib/utils';

/**
 * Fake incoming call — a discreet way out of an uncomfortable conversation.
 * Rings after a short delay so the rider can put the phone down first.
 */
export function FakeCall({ open, onClose, caller = 'Mom', delaySec = 5 }: { open: boolean; onClose: () => void; caller?: string; delaySec?: number }) {
  const [phase, setPhase] = useState<'waiting' | 'ringing' | 'active'>('waiting');
  const [answeredAt, setAnsweredAt] = useState<string | null>(null);
  const elapsed = useElapsed(answeredAt);

  useEffect(() => {
    if (!open) {
      setPhase('waiting');
      setAnsweredAt(null);
      return;
    }
    const t = setTimeout(() => setPhase('ringing'), delaySec * 1000);
    return () => clearTimeout(t);
  }, [open, delaySec]);

  useEffect(() => {
    if (phase !== 'ringing') return;
    vibrate([800, 400, 800, 400, 800]);
    const t = setInterval(() => vibrate([800, 400, 800]), 2400);
    return () => clearInterval(t);
  }, [phase]);

  if (!open || phase === 'waiting') return null;
  return createPortal(
    <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-between bg-gradient-to-b from-slate-800 to-black px-6 pb-16 pt-24 text-white">
      <div className="flex flex-col items-center gap-4">
        <Avatar name={caller} size={96} />
        <div className="text-3xl font-semibold">{caller}</div>
        <div className="text-sm text-white/70">{phase === 'ringing' ? 'Mobile · incoming call…' : mmss(elapsed)}</div>
      </div>
      <div className="flex w-full max-w-xs justify-around">
        <button
          onClick={onClose}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 shadow-lg"
          aria-label="Decline call"
        >
          <PhoneOff className="h-7 w-7" />
        </button>
        {phase === 'ringing' && (
          <button
            onClick={() => {
              setPhase('active');
              setAnsweredAt(new Date().toISOString());
              vibrate(0);
            }}
            className="flex h-16 w-16 animate-pulse items-center justify-center rounded-full bg-emerald-500 shadow-lg"
            aria-label="Answer call"
          >
            <Phone className="h-7 w-7" />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
