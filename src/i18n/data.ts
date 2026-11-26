import type { Lang } from '../lib/format';

/**
 * Azerbaijani renderings of descriptive text stored with the data by our own
 * adapters. Text quoted from a bank is left as published.
 */
const az: Record<string, string> = {
  'Classic term deposit': 'Klassik müddətli depozit', DigiDeposit: 'DigiDeposit', 'Term deposit': 'Müddətli depozit',
  'MyAccess online term deposit': 'MyAccess onlayn müddətli depozit', 'High-yield deposit campaign': 'Yüksək gəlirli depozit kampaniyası',
  'Dynamic deposit': 'Dinamik əmanət', 'Digital deposit': 'Rəqəmsal depozit', 'Classic deposit': 'Klassik əmanət', 'Premium deposit': 'Premium əmanət',
  'Universal deposit': 'Universal əmanət', 'Dollar deposit campaign (package 1)': 'Dollar əmanəti kampaniyası (paket 1)',
  'Dollar deposit campaign (package 2)': 'Dollar əmanəti kampaniyası (paket 2)', 'Savings deposit (with monthly top-ups)': 'Yığım əmanəti (aylıq artımla)',
  'Savings deposit (without monthly top-ups)': 'Yığım əmanəti (aylıq artımsız)', 'Affordable savings deposit': 'Sərfəli əmanət',
  'Advance-interest deposit': 'Avans depoziti', 'Yelo Sabit term deposit': 'Yelo Sabit müddətli depozit',
  'Yelo Sərbəst flexible deposit': 'Yelo Sərbəst depozit', 'Standard term deposit': 'Standart müddətli depozit', 'Cash consumer loan': 'Nağd istehlak krediti',
  'Partial withdrawals permitted': 'Qismən çıxarışa icazə verilir', 'Interest paid upfront when the deposit is opened': 'Faiz əmanət açılan kimi əvvəlcədən ödənilir',
  'Interest capitalised monthly, paid at maturity': 'Faiz hər ay kapitallaşdırılır, müddətin sonunda ödənilir',
  Monthly: 'Aylıq', 'Irregular (checked daily)': 'Qeyri-müntəzəm (hər gün yoxlanılır)', 'Operator-defined': 'Operator tərəfindən müəyyən edilir',
  'Central Bank of the Republic of Azerbaijan': 'Azərbaycan Respublikasının Mərkəzi Bankı',
  'Central Bank of Azerbaijan, citing the State Statistics Committee': 'Azərbaycan Mərkəzi Bankı (Dövlət Statistika Komitəsinə istinadən)',
  'CBAR — average interest rates on deposits and loans (tables 3.2, 3.2.1)': 'AMB — depozit və kreditlər üzrə orta faiz dərəcələri (cədvəl 3.2, 3.2.1)',
  'CBAR statistical bulletin — inflation and policy rates (tables 1.1, 3.1)': 'AMB statistik bülleteni — inflyasiya və uçot dərəcələri (cədvəl 1.1, 3.1)',
  'The server sends an incomplete TLS certificate chain, which Node.js rejects. Certificate verification is never disabled, so rates stay unavailable until the bank fixes its configuration.':
    'Server natamam TLS sertifikat zənciri göndərir və Node.js onu rədd edir. Sertifikat yoxlaması söndürülmür, ona görə bank konfiqurasiyanı düzəldənədək faizlər əlçatan olmayacaq.',
  'Website returns HTTP 403 to automated clients. Protection is respected, not bypassed.': 'Sayt avtomatik sorğulara HTTP 403 qaytarır. Qoruma aşılmır, ona riayət edilir.',
  'Public page states only a headline "up to" rate without a term table, so it is not comparable.': 'Açıq səhifədə müddət cədvəli olmadan yalnız «-dək» faiz göstərilir, ona görə müqayisə mümkün deyil.',
  'Term-level rate table is not present in the public page source (headline rate only).': 'Açıq səhifənin kodunda müddətlər üzrə faiz cədvəli yoxdur (yalnız ümumi faiz).',
  'No public deposit rate page with a term table was identified.': 'Müddət cədvəli olan açıq depozit faizi səhifəsi tapılmadı.',
  'Operator-configured authorised feed': 'Operatorun qurduğu icazəli məlumat axını',
};

export function localize(lang: Lang, text: string): string;
export function localize(lang: Lang, text: string | null): string | null;
export function localize(lang: Lang, text: string | null): string | null {
  if (lang !== 'az' || !text) return text;
  return az[text] ?? text.replace(/ — public product pages$/, ' — açıq məhsul səhifələri').replace(/ — not collected$/, ' — toplanmır').replace(/^Advertised:/, 'Elan edilib:');
}
