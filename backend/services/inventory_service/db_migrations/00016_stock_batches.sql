-- +goose Up
-- STOCK BECOMES PER-(SHELF × BATCH) — the FIFO cost-layer model (#208/#209, plans/stock_service).
--
-- Until now on-hand was per (warehouse, product, rack) with cost read as "the latest restock's price"
-- (StockCost). That cannot answer the questions every stock screen asks: what is THIS shelf worth when
-- its units came from two deliveries at two prices, and which delivery does a pick draw from. A batch —
-- one product's units from one delivery — freezes its own cost, so on-hand splits into cost layers and
-- picks draw the oldest layer first.
--
-- This migration adds the batch tables. `stock_levels` stays as the per-shelf on-hand cache (a SUM over
-- the shelf's batches); the accept flow (#206) is what mints a batch per received line in a later step.

-- A batch = one product's units from one delivery (an accepted restock line, #207). It freezes the
-- cost those units carry and tracks the delivery's lifecycle: Arrived = Damaged + (Used) + Ready.
CREATE TABLE stock_batches (
    id BIGSERIAL PRIMARY KEY,

    -- Scope + identity. warehouse_id/product_id are opaque cross-service ids (no FK); the batch belongs
    -- to exactly ONE accepted restock line, which is what makes "batch = a delivery line" true (#207).
    warehouse_id BIGINT NOT NULL,
    product_id   BIGINT NOT NULL,
    -- The delivery's display number is its restock request id (`#3007`); denormalised so a batch list
    -- need not join to name it. The LINE is the real identity — one batch per received line.
    delivery_id  BIGINT NOT NULL,
    restock_request_item_id BIGINT NOT NULL
        REFERENCES restock_request_items (id) ON DELETE RESTRICT,

    -- FROZEN HPP, whole rupiah — the cost this layer carries (freight included, as StockCost computes).
    -- ⚠ NULL is UNKNOWN, never 0 (#74): a product received with no cost basis has no layer price, and a
    -- zero would value the shelf as if the goods were free. Value math must tolerate NULL.
    unit_cost BIGINT,

    -- What the delivery LINE brought and what never became stock. Arrived is fixed at acceptance;
    -- Ready = Σ shelf_batch.qty (derived); Used = arrived − damaged − Ready (derived).
    arrived_qty BIGINT NOT NULL CHECK (arrived_qty >= 0),
    damaged_qty BIGINT NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),

    -- Perishables only (#208) — NULL means "does not expire". Drives the amber "expiring ≤ 30 days".
    expires_on DATE,

    -- WHO raised the restock and WHO accepted it — the two actors the batch/receipt screens name.
    -- Opaque user_service ids; 0 when unknown.
    created_by  BIGINT NOT NULL DEFAULT 0,
    accepted_by BIGINT NOT NULL DEFAULT 0,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One batch per received line — the line IS the batch (#207), so accepting a line twice cannot mint two.
CREATE UNIQUE INDEX stock_batches_item_idx ON stock_batches (restock_request_item_id);
-- The Batches tab and cost-layer reads are "this warehouse's this product, oldest first" (FIFO).
CREATE INDEX stock_batches_wh_product_idx ON stock_batches (warehouse_id, product_id, id);

-- How many READY units of a batch sit on ONE shelf. A batch fans across shelves (a delivery of 100
-- does not go on one), and a shelf holds several batches — this is the (shelf × batch) grain the whole
-- feature turns on. On-hand for a (product, rack) is the SUM over the batches on it.
CREATE TABLE stock_shelf_batches (
    id BIGSERIAL PRIMARY KEY,
    batch_id BIGINT NOT NULL REFERENCES stock_batches (id) ON DELETE RESTRICT,

    -- NULL = the unplaced/holding pile (#135) — received, not shelved yet. A real place, not an absence.
    -- ON DELETE RESTRICT like every rack reference: a shelf holding stock cannot be deleted (#138).
    rack_id BIGINT REFERENCES racks (id) ON DELETE RESTRICT,

    qty BIGINT NOT NULL CHECK (qty >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- A batch names each place ONCE. NULLS NOT DISTINCT so the unplaced pile is also single-rowed —
    -- the same rule stock_levels uses for its unplaced identity.
    CONSTRAINT stock_shelf_batch_unique UNIQUE NULLS NOT DISTINCT (batch_id, rack_id)
);

CREATE INDEX stock_shelf_batches_batch_idx ON stock_shelf_batches (batch_id);
CREATE INDEX stock_shelf_batches_rack_idx ON stock_shelf_batches (rack_id);

-- Which batch a ledger event moved. NULLABLE: a shelf RECOUNT is batch-less (#211) — it reconciles the
-- whole shelf and shows Batch "—" in Stock History, even though its delta lands on the oldest batch
-- underneath (FIFO, owner). Every batch-scoped event (receive/move/pick/adjust) carries its batch here.
ALTER TABLE stock_movements ADD COLUMN batch_id BIGINT REFERENCES stock_batches (id) ON DELETE RESTRICT;
CREATE INDEX stock_movements_batch_idx ON stock_movements (batch_id);

-- +goose Down
ALTER TABLE stock_movements DROP COLUMN batch_id;
DROP TABLE stock_shelf_batches;
DROP TABLE stock_batches;
