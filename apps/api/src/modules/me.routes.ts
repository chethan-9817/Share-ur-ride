import { normalisePhone, trustedContactSchema, updateProfileSchema } from '@arriveshare/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client';
import { trustedContacts, users } from '../db/schema';
import { badRequest, must } from '../lib/errors';
import { listNotifications, markAllRead } from '../services/notifications';
import { userDto } from '../services/views';

const MAX_CONTACTS = 5;

const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/', { schema: { tags: ['me'] } }, async (req) => {
    const [u] = await db.select().from(users).where(eq(users.id, req.user.sub));
    return userDto(must(u, 'User'));
  });

  app.patch('/', { schema: { body: updateProfileSchema, tags: ['me'] } }, async (req) => {
    const [current] = await db.select().from(users).where(eq(users.id, req.user.sub));
    const u = must(current, 'User');
    const { safety, phone, ...rest } = req.body;
    const nextSafety = { ...u.safety, ...safety };
    const gender = rest.gender ?? u.gender;
    if (nextSafety.womenOnlyDefault && gender !== 'female') {
      throw badRequest('WOMEN_ONLY_GENDER', 'Women-only pooling is available to riders who identify as women');
    }
    const next = {
      ...rest,
      ...(phone ? { phone: normalisePhone(phone) } : {}),
      safety: nextSafety,
    };
    const onboarded = Boolean((next.name ?? u.name) && (next.phone ?? u.phone) && gender !== 'undisclosed');
    const [updated] = await db
      .update(users)
      .set({ ...next, onboarded })
      .where(eq(users.id, req.user.sub))
      .returning();
    return userDto(updated!);
  });

  // ── Trusted contacts ──
  app.get('/contacts', { schema: { tags: ['safety'] } }, async (req) =>
    db
      .select({
        id: trustedContacts.id,
        name: trustedContacts.name,
        phone: trustedContacts.phone,
        email: trustedContacts.email,
        relation: trustedContacts.relation,
      })
      .from(trustedContacts)
      .where(eq(trustedContacts.userId, req.user.sub))
      .orderBy(asc(trustedContacts.createdAt)),
  );

  app.post('/contacts', { schema: { body: trustedContactSchema, tags: ['safety'] } }, async (req, reply) => {
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(trustedContacts)
      .where(eq(trustedContacts.userId, req.user.sub));
    if (n >= MAX_CONTACTS) throw badRequest('CONTACT_LIMIT', `You can add up to ${MAX_CONTACTS} trusted contacts`);
    const [c] = await db
      .insert(trustedContacts)
      .values({
        userId: req.user.sub,
        name: req.body.name,
        phone: normalisePhone(req.body.phone),
        email: req.body.email ?? null,
        relation: req.body.relation ?? null,
      })
      .returning();
    reply.status(201);
    return { id: c!.id, name: c!.name, phone: c!.phone, email: c!.email, relation: c!.relation };
  });

  app.delete(
    '/contacts/:id',
    { schema: { params: z.object({ id: z.string().uuid() }), tags: ['safety'] } },
    async (req) => {
      await db
        .delete(trustedContacts)
        .where(and(eq(trustedContacts.id, req.params.id), eq(trustedContacts.userId, req.user.sub)));
      return { ok: true };
    },
  );

  // ── Notifications ──
  app.get('/notifications', { schema: { tags: ['me'] } }, async (req) => listNotifications(req.user.sub));
  app.post('/notifications/read', { schema: { tags: ['me'] } }, async (req) => {
    await markAllRead(req.user.sub);
    return { ok: true };
  });
};

export default meRoutes;
