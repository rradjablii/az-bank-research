CREATE TABLE banks (
  id          SERIAL PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  website     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE data_sources (
  id                SERIAL PRIMARY KEY,
  key               TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  publisher         TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('official_statistics','bank_website','partner_feed')),
  url               TEXT NOT NULL,
  format            TEXT NOT NULL,
  update_frequency  TEXT NOT NULL,
  access_status     TEXT NOT NULL CHECK (access_status IN ('active','unavailable','disabled')),
  access_note       TEXT,
  bank_id           INTEGER REFERENCES banks(id),
  min_refresh_hours INTEGER NOT NULL DEFAULT 12,
  stale_after_hours INTEGER NOT NULL DEFAULT 48,
  last_attempt_at   TIMESTAMPTZ,
  last_success_at   TIMESTAMPTZ,
  last_status       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ingestion_logs (
  id                BIGSERIAL PRIMARY KEY,
  source_id         INTEGER NOT NULL REFERENCES data_sources(id),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at       TIMESTAMPTZ,
  status            TEXT NOT NULL CHECK (status IN ('running','success','partial','failed')),
  trigger           TEXT NOT NULL CHECK (trigger IN ('manual','schedule','cli')),
  records_fetched   INTEGER NOT NULL DEFAULT 0,
  records_inserted  INTEGER NOT NULL DEFAULT 0,
  records_unchanged INTEGER NOT NULL DEFAULT 0,
  records_rejected  INTEGER NOT NULL DEFAULT 0,
  message           TEXT
);
-- At most one running ingestion per source (concurrency lock).
CREATE UNIQUE INDEX ingestion_logs_running_uq ON ingestion_logs (source_id) WHERE status = 'running';
CREATE INDEX ingestion_logs_source_idx ON ingestion_logs (source_id, started_at DESC);

-- Raw extracted source records, kept separately from normalised data.
CREATE TABLE raw_source_records (
  id               BIGSERIAL PRIMARY KEY,
  source_id        INTEGER NOT NULL REFERENCES data_sources(id),
  ingestion_log_id BIGINT REFERENCES ingestion_logs(id),
  source_url       TEXT NOT NULL,
  content_hash     TEXT NOT NULL,
  payload          JSONB NOT NULL,
  collected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_url, content_hash)
);

CREATE TABLE bank_products (
  id            SERIAL PRIMARY KEY,
  bank_id       INTEGER NOT NULL REFERENCES banks(id),
  source_id     INTEGER NOT NULL REFERENCES data_sources(id),
  product_key   TEXT NOT NULL,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('deposit','loan')),
  product_type  TEXT NOT NULL CHECK (product_type IN ('term_deposit','savings_deposit','flexible_deposit','consumer_loan')),
  product_url   TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bank_id, product_key)
);

CREATE TABLE interest_rate_observations (
  id                BIGSERIAL PRIMARY KEY,
  product_id        INTEGER NOT NULL REFERENCES bank_products(id),
  source_id         INTEGER NOT NULL REFERENCES data_sources(id),
  raw_record_id     BIGINT NOT NULL REFERENCES raw_source_records(id),
  currency          CHAR(3) NOT NULL CHECK (currency IN ('AZN','USD','EUR')),
  term_min_months   INTEGER CHECK (term_min_months > 0),
  term_max_months   INTEGER CHECK (term_max_months > 0),
  payout_frequency  TEXT NOT NULL CHECK (payout_frequency IN ('monthly','quarterly','at_maturity','upfront','unspecified')),
  variant           TEXT NOT NULL CHECK (variant IN ('standard','campaign','uninsured','legacy_renewal')),
  rate              NUMERIC(7,4) NOT NULL CHECK (rate > 0 AND rate <= 150),
  rate_max          NUMERIC(7,4) CHECK (rate_max >= rate),
  rate_qualifier    TEXT NOT NULL CHECK (rate_qualifier IN ('exact','from','up_to','range')),
  apr_min           NUMERIC(7,4),
  apr_max           NUMERIC(7,4),
  amount_min        NUMERIC(18,2),
  amount_max        NUMERIC(18,2),
  conditions        TEXT,
  source_name       TEXT NOT NULL,
  source_url        TEXT NOT NULL,
  observed_date     DATE,
  collected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX rate_obs_current_uq ON interest_rate_observations (
  product_id, currency, (COALESCE(term_min_months, 0)), (COALESCE(term_max_months, 0)),
  payout_frequency, variant, (COALESCE(amount_min, 0))
) WHERE superseded_at IS NULL;
CREATE INDEX rate_obs_filter_idx ON interest_rate_observations (currency, term_min_months, payout_frequency) WHERE superseded_at IS NULL;
CREATE INDEX rate_obs_history_idx ON interest_rate_observations (product_id, collected_at);

-- Officially published market averages. Revisions supersede, never overwrite.
CREATE TABLE market_statistics (
  id               BIGSERIAL PRIMARY KEY,
  source_id        INTEGER NOT NULL REFERENCES data_sources(id),
  raw_record_id    BIGINT NOT NULL REFERENCES raw_source_records(id),
  metric           TEXT NOT NULL CHECK (metric IN ('deposit_rate','loan_rate')),
  basis            TEXT NOT NULL CHECK (basis IN ('outstanding','new_business')),
  currency_group   TEXT NOT NULL CHECK (currency_group IN ('AZN','FX')),
  segment          TEXT NOT NULL CHECK (segment IN ('total','legal_entities','individuals')),
  maturity_bucket  TEXT NOT NULL,
  period_date      DATE NOT NULL,
  frequency        TEXT NOT NULL CHECK (frequency IN ('monthly','annual')),
  rate             NUMERIC(9,4) NOT NULL CHECK (rate >= 0 AND rate <= 200),
  collected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX market_current_uq ON market_statistics (metric, basis, currency_group, segment, maturity_bucket, period_date) WHERE superseded_at IS NULL;

CREATE TABLE inflation_observations (
  id               BIGSERIAL PRIMARY KEY,
  source_id        INTEGER NOT NULL REFERENCES data_sources(id),
  raw_record_id    BIGINT NOT NULL REFERENCES raw_source_records(id),
  period_date      DATE NOT NULL,
  measure          TEXT NOT NULL CHECK (measure IN ('cpi_mom','cpi_yoy','cpi_avg_annual')),
  value            NUMERIC(9,4) NOT NULL,
  collected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX inflation_current_uq ON inflation_observations (measure, period_date) WHERE superseded_at IS NULL;

-- Daily snapshot of the comparable bank-offer distribution (one best standard offer per bank).
CREATE TABLE historical_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  product_type  TEXT NOT NULL,
  currency      CHAR(3) NOT NULL,
  term_months   INTEGER NOT NULL DEFAULT 0,
  payout        TEXT NOT NULL,
  n_offers      INTEGER NOT NULL,
  n_banks       INTEGER NOT NULL,
  mean_rate     NUMERIC(9,4) NOT NULL,
  median_rate   NUMERIC(9,4) NOT NULL,
  min_rate      NUMERIC(9,4) NOT NULL,
  max_rate      NUMERIC(9,4) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, product_type, currency, term_months, payout)
);
