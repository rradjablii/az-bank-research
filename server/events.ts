import type { Db, Queryable } from './db/client.js';
import type { ChangeEvent, Currency } from '../shared/types.js';

export async function recordEvent(
  q: Queryable,
  e: { kind: ChangeEvent['kind']; bankSlug: string | null; currency: Currency | null; details: Record<string, unknown>; dedupeKey: string },
) {
  await q.query(
    `INSERT INTO change_events (kind, bank_slug, currency, details, dedupe_key) VALUES ($1,$2,$3,$4::jsonb,$5)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [e.kind, e.bankSlug, e.currency, JSON.stringify(e.details), e.dedupeKey],
  );
}

/**
 * Creates in-app notifications for matching subscriptions. Only events newer than
 * the subscription qualify, and each (user, event) pair is delivered once.
 */
export async function deliverNotifications(db: Db): Promise<number> {
  const rows = await db.query(`
    INSERT INTO notifications (user_id, event_id)
    SELECT DISTINCT s.user_id, e.id FROM alert_subscriptions s
    JOIN change_events e ON e.kind = s.kind AND e.created_at >= s.created_at
      AND (s.bank_slug IS NULL OR e.bank_slug = s.bank_slug)
      AND (s.currency IS NULL OR e.currency = s.currency)
    ON CONFLICT (user_id, event_id) DO NOTHING
    RETURNING 1`);
  return rows.length;
}
