import { io, type Socket } from 'socket.io-client';
import { useAuth } from '@/store/auth';

/**
 * One shared socket per tab. It reconnects with the latest access token whenever
 * the session changes, and Socket.IO's built-in exponential backoff handles drops
 * (e.g. a phone switching from Wi-Fi to mobile data in the cab).
 */
let socket: Socket | null = null;
let currentToken: string | null | undefined;

export function getSocket(): Socket {
  const token = useAuth.getState().token;
  if (socket && currentToken === token) return socket;
  socket?.disconnect();
  currentToken = token;
  socket = io({
    path: '/socket.io',
    auth: token ? { token } : {},
    transports: ['websocket', 'polling'],
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });
  return socket;
}

useAuth.subscribe((s, prev) => {
  if (s.token !== prev.token && socket) getSocket();
});
