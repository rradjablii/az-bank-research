import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPglite, createPostgres, DatabaseNotConfigured, type Db } from '../server/db/client';
import { migrate } from '../server/db/migrate';
import { createApp } from '../server/http/app';
import { isAdmin } from '../server/http/security';
import { runIngestion } from '../server/ingest/pipeline';
import type { OfferRecord, SourceAdapter } from '../server/ingest/types';
import * as repo from '../server/repo';

vi.spyOn(console, 'log').mockImplementation(() => {});

const URL_ = 'https://bank.az/deposits';
const offer = (rate: number, termMin = 12): OfferRecord & { sourceUrl: string } => ({
  productKey: 'term', productName: 'Term deposit', productType: 'term_deposit', productUrl: URL_, sourceUrl: URL_,
  currency: 'AZN', termMin, termMax: termMin, payout: 'at_maturity', variant: 'standard', rate,
});

let mode: 'ok' | 'fail' | 'partial' = 'ok';
let offers = [offer(9), offer(8, 6)];
const bankSource: SourceAdapter = {
  key: 'bank_test', name: 'Test bank pages', publisher: 'Test Bank', kind: 'bank_website', url: URL_, format: 'HTML',
  updateFrequency: 'Daily', accessStatus: 'active', bank: { slug: 'test', name: 'Test Bank', website: 'https://bank.az' },
  hosts: ['bank.az'], minRefreshHours: 12, staleAfterHours: 48,
  async collect() {
    if (mode === 'fail') throw new Error('network down');
    return { documents: [{ url: URL_, payload: { offers } }], offers, warnings: mode === 'partial' ? ['second page failed'] : [] };
  },
};
let cbarValue = 8.1;
const officialSource: SourceAdapter = {
  key: 'cbar_rates', name: 'CBAR rates', publisher: 'CBAR', kind: 'official_statistics', url: 'https://www.cbar.az/', format: 'XLSX',
  updateFrequency: 'Monthly', accessStatus: 'active', hosts: ['www.cbar.az'], minRefreshHours: 12, staleAfterHours: 168,
  async collect() {
    const url = 'https://www.cbar.az/x.xlsx';
    return {
      documents: [{ url, payload: { v: cbarValue } }],
      market: [{ metric: 'deposit_rate', basis: 'new_business', currencyGroup: 'AZN', segment: 'total', bucket: 'all', periodDate: '2026-10-01', frequency: 'monthly', rate: cbarValue, sourceUrl: url }],
      inflation: [{ periodDate: '2026-09-01', measure: 'cpi_yoy', value: 5.4755, sourceUrl: url }],
    };
  },
};

function pipelineSuite(name: string, setup: () => Promise<{ db: Db; teardown: () => Promise<void> }>) {
  describe(`ingestion and API (${name})`, () => {
    let db: Db;
    let teardown: () => Promise<void>;
    const run = (force = true) => runIngestion(db, { trigger: 'cli', force, adapters: [bankSource, officialSource] });
    const current = async () => (await repo.loadRates(db)).map((r) => [r.termMin, r.rate]);
    const count = async (sql: string) => Number((await db.query<{ n: string }>(sql))[0]!.n);

    beforeAll(async () => {
      mode = 'ok';
      offers = [offer(9), offer(8, 6)];
      cbarValue = 8.1;
      ({ db, teardown } = await setup());
      await migrate(db);
    });
    afterAll(() => teardown());

    it('applies migrations once', async () => {
      expect(await migrate(db)).toEqual([]);
    });

    it('stores raw and normalised records and is idempotent', async () => {
      const first = await run();
      expect(first.map((r) => [r.key, r.status, r.inserted])).toEqual([['bank_test', 'success', 2], ['cbar_rates', 'success', 2]]);
      const second = await run();
      expect(second.map((r) => [r.inserted, r.unchanged])).toEqual([[0, 2], [0, 2]]);
      expect(await count('SELECT count(*) AS n FROM raw_source_records')).toBe(2);
      expect(await count('SELECT count(*) AS n FROM historical_snapshots')).toBeGreaterThan(0);
    });

    it('respects the minimum refresh interval unless forced', async () => {
      expect((await run(false)).every((r) => r.status === 'skipped')).toBe(true);
    });

    it('preserves history when values change or are revised', async () => {
      offers = [offer(9.5), offer(8, 6)];
      cbarValue = 8.25;
      await run();
      expect(await current()).toEqual([[6, 8], [12, 9.5]]);
      expect(await count('SELECT count(*) AS n FROM interest_rate_observations WHERE superseded_at IS NOT NULL')).toBe(1);
      expect(await count('SELECT count(*) AS n FROM market_statistics')).toBe(2);
      expect((await repo.loadMarket(db, { metric: 'deposit_rate', basis: 'new_business' })).map((p) => p.rate)).toEqual([8.25]);
    });

    it('keeps last verified values and marks them when a refresh fails', async () => {
      mode = 'fail';
      const [bank] = await run();
      expect(bank).toMatchObject({ status: 'failed', message: 'network down' });
      const rows = await repo.loadRates(db);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.freshness === 'refresh_failed')).toBe(true);
    });

    it('does not retire rates after a partial run, but does after a clean one', async () => {
      mode = 'partial';
      offers = [offer(9.5)];
      await run();
      expect(await current()).toHaveLength(2);
      mode = 'ok';
      await run();
      expect(await current()).toEqual([[12, 9.5]]);
    });

    it('serves validated JSON endpoints', async () => {
      const app = createApp({ db: async () => db, ingest: runIngestion });
      const get = async (path: string) => {
        const res = await app(new Request(`https://x.test/api/${path}`));
        return { status: res.status, body: (await res.json()) as any, headers: res.headers };
      };
      const rates = await get('rates');
      expect(rates.status).toBe(200);
      expect(rates.body.rows[0]).toMatchObject({ bankName: 'Test Bank', rate: 9.5, sourceUrl: URL_, sourceName: 'Test bank pages' });
      expect(rates.body.rows[0].lastVerifiedAt).toBeTruthy();
      expect(rates.headers.get('cache-control')).not.toContain('stale-while-revalidate');
      expect(rates.headers.get('cdn-cache-control')).toContain('s-maxage=120');
      expect((await get('market?metric=deposit_rate&basis=new_business')).body.points).toHaveLength(1);
      // Vercel rewrite form.
      expect((await get('?__path=market&metric=deposit_rate&basis=new_business')).status).toBe(200);
      expect((await get('inflation')).body.points[0].yoy).toBe(5.4755);
      expect((await get('meta')).body.sources).toHaveLength(2);
      expect((await get('market?metric=deposit_rate')).status).toBe(400);
      expect((await get("market?metric=deposit_rate&basis=new_business&bucket='%3B--")).status).toBe(400);
      expect((await get('market?metric=deposit_rate&basis=new_business&x=1')).status).toBe(400);
      expect((await get('nope')).status).toBe(404);
      expect((await get('constructor')).status).toBe(404);
      expect((await app(new Request('https://x.test/api/rates', { method: 'DELETE' }))).status).toBe(405);
    });

    it('protects the refresh endpoint', async () => {
      vi.stubEnv('ADMIN_SECRET', 'a-long-test-secret-value');
      const ingest = vi.fn().mockResolvedValue([]);
      const app = createApp({ db: async () => db, ingest });
      const post = (auth?: string, body = '{}') =>
        app(new Request('https://x.test/api/admin/refresh', { method: 'POST', headers: auth ? { authorization: auth } : {}, body }));
      expect((await post()).status).toBe(401);
      expect((await post('Bearer wrong')).status).toBe(401);
      expect(ingest).not.toHaveBeenCalled();
      const ok = 'Bearer a-long-test-secret-value';
      expect((await post(ok, '{"force":true,"sources":["cbar_rates"]}')).status).toBe(200);
      expect(ingest).toHaveBeenCalledWith(db, { trigger: 'manual', keys: ['cbar_rates'], force: true });
      expect((await post(ok, '{"sources":["DROP TABLE"]}')).status).toBe(400);
      expect((await post(ok, 'not json')).status).toBe(400);
      expect((await post(ok, ' '.repeat(5000))).status).toBe(413);
      expect((await app(new Request('https://x.test/api/admin/refresh'))).status).toBe(405);
      vi.unstubAllEnvs();
    });
  });
}

pipelineSuite('embedded PGlite', async () => {
  const db = await createPglite();
  return { db, teardown: () => db.close() };
});

// The same flow through the node-postgres driver used in production (Neon).
pipelineSuite('node-postgres over the wire protocol', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const lite = await PGlite.create();
  const server = new PGLiteSocketServer({ db: lite, port: 0, host: '127.0.0.1', maxConnections: 10 });
  const listening = new Promise<number>((resolve) => server.addEventListener('listening', (e) => resolve((e as CustomEvent<{ port: number }>).detail.port)));
  await server.start();
  const db = await createPostgres(`postgresql://postgres@127.0.0.1:${await listening}/postgres?sslmode=disable`);
  return {
    db,
    teardown: async () => {
      await db.close();
      await server.stop();
      await lite.close();
    },
  };
});

describe('security and resilience', () => {
  it('requires a sufficiently long configured secret', () => {
    expect(isAdmin('Bearer short', 'short')).toBe(false);
    expect(isAdmin('Bearer anything', undefined)).toBe(false);
    expect(isAdmin(null, 'a-long-test-secret-value')).toBe(false);
  });
  it('rate limits and reports a missing database without leaking details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const missing = createApp({ db: async () => { throw new DatabaseNotConfigured(); }, ingest: runIngestion });
    const res = await missing(new Request('https://x.test/api/rates'));
    expect([res.status, await res.json()]).toEqual([503, { error: 'database_not_configured' }]);
    const broken = createApp({ db: async () => { throw new Error('password=hunter2'); }, ingest: runIngestion });
    const r2 = await broken(new Request('https://x.test/api/rates'));
    expect(await r2.json()).toEqual({ error: 'internal_error' });
    let last = 200;
    for (let i = 0; i < 305; i++) last = (await missing(new Request('https://x.test/api/rates', { headers: { 'x-real-ip': '9.9.9.9' } }))).status;
    expect(last).toBe(429);
  });
});
