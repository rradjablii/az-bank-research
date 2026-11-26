import { useCallback, useEffect, useState } from 'react';
import type {
  ChangeEvent, IngestionLog, InflationPoint, MarketPoint, PolicyPoint, ProductTermsRow, RateRow, SeriesSourceInfo, Snapshot, SourceInfo,
} from '../../shared/types';
import type { HistoryStats, IndexInput } from '../../shared/index-score';
import type { ReportData, ReportType } from '../../shared/report';

export type SeriesInfo = (SeriesSourceInfo & { latestPeriod: string | null }) | null;

export interface BankSummary {
  slug: string; name: string; website: string; accessStatus: string; accessNote: string | null;
  freshness: SeriesSourceInfo['freshness']; lastVerifiedAt: string | null;
}
export interface HistoryRow {
  productName: string; currency: string; termMin: number | null; termMax: number | null; payout: string; variant: string;
  rate: number; verification: string; from: string; until: string | null;
}

export interface Responses {
  meta: { generatedAt: string; sources: SourceInfo[]; rates: SeriesInfo; inflation: SeriesInfo };
  rates: { rows: RateRow[] };
  market: { points: MarketPoint[]; source: SeriesInfo };
  inflation: { points: InflationPoint[]; source: SeriesInfo };
  policy: { points: PolicyPoint[]; source: SeriesInfo };
  snapshots: { snapshots: Snapshot[] };
  logs: { logs: IngestionLog[] };
  terms: { terms: ProductTermsRow[] };
  banks: { banks: BankSummary[] };
  bank: { bank: BankSummary; history: HistoryRow[]; events: ChangeEvent[] };
  index: {
    rates: RateRow[]; terms: ProductTermsRow[]; history: Record<string, HistoryStats>; inflation: IndexInput['inflation'];
    scoreHistory: { date: string; methodology: string; bankSlug: string; score: number | null; coverage: number; provisional: boolean }[];
  };
  confidence: { sources: { key: string; publisher: string; score: number | null; parts: Record<string, number> | null }[] };
  reports: { reports: { slug: string; type: ReportType; period: string; publishedAt: string }[] };
  report: { slug: string; publishedAt: string; data: ReportData };
  aiStatus: { enabled: boolean; model: string | null };
}

const PATHS: Partial<Record<keyof Responses, string>> = { bank: 'banks/', report: 'reports/', aiStatus: 'ai/status' };

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

export async function request<T = unknown>(path: string, init?: { method?: 'POST' | 'DELETE' | 'GET'; body?: unknown; secret?: string }): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers['content-type'] = 'application/json';
  if (init?.secret) headers.authorization = `Bearer ${init.secret}`;
  const res = await fetch(`/api/${path}`, { method: init?.method ?? 'GET', headers, body: init?.body === undefined ? undefined : JSON.stringify(init.body) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`, res.status);
  if (!body) throw new ApiError('invalid_response', res.status);
  return body as T;
}

/** Cached for five minutes at most, so a long-lived tab does not show old figures indefinitely. */
const MAX_AGE = 5 * 60_000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();
export const clearApiCache = () => cache.clear();

export function useApi<K extends keyof Responses>(name: K, query = '', segment = ''): ApiState<Responses[K]> {
  const base = `${PATHS[name] ?? name}${segment}`;
  const path = query ? `${base}?${query}` : base;
  const [state, setState] = useState<ApiState<Responses[K]> & { path: string }>({ path, data: null, error: null, loading: true });
  useEffect(() => {
    let live = true;
    let entry = cache.get(path);
    if (!entry || Date.now() - entry.at > MAX_AGE) {
      entry = { at: Date.now(), value: request(path) };
      cache.set(path, entry);
      entry.value.catch(() => cache.delete(path));
    }
    entry.value.then(
      (data) => live && setState({ path, data: data as Responses[K], error: null, loading: false }),
      (e: Error) => live && setState({ path, data: null, error: e.message, loading: false }),
    );
    return () => {
      live = false;
    };
  }, [path]);
  // Never show the previous query's data under a new filter.
  return state.path === path ? state : { data: null, error: null, loading: true };
}

/** Private data: never cached, reloadable after changes. */
export function useLive<T>(path: string | null, secret?: string) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<ApiState<T>>({ data: null, error: null, loading: true });
  useEffect(() => {
    if (!path) return;
    let live = true;
    request<T>(path, { secret }).then(
      (data) => live && setState({ data, error: null, loading: false }),
      (e: Error) => live && setState({ data: null, error: e.message, loading: false }),
    );
    return () => {
      live = false;
    };
  }, [path, secret, version]);
  return { ...state, reload: useCallback(() => setVersion((v) => v + 1), []) };
}

export interface SessionUser {
  email: string;
  role: 'user' | 'admin';
  preferences?: Record<string, unknown>;
}

export const marketQuery = (metric: string, basis: string, extra: Record<string, string> = {}) =>
  new URLSearchParams({ metric, basis, ...extra }).toString();
