/** Presentation helpers used on both sides (emails, notifications, UI). */

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export const formatINR = (n: number | null | undefined) => (n == null ? '—' : inr.format(n));

export const formatKm = (n: number | null | undefined) =>
  n == null ? '—' : `${n < 10 ? n.toFixed(1) : Math.round(n)} km`;

export function firstName(fullName: string | null | undefined): string {
  const f = (fullName ?? '').trim().split(/\s+/)[0] ?? '';
  return f ? f[0]!.toUpperCase() + f.slice(1) : 'Rider';
}

/** "+91 98765 43210" → "+91 ••••• •3210" */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return 'Hidden';
  const digits = phone.replace(/\D/g, '');
  const last4 = digits.slice(-4);
  return `+91 ••••• •${last4}`;
}

/** "chethan@example.com" → "ch•••@example.com" */
export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 2)}${'•'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

export function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '').slice(-10);
  return `+91${digits}`;
}

export function initials(name: string | null | undefined): string {
  return (
    (name ?? '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

/** Display name derived from an email address when a user hasn't set one yet. */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? 'traveller';
  return local
    .replace(/[._\-+0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .slice(0, 40) || 'Traveller';
}
