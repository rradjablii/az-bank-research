import { z } from 'zod';
import * as account from '../../account.js';
import { EmailTaken, authenticate, createSession, createUser, endSession, sameOrigin, sessionCookie, sessionUser, verifyPassword, type User } from '../../auth.js';
import { createRateLimiter } from '../security.js';
import { HttpError, body, json, type Ctx, type Route } from '../router.js';

const credentials = z.object({ email: z.email().max(200), password: z.string().min(10).max(200) }).strict();
const itemSchema = z
  .object({ kind: z.enum(['favorite', 'comparison', 'scenario']), label: z.string().trim().min(1).max(120), payload: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean(), z.array(z.union([z.string().max(80), z.number()])).max(20), z.null()])) })
  .strict();
const alertSchema = z
  .object({ kind: z.enum(['rate_change', 'new_product', 'conditions_change', 'indicator', 'report']), bankSlug: z.string().regex(/^[a-z0-9_]{1,40}$/).nullish(), currency: z.enum(['AZN', 'USD', 'EUR']).nullish() })
  .strict();
const preferences = z.object({ lang: z.enum(['en', 'az']).optional(), theme: z.enum(['light', 'dark']).optional(), currency: z.enum(['AZN', 'USD', 'EUR']).optional() }).strict();

const publicUser = (u: User) => ({ email: u.email, role: u.role, plan: u.plan, preferences: u.preferences, createdAt: u.createdAt });

function requireSameOrigin(c: Ctx) {
  if (!sameOrigin(c.request)) throw new HttpError(403, 'bad_origin');
}
async function requireUser(c: Ctx): Promise<User> {
  if (c.request.method !== 'GET') requireSameOrigin(c);
  const user = await sessionUser(await c.db(), c.request);
  if (!user) throw new HttpError(401, 'unauthorized');
  return user;
}
const id = (c: Ctx) => z.coerce.number().int().positive().parse(c.params.id);

export function accountRoutes(): Route[] {
  // Throttles credential guessing per client and per targeted address.
  const attempts = createRateLimiter(10, 15 * 60_000);
  const throttle = (key: string) => {
    if (!attempts(key).ok) throw new HttpError(429, 'rate_limited');
  };
  const start = async (c: Ctx, user: User) => {
    const token = await createSession(await c.db(), user.id);
    return json({ user: publicUser(user) }, 200, { 'set-cookie': sessionCookie(c.request, token) });
  };

  return [
    {
      method: 'POST', path: 'auth/register', handler: async (c) => {
        requireSameOrigin(c);
        throttle(`register:${c.ip}`);
        const input = await body(c.request, credentials);
        try {
          return await start(c, await createUser(await c.db(), input.email, input.password));
        } catch (e) {
          if (e instanceof EmailTaken) throw new HttpError(409, 'email_unavailable');
          throw e;
        }
      },
    },
    {
      method: 'POST', path: 'auth/login', handler: async (c) => {
        requireSameOrigin(c);
        const input = await body(c.request, credentials);
        throttle(`login-ip:${c.ip}`);
        throttle(`login-mail:${input.email.toLowerCase()}`);
        const user = await authenticate(await c.db(), input.email, input.password);
        if (!user) throw new HttpError(401, 'invalid_credentials');
        return start(c, user);
      },
    },
    {
      method: 'POST', path: 'auth/logout', handler: async (c) => {
        requireSameOrigin(c);
        await endSession(await c.db(), c.request);
        return json({ ok: true }, 200, { 'set-cookie': sessionCookie(c.request, null) });
      },
    },
    { method: 'GET', path: 'auth/me', handler: async (c) => { const u = await sessionUser(await c.db(), c.request); return { user: u ? publicUser(u) : null }; } },
    {
      method: 'GET', path: 'account', handler: async (c) => {
        const user = await requireUser(c);
        const db = await c.db();
        return { items: await account.listItems(db, user.id), subscriptions: await account.listSubscriptions(db, user.id), notifications: await account.listNotifications(db, user.id) };
      },
    },
    { method: 'GET', path: 'account/export', handler: async (c) => { const u = await requireUser(c); return account.exportAccount(await c.db(), u.id); } },
    {
      method: 'POST', path: 'account/items', handler: async (c) => {
        const user = await requireUser(c);
        try {
          return { id: await account.addItem(await c.db(), user.id, await body(c.request, itemSchema)) };
        } catch (e) {
          if (e instanceof account.LimitReached) throw new HttpError(409, 'limit_reached');
          throw e;
        }
      },
    },
    {
      method: 'DELETE', path: 'account/items/:id', handler: async (c) => {
        const user = await requireUser(c);
        if (!(await account.removeItem(await c.db(), user.id, id(c)))) throw new HttpError(404, 'not_found');
        return { ok: true };
      },
    },
    { method: 'POST', path: 'account/alerts', handler: async (c) => { const u = await requireUser(c); await account.subscribe(await c.db(), u.id, await body(c.request, alertSchema)); return { ok: true }; } },
    {
      method: 'DELETE', path: 'account/alerts/:id', handler: async (c) => {
        const user = await requireUser(c);
        if (!(await account.unsubscribe(await c.db(), user.id, id(c)))) throw new HttpError(404, 'not_found');
        return { ok: true };
      },
    },
    { method: 'POST', path: 'account/notifications/read', handler: async (c) => { const u = await requireUser(c); await account.markRead(await c.db(), u.id); return { ok: true }; } },
    { method: 'POST', path: 'account/preferences', handler: async (c) => { const u = await requireUser(c); await account.savePreferences(await c.db(), u.id, await body(c.request, preferences)); return { ok: true }; } },
    {
      method: 'POST', path: 'account/delete', handler: async (c) => {
        const user = await requireUser(c);
        const { password } = await body(c.request, z.object({ password: z.string().max(200) }).strict());
        throttle(`delete:${user.id}`);
        const db = await c.db();
        const [row] = await db.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id=$1', [user.id]);
        if (!(await verifyPassword(password, row!.password_hash))) throw new HttpError(401, 'invalid_credentials');
        await account.deleteAccount(db, user.id);
        return json({ ok: true }, 200, { 'set-cookie': sessionCookie(c.request, null) });
      },
    },
  ];
}
