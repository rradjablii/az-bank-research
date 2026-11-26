import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

export type Cell = string | number;
/** Sparse row: column letters → value. */
export type Row = { index: number; cells: Record<string, Cell> };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: { enabled: true, maxTotalExpansions: 1_000_000, maxExpandedLength: 50_000_000 },
  isArray: (name) => ['row', 'c', 'si', 'r', 'sheet', 'Relationship'].includes(name),
});

const MAX_UNZIPPED = 60 * 1024 * 1024;

function textOf(node: unknown): string {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(textOf).join('');
  const o = node as Record<string, unknown>;
  return textOf(o['#text']) + textOf(o.t) + textOf(o.r);
}

/** Reads only the requested worksheets of an .xlsx file (values, no styles or formulas). */
export function readSheets(data: Uint8Array, wanted: string[]): Record<string, Row[]> {
  const unzip = (filter: (name: string) => boolean) =>
    unzipSync(data, {
      filter: (f) => {
        if (!filter(f.name)) return false;
        if (f.originalSize > MAX_UNZIPPED) throw new Error('Workbook entry too large');
        return true;
      },
    });
  const index = unzip((n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml');
  const xml = (bytes: Uint8Array | undefined) => (bytes ? parser.parse(strFromU8(bytes)) : null);
  const workbook = xml(index['xl/workbook.xml']);
  const rels = xml(index['xl/_rels/workbook.xml.rels']);
  if (!workbook || !rels) throw new Error('Not a valid .xlsx workbook');
  const shared: string[] = (xml(index['xl/sharedStrings.xml'])?.sst?.si ?? []).map(textOf);
  const targets = new Map<string, string>(
    rels.Relationships.Relationship.map((r: { Id: string; Target: string }) => [r.Id, r.Target]),
  );

  const paths = new Map<string, string>();
  for (const s of workbook.workbook.sheets.sheet as { name: string; 'r:id': string }[]) {
    const name = s.name.trim();
    if (!wanted.includes(name)) continue;
    const t = targets.get(s['r:id'])!.replace(/^\//, '');
    paths.set(name, t.startsWith('xl/') ? t : `xl/${t}`);
  }
  const missing = wanted.filter((w) => !paths.has(w));
  if (missing.length) throw new Error(`Workbook is missing sheet(s): ${missing.join(', ')}`);

  const files = unzip((n) => [...paths.values()].includes(n));
  const out: Record<string, Row[]> = {};
  for (const [name, path] of paths) {
    const sheet = xml(files[path]);
    out[name] = (sheet?.worksheet?.sheetData?.row ?? []).map((row: any) => {
      const cells: Record<string, Cell> = {};
      for (const c of row.c ?? []) {
        const raw = c.t === 'inlineStr' ? textOf(c.is) : textOf(c.v);
        const value: Cell =
          c.t === 's' ? (shared[Number(raw)] ?? '') : c.t === 'str' || c.t === 'inlineStr' || c.t === 'e' || c.t === 'b' ? raw : raw === '' ? '' : Number(raw);
        const clean = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value;
        if (clean !== '') cells[String(c.r).replace(/\d+/g, '')] = clean;
      }
      return { index: Number(row.r), cells };
    });
  }
  return out;
}

/** Excel serial number or "dd.mm.yyyy" → ISO date; null for anything else. */
export function cellDate(v: Cell | undefined): string | null {
  if (typeof v === 'number') {
    if (v < 30000 || v > 80000 || !Number.isInteger(v)) return null;
    return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  }
  const m = typeof v === 'string' ? /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
