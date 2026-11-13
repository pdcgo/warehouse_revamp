-- +goose Up
-- +goose StatementBegin
-- KOREKSI JUMLAH TERIMA (docs/business/inventory/adjustment_decision.md — the-warehouse-corrects-a-wrong-stock-in-alone,
-- a-stock-in-correction-keeps-the-batch-price, a-wrong-stock-in-is-a-received-count-correction,
-- the-received-count-prototype-is-accepted, a-received-count-correction-counts-on-its-own-day). The receiving warehouse
-- corrects an ACCEPTED restock's or transfer's received count; the units move at the batch's price in an `adjustment`
-- transaction (a-rollback-only-undoes-a-take).

-- 1. TWO NEW LOG CHANGE TYPES. The correction's batch and rack rows are `restock_correction` / `transfer_correction`,
-- never `adjustment`: on a rack row `adjustment` means "last counted" (a recount — placement_list, product_stock_summary,
-- BatchPlacementList read it so), and the Restock and Transfer metrics read the stock change report BY TYPE, so a
-- correction moves accepted / received on its own day, signed, while Σ report = Σ batch_logs stays true by construction
-- (inventory_ledgers.StockTransaction). The history reads both as ADJUST.
ALTER TABLE batch_logs DROP CONSTRAINT batch_logs_change_type_check;
ALTER TABLE batch_logs ADD CONSTRAINT batch_logs_change_type_check CHECK (change_type IN (
    'order', 'revaluation', 'return', 'restock', 'adjustment', 'broken', 'lost',
    'transfer_in', 'transfer_out', 'found', 'sample', 'restock_correction', 'transfer_correction'));

ALTER TABLE product_placement_logs DROP CONSTRAINT product_placement_logs_change_type_check;
ALTER TABLE product_placement_logs ADD CONSTRAINT product_placement_logs_change_type_check CHECK (change_type IN (
    'order', 'restock', 'return', 'sample', 'transfer_in', 'transfer_out',
    'adjustment', 'move', 'broken', 'lost', 'found', 'restock_correction', 'transfer_correction'));

ALTER TABLE inventory_stock_daily_changes DROP CONSTRAINT inventory_stock_daily_changes_change_type_check;
ALTER TABLE inventory_stock_daily_changes ADD CONSTRAINT inventory_stock_daily_changes_change_type_check CHECK (change_type IN (
    'order', 'revaluation', 'return', 'restock', 'adjustment', 'broken', 'lost',
    'transfer_in', 'transfer_out', 'found', 'sample', 'restock_correction', 'transfer_correction'));

-- 2. THE DOOR'S MISSING IS SIGNED. A too-few correction gives back missing units on ITS day — the day's row may read −2
-- (a-received-count-correction-counts-on-its-own-day: "signed"; past days never re-folded). Broken stays ≥ 0: a
-- correction never changes the broken units.
ALTER TABLE inventory_door_daily_reports DROP CONSTRAINT inventory_door_daily_reports_missing_count_check;

-- 3. THE CORRECTIONS, one table per stock-in. Never the problem tables: those hold ONE missing row per product (UNIQUE
-- restock/transfer × product × type) and are the accept's, and a correction must never read as the selling team's edit
-- on the trail. Append-only: the Kurang of a line = the accept's missing row + Σ units_out here. Who and when are the
-- correction's; `is_override` per an-override-is-stamped-in-every-service. Money is the batch's price at the time, the
-- exact double (the-backend-never-rounds-money).
CREATE TABLE restock_count_corrections (
    id              BIGSERIAL PRIMARY KEY,
    restock_id      BIGINT           NOT NULL REFERENCES restocks (id) ON DELETE RESTRICT,
    restock_item_id BIGINT           NOT NULL REFERENCES restock_items (id) ON DELETE RESTRICT,
    product_id      BIGINT           NOT NULL CHECK (product_id > 0),
    -- The receiving warehouse, and the selling team that owns the goods (a-batch-carries-its-owner).
    warehouse_id    BIGINT           NOT NULL CHECK (warehouse_id > 0),
    team_id         BIGINT           NOT NULL CHECK (team_id > 0),
    -- The `adjustment` transaction — its batch and rack rows are the stock record.
    transaction_id  BIGINT           NOT NULL REFERENCES inventory_transactions (id) ON DELETE RESTRICT,
    -- The line's batch the units moved in (minted by the correction when the line had none), and the rack.
    batch_id        BIGINT           NOT NULL REFERENCES batches (id) ON DELETE RESTRICT,
    placement_id    BIGINT           NOT NULL REFERENCES placements (id) ON DELETE RESTRICT,
    -- The line's received count before and after; units_out = from − to (> 0 out of the batch, < 0 into it).
    from_count      BIGINT           NOT NULL CHECK (from_count >= 0),
    to_count        BIGINT           NOT NULL CHECK (to_count >= 0),
    units_out       BIGINT           NOT NULL CHECK (units_out <> 0),
    price_unit      DOUBLE PRECISION NOT NULL,
    -- units_out × the value per unit the batch gave up or took — signed like units_out.
    total           DOUBLE PRECISION NOT NULL,
    reason          TEXT             NOT NULL CHECK (btrim(reason) <> ''),
    actor_user_id   BIGINT           NOT NULL DEFAULT 0 CHECK (actor_user_id >= 0),
    is_override     BOOLEAN          NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

    CONSTRAINT restock_count_corrections_units_check CHECK (units_out = from_count - to_count)
);

-- The detail's read (every correction of one restock, in order) and the history's label (a log row's transaction).
CREATE INDEX restock_count_corrections_restock_idx ON restock_count_corrections (restock_id, id);
CREATE INDEX restock_count_corrections_transaction_idx ON restock_count_corrections (transaction_id);
-- A batch's units out by corrections (the batch summary's Hilang / Terpakai — batchSelect's countOutExpr).
CREATE INDEX restock_count_corrections_batch_idx ON restock_count_corrections (batch_id);

-- A transfer line may draw SEVERAL of B's batches — one per source layer (the-receiver-mints-one-batch-per-source-batch)
-- — so one correction of a line writes ONE ROW PER BATCH IT MOVED: from / to are the line's, units_out the batch's
-- piece. `layer_batch_id` is the source batch at A the piece's batch at B stands for, so a later correction finds the
-- batch a correction minted for a layer that had none.
CREATE TABLE warehouse_transfer_count_corrections (
    id               BIGSERIAL PRIMARY KEY,
    transfer_id      BIGINT           NOT NULL REFERENCES warehouse_transfers (id) ON DELETE RESTRICT,
    transfer_item_id BIGINT           NOT NULL REFERENCES warehouse_transfer_items (id) ON DELETE RESTRICT,
    product_id       BIGINT           NOT NULL CHECK (product_id > 0),
    warehouse_id     BIGINT           NOT NULL CHECK (warehouse_id > 0),
    team_id          BIGINT           NOT NULL CHECK (team_id > 0),
    transaction_id   BIGINT           NOT NULL REFERENCES inventory_transactions (id) ON DELETE RESTRICT,
    batch_id         BIGINT           NOT NULL REFERENCES batches (id) ON DELETE RESTRICT,
    layer_batch_id   BIGINT           NOT NULL REFERENCES batches (id) ON DELETE RESTRICT,
    placement_id     BIGINT           NOT NULL REFERENCES placements (id) ON DELETE RESTRICT,
    from_count       BIGINT           NOT NULL CHECK (from_count >= 0),
    to_count         BIGINT           NOT NULL CHECK (to_count >= 0),
    units_out        BIGINT           NOT NULL CHECK (units_out <> 0),
    price_unit       DOUBLE PRECISION NOT NULL,
    total            DOUBLE PRECISION NOT NULL,
    reason           TEXT             NOT NULL CHECK (btrim(reason) <> ''),
    actor_user_id    BIGINT           NOT NULL DEFAULT 0 CHECK (actor_user_id >= 0),
    is_override      BOOLEAN          NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX warehouse_transfer_count_corrections_transfer_idx ON warehouse_transfer_count_corrections (transfer_id, id);
CREATE INDEX warehouse_transfer_count_corrections_transaction_idx ON warehouse_transfer_count_corrections (transaction_id);
CREATE INDEX warehouse_transfer_count_corrections_batch_idx ON warehouse_transfer_count_corrections (batch_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE warehouse_transfer_count_corrections;
DROP TABLE restock_count_corrections;

ALTER TABLE inventory_door_daily_reports ADD CONSTRAINT inventory_door_daily_reports_missing_count_check CHECK (missing_count >= 0);

ALTER TABLE inventory_stock_daily_changes DROP CONSTRAINT inventory_stock_daily_changes_change_type_check;
ALTER TABLE inventory_stock_daily_changes ADD CONSTRAINT inventory_stock_daily_changes_change_type_check CHECK (change_type IN (
    'order', 'revaluation', 'return', 'restock', 'adjustment', 'broken', 'lost',
    'transfer_in', 'transfer_out', 'found', 'sample'));

ALTER TABLE product_placement_logs DROP CONSTRAINT product_placement_logs_change_type_check;
ALTER TABLE product_placement_logs ADD CONSTRAINT product_placement_logs_change_type_check CHECK (change_type IN (
    'order', 'restock', 'return', 'sample', 'transfer_in', 'transfer_out',
    'adjustment', 'move', 'broken', 'lost', 'found'));

ALTER TABLE batch_logs DROP CONSTRAINT batch_logs_change_type_check;
ALTER TABLE batch_logs ADD CONSTRAINT batch_logs_change_type_check CHECK (change_type IN (
    'order', 'revaluation', 'return', 'restock', 'adjustment', 'broken', 'lost',
    'transfer_in', 'transfer_out', 'found', 'sample'));
-- +goose StatementEnd
