import { useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { useAuth } from '@/store/auth';

/** Subscribes to a socket event for the component's lifetime. */
export function useSocketEvent<T = unknown>(event: string, handler: (payload: T) => void) {
  const token = useAuth((s) => s.token);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const s = getSocket();
    const fn = (p: T) => ref.current(p);
    s.on(event, fn);
    return () => {
      s.off(event, fn);
    };
  }, [event, token]);
}

/** Joins a room (group or share) and re-joins after every reconnect. */
export function useRoom(kind: 'group' | 'share', id: string | null | undefined) {
  const token = useAuth((s) => s.token);
  useEffect(() => {
    if (!id) return;
    const s = getSocket();
    const join = () =>
      kind === 'group' ? s.emit('group:join', { groupId: id }) : s.emit('share:join', { token: id });
    join();
    s.on('connect', join);
    return () => {
      s.off('connect', join);
      if (kind === 'group') s.emit('group:leave', { groupId: id });
      else s.emit('share:leave', { token: id });
    };
  }, [kind, id, token]);
}

export function useConnectionState() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const s = getSocket();
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    s.on('connect', up);
    s.on('disconnect', down);
    setOnline(s.connected || !s.disconnected);
    return () => {
      s.off('connect', up);
      s.off('disconnect', down);
    };
  }, []);
  return online;
}
