export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const addMs = (d: Date, ms: number) => new Date(d.getTime() + ms);
export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Start of the current day in IST, as a UTC Date. */
export function startOfDayIST(now = new Date()): Date {
  const offset = 330 * MINUTE;
  const local = new Date(now.getTime() + offset);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - offset);
}

export function dateKeyIST(d: Date): string {
  return new Date(d.getTime() + 330 * MINUTE).toISOString().slice(0, 10);
}
