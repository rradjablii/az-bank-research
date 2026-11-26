-- Verification workflow on observed rates. `source_rate` keeps what the source
-- said when a reviewer corrects or rejects a value, so re-ingesting the same
-- source value does not undo the review.
ALTER TABLE interest_rate_observations
  ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'auto_validated'
    CHECK (verification_status IN ('auto_validated','pending_review','approved','corrected','rejected')),
  ADD COLUMN source_rate NUMERIC(7,4);
UPDATE interest_rate_observations SET source_rate = rate;

ALTER TABLE ingestion_logs ADD COLUMN records_duplicate INTEGER NOT NULL DEFAULT 0;

CREATE TABLE rejected_records (
  id               BIGSERIAL PRIMARY KEY,
  source_id        INTEGER NOT NULL REFERENCES data_sources(id),
  ingestion_log_id BIGINT REFERENCES ingestion_logs(id),
  reason           TEXT NOT NULL,
  payload          JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rejected_source_idx ON rejected_records (source_id, created_at DESC);

-- Product conditions as stated on the bank page. NULL always means "not found on
-- the collected page", never "no".
CREATE TABLE product_terms (
  id               BIGSERIAL PRIMARY KEY,
  product_id       INTEGER NOT NULL REFERENCES bank_products(id),
  raw_record_id    BIGINT NOT NULL REFERENCES raw_source_records(id),
  terms            JSONB NOT NULL,
  source_url       TEXT NOT NULL,
  collected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX product_terms_current_uq ON product_terms (product_id) WHERE superseded_at IS NULL;

CREATE TABLE policy_rates (
  id               BIGSERIAL PRIMARY KEY,
  source_id        INTEGER NOT NULL REFERENCES data_sources(id),
  raw_record_id    BIGINT NOT NULL REFERENCES raw_source_records(id),
  period_date      DATE NOT NULL,
  measure          TEXT NOT NULL CHECK (measure IN ('refinancing','corridor_floor','corridor_ceiling')),
  value            NUMERIC(9,4) NOT NULL,
  collected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX policy_current_uq ON policy_rates (measure, period_date) WHERE superseded_at IS NULL;

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  plan          TEXT NOT NULL DEFAULT 'free',
  preferences   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE user_items (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('favorite','comparison','scenario')),
  label      TEXT NOT NULL,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX user_items_idx ON user_items (user_id, kind);

CREATE TABLE alert_subscriptions (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('rate_change','new_product','conditions_change','indicator','report')),
  bank_slug  TEXT,
  currency   CHAR(3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX alert_subscriptions_uq ON alert_subscriptions (user_id, kind, (COALESCE(bank_slug,'')), (COALESCE(currency,'')));

-- Verified changes only; `dedupe_key` stops the same change being recorded twice.
CREATE TABLE change_events (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('rate_change','new_product','conditions_change','indicator','report')),
  bank_slug   TEXT,
  currency    CHAR(3),
  details     JSONB NOT NULL,
  dedupe_key  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX change_events_bank_idx ON change_events (bank_slug, created_at DESC);

CREATE TABLE notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id   BIGINT NOT NULL REFERENCES change_events(id) ON DELETE CASCADE,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id)
);

CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  before     JSONB,
  after      JSONB,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE index_snapshots (
  id                 BIGSERIAL PRIMARY KEY,
  snapshot_date      DATE NOT NULL,
  methodology        TEXT NOT NULL,
  bank_slug          TEXT NOT NULL,
  score              NUMERIC(6,2),
  coverage           NUMERIC(5,4) NOT NULL,
  provisional        BOOLEAN NOT NULL,
  components         JSONB NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, methodology, bank_slug)
);

CREATE TABLE reports (
  id           SERIAL PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  type         TEXT NOT NULL,
  period       TEXT NOT NULL,
  data         JSONB NOT NULL,
  data_hash    TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reports_published_idx ON reports (published_at DESC);

CREATE TABLE ai_usage (
  day   DATE PRIMARY KEY,
  calls INTEGER NOT NULL
);
