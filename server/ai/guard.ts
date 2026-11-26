/**
 * Checks model output against the evidence. Facts and calculations must cite
 * existing evidence and may contain only figures found in what they cite;
 * anything else is withheld rather than shown.
 */
import type { Evidence } from './evidence.js';
import type { Statement } from './provider.js';

/** All numbers in a text, accepting "9,5" and "9.5" and ignoring thousands separators. */
export function numbersIn(text: string): number[] {
  const cleaned = text.replace(/(\d)[  ](?=\d{3}\b)/g, '$1').replace(/(\d),(?=\d{3}\b(?!\.))/g, '$1');
  return (cleaned.match(/\d+(?:[.,]\d+)?/g) ?? []).map((m) => Number(m.replace(',', '.')));
}

/** True when `n` equals an evidence figure, allowing for rounding to 0, 1 or 2 decimals. */
function supported(n: number, allowed: number[]) {
  return allowed.some((a) => [0, 1, 2].some((d) => Math.abs(Number(a.toFixed(d)) - n) < 1e-9) || Math.abs(a - n) < 1e-9);
}

export function verifyStatements(statements: Statement[], evidence: Evidence[], question: string) {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const kept: Statement[] = [];
  let withheld = 0;
  for (const s of statements) {
    const cited = s.citations.flatMap((c) => byId.get(c) ?? []);
    const validCitations = cited.length === s.citations.length;
    const grounded = s.kind === 'fact' || s.kind === 'calculation';
    // Interpretations and assumptions may restate figures, but only ones present in the evidence or the question.
    const pool = grounded ? cited : evidence;
    const allowed = [...pool.flatMap((e) => [...numbersIn(e.text), ...numbersIn(e.date ?? '')]), ...numbersIn(question), 0, 1, 100];
    const figures = numbersIn(s.text.replace(/\[E\d+\]/g, ''));
    if (!validCitations || (grounded && !cited.length) || figures.some((n) => !supported(n, allowed))) {
      withheld++;
      continue;
    }
    kept.push(s);
  }
  return { statements: kept, withheld };
}
