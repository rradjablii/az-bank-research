# Development status — AZFI evolution (v2)

Updated after each milestone. "Tested" means an automated test or a described manual check was actually run.

## Stage 1 — audit of v1 (26 Nov 2026)

Baseline: type check clean, 94/94 tests pass, 0 npm advisories. Backup taken before changes. No git repository.

**Working:** CBAR rates/CPI ingestion, 11 banks of 13 live sources, raw + normalised history, stats and finance libraries, 7 bilingual pages, admin-secret refresh.
**Broken:** AFB source fails (bank's incomplete TLS chain; external).
**Missing:** product conditions, policy rate, review/audit workflow, change events, bank profiles, comparison engine, index, decision engine, probability lab, research/PDF, AI assistant, accounts, alerts, data center.
**Risks:** large rate changes accepted without review; rejected records not retained; no version control; tax presets rest on secondary sources; never deployed.

## Stage 2 — target architecture

- One app, one API function (`api/index.ts`) with a small route table split by area; one scheduled function.
- `shared/` stays pure (statistics, finance, index, confidence, report text) so server, UI, PDF and tests share one implementation.
- Migration `002`: product terms, policy rates, verification status and overrides, rejected records, change events, audit log, users/sessions/items/alerts, index snapshots, reports, AI usage.
- Auth: own e-mail + password (scrypt), hashed session tokens, HttpOnly cookie, same-origin check; admin role granted only from the CLI, or `ADMIN_SECRET`.
- AI: provider interface; evidence retrieved from the database first; answers checked against evidence; works without a key in evidence-only mode.
- No paid features yet; only a `plan` column.

## Milestones

| # | Milestone | State |
|---|---|---|
| 1 | Data integrity: terms, policy rate, review gate, change events | implemented and tested |
| 2 | Statistics and financial engines | implemented and tested |
| 3 | Bank index and data confidence | implemented and tested |
| 4 | Research reports, PDF, exports | implemented and tested |
| 5 | AI research assistant | tested with a fake provider; **no live model call made** (no key) |
| 6 | Accounts, alerts, admin API | implemented and tested |
| 7 | User interface | implemented and tested |
| 8 | Verification and deployment documentation | done locally; **not deployed** |

## Log

- **M1** Migration 002 applied to the existing database without losing history (495 observations kept). Live run: terms for 17 products from 11 banks, 246 months of policy rates; re-ingestion raised 0 change events. Tests pending (M8).
- **M2** Covariance, normality, t / Welch / Mann-Whitney, conditional probability, reinvestment, early withdrawal. Type-checked; tests pending (M8).
- **M3** Index v1.0 and data confidence on live data: 11 banks scored, all provisional (stability needs 30 days of history).
- **M4** Six report types generated from the live database; unchanged data does not publish a duplicate; Azerbaijani PDF inspected visually. CSV exports written, not yet tested.
- **M5** Evidence retrieval, provider interface, Anthropic adapter (structured output, refusal fallback), figure/citation guard, daily quota. Type-checked only so far; no API key available, so no live model call has been made.
- **M6** Accounts (scrypt, hashed sessions, same-origin check), alerts, admin review/audit, routed API.
- **Backend tests** 128/128 pass. Found and fixed: topic detection matched inside words; unsourced evidence is now dropped.
- **M7** Grouped navigation, teal accent, 10 new pages and upgrades to 5. All 17 routes and the main flows covered by component tests.
- **M8** 146/146 tests; type check and production build clean; 0 advisories. Headless Chromium: 17 routes × 3 viewports with no errors or overflow; 18 end-to-end flows pass. API loads as plain Node ESM; `vercel.json` matches the published schema apart from the `$schema` hint.
  Defects found and fixed in this stage: browser-side `stale-while-revalidate` served old data first; comparison inputs lagged because state lived only in the URL; mobile overflow on the assistant.
  Product favourites and account preferences were completed after a re-check against the brief.

## Verified vs not verified

| Verified | Not verified |
|---|---|
| Live ingestion of 13 sources, migration of the existing database | Anything on Vercel or Neon |
| Statistics, finance, index, confidence (unit tests) | The scheduled function and its report publishing |
| Auth, authorisation, review/audit, alerts (API tests) | A live AI model call |
| Reports and PDF generation (tests + visual check) | PDF generation inside a Vercel function |
| UI routes and flows (component tests + Chromium) | Account data download button; Safari/Firefox; screen readers |
| Postgres driver over the wire protocol (PGlite socket) | A real PostgreSQL server |

## Remaining work

1. Deploy and complete the production checklist in `README.md`.
2. Accumulate at least 30 days of daily collection so index stability and bank-rate history become meaningful.
3. E-mail delivery, e-mail verification, password reset.
4. Per-bank rate charts; rates pagination; per-indicator alerts.
5. Review workflow for AI-written research drafts before any publication.
6. Cover Kapital Bank and others through authorised feeds.
7. Native-speaker proofreading; source terms-of-use review; verify tax rules.
8. Put the project under version control.

## Blockers needing you

Vercel and Neon accounts · an `ANTHROPIC_API_KEY` for the assistant · permission or feeds from uncollected banks.

## After deployment

- Live at https://az-bank-research.vercel.app. First refresh: 10 banks and CBAR rates succeeded; CPI/policy download failed (socket closed by uploads.cbar.az); Bank Respublika returned 403 to Vercel; AFB as before.
- Schedule changed to the 1st and 15th; stale threshold 18 days (146 tests pass). Whether Vercel actually runs the schedule is not yet verified.
