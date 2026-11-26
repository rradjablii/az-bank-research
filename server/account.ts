import type { Db } from './db/client.js';
import type { ChangeEvent } from '../shared/types.js';

export class LimitReached extends Error {}
const MAX_ITEMS = 100;

export async function listItems(db: Db, userId: number) {
  const rows = await db.query<Record<string, any>>('SELECT id, kind, label, payload, created_at FROM user_items WHERE user_id=$1 ORDER BY id DESC', [userId]);
  return rows.map((r) => ({ id: r.id as number, kind: r.kind as string, label: r.label as string, payload: r.payload as Record<string, unknown>, createdAt: new Date(r.created_at).toISOString() }));
}

export async function addItem(db: Db, userId: number, item: { kind: string; label: string; payload: unknown }) {
  const [c] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM user_items WHERE user_id=$1', [userId]);
  if (c!.n >= MAX_ITEMS) throw new LimitReached();
  const [row] = await db.query<{ id: number }>('INSERT INTO user_items (user_id, kind, label, payload) VALUES ($1,$2,$3,$4::jsonb) RETURNING id', [userId, item.kind, item.label, JSON.stringify(item.payload)]);
  return row!.id;
}

// Every statement is scoped by user_id so one account cannot touch another's rows.
export const removeItem = async (db: Db, userId: number, id: number) =>
  (await db.query('DELETE FROM user_items WHERE id=$1 AND user_id=$2 RETURNING 1', [id, userId])).length > 0;

export async function listSubscriptions(db: Db, userId: number) {
  const rows = await db.query<Record<string, any>>('SELECT id, kind, bank_slug, currency FROM alert_subscriptions WHERE user_id=$1 ORDER BY id', [userId]);
  return rows.map((r) => ({ id: r.id as number, kind: r.kind as ChangeEvent['kind'], bankSlug: r.bank_slug as string | null, currency: r.currency as string | null }));
}

export async function subscribe(db: Db, userId: number, s: { kind: string; bankSlug?: string | null; currency?: string | null }) {
  const [c] = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM alert_subscriptions WHERE user_id=$1', [userId]);
  if (c!.n >= MAX_ITEMS) throw new LimitReached();
  await db.query(
    `INSERT INTO alert_subscriptions (user_id, kind, bank_slug, currency) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, kind, (COALESCE(bank_slug,'')), (COALESCE(currency,''))) DO NOTHING`,
    [userId, s.kind, s.bankSlug ?? null, s.currency ?? null],
  );
}

export const unsubscribe = async (db: Db, userId: number, id: number) =>
  (await db.query('DELETE FROM alert_subscriptions WHERE id=$1 AND user_id=$2 RETURNING 1', [id, userId])).length > 0;

export async function listNotifications(db: Db, userId: number) {
  const rows = await db.query<Record<string, any>>(
    `SELECT n.id, n.read_at, e.kind, e.bank_slug, e.currency, e.details, e.created_at
     FROM notifications n JOIN change_events e ON e.id = n.event_id WHERE n.user_id=$1 ORDER BY n.id DESC LIMIT 100`,
    [userId],
  );
  return rows.map((r) => ({
    id: Number(r.id), read: r.read_at !== null, kind: r.kind as ChangeEvent['kind'], bankSlug: r.bank_slug as string | null,
    currency: r.currency as string | null, details: r.details as Record<string, unknown>, createdAt: new Date(r.created_at).toISOString(),
  }));
}

export const markRead = (db: Db, userId: number) => db.query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [userId]);

export const savePreferences = (db: Db, userId: number, preferences: Record<string, unknown>) =>
  db.query('UPDATE users SET preferences = preferences || $2::jsonb WHERE id=$1', [userId, JSON.stringify(preferences)]);

/** Everything stored about an account, for the user's own download. */
export async function exportAccount(db: Db, userId: number) {
  const [user] = await db.query('SELECT email, plan, preferences, created_at FROM users WHERE id=$1', [userId]);
  return { user, items: await listItems(db, userId), subscriptions: await listSubscriptions(db, userId), notifications: await listNotifications(db, userId) };
}

/** Cascades to sessions, items, subscriptions and notifications. */
export const deleteAccount = (db: Db, userId: number) => db.query('DELETE FROM users WHERE id=$1', [userId]);
