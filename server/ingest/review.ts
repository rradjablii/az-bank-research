/** Rules for the verification workflow. */
export const REVIEW_THRESHOLD = { deposit: 2, loan: 5 } as const;

/** A jump this large is more often a parsing fault than a real repricing, so a person confirms it. */
export function needsReview(previousRate: number, nextRate: number, category: 'deposit' | 'loan'): boolean {
  return Math.abs(nextRate - previousRate) >= REVIEW_THRESHOLD[category];
}
