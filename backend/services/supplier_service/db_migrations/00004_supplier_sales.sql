-- +goose Up
-- +goose StatementBegin
-- PENJUALAN — what went OUT of a supplier's goods to a buyer, beside what came in
-- (docs/technical/frontend/suppliers_decision.md#penjualan-is-the-selling-value-on-the-order-day).
--
-- ⚠ DERIVED, like every figure table here. The order and its stock take are the truth; these are built by
-- supplier_service's webhook consuming `OrderPlaced` and `OrderCancelled`. Their OWN tables, not columns of
-- `supplier_product_daily_reports`: AnalyticReplayCompute deletes that table and seeks the restock subscription only, so
-- a sale kept there would be deleted and never brought back.

-- ONE ROW PER ORDER the sales fold has seen — the claim, and what makes the two events order-independent: a cancel that
-- arrives first leaves `cancelled_day` with no `placed_day`, and the late placement then folds both days at once.
CREATE TABLE supplier_sale_orders (
    order_id      BIGINT      PRIMARY KEY,
    -- The order's Jakarta day (OrderPlaced's occurred_at) — NULL until the placement is folded.
    placed_day    DATE,
    -- The cancel's Jakarta day (OrderCancelled's occurred_at) — NULL while the order stands.
    cancelled_day DATE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- WHAT ONE ORDER ADDED — per supplier, product and owning team — kept so the cancel takes back exactly that, whatever
-- the take or the prices read like later.
CREATE TABLE supplier_sale_order_parts (
    order_id    BIGINT           NOT NULL,
    supplier_id BIGINT           NOT NULL,
    product_id  BIGINT           NOT NULL,
    -- The team that owns the goods (the batch's team) — the restocking team, as Direstok's rows are keyed.
    team_id     BIGINT           NOT NULL,
    units       BIGINT           NOT NULL,
    -- Their selling value, exact rupiah (the-backend-never-rounds-money).
    value       DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (order_id, supplier_id, product_id, team_id)
);

-- THE FIGURES — one row per Jakarta day, supplier, product and owning team with a sale or a cancel. SIGNED: a cancel
-- subtracts on its own day, so a day may read below zero (the warehouse fee's shape,
-- a-warehouse-fee-counts-on-its-day-and-a-cancel-takes-it-back-on-its-day).
CREATE TABLE supplier_sale_daily_reports (
    id           BIGSERIAL        PRIMARY KEY,
    day          DATE             NOT NULL,
    supplier_id  BIGINT           NOT NULL,
    product_id   BIGINT           NOT NULL,
    team_id      BIGINT           NOT NULL,
    sales_count  BIGINT           NOT NULL DEFAULT 0,
    sales_value  DOUBLE PRECISION NOT NULL DEFAULT 0,
    last_updated TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- The fold's upsert target, day first — as `supplier_product_daily_reports_key_idx`, so every window scan is the same.
CREATE UNIQUE INDEX supplier_sale_daily_reports_key_idx
    ON supplier_sale_daily_reports (day, supplier_id, product_id, team_id);
-- One supplier over a window — the Statistics tab's series and its by-product table.
CREATE INDEX supplier_sale_daily_reports_supplier_day_idx
    ON supplier_sale_daily_reports (supplier_id, day);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE supplier_sale_daily_reports;
DROP TABLE supplier_sale_order_parts;
DROP TABLE supplier_sale_orders;
-- +goose StatementEnd
