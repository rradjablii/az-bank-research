/**
 * Polite, safe HTTP client for public data: HTTPS only, host allow-list,
 * robots.txt honoured, per-host spacing, bounded retries and response size.
 * It never attempts to get around 401/403/429 or challenge pages.
 */
export const USER_AGENT_TOKEN = 'AZFinanceIntelligence';
export const userAgent = () => process.env.INGEST_USER_AGENT || `${USER_AGENT_TOKEN}/1.0 (research; public data)`;

const MAX_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 25_000;
const DEFAULT_SPACING_MS = 1_000;

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export interface Fetcher {
  bytes(url: string): Promise<Uint8Array>;
  text(url: string): Promise<string>;
}

export interface RobotsRules {
  allow: string[];
  disallow: string[];
  crawlDelay: number | null;
}

/** Minimal robots.txt parser: our token's group if present, otherwise '*'. */
export function parseRobots(txt: string, token = USER_AGENT_TOKEN): RobotsRules {
  const groups: { agents: string[]; rules: RobotsRules }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/.exec(raw.replace(/#.*$/, ''));
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!;
    if (field === 'user-agent') {
      if (!lastWasAgent || !current) groups.push((current = { agents: [], rules: { allow: [], disallow: [], crawlDelay: null } }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' && value) current.rules.allow.push(value);
    if (field === 'disallow' && value) current.rules.disallow.push(value);
    if (field === 'crawl-delay' && Number.isFinite(Number(value))) current.rules.crawlDelay = Number(value);
  }
  const pick = (name: string) => groups.filter((g) => g.agents.includes(name));
  const chosen = pick(token.toLowerCase()).length ? pick(token.toLowerCase()) : pick('*');
  return {
    allow: chosen.flatMap((g) => g.rules.allow),
    disallow: chosen.flatMap((g) => g.rules.disallow),
    crawlDelay: chosen.find((g) => g.rules.crawlDelay !== null)?.rules.crawlDelay ?? null,
  };
}

export function robotsAllows(rules: RobotsRules, path: string): boolean {
  const longest = (list: string[]) =>
    Math.max(
      -1,
      ...list.map((p) => {
        const anchored = p.endsWith('$');
        const body = (anchored ? p.slice(0, -1) : p).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        return new RegExp(`^${body}${anchored ? '$' : ''}`).test(path) ? p.length : -1;
      }),
    );
  const d = longest(rules.disallow);
  return d < 0 || longest(rules.allow) >= d;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createFetcher(allowedHosts: readonly string[], fetchImpl: typeof fetch = fetch): Fetcher {
  const allowed = new Set(allowedHosts);
  const robots = new Map<string, Promise<RobotsRules>>();
  const nextSlot = new Map<string, number>();

  async function throttle(host: string, spacing: number) {
    const now = Date.now();
    const at = Math.max(now, nextSlot.get(host) ?? 0);
    nextSlot.set(host, at + spacing);
    if (at > now) await sleep(at - now);
  }

  function check(url: URL) {
    if (url.protocol !== 'https:') throw new FetchError(`Refusing non-HTTPS URL ${url.href}`);
    if (!allowed.has(url.hostname)) throw new FetchError(`Host ${url.hostname} is not in the source allow-list`);
  }

  async function raw(start: string): Promise<{ status: number; body: Uint8Array }> {
    let url = new URL(start);
    for (let hop = 0; hop < 5; hop++) {
      check(url);
      const res = await fetchImpl(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'user-agent': userAgent(), accept: '*/*', 'accept-language': 'az,en;q=0.8' },
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        url = new URL(location, url);
        continue;
      }
      if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new FetchError('Response too large');
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (res.body) {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          size += chunk.byteLength;
          if (size > MAX_BYTES) throw new FetchError('Response too large');
          chunks.push(chunk);
        }
      }
      return { status: res.status, body: Buffer.concat(chunks) };
    }
    throw new FetchError('Too many redirects');
  }

  function rulesFor(url: URL) {
    let r = robots.get(url.origin);
    if (!r) {
      r = raw(`${url.origin}/robots.txt`).catch((e) => {
        const cause = (e as { cause?: { code?: string } }).cause?.code;
        throw cause ? new FetchError(`${cause} from ${url.hostname}`, undefined, true) : e;
      }).then((res) => {
        if (res.status === 200) return parseRobots(new TextDecoder().decode(res.body));
        // RFC 9309: 4xx = no restrictions; 5xx = treat as temporarily disallowed.
        if (res.status >= 500 && res.status !== 520) throw new FetchError(`robots.txt unavailable (${res.status})`, res.status, true);
        return { allow: [], disallow: [], crawlDelay: null };
      });
      r.catch(() => robots.delete(url.origin));
      robots.set(url.origin, r);
    }
    return r;
  }

  async function bytes(href: string): Promise<Uint8Array> {
    const url = new URL(href);
    check(url);
    const rules = await rulesFor(url);
    if (!robotsAllows(rules, url.pathname + url.search)) throw new FetchError(`Disallowed by robots.txt: ${url.href}`);
    const spacing = Math.max(DEFAULT_SPACING_MS, (rules.crawlDelay ?? 0) * 1000);
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await sleep(1_500 * 2 ** (attempt - 1));
      await throttle(url.hostname, spacing);
      try {
        const res = await raw(url.href);
        if (res.status === 200) return res.body;
        throw new FetchError(`HTTP ${res.status} from ${url.hostname}`, res.status, res.status >= 500);
      } catch (e) {
        // Surface the underlying network cause (DNS, TLS, reset) instead of "fetch failed".
        const cause = (e as { cause?: { code?: string } }).cause?.code;
        last = cause ? new FetchError(`${cause} from ${url.hostname}`, undefined, true) : e;
        if (cause && /CERT|SIGNATURE/.test(cause)) throw last;
        if (e instanceof FetchError && !e.retryable) throw e;
      }
    }
    throw last;
  }

  return { bytes, text: async (u) => new TextDecoder('utf-8').decode(await bytes(u)) };
}
