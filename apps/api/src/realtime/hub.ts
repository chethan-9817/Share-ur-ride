import { EventEmitter } from 'node:events';
import type { Server } from 'socket.io';

/**
 * Thin façade over Socket.IO so domain services can publish events without knowing
 * about sockets. Every emit is mirrored on `bus` which tests subscribe to.
 *
 * Rooms:
 *   user:<userId>     private events for one account
 *   group:<groupId>   everyone in a shared cab (riders + driver)
 *   share:<token>     anonymous family/friends following a shared trip
 *   admins            safety operations team
 */

export interface EmittedEvent {
  room: string;
  event: string;
  payload: unknown;
}

export const bus = new EventEmitter();
bus.setMaxListeners(100);

let io: Server | null = null;

export function attachIo(server: Server | null) {
  io = server;
}

export const rooms = {
  user: (id: string) => `user:${id}`,
  group: (id: string) => `group:${id}`,
  share: (token: string) => `share:${token}`,
  admins: 'admins',
};

function emit(room: string, event: string, payload: unknown) {
  bus.emit('emit', { room, event, payload } satisfies EmittedEvent);
  io?.to(room).emit(event, payload);
}

export const realtime = {
  toUser: (userId: string, event: string, payload: unknown) => emit(rooms.user(userId), event, payload),
  toUsers: (userIds: string[], event: string, payload: unknown) =>
    userIds.forEach((id) => emit(rooms.user(id), event, payload)),
  toGroup: (groupId: string, event: string, payload: unknown) =>
    emit(rooms.group(groupId), event, payload),
  toShare: (token: string, event: string, payload: unknown) =>
    emit(rooms.share(token), event, payload),
  toAdmins: (event: string, payload: unknown) => emit(rooms.admins, event, payload),
};
