import { describe, expect, it } from 'vitest';
import { cn, googleMapsNav, timeAgo, toLocalInput } from './utils';
import { mmss } from '@/hooks/useCountdown';

describe('web utils', () => {
  it('joins class names and drops falsy values', () => {
    const off = Math.random() > 2;
    expect(cn('a', off && 'b', null, undefined, 'c')).toBe('a c');
  });

  it('lets a later Tailwind class override a conflicting earlier one', () => {
    expect(cn('text-white bg-brand-600', 'text-brand-700')).toBe('bg-brand-600 text-brand-700');
    expect(cn('px-4 h-11', 'h-14')).toBe('px-4 h-14');
  });

  it('formats datetime-local values in local time', () => {
    const d = new Date(2026, 10, 9, 7, 5);
    expect(toLocalInput(d)).toBe('2026-11-09T07:05');
  });

  it('builds Google Maps driving links', () => {
    expect(googleMapsNav(12.97, 77.64)).toContain('destination=12.97,77.64');
  });

  it('describes relative times', () => {
    expect(timeAgo(new Date().toISOString())).toBe('just now');
    expect(timeAgo(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('5 min ago');
  });

  it('formats countdowns as m:ss', () => {
    expect(mmss(125)).toBe('2:05');
    expect(mmss(0)).toBe('0:00');
  });
});
