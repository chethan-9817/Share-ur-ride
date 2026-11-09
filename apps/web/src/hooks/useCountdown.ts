import { useEffect, useState } from 'react';

/** Seconds remaining until `iso`, ticking every second. */
export function useCountdown(iso: string | null | undefined) {
  const calc = () => (iso ? Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000)) : 0);
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    setLeft(calc());
    if (!iso) return;
    const t = setInterval(() => setLeft(calc()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso]);
  return left;
}

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Seconds elapsed since `iso`. */
export function useElapsed(iso: string | null | undefined) {
  const calc = () => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)) : 0);
  const [s, setS] = useState(calc);
  useEffect(() => {
    if (!iso) return;
    const t = setInterval(() => setS(calc()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso]);
  return s;
}
