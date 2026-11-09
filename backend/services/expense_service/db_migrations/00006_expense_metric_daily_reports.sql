-- +goose Up
-- +goose StatementBegin
-- THE EXPENSE METRICS, BY DAY (docs/business/analytic/rpc_provide_decision.md — expense-has-ads-and-expenses,
-- expense-figures-are-read-from-its-own-records, an-expense-correction-counts-on-the-day-it-is-made,
-- stock-loss-stays-out-of-analytic-expenses, an-expense-correction-counts-for-who-made-it,
-- the-expense-prototype-is-accepted). Read by ExpenseAnalyticService (`metrics/ads`, `metrics/expenses`).
--
-- One row per Jakarta day × team × kind × shop × person: the signed sum of the `expense_records` rows that count there.
-- Written IN THE SAME TRANSACTION as the row it counts (ExpenseCreate, ExpenseAdjust — a cancel is an adjustment), so
-- the report is never behind its source and needs no event:
--   an EXPENSE    on its own `occurred_at`, for the person who typed it (`created_by`);
--   a CORRECTION  on the Jakarta day it is MADE, for the person who MADE it — a cancel likewise. A past day never
--                 changes; the Expenses page, the statement and the paying account keep the expense's own day.
--
-- `kind` is a TYPED kind only — ADS 1, PAYROLL 2, OPERATIONAL 3, OTHER 4. A STOCK_LOSS (5) is never written
-- (stock-loss-stays-out-of-analytic-expenses), and the CHECK says so.
--
-- `team_id` is whose expense it is — the reader's scope. `seller_id` / `warehouse_id` is the same team on the side of
-- the composer it sits on (the-warehouse-is-its-own-group): a selling team's under Seller, a warehouse team's under
-- Warehouse, the root team's under neither (both 0). `shop_id` is an ads expense's shop (0 on every other kind),
-- `user_id` who made the entry (0 when the identity was absent). Every *_id is another service's: no FK.
--
-- No backfill: revamp holds no real expenses yet (revamp-has-no-real-orders-yet), and which side a team sits on is
-- team_service's — a migration of this service cannot read it.
CREATE TABLE expense_metric_daily_reports (
    id           BIGSERIAL PRIMARY KEY,
    day          DATE             NOT NULL,
    team_id      BIGINT           NOT NULL CHECK (team_id > 0),
    seller_id    BIGINT           NOT NULL DEFAULT 0,
    warehouse_id BIGINT           NOT NULL DEFAULT 0,
    kind         INTEGER          NOT NULL CHECK (kind BETWEEN 1 AND 4),
    shop_id      BIGINT           NOT NULL DEFAULT 0 CHECK (shop_id >= 0),
    user_id      BIGINT           NOT NULL DEFAULT 0 CHECK (user_id >= 0),
    -- Exact, signed (the-backend-never-rounds-money): a correction day can read below 0.
    amount       DOUBLE PRECISION NOT NULL DEFAULT 0,
    last_updated TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    -- The side is the team itself, on one side at most.
    CONSTRAINT expense_metric_daily_reports_side CHECK (
        seller_id IN (0, team_id) AND warehouse_id IN (0, team_id) AND (seller_id = 0 OR warehouse_id = 0)
    )
);

-- The fold's upsert target — one row per key and day. Also root's read over a window (every team's).
CREATE UNIQUE INDEX expense_metric_daily_reports_key_unique
    ON expense_metric_daily_reports (day, team_id, kind, shop_id, user_id);

-- A team's own read over a window.
CREATE INDEX expense_metric_daily_reports_team_day_idx ON expense_metric_daily_reports (team_id, day);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE expense_metric_daily_reports;
-- +goose StatementEnd
