import * as cheerio from 'cheerio';

/** A table expanded to a rectangular grid (rowspan/colspan repeated into each slot). */
export type Grid = string[][];

export const squash = (s: string) => s.replace(/[ \s]+/g, ' ').trim();

export function tables(html: string): Grid[] {
  const $ = cheerio.load(html);
  return $('table')
    .toArray()
    .map((table) => {
      const grid: Grid = [];
      $(table)
        .find('tr')
        .toArray()
        .forEach((tr, y) => {
          grid[y] ??= [];
          let x = 0;
          for (const cell of $(tr).children('th,td').toArray()) {
            while (grid[y]![x] !== undefined) x++;
            const colspan = Math.min(20, Number($(cell).attr('colspan')) || 1);
            const rowspan = Math.min(100, Number($(cell).attr('rowspan')) || 1);
            const text = squash($(cell).text());
            for (let dy = 0; dy < rowspan; dy++) {
              grid[y + dy] ??= [];
              for (let dx = 0; dx < colspan; dx++) grid[y + dy]![x + dx] = text;
            }
            x += colspan;
          }
        });
      return grid.map((row) => Array.from(row, (c) => c ?? ''));
    });
}

/** Visible page text with scripts, styles and comments removed. */
export function pageText(html: string): string {
  const $ = cheerio.load(html);
  $('script,style,noscript,template').remove();
  $('body *').each((_, el) => {
    $(el).prepend(' ').append(' ');
  });
  return squash($('body').text());
}

/** "6,5%" / "6.5 % (illik)" / "3.25" → number; null for blanks and dashes. */
export function parseRate(s: string): number | null {
  const m = /(\d{1,3}(?:[.,]\d{1,4})?)(?:[.,])?\s*%?/.exec(s.replace(/\(.*?\)/g, ''));
  if (!m || /^\s*[-–—]/.test(s)) return null;
  const v = Number(m[1]!.replace(',', '.'));
  return v > 0 && v <= 150 ? v : null;
}

/**
 * Term cell in months. Handles "6", "6 ay", "6 ay - 11 ay", "6 - 11 ay", "1.5 il",
 * ">=36 ay" and lists such as "12/18 ay".
 */
export function parseTerms(s: string): { min: number; max: number }[] {
  const t = squash(s).toLowerCase();
  const factor = /\bil\b/.test(t) && !/\bay\b/.test(t) ? 12 : 1;
  const n = (x: string) => Math.round(Number(x.replace(',', '.')) * factor);
  const body = t.replace(/\b(ay|aylar|il)\b/g, '').replace(/>=|≥/g, '').trim();
  const valid = (v: number) => Number.isInteger(v) && v >= 1 && v <= 120;
  const range = /^(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)$/.exec(body);
  if (range) {
    const [min, max] = [n(range[1]!), n(range[2]!)];
    return valid(min) && valid(max) && min <= max ? [{ min, max }] : [];
  }
  if (/^\d+(?:[.,]\d+)?(\s*\/\s*\d+(?:[.,]\d+)?)*$/.test(body)) {
    return body.split('/').map((x) => n(x.trim())).filter(valid).map((v) => ({ min: v, max: v }));
  }
  return [];
}
