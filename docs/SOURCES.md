# Data sources — investigation of 26 November 2026

## Official

| Data | Where | Format | Frequency | Used |
|---|---|---|---|---|
| Average rates on outstanding time deposits and loans (table 3.2) | [CBAR monetary indicators](https://www.cbar.az/page-42/monetary-indicators?language=en) | XLSX | monthly | 2003–2004 annual, monthly from 2005 |
| Average rates on new time deposits and loans (table 3.2.1) | same page | XLSX | monthly | from 2019 |
| Refinancing rate and interest-rate corridor (bulletin table 3.1) | CBAR statistical bulletin | XLSX | monthly | from 2006 |
| CPI inflation (bulletin table 1.1; origin: State Statistics Committee) | [CBAR statistical bulletin](https://www.cbar.az/page-40/statistical-bulletin?language=en) | XLSX (about 3.7 MB) | monthly | from 2005 |

Download links change with each release, so they are discovered by page title/order. No documented public API for these series was found.

Also looked at, not used: [stat.gov.az price tables](https://www.stat.gov.az/source/price_tarif/?lang=en) (the XLSX tables inspected were annual, or monthly only up to an earlier year) and CBAR's daily exchange-rate XML (`cbar.az/currencies/DD.MM.YYYY.xml`; the app does not convert currencies).

### Interpretation that you should know about

- **Reporting date vs month.** Rows labelled `01.MM.YYYY` are treated as covering the previous month. This is inferred from release timing (the September 2026 bulletin ends at `01.10.2026`), not from a published definition.
- **Transposed date cells.** Many cells in tables 3.2 and 3.2.1 hold day and month swapped (June 2019 stored as 6 January 2019). They are repaired, and a file is rejected unless its labels then form an unbroken sequence.
- Zero or `-` cells are treated as no data.

## Bank websites (public product pages)

Collected: ABB, AccessBank, Bank of Baku, Express Bank, Premium Bank, Rabitabank, Bank Respublika, Unibank, Bank VTB (Azerbaijan), Yelo Bank, Ziraat Bank Azerbaijan. Cash-loan terms for all of these except AccessBank (no suitable page found). Exact URLs are in `server/ingest/adapters/banks/index.ts` and on every record.

| Not collected | Reason |
|---|---|
| Kapital Bank, Azer-Turk Bank | HTTP 403 to automated clients; not bypassed |
| AFB Bank | Adapter exists, but the server sends an incomplete TLS chain that Node rejects. Verification is not disabled |
| PASHA Bank | Only a headline "up to" rate in page text |
| Xalq Bank | No term table in the page source |
| TuranBank | No deposit rate page with a term table identified |
| pashabank.digital | robots.txt disallows several AI crawlers; not accessed further |

Banks not listed here were not investigated or did not resolve.

Most pages state no publication date (Ziraat does). Terms of use were **not** legally reviewed.

## Product conditions

Read from the same pages with wording-specific rules (`server/ingest/adapters/banks/terms.ts`).

| Early-closure terms found | Not found |
|---|---|
| ABB, Premium, Respublika, Unibank, Yelo (fixed), Ziraat | AccessBank, Bank of Baku, Express, Rabitabank, VTB |

Rabitabank's page has a "no interest on early closure" sentence that belongs to a one-month campaign, so it is deliberately not attached to the universal deposit. "Not found" never means "not allowed".

## Tax assumptions

- [Ministry of Economy summary](https://economy.gov.az/en/post/1792/amendments-made-in-interest-income-tax-on-bank-deposits): 10% withholding; AZN exemption up to 200 per month per bank; full exemption for AZN deposits held 18+ months.
- [Azerbaijan Today, 17 Nov 2026](https://azerbaijantoday.az/2026/11/17/tax-incentives-for-long-term-bank-deposits-in-azerbaijan/) (by an MP): the 18-month incentive (art. 102.1.22-4) expires at the end of 2026 and was not in the amendment package under discussion. Neither has been checked against the Tax Code, so the app applies **no tax by default** and offers these as labelled scenarios.
