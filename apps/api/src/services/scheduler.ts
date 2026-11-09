import type { FastifyBaseLogger } from 'fastify';
import { env } from '../config/env';
import { sweepDispatch } from './dispatch';
import { expireAcceptWindows, expireStaleRequests, runMatching } from './matching';
import { escalateMissedCheckIns, nightCheckIns } from './safety';

/**
 * Background worker. Each step is idempotent and guarded by status predicates,
 * so running the tick on several instances at once is safe (just wasteful).
 */

export async function tick(now = new Date()) {
  const acceptExpired = await expireAcceptWindows(now);
  const matched = await runMatching(now);
  const dispatch = await sweepDispatch(now);
  const escalated = await escalateMissedCheckIns(now);
  const night = await nightCheckIns(now);
  const stale = await expireStaleRequests(now);
  return { acceptExpired, ...matched, ...dispatch, escalated, night, stale };
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startScheduler(log: FastifyBaseLogger) {
  if (timer) return;
  timer = setInterval(async () => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      const r = await tick();
      if (r.formed || r.joined || r.offered || r.escalated) log.info({ scheduler: r }, 'scheduler tick');
    } catch (err) {
      log.error({ err }, 'scheduler tick failed');
    } finally {
      running = false;
    }
  }, env.SCHEDULER_INTERVAL_SEC * 1000);
  timer.unref();
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
