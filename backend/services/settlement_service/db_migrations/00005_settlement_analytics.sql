-- +goose Up
-- +goose StatementBegin
-- THE SETTLEMENT REPORTS (docs/business/settlement/analytic_context.md) and the fold's own bookkeeping.
--
-- ⚠ EVERY TABLE HERE IS DERIVED. `settlement_logs` is the truth; these are built by settlement's webhook
-- consuming `SettlementLogPosted` (#the-fold-owns-the-report-not-the-writer) and can be rebuilt by
-- `AnalyticReplayCompute`. Nothing on the ledger's write path reads or writes them.
--
-- ⚠ NO GENESIS ROW IS SEEDED (#genesis-is-not-needed-when-the-log-starts-empty). The fold's own `prev`
-- lookup opens a new scope at 0, which is the true position for a log holding nothing older than these
-- tables.

-- THE SERVICE'S CONFIGURATION (meta_context.md) — human-set, service-read.
CREATE TABLE settlement_service_metadata (
    id         BIGSERIAL   PRIMARY KEY,
    key        TEXT        NOT NULL UNIQUE,
    -- Each key defines its own encoding. `process_event_lock` is `{"lock":true|false}`, and a value that
    -- does not parse is an ERROR the webhook surfaces — for a lock, failing open is the wrong direction.
    value      TEXT        NOT NULL,
    -- When it was flipped is most of the information a switch carries.
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The developer's maintenance switch. While true the webhook refuses every event (500, so Pub/Sub
-- redelivers), which is what lets a replay delete a range without a live fold writing into it.
INSERT INTO settlement_service_metadata (key, value) VALUES ('process_event_lock', '{"lock":false}');

-- THE IDEMPOTENCY LAYER (§Idempotency Layer). A row per event already folded.
CREATE TABLE settlement_event_logs (
    -- ⚠ THE EVENT's id ("settlement-log:<log_id>"), NOT the broker's message id. A retried publish mints a
    -- new message id for the same row, so keying on it would fold the movement twice
    -- (typed-fields-for-what-the-library-reads).
    id         TEXT        PRIMARY KEY,
    -- The event as received, protojson — what a person reads when a fold is questioned.
    raw        BYTEA       NOT NULL,
    -- ⚠ THE JAKARTA DAY THE FOLDED ROW BELONGS TO — its `posted_on`. A replay deletes dedup rows on this
    -- SAME predicate as the report rows, in one transaction (#the-replay-cuts-three-tables-on-one-line), so
    -- the two can never disagree about what was folded.
    day        DATE        NOT NULL,
    -- When the event was RECEIVED. Retention cuts on this, not on `day`: the guard must outlive the
    -- broker's ability to redeliver, which is measured from receipt.
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX settlement_event_logs_day_idx ON settlement_event_logs (day);
CREATE INDEX settlement_event_logs_created_idx ON settlement_event_logs (created_at);

-- THE SHOP GRAIN — one row per (shop, team, day) that had movement (§Daily Reports 1).
--
-- ⚠ A DAY WITH NO MOVEMENT HAS NO ROW, and that is correct. A position query falls back to the last row
-- at or before the date (#a-past-date-position-is-a-real-screen) — never "no data".
CREATE TABLE shop_settlement_daily_reports (
    id                     BIGSERIAL   PRIMARY KEY,
    day                    DATE        NOT NULL,
    shop_id                BIGINT      NOT NULL,
    team_id                BIGINT      NOT NULL,

    -- §Field that tracked — the day's movement per settlement_type, in the LOG's sign convention.
    initial_total          BIGINT      NOT NULL DEFAULT 0,
    initial_total_cancel   BIGINT      NOT NULL DEFAULT 0,
    other                  BIGINT      NOT NULL DEFAULT 0,
    fund                   BIGINT      NOT NULL DEFAULT 0,
    external_ads_fee       BIGINT      NOT NULL DEFAULT 0,
    affiliate_fee          BIGINT      NOT NULL DEFAULT 0,
    marketplace_adjustment BIGINT      NOT NULL DEFAULT 0,
    system_adjustment      BIGINT      NOT NULL DEFAULT 0,

    -- The day's net movement. Not in §Field that tracked, but the adopted SQL writes it and
    -- `close_balance − open_balance` must equal it (analytic clarify — the tracked-field contradiction).
    change                 BIGINT      NOT NULL DEFAULT 0,

    -- THE POSITION at the day's boundaries, STORED and maintained by increment
    -- (#the-carry-is-stored-not-derived). By definition open(D) = Σ change before D and close(D) =
    -- Σ change up to and including D (#the-carry-materialises-the-day-boundary-position).
    open_balance           BIGINT      NOT NULL DEFAULT 0,
    close_balance          BIGINT      NOT NULL DEFAULT 0,

    last_updated           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ⚠ THE COMPOSITE UNIQUE, in (scope, day) order: the fold's `prev` lookup and its later-day shift both
-- filter equality on the scope with a RANGE on day (#the-carry-is-stored-not-derived).
CREATE UNIQUE INDEX shop_settlement_daily_reports_scope_day_idx
    ON shop_settlement_daily_reports (shop_id, team_id, day);
-- A team's shops over a window — the team-level series and the by-shop ranking.
CREATE INDEX shop_settlement_daily_reports_team_day_idx ON shop_settlement_daily_reports (team_id, day);
-- The replay's delete.
CREATE INDEX shop_settlement_daily_reports_day_idx ON shop_settlement_daily_reports (day);

-- THE USER GRAIN (§Daily Reports 2). The user is WHO CREATED THE ORDER for an order row
-- (#the-user-is-the-order-creator) and the ACTOR for a shop row
-- (#a-shop-addressed-row-is-attributed-to-its-actor). user_id 0 is "not recorded", kept as its own row
-- so user totals still sum to shop totals.
CREATE TABLE user_settlement_daily_reports (
    id                     BIGSERIAL   PRIMARY KEY,
    day                    DATE        NOT NULL,
    user_id                BIGINT      NOT NULL,
    team_id                BIGINT      NOT NULL,

    initial_total          BIGINT      NOT NULL DEFAULT 0,
    initial_total_cancel   BIGINT      NOT NULL DEFAULT 0,
    other                  BIGINT      NOT NULL DEFAULT 0,
    fund                   BIGINT      NOT NULL DEFAULT 0,
    external_ads_fee       BIGINT      NOT NULL DEFAULT 0,
    affiliate_fee          BIGINT      NOT NULL DEFAULT 0,
    marketplace_adjustment BIGINT      NOT NULL DEFAULT 0,
    system_adjustment      BIGINT      NOT NULL DEFAULT 0,
    change                 BIGINT      NOT NULL DEFAULT 0,
    open_balance           BIGINT      NOT NULL DEFAULT 0,
    close_balance          BIGINT      NOT NULL DEFAULT 0,

    last_updated           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX user_settlement_daily_reports_scope_day_idx
    ON user_settlement_daily_reports (user_id, team_id, day);
CREATE INDEX user_settlement_daily_reports_team_day_idx ON user_settlement_daily_reports (team_id, day);
CREATE INDEX user_settlement_daily_reports_day_idx ON user_settlement_daily_reports (day);

-- THE BALANCE STATE (§Balance State Reports) — each scope's LATEST close_balance, one row per scope.
--
-- ⚠ DERIVED FROM THE DAILY ROWS, never incremented: the fold rewrites it from the scope's newest daily
-- row inside the same transaction. That is what makes a replay self-heal it — every redelivered event
-- re-derives it, where a `+=` writer would double.
CREATE TABLE shop_settlement_reports (
    id            BIGSERIAL   PRIMARY KEY,
    shop_id       BIGINT      NOT NULL,
    team_id       BIGINT      NOT NULL,
    close_balance BIGINT      NOT NULL DEFAULT 0,
    last_updated  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX shop_settlement_reports_scope_idx ON shop_settlement_reports (shop_id, team_id);
CREATE INDEX shop_settlement_reports_team_idx ON shop_settlement_reports (team_id);

CREATE TABLE user_settlement_reports (
    id            BIGSERIAL   PRIMARY KEY,
    user_id       BIGINT      NOT NULL,
    team_id       BIGINT      NOT NULL,
    close_balance BIGINT      NOT NULL DEFAULT 0,
    last_updated  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX user_settlement_reports_scope_idx ON user_settlement_reports (user_id, team_id);
CREATE INDEX user_settlement_reports_team_idx ON user_settlement_reports (team_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE user_settlement_reports;
DROP TABLE shop_settlement_reports;
DROP TABLE user_settlement_daily_reports;
DROP TABLE shop_settlement_daily_reports;
DROP TABLE settlement_event_logs;
DROP TABLE settlement_service_metadata;
-- +goose StatementEnd
