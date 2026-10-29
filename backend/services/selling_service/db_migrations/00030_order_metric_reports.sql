-- +goose Up
-- +goose StatementBegin
-- THE ORDER METRICS' REPORT (docs/business/order/order_statistic_metric.md) and the fold's dedup.
--
-- ⚠ BOTH TABLES ARE DERIVED. The orders and their timeline are the truth; these are built by selling_service's own
-- webhook from `OrderPlaced`, `OrderCancelled` and `OrderStatusChanged` (a-report-is-fed-by-events-only-for-now).
-- Nothing on a write path reads them.

-- THE IDEMPOTENCY LAYER. A row per event already folded.
CREATE TABLE order_event_logs (
    -- ⚠ THE EVENT's id ("order-placed:<order_id>", "order-status-changed:<timeline_log_id>"), NOT the broker's message
    -- id — a republish and a redelivery collide here.
    id         TEXT        PRIMARY KEY,
    -- The event as received, protojson — what a person reads when a figure is questioned.
    raw        BYTEA       NOT NULL,
    -- The Jakarta day the figures went to — the move's day (a-fact-counts-on-the-day-it-happened).
    day        DATE        NOT NULL,
    -- When the event was RECEIVED. A retention prune would cut on this, not on `day`.
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX order_event_logs_day_idx ON order_event_logs (day);

-- THE FIGURES — one row per day, metric, seller, shop, warehouse and creator that had a move. A day with no move has no
-- row, and that is correct: every figure counts moves, so a missing day reads as zero.
CREATE TABLE order_daily_reports (
    id           BIGSERIAL        PRIMARY KEY,
    -- The move's Jakarta day.
    day          DATE             NOT NULL,
    -- Which of the five order metrics the row counts for.
    metric       TEXT             NOT NULL CHECK (metric IN ('created', 'cancelled', 'return_created', 'return_arrived', 'lost_created')),
    -- The order's seller, shop, warehouse and creator (the-team-group-is-the-seller,
    -- a-metrics-user-is-the-orders-creator). 0 = none recorded.
    team_id      BIGINT           NOT NULL,
    shop_id      BIGINT           NOT NULL,
    warehouse_id BIGINT           NOT NULL,
    user_id      BIGINT           NOT NULL,

    -- Orders, and Σ their frozen `total_cost` (a-total-is-the-total-cost) and `platform_total`.
    order_count  BIGINT           NOT NULL DEFAULT 0,
    total        DOUBLE PRECISION NOT NULL DEFAULT 0,
    mp_total     BIGINT           NOT NULL DEFAULT 0,

    last_updated TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- The fold's upsert target. Day first, so it also serves a window scan.
CREATE UNIQUE INDEX order_daily_reports_key_idx
    ON order_daily_reports (day, metric, team_id, shop_id, warehouse_id, user_id);
-- A seller's window, and a warehouse's — the two scopes every non-root read is narrowed by
-- (a-warehouse-reads-the-orders-it-ships).
CREATE INDEX order_daily_reports_team_idx ON order_daily_reports (team_id, metric, day);
CREATE INDEX order_daily_reports_warehouse_idx ON order_daily_reports (warehouse_id, metric, day);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE order_daily_reports;
DROP TABLE order_event_logs;
-- +goose StatementEnd
