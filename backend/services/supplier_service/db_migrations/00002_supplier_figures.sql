-- +goose Up
-- +goose StatementBegin
-- A SUPPLIER'S FIGURES (docs/business/supplier/context.md §How We provide Analitical Data of Suppliers) and the fold's
-- own bookkeeping — settlement's, read for the supplier (the-report-is-processed-like-settlement).
--
-- ⚠ EVERY TABLE HERE IS DERIVED. The restock accept is the truth; these are built by supplier_service's webhook
-- consuming `RestockAccepted`, and can be rebuilt by AnalyticReplayCompute. Nothing on a write path reads them.

-- THE SERVICE'S CONFIGURATION — human-set or fold-set, service-read. Each key defines its own encoding.
CREATE TABLE supplier_service_metadata (
    id         BIGSERIAL   PRIMARY KEY,
    key        TEXT        NOT NULL UNIQUE,
    value      TEXT        NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The maintenance switch, `{"lock":true|false}`. While true the webhook refuses every event (500, so Pub/Sub
-- redelivers) — what lets a replay delete a range without a live fold writing into it. A value that does not parse
-- is an ERROR, never "unlocked": for a lock, failing open is the wrong direction.
INSERT INTO supplier_service_metadata (key, value) VALUES ('process_event_lock', '{"lock":false}');

-- THE IDEMPOTENCY LAYER. A row per event already folded.
CREATE TABLE supplier_event_logs (
    -- ⚠ THE EVENT's id ("restock-accepted:<restock_id>"), NOT the broker's message id — a republish, a replay and the
    -- backfill (past-accepts-are-backfilled-once) all collide here.
    id         TEXT        PRIMARY KEY,
    -- The event as received, protojson — what a person reads when a figure is questioned.
    raw        BYTEA       NOT NULL,
    -- ⚠ THE JAKARTA DAY THE FIGURES WENT TO — the accept's day. A replay deletes dedup rows on this SAME predicate as the
    -- figure rows, in one transaction, so the two can never disagree about what was folded.
    day        DATE        NOT NULL,
    -- When the event was RECEIVED. Retention cuts on this, not on `day`.
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX supplier_event_logs_day_idx ON supplier_event_logs (day);
CREATE INDEX supplier_event_logs_created_idx ON supplier_event_logs (created_at);

-- THE FIGURES — one row per day, supplier, product and restocking team that had an accept
-- (a-supplier-is-measured-per-product-per-day, the-report-is-keyed-by-team-not-by-store). A day with no accept has no
-- row, and that is correct: every figure is a movement, so a missing day reads as zero.
CREATE TABLE supplier_product_daily_reports (
    id                        BIGSERIAL   PRIMARY KEY,
    -- The accept's Jakarta day (each-figure-is-read-at-the-accept).
    day                       DATE        NOT NULL,
    supplier_id               BIGINT      NOT NULL,
    -- The restocking team's product — two teams buying one item are two rows.
    product_id                BIGINT      NOT NULL,
    -- The restocking team, not the supplier's owning team.
    team_id                   BIGINT      NOT NULL,

    -- Units accepted as good stock, and their value at the line's price.
    restock_count             BIGINT      NOT NULL DEFAULT 0,
    restock_valuation         BIGINT      NOT NULL DEFAULT 0,
    -- Units short in an accepted parcel.
    shipping_lost_count       BIGINT      NOT NULL DEFAULT 0,
    shipping_lost_valuation   BIGINT      NOT NULL DEFAULT 0,
    -- Units that arrived broken.
    shipping_broken_count     BIGINT      NOT NULL DEFAULT 0,
    shipping_broken_valuation BIGINT      NOT NULL DEFAULT 0,

    last_updated              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ⚠ THE COMPOSITE UNIQUE as the owner wrote it — (day, supplier_id, product_id, team_id) — and the fold's upsert
-- target. Day first, so it also serves the replay's delete and every window scan.
CREATE UNIQUE INDEX supplier_product_daily_reports_key_idx
    ON supplier_product_daily_reports (day, supplier_id, product_id, team_id);
-- One supplier over a window — the Statistics tab's series and its by-product table.
CREATE INDEX supplier_product_daily_reports_supplier_day_idx
    ON supplier_product_daily_reports (supplier_id, day);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE supplier_product_daily_reports;
DROP TABLE supplier_event_logs;
DROP TABLE supplier_service_metadata;
-- +goose StatementEnd
