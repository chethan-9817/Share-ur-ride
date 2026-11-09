import { SOCKET_EVENTS, type NotificationDto } from '@arriveshare/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db, type DbOrTx } from '../db/client';
import { notifications, type Notification } from '../db/schema';
import { realtime } from '../realtime/hub';

export function toNotificationDto(n: Notification): NotificationDto {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    link: n.link,
    read: n.readAt != null,
    createdAt: n.createdAt.toISOString(),
  };
}

/** Persists an in-app notification and pushes it over the user's socket. */
export async function notify(
  userId: string,
  n: { kind: string; title: string; body: string; link?: string | null },
  tx: DbOrTx = db,
) {
  const [row] = await tx
    .insert(notifications)
    .values({ userId, kind: n.kind, title: n.title, body: n.body, link: n.link ?? null })
    .returning();
  realtime.toUser(userId, SOCKET_EVENTS.notification, toNotificationDto(row!));
  return row!;
}

export async function listNotifications(userId: string, limit = 30) {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return rows.map(toNotificationDto);
}

export async function markAllRead(userId: string) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}
