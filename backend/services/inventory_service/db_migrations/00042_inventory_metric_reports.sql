-- +goose Up
-- +goose StatementBegin
-- THE FOUR INVENTORY METRICS' REPORTS (docs/business/analytic/rpc_provide_decision.md —
-- the-four-inventory-metrics-filter-like-lost-stock, the-inventory-metrics-prototype-is-accepted,
-- a-transfer-counts-each-side-on-its-own-day, a-warehouse-sees-ready-value-but-a-shelf-only-units,
-- ready-stock-is-folded-in-the-stock-changes-own-step). Keyed like Lost stock's (00037): Jakarta day × warehouse × owning
-- team × product × supplier. Every *_id is another service's or a key: no FK.

-- 1. EVERY STOCK CHANGE, NETTED PER DAY. One row per key, day and `batch_logs.change_type`: the units and value every
-- batch_logs row of that day moved (signed — out is negative), written IN THE SAME TRANSACTION as the log rows, as the
-- transaction's LAST lock (inventory_ledgers.StockTransaction — the ledger's three writers, MintBatches,
-- BatchWrites.Flush and Revalue, note each row; the wrapper folds them at the end). So Σ change = Σ batch_logs, per key
-- and day, by construction.
--   Ready stock    = today's batches − every change after the edge (a position read backwards, all types);
--   Restock        = change_type 'restock' (units and value accepted);
--   Transfer       = 'transfer_out' negated (sent — a cancel's reversal nets on the cancel day) and 'transfer_in'
--                    (received);
--   Returned stock = 'return' (back on the shelf).
-- `team_id` is the batch's owner (a-batch-carries-its-owner), `warehouse_id` where the batch sits, `supplier_id` the
-- batch's own (a-batch-keeps-its-supplier), 0 when it names none. Money is the exact double
-- (the-backend-never-rounds-money).
CREATE TABLE inventory_stock_daily_changes (
    day          DATE             NOT NULL,
    warehouse_id BIGINT           NOT NULL CHECK (warehouse_id > 0),
    team_id      BIGINT           NOT NULL CHECK (team_id > 0),
    product_id   BIGINT           NOT NULL CHECK (product_id > 0),
    supplier_id  BIGINT           NOT NULL DEFAULT 0 CHECK (supplier_id >= 0),
    -- batch_logs' own list (00025).
    change_type  TEXT             NOT NULL CHECK (change_type IN (
                     'order', 'revaluation', 'return', 'restock', 'adjustment', 'broken', 'lost',
                     'transfer_in', 'transfer_out', 'found', 'sample')),
    change_count BIGINT           NOT NULL DEFAULT 0,
    change_value DOUBLE PRECISION NOT NULL DEFAULT 0,
    last_updated TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

    -- The fold's upsert target — one row per key, day and type. No surrogate id: one index less on every stock write.
    PRIMARY KEY (day, warehouse_id, team_id, product_id, supplier_id, change_type)
);

-- The two readers: the owning seller (team_id) and the warehouse (warehouse_id), each over a window or "after the edge".
-- The change type rides last, so a movement's read (Restock: 'restock' only) is judged in the index and visits only its
-- own rows of the heap, while Ready's (every type after the edge) still reads the (…, day) range — no third index on
-- the take's path (audits/services/inventory_service/performances/MetricData.md, finding 0).
CREATE INDEX inventory_stock_daily_changes_team_day_idx ON inventory_stock_daily_changes (team_id, day, change_type);
CREATE INDEX inventory_stock_daily_changes_warehouse_day_idx ON inventory_stock_daily_changes (warehouse_id, day, change_type);

-- 2. THE DOOR — what a restock accept or a return accept found broken or missing, per day, written in that accept's own
-- transaction just before the change rows (StockTransaction). Never stock: a broken unit is thrown away, a missing one
-- never came (restock: a-short-unit-at-the-door-is-missing; return: a-short-return-is-missing-at-the-door,
-- a-broken-returned-unit-is-thrown-away-at-the-door). `team_id` is the goods' owner — the restocking team, or the
-- ordering team for a return (a borrowed line under its mapped own product); `supplier_id` the restock line's, or the
-- layer's batch's for a return.
CREATE TABLE inventory_door_daily_reports (
    day           DATE        NOT NULL,
    warehouse_id  BIGINT      NOT NULL CHECK (warehouse_id > 0),
    team_id       BIGINT      NOT NULL CHECK (team_id > 0),
    product_id    BIGINT      NOT NULL CHECK (product_id > 0),
    supplier_id   BIGINT      NOT NULL DEFAULT 0 CHECK (supplier_id >= 0),
    source        TEXT        NOT NULL CHECK (source IN ('restock', 'return')),
    broken_count  BIGINT      NOT NULL DEFAULT 0 CHECK (broken_count >= 0),
    missing_count BIGINT      NOT NULL DEFAULT 0 CHECK (missing_count >= 0),
    last_updated  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (day, warehouse_id, team_id, product_id, supplier_id, source)
);

CREATE INDEX inventory_door_daily_reports_team_day_idx ON inventory_door_daily_reports (team_id, day);
CREATE INDEX inventory_door_daily_reports_warehouse_day_idx ON inventory_door_daily_reports (warehouse_id, day);

-- 3. THE CHANGES SO FAR, from the ledger itself: Ready stock reads a past day BACKWARDS from today's batches, so every
-- change after that day must be in the table, the ones before the build included — otherwise a past day would read
-- today's stock minus only the changes since the build. Exact (the same rows the fold sums). The door rows are not
-- replayed: like Lost stock (lost-stock-is-not-backfilled) they count from the build, and revamp has no real data
-- (revamp-has-no-real-orders-yet).
INSERT INTO inventory_stock_daily_changes
    (day, warehouse_id, team_id, product_id, supplier_id, change_type, change_count, change_value)
SELECT (l.created_at AT TIME ZONE 'Asia/Jakarta')::date, l.warehouse_id, l.team_id, b.product_id, b.supplier_id,
       l.change_type, SUM(l.change_count), SUM(l.change_valuation)
FROM batch_logs l
JOIN batches b ON b.id = l.batch_id
WHERE b.product_id > 0
GROUP BY 1, 2, 3, 4, 5, 6;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE inventory_door_daily_reports;
DROP TABLE inventory_stock_daily_changes;
-- +goose StatementEnd
