import { createHash, timingSafeEqual } from 'node:crypto';

export function isAdmin(header: string | null, secret = process.env.ADMIN_SECRET): boolean {
  if (!secret || secret.length < 16 || !header?.startsWith('Bearer ')) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(header.slice(7)), digest(secret));
}

/**
 * Fixed-window limiter held in instance memory. It bounds abuse per instance;
 * use Vercel Firewall rate-limit rules for a global limit.
 */
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (key: string, now = Date.now()) => {
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    let h = hits.get(key);
    if (!h || h.reset <= now) hits.set(key, (h = { count: 0, reset: now + windowMs }));
    h.count++;
    return { ok: h.count <= limit, retryAfter: Math.ceil((h.reset - now) / 1000) };
  };
}
