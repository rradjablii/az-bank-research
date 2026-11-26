import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { Db } from './db/client.js';

const derive = (password: string, salt: Buffer, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scrypt(password.normalize('NFKC'), salt, 32, options, (e, k) => (e ? reject(e) : resolve(k))));

const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS);
  return `scrypt$${PARAMS.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), { ...PARAMS, N: Number(n) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface User {
  id: number;
  email: string;
  role: 'user' | 'admin';
  plan: string;
  preferences: Record<string, unknown>;
  createdAt: string;
}

export const SESSION_COOKIE = 'azfi_session';
const SESSION_DAYS = 30;
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

const toUser = (r: Record<string, any>): User => ({
  id: r.id, email: r.email, role: r.role, plan: r.plan, preferences: r.preferences, createdAt: new Date(r.created_at).toISOString(),
});

export class EmailTaken extends Error {}

export async function createUser(db: Db, email: string, password: string): Promise<User> {
  const rows = await db.query<Record<string, any>>(
    'INSERT INTO users (email, password_hash) VALUES ($1,$2) ON CONFLICT (email) DO NOTHING RETURNING *',
    [email.trim().toLowerCase(), await hashPassword(password)],
  );
  if (!rows[0]) throw new EmailTaken();
  return toUser(rows[0]);
}

let decoy: Promise<string> | null = null;

export async function authenticate(db: Db, email: string, password: string): Promise<User | null> {
  const [row] = await db.query<Record<string, any>>('SELECT * FROM users WHERE email=$1', [email.trim().toLowerCase()]);
  // Spend the same time whether or not the account exists.
  const ok = await verifyPassword(password, row?.password_hash ?? (await (decoy ??= hashPassword('decoy-password'))));
  return row && ok ? toUser(row) : null;
}

/** Returns the raw token (given to the browser once); only its hash is stored. */
export async function createSession(db: Db, userId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  await db.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2, now() + make_interval(days => $3))`, [tokenHash(token), userId, SESSION_DAYS]);
  return token;
}

export function sessionToken(request: Request): string | null {
  const cookie = request.headers.get('cookie') ?? '';
  const m = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([A-Za-z0-9_-]{20,100})`).exec(cookie);
  return m?.[1] ?? null;
}

export async function sessionUser(db: Db, request: Request): Promise<User | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const [row] = await db.query<Record<string, any>>(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash=$1 AND s.expires_at > now()',
    [tokenHash(token)],
  );
  return row ? toUser(row) : null;
}

export async function endSession(db: Db, request: Request) {
  const token = sessionToken(request);
  if (token) await db.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(token)]);
}

export function sessionCookie(request: Request, token: string | null): string {
  const secure = (request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '')) === 'https';
  const age = token ? SESSION_DAYS * 86_400 : 0;
  return `${SESSION_COOKIE}=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
}

/**
 * CSRF defence for cookie-authenticated writes: browsers always send Origin on
 * cross-site POSTs, so it must match the host being addressed.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
