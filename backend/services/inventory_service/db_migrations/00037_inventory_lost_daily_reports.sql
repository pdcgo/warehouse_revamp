-- +goose Up
-- +goose StatementBegin
-- LOST STOCK, BY DAY (docs/business/analytic/rpc_provide_decision.md — inventory-lost-counts-the-warehouses-custody-losses,
-- inventory-lost-is-gross, inventory-lost-groups-and-sits-under-inventory, the-inventory-lost-prototype-is-accepted).
--
-- One row per Jakarta day × warehouse × owning team × product × supplier: the units LOST in the warehouse's custody and
-- their value at the batch's price. Folded IN-PROCESS, in the same transaction as the `warehouse_stock_problems` row it
-- counts (a `lost` row only — never `broken`): a stock count's shortage written off as lost
-- (inventory_mutations.PostCountFinalize) and a Stock Adjust "lost" (PostShelfProblem). inventory owns both the problem
-- rows and this table, so no event is needed and the report is never behind its source.
--
-- GROSS: a later Found claim never subtracts, and a past day never changes — rows only ever grow.
--
-- `team_id` is the stock's owner (the batch's team — the Seller group), `warehouse_id` the warehouse that held it,
-- `supplier_id` the batch's own supplier (a-batch-keeps-its-supplier), 0 when the batch names none. Every *_id is another
-- service's or a key: no FK.
CREATE TABLE inventory_lost_daily_reports (
    id           BIGSERIAL PRIMARY KEY,
    day          DATE          NOT NULL,
    warehouse_id BIGINT        NOT NULL CHECK (warehouse_id > 0),
    team_id      BIGINT        NOT NULL CHECK (team_id > 0),
    product_id   BIGINT        NOT NULL CHECK (product_id > 0),
    supplier_id  BIGINT        NOT NULL DEFAULT 0 CHECK (supplier_id >= 0),
    lost_count   BIGINT        NOT NULL DEFAULT 0 CHECK (lost_count >= 0),
    lost_amount  NUMERIC(20,2) NOT NULL DEFAULT 0,
    last_updated TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- The fold's upsert target — one row per key and day.
CREATE UNIQUE INDEX inventory_lost_daily_reports_key_unique
    ON inventory_lost_daily_reports (day, warehouse_id, team_id, product_id, supplier_id);

-- The two readers: the owning seller (team_id) and the warehouse that held the stock (warehouse_id), each over a window.
CREATE INDEX inventory_lost_daily_reports_team_day_idx ON inventory_lost_daily_reports (team_id, day);
CREATE INDEX inventory_lost_daily_reports_warehouse_day_idx ON inventory_lost_daily_reports (warehouse_id, day);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE inventory_lost_daily_reports;
-- +goose StatementEnd
