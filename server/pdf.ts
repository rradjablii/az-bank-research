import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ReportChart, ReportDoc, ReportTable } from '../shared/report.js';

const W = 595.28;
const H = 841.89;
const M = 48;
const INK = rgb(0.07, 0.1, 0.17);
const MUTED = rgb(0.33, 0.38, 0.48);
const LINE = rgb(0.86, 0.89, 0.92);
const SERIES = [rgb(0.15, 0.49, 0.88), rgb(0.96, 0.45, 0.19), rgb(0, 0.72, 0.58)];

const fontFile = (name: string) => readFile(join(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf', name));

/** Renders a report document to PDF with an embedded font that covers Azerbaijani. */
export async function reportPdf(doc: ReportDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(await fontFile('DejaVuSans.ttf'), { subset: true });
  const bold = await pdf.embedFont(await fontFile('DejaVuSans-Bold.ttf'), { subset: true });
  pdf.setTitle(doc.title);
  pdf.setAuthor('AZ Finance Intelligence');

  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  const need = (h: number) => {
    if (y - h < M) newPage();
  };
  const wrap = (text: string, font: PDFFont, size: number, width: number) => {
    const lines: string[] = [];
    let line = '';
    for (let word of text.split(/\s+/)) {
      // Hard-break tokens longer than the line (e.g. URLs).
      while (font.widthOfTextAtSize(word, size) > width) {
        let cut = word.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > width) cut--;
        if (line) lines.push(line);
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
        line = '';
      }
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  const text = (value: string, { font = regular, size = 9.5, color = INK, gap = 4 } = {}) => {
    for (const line of wrap(value, font, size, W - 2 * M)) {
      need(size * 1.45);
      y -= size * 1.45;
      page.drawText(line, { x: M, y, size, font, color });
    }
    y -= gap;
  };

  const table = (t: ReportTable) => {
    need(60);
    text(t.caption, { font: bold, size: 9 });
    const size = 7.5;
    const cols = t.head.length;
    // First column is wider; the remainder share the rest equally.
    const first = cols > 2 ? (W - 2 * M) * 0.24 : (W - 2 * M) * 0.55;
    const other = (W - 2 * M - first) / Math.max(1, cols - 1);
    const widths = t.head.map((_, i) => (i === 0 ? first : other));
    const row = (cells: string[], font: PDFFont, color = INK) => {
      const wrapped = cells.map((c, i) => wrap(c, font, size, widths[i]! - 6));
      const height = Math.max(...wrapped.map((w) => w.length)) * size * 1.35 + 5;
      need(height);
      let x = M;
      wrapped.forEach((lines, i) => {
        lines.forEach((line, k) => page.drawText(line, { x, y: y - (k + 1) * size * 1.35, size, font, color }));
        x += widths[i]!;
      });
      y -= height;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE });
    };
    row(t.head, bold, MUTED);
    t.rows.forEach((r) => row(r, regular));
    y -= 10;
  };

  const chart = (c: ReportChart) => {
    const values = c.series.flatMap((s) => s.values).filter((v): v is number => v !== null);
    if (!values.length) return;
    const height = 150;
    need(height + 55);
    text(c.caption, { font: bold, size: 9 });
    const min = c.kind === 'bar' ? Math.min(0, ...values) : Math.min(...values);
    const max = Math.max(...values, min + 1);
    const x0 = M + 30;
    const width = W - M - x0;
    const base = y - height;
    const sy = (v: number) => base + ((v - min) / (max - min)) * (height - 10);
    for (const v of [min, (min + max) / 2, max]) {
      page.drawLine({ start: { x: x0, y: sy(v) }, end: { x: W - M, y: sy(v) }, thickness: 0.5, color: LINE });
      page.drawText(v.toFixed(1), { x: M, y: sy(v) - 3, size: 7, font: regular, color: MUTED });
    }
    const n = c.labels.length;
    if (c.kind === 'bar') {
      const slot = width / n;
      c.series[0]!.values.forEach((v, i) => {
        if (v === null) return;
        page.drawRectangle({ x: x0 + i * slot + slot * 0.15, y: sy(Math.min(0, v)), width: slot * 0.7, height: Math.abs(sy(v) - sy(0 > min ? 0 : min)), color: SERIES[0] });
      });
    } else {
      c.series.forEach((s, k) => {
        s.values.forEach((v, i) => {
          const prev = s.values[i - 1];
          if (i === 0 || v === null || prev === null || prev === undefined) return;
          page.drawLine({ start: { x: x0 + ((i - 1) / (n - 1)) * width, y: sy(prev) }, end: { x: x0 + (i / (n - 1)) * width, y: sy(v) }, thickness: 1.4, color: SERIES[k % 3] });
        });
      });
    }
    // Category labels for short bar charts, end labels otherwise.
    const shown = c.kind === 'bar' && n <= 12 ? c.labels.map((l, i) => [l, x0 + (i + 0.5) * (width / n)] as const) : [[c.labels[0]!, x0 + 15] as const, [c.labels[n - 1]!, W - M - 20] as const];
    for (const [label, cx] of shown) {
      const short = label.length > 11 ? `${label.slice(0, 10)}…` : label;
      page.drawText(short, { x: cx - regular.widthOfTextAtSize(short, 6) / 2, y: base - 10, size: 6, font: regular, color: MUTED });
    }
    y = base - 18;
    let lx = M;
    c.series.forEach((s, k) => {
      page.drawRectangle({ x: lx, y: y - 7, width: 10, height: 3, color: SERIES[k % 3] });
      page.drawText(s.name, { x: lx + 14, y: y - 9, size: 7, font: regular, color: MUTED });
      lx += 26 + regular.widthOfTextAtSize(s.name, 7);
    });
    y -= 22;
  };

  newPage();
  text('AZ FINANCE INTELLIGENCE', { font: bold, size: 8, color: MUTED });
  text(doc.title, { font: bold, size: 17 });
  text(doc.subtitle, { size: 8.5, color: MUTED, gap: 12 });
  for (const section of doc.sections) {
    need(48);
    y -= 6;
    text(section.heading, { font: bold, size: 11.5 });
    section.paragraphs.forEach((p) => text(p));
    section.tables?.forEach(table);
    section.charts?.forEach(chart);
  }
  pdf.getPages().forEach((p, i, all) => p.drawText(`${i + 1} / ${all.length}`, { x: W - M - 28, y: 24, size: 7, font: regular, color: MUTED }));
  return pdf.save();
}
