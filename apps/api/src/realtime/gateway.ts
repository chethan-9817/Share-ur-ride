import { locationPingSchema, SOCKET_EVENTS } from '@arriveshare/shared';
import { and, eq, gte, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { db } from '../db/client';
import { drivers, rideGroups, rideRequests, tripShares } from '../db/schema';
import type { AccessClaims } from '../plugins/auth';
import { ingestLocation } from '../services/trips';
import { attachIo, rooms } from './hub';

/**
 * Socket.IO gateway.
 *  • Authenticated sockets (JWT in handshake.auth.token) join `user:<id>` and,
 *    for admins, the `admins` room.
 *  • Group rooms are joined only after a membership check.
 *  • Share rooms accept anonymous sockets holding a valid, unexpired share token.
 *  • Drivers stream GPS over the socket (`driver:location:push`) — cheaper than REST.
 */
export function createGateway(app: FastifyInstance, corsOrigins: string[]) {
  const io = new Server(app.server, {
    path: '/socket.io',
    cors: { origin: corsOrigins, credentials: true },
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(); // anonymous (share viewers)
    try {
      socket.data.user = app.jwt.verify<AccessClaims>(token);
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as AccessClaims | undefined;
    if (user) {
      socket.join(rooms.user(user.sub));
      if (user.role === 'admin') socket.join(rooms.admins);
    }

    socket.on(SOCKET_EVENTS.joinGroup, async ({ groupId }: { groupId?: string }, ack?: (ok: boolean) => void) => {
      if (!user || typeof groupId !== 'string') return ack?.(false);
      try {
        let allowed = user.role === 'admin';
        if (!allowed) {
          const [member] = await db
            .select({ id: rideRequests.id })
            .from(rideRequests)
            .where(and(eq(rideRequests.groupId, groupId), eq(rideRequests.userId, user.sub)));
          allowed = !!member;
        }
        if (!allowed) {
          const [asDriver] = await db
            .select({ id: rideGroups.id })
            .from(rideGroups)
            .innerJoin(drivers, eq(drivers.id, rideGroups.driverId))
            .where(and(eq(rideGroups.id, groupId), eq(drivers.userId, user.sub)));
          allowed = !!asDriver;
        }
        if (allowed) socket.join(rooms.group(groupId));
        ack?.(allowed);
      } catch {
        ack?.(false);
      }
    });

    socket.on(SOCKET_EVENTS.leaveGroup, ({ groupId }: { groupId?: string }) => {
      if (typeof groupId === 'string') socket.leave(rooms.group(groupId));
    });

    socket.on(SOCKET_EVENTS.joinShare, async ({ token }: { token?: string }, ack?: (ok: boolean) => void) => {
      if (typeof token !== 'string' || token.length > 64) return ack?.(false);
      const [share] = await db
        .select({ id: tripShares.id })
        .from(tripShares)
        .where(and(eq(tripShares.token, token), isNull(tripShares.revokedAt), gte(tripShares.expiresAt, new Date())));
      if (share) socket.join(rooms.share(token));
      ack?.(!!share);
    });

    socket.on(SOCKET_EVENTS.driverLocationPush, async (payload: unknown, ack?: (r: unknown) => void) => {
      if (!user || user.role !== 'driver') return ack?.({ ok: false });
      const parsed = locationPingSchema.safeParse(payload);
      if (!parsed.success) return ack?.({ ok: false, error: 'INVALID' });
      try {
        ack?.({ ok: true, ...(await ingestLocation(user.sub, parsed.data)) });
      } catch (err) {
        app.log.warn({ err }, 'socket location ingest failed');
        ack?.({ ok: false });
      }
    });
  });

  attachIo(io);
  return io;
}
