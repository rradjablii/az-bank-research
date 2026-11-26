export type Lang = 'en' | 'az';

// Many browser ICU builds ship without Azerbaijani data and silently print
// placeholders such as "2026 M11 26", so Azerbaijani dates are composed here and
// numbers borrow the identical "1.234,56" convention from de-DE.
const AZ_MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avq', 'sen', 'okt', 'noy', 'dek'];

/** Calendar parts of an ISO value in the given time zone. */
function parts(iso: string, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: 'numeric', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return { day: p.day!, month: Number(p.month) - 1, year: p.year!, time: `${p.hour}:${p.minute}` };
}

export function formatters(lang: Lang) {
  const az = lang === 'az';
  const number = (v: number | null | undefined, digits = 2) =>
    v === null || v === undefined || !Number.isFinite(v)
      ? '—'
      : new Intl.NumberFormat(az ? 'de-DE' : 'en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  const month = (m: number) => (az ? AZ_MONTHS[m]! : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m]!);
  const date = (iso: string, zone = 'UTC') => {
    const p = parts(iso, zone);
    return `${p.day} ${month(p.month)} ${p.year}`;
  };
  return {
    number,
    pct: (v: number | null | undefined, digits = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${number(v, digits)}%`),
    money: (v: number, currency = 'AZN') => `${number(v, 2)} ${currency}`,
    date: (iso: string | null | undefined) => (iso ? date(iso) : '—'),
    dateTime: (iso: string | null | undefined) => (iso ? `${date(iso, 'Asia/Baku')}, ${parts(iso, 'Asia/Baku').time}` : '—'),
    month: (iso: string | null | undefined) => {
      if (!iso) return '—';
      const p = parts(iso, 'UTC');
      return `${month(p.month)} ${p.year}`;
    },
  };
}
