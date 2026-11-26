import type { SourceInfo } from './types.js';

/**
 * Data confidence describes how far the platform's copy of a source can be
 * relied on. It is independent of how good a bank's products are.
 */
export interface ConfidenceInput {
  kind: SourceInfo['kind'];
  records: number;
  validatedShare: number;
  hoursSinceSuccess: number | null;
  staleAfterHours: number;
  /** Share of optional fields (publication date, terms) actually present. */
  completeness: number;
  historyDays: number;
}

export const CONFIDENCE_WEIGHTS = { authority: 25, verification: 25, recency: 25, completeness: 15, history: 10 } as const;

export function dataConfidence(i: ConfidenceInput) {
  if (!i.records || i.hoursSinceSuccess === null) return null;
  const parts = {
    authority: i.kind === 'official_statistics' ? 100 : i.kind === 'bank_website' ? 80 : 60,
    verification: 100 * i.validatedShare,
    // Full marks inside the freshness window, then linear decay to zero over three more windows.
    recency: Math.max(0, Math.min(100, 100 - (100 * Math.max(0, i.hoursSinceSuccess - i.staleAfterHours)) / (3 * i.staleAfterHours))),
    completeness: 100 * i.completeness,
    history: Math.min(100, (100 * i.historyDays) / 365),
  };
  const score = (Object.keys(CONFIDENCE_WEIGHTS) as (keyof typeof CONFIDENCE_WEIGHTS)[]).reduce(
    (s, k) => s + (parts[k] * CONFIDENCE_WEIGHTS[k]) / 100,
    0,
  );
  return { score, parts };
}
