import { z } from 'zod';
import type { Db } from '../db/client.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export interface Ctx {
  request: Request;
  url: URL;
  db: () => Promise<Db>;
  ip: string;
  params: Record<string, string>;
}

export interface Route {
  method: 'GET' | 'POST' | 'DELETE';
  /** Path under /api, with `:name` segments. */
  path: string;
  handler: (ctx: Ctx) => Promise<Response | unknown>;
  /** Public edge caching for anonymous, shared data only. */
  cache?: boolean;
}

export function matchRoute(routes: Route[], method: string, path: string) {
  const parts = path.split('/');
  let pathMatched = false;
  for (const route of routes) {
    const pattern = route.path.split('/');
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    if (!pattern.every((p, i) => (p.startsWith(':') ? /^[A-Za-z0-9_-]{1,80}$/.test(parts[i]!) && ((params[p.slice(1)] = parts[i]!), true) : p === parts[i]))) continue;
    pathMatched = true;
    if (route.method === method || (method === 'HEAD' && route.method === 'GET')) return { route, params };
  }
  return pathMatched ? 'method_not_allowed' : null;
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', ...headers },
  });

/** Reads and validates a small JSON body. */
export async function body<T extends z.ZodType>(request: Request, schema: T, limit = 8000): Promise<z.output<T>> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) throw new HttpError(413, 'payload_too_large');
  const text = await request.text();
  if (text.length > limit) throw new HttpError(413, 'payload_too_large');
  return schema.parse(text ? JSON.parse(text) : {});
}

/** Query parameters minus the platform's routing artefacts. */
export const query = <T extends z.ZodType>(url: URL, schema: T): z.output<T> =>
  schema.parse(Object.fromEntries([...url.searchParams].filter(([k]) => k !== '__path' && k !== 'path')));
