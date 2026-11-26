# AZ Finance Intelligence

*Financial intelligence for Azerbaijan.* Deposit and lending rate analytics built on official statistics and publicly advertised bank terms. English / Azərbaycanca.

| Area | Pages |
|---|---|
| Consumer | Bank Explorer, Compare Products, Decision Engine, Inflation, Learn |
| Intelligence | Overview, Banks and bank profiles, Bank Index, Statistics & Probability Lab, Trends, AI Assistant |
| Research | Research Center (reports, PDF, CSV exports), Methodology |
| Platform | My Account (optional), Data Intelligence Center (admin) |

See `DEVELOPMENT_STATUS.md` for what has and has not been verified.

**Stack:** React 19, TypeScript, Vite, Tailwind CSS 4, Recharts · Vercel Functions (Node) · PostgreSQL (Neon) · embedded PGlite for local development.

## Quick start (no database server needed)

```bash
npm install
cp .env.example .env.local     # set ADMIN_SECRET (16+ characters); leave DATABASE_URL empty
npm run ingest                 # collects live data into ./.data (about 1 minute)
npm run dev                    # http://localhost:3000
```

PGlite allows one process at a time: stop `npm run dev` before `npm run ingest`, or refresh from **Methodology & Sources** instead.

| Command | Purpose |
|---|---|
| `npm test` | Vitest: statistics, finance, parsers, normalisation, pipeline, API, UI flows |
| `npm run build` | Type-check and production build |
| `npm start` | Serve the built app and API locally with the production security headers |
| `npm run db:migrate` | Apply `db/migrations` to `DATABASE_URL` (or PGlite) |
| `npm run ingest -- [--force] [source_key…]` | Collect data. Exit code 2 if any source failed |
| `npm run report` | Publish research reports that do not yet exist for the current period |
| `npm run admin:grant -- you@example.com` | Give a registered account the admin role (`admin:revoke` to remove) |

## Deploy to Vercel

1. Install and sign in: `npm i -g vercel && vercel login`
2. From this directory: `vercel link`
3. Create the database: `vercel integration add neon` (or add Neon from the Vercel Marketplace). Confirm `DATABASE_URL` is set for the project, using the **pooled** connection string.
4. Add the admin secret: `openssl rand -hex 32`, then `vercel env add ADMIN_SECRET production`
5. Deploy: `vercel deploy --prod`. The build runs migrations when `DATABASE_URL` is present (`vercel-build`).
6. **Load the first data** (a new database is empty and the app says so):
   ```bash
   curl -X POST https://YOUR-DOMAIN/api/admin/refresh \
     -H "Authorization: Bearer $ADMIN_SECRET" -H "Content-Type: application/json" -d '{"force":true}'
   ```
7. Check `https://YOUR-DOMAIN/api/health`, then **Methodology & Sources** for per-source status.
8. Register an account on the site, then grant it admin from your machine:
   `vercel env pull .env.local && npm run admin:grant -- you@example.com`
   (this runs against the production database; delete the pulled file afterwards if you do not want it locally).
9. Publish the first reports from **Data Center**, or wait for the scheduled job.

Without the CLI: push to a Git repository, import it in Vercel, add the Neon integration and `ADMIN_SECRET`, deploy, then do step 6.

Preview deployments run migrations too; give them a separate Neon branch.

### Configuration

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | on Vercel | PostgreSQL connection string |
| `ADMIN_SECRET` | for manual refresh | 16+ characters; protects `POST /api/admin/refresh` |
| `INGEST_USER_AGENT` | no | Overrides the ingestion User-Agent |
| `SOURCE_FEED_{KAPITAL,PASHA,XALQ,ATB,TURAN}_URL` | no | Authorised JSON feed for an uncollected bank |
| `ANTHROPIC_API_KEY` | no | Enables written answers in the AI Assistant |
| `AI_PROVIDER` | no | `anthropic` (default when a key is set) or `none` |
| `AI_MODEL` | no | Defaults to `claude-opus-5-5` |
| `AI_DAILY_LIMIT` | no | Maximum model calls per day, all users (default 200) |

### AI assistant

`server/ai/` holds a provider interface (`provider.ts`), the Anthropic adapter and the grounding steps. For each question the server first computes numbered evidence from the database, sends only that evidence and the question to the model, then withholds any statement whose figures are not in the evidence it cites. Without a key the evidence itself is shown. To add a provider, implement `LlmProvider` and register it in `server/ai/index.ts`.

The adapter requests server-side refusal fallback. Model calls cost money: keep the daily limit, and set a spend limit with the provider. Questions are sent to the provider, so say so in a privacy notice. **The live integration has not been exercised** — ask a few questions after adding the key and compare the answers with the evidence shown.

The figure check catches invented numbers. It cannot catch a correct number used in a misleading sentence, so answers are labelled unreviewed drafts.

### Scheduled refresh

`vercel.json` declares a twice-monthly **Vercel Schedule** (`0 4 1,15 * *`: 04:00 UTC on the 1st and 15th) that invokes the private function `api/cron-ingest.ts`. It needs no secret because it has no public URL. Vercel Schedules is in public beta and this part could not be tested without a deployment. After deploying, verify with `vercel schedules list` and `vercel schedules invoke daily-ingest` (the job kept its original name so its run history is not reset). A source is marked stale after 18 days. A failed run is not retried until the next date, so refresh manually when a source fails. If it is unavailable to you, remove the `schedules` and `experimentalTriggers` entries and have any scheduler send the request from step 6.

`regions` is set to `fra1`, the nearest region to the sources.

### Partner feeds

HTTPS URL returning:

```json
{ "offers": [ { "productKey": "term", "productName": "Term deposit", "productType": "term_deposit",
  "productUrl": "https://bank.example/deposits", "currency": "AZN", "termMin": 12, "termMax": 12,
  "payout": "at_maturity", "variant": "standard", "rate": 9.0, "observedDate": "2026-11-01" } ] }
```

Only configure feeds you are authorised to use.

## Layout

```
api/            Vercel Functions (HTTP router, scheduled ingestion)
server/         database, repository, HTTP app, ingestion pipeline and source adapters
shared/         pure statistics, finance and comparability logic used by server and UI
src/            React app: pages, components, i18n
db/migrations/  SQL schema
tests/          tests, with trimmed excerpts of real source pages as fixtures
docs/SOURCES.md source investigation and data interpretation
```

## API

Public `GET`: `health`, `meta`, `rates`, `market`, `inflation`, `policy`, `snapshots`, `logs`, `terms`, `banks`, `banks/:slug`, `events`, `index`, `confidence`, `reports`, `reports/:slug`, `reports/:slug/pdf?lang=`, `export/{rates,market,inflation,policy}`, `ai/status`.
Same-origin `POST`: `ai/ask`, `auth/{register,login,logout}`, `account/*` (signed in).
Admin (admin session, or `Authorization: Bearer $ADMIN_SECRET`): `admin/{refresh,overview,raw/:source,rejected,observations,observations/:id/review,audit,reports}`.

## Data model

Migration 001: `banks`, `data_sources`, `bank_products`, `interest_rate_observations`, `market_statistics`, `inflation_observations`, `historical_snapshots`, `ingestion_logs`, `raw_source_records`.
Migration 002: verification columns, `product_terms`, `policy_rates`, `rejected_records`, `change_events`, `audit_log`, `users`, `sessions`, `user_items`, `alert_subscriptions`, `notifications`, `index_snapshots`, `reports`, `ai_usage`.
Rates are `NUMERIC`. Changed values supersede and insert; nothing is overwritten. Migrations are additive and run by `vercel-build`.

**Review gate.** A change of 2 points (deposits) or 5 (loans) or more is stored as *pending validation*: shown with a badge and left out of statistics until reviewed. A correction survives later ingestion for as long as the source keeps saying the old value.

## Security

- HTTPS-only fetching with a per-source host allow-list, robots.txt and crawl delays, size and time limits.
- Zod validation of external data and requests; parameterised SQL.
- Passwords: scrypt with per-user salt. Sessions: random token, only its hash stored, `HttpOnly; SameSite=Lax` (+`Secure` on HTTPS). State-changing cookie requests require a matching `Origin`.
- Admin role is granted only from the command line. Admin secret compared in constant time.
- CSP and related headers; CSV export neutralises spreadsheet formulas.

Before public use, also: add a Vercel Firewall rate-limit rule (limits here are per function instance); use a long random `ADMIN_SECRET` different from your local one; add e-mail verification and password reset (neither exists); publish a privacy notice and terms. The `logs` endpoint is public and shows ingestion error text.

### Backup and recovery

Neon keeps point-in-time history for a window that depends on your plan: check it, and test restoring to a branch. Additionally schedule a `pg_dump` of the database to storage you control — the collected history cannot be re-created from the sources. Raw records allow normalised data to be rebuilt after a parser fix.

## Production checklist

- [ ] Neon provisioned, `DATABASE_URL` pooled, `ADMIN_SECRET` set
- [ ] Deployed; `/api/health` is OK; first refresh completed
- [ ] Per-source status checked from Vercel (cloud addresses may be treated differently)
- [ ] `vercel schedules list` shows `daily-ingest`; one manual invoke succeeded
- [ ] Report PDF downloads from production (font files are bundled via `includeFiles`)
- [ ] Admin account granted; review queue checked
- [ ] Firewall rule, backups, privacy notice, source terms of use reviewed
- [ ] AI key and spend limit set (if used) and answers spot-checked

## Known limitations

- **Coverage is partial.** 11 banks supply rates; Kapital Bank, a major one, is not covered. See `docs/SOURCES.md`.
- **Parsers depend on page layout and wording.** A redesign makes a source fail or a condition read "Not found"; it needs a code change.
- **Little history yet.** Advertised-rate history, change events, the index's stability component and score history start at your first ingestion. All index scores are provisional until then.
- Official long series are Central Bank averages; they split manat from foreign currency, not USD from EUR.
- Tax scenarios rest on a government summary and a press article. The default applies no tax.
- Deposit maths uses 30/360. Early-closure results cover only terms the page states.
- Bank offers are not a random sample; inferential statistics on them are illustrative.
- Alerts are in-app only (no e-mail). Indicator alerts cannot be narrowed to one indicator. No password reset.
- Advertised-rate charts per bank are not drawn; the profile shows a history table.
- `/api/rates` is not paginated (about 330 KB before compression).
- Public responses may be up to about two minutes old at the CDN; each shows its verification time.
- AI evidence retrieval is keyword-based; unusual phrasing may return too little.
- No paid features, API keys for third parties, or sponsorship; only a `plan` column.
- Checked in headless Chromium only; no screen-reader, Safari or Firefox testing.
- Azerbaijani text has not been proofread by a native speaker. Some bank product names and server notes remain in English.
