-- +goose Up
-- +goose StatementBegin
-- THE DECIDED LEDGERS (docs/development_state/inventory/ledgers.md, stage 1). Additive only: nothing reads or writes these
-- tables yet, and today's stock_* tables are untouched. They replace those tables outright, stage by stage, with no
-- switch-over (no-switch-over-the-ledgers-replace-todays-tables).
--
-- Money is DOUBLE PRECISION and compared at 4 digits, never with = (stock-money-is-float64-compared-at-4-digits).
-- Counts are BIGINT and never fractional. Every *_id but the in-service ones is another service's: no FK.

-- 1. A TRANSACTION IS ONE STOCK CHANGE (every-stock-change-belongs-to-a-transaction). Its type names ONE direction
--    (problem-and-found-replace-opname). `team_id` is the ORDERING team for an order, the owner for every other type
--    (an-order-transaction-is-the-ordering-teams).
CREATE TABLE inventory_transactions (
    id                BIGSERIAL PRIMARY KEY,
    warehouse_id      BIGINT           NOT NULL CHECK (warehouse_id > 0),
    team_id           BIGINT           NOT NULL CHECK (team_id > 0),
    tx_type           TEXT             NOT NULL CHECK (tx_type IN (
                          'order', 'restock', 'return', 'sample', 'transfer_in', 'transfer_out',
                          'adjustment', 'revaluation', 'problem', 'found', 'move')),
    create_by_user_id BIGINT           NOT NULL DEFAULT 0 CHECK (create_by_user_id >= 0),
    -- Set once, by the rollback, under the row lock (an-undo-rolls-the-transaction-back-once). Only a take is ever
    -- rolled back (a-rollback-only-undoes-a-take); the mutation refuses any other type.
    is_rollback       BOOLEAN          NOT NULL DEFAULT FALSE,
    description       TEXT             NOT NULL DEFAULT '',
    -- Set by a sample only (a-sample-keeps-its-recipient).
    recipient         TEXT             NOT NULL DEFAULT '',
    updated_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    created_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- A team's history, its sample list and the reports group by team and type (items-are-what-history-and-reports-read).
CREATE INDEX inventory_transactions_team_idx      ON inventory_transactions (team_id, tx_type, created_at);
CREATE INDEX inventory_transactions_warehouse_idx ON inventory_transactions (warehouse_id, created_at);

-- 2. AN ITEM IS THE TRANSACTION'S SUMMARY, ONE PER PRODUCT (an-item-names-its-product). It equals its batch rows: the
--    units they moved and their value (an-item-equals-its-batch-rows); a move counts the units off its source rack and
--    totals 0 (a-move-lists-its-units-at-zero-value). Always positive: the type gives the direction.
CREATE TABLE inventory_transaction_items (
    id              BIGSERIAL PRIMARY KEY,
    warehouse_id    BIGINT           NOT NULL CHECK (warehouse_id > 0),
    transaction_id  BIGINT           NOT NULL REFERENCES inventory_transactions (id) ON DELETE RESTRICT,
    product_id      BIGINT           NOT NULL CHECK (product_id > 0),
    -- The product's OWNER, on every item (an-item-carries-its-owning-team); is_owned = owner is the transaction's team.
    product_team_id BIGINT           NOT NULL CHECK (product_team_id > 0),
    is_owned        BOOLEAN          NOT NULL,
    quantity        BIGINT           NOT NULL CHECK (quantity >= 0),
    total           DOUBLE PRECISION NOT NULL,
    created_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

    CONSTRAINT inventory_transaction_items_one_per_product UNIQUE (transaction_id, product_id)
);

-- "What was taken from my stock" — the owner reads items, not headers.
CREATE INDEX inventory_transaction_items_owner_idx     ON inventory_transaction_items (product_team_id, created_at);
CREATE INDEX inventory_transaction_items_warehouse_idx ON inventory_transaction_items (warehouse_id, created_at);

-- 3. THE BATCH LEDGER'S STATE — one batch is the scope. `stock_valuation` is the truth; a batch at 0 units is worth
--    exactly 0 (an-emptying-take-takes-all-the-value). `team_id` is the owner, written at mint, never changed
--    (a-batch-carries-its-owner). A batch is never deleted: an emptied one reopens on a found claim.
CREATE TABLE batches (
    id                   BIGSERIAL PRIMARY KEY,
    warehouse_id         BIGINT           NOT NULL CHECK (warehouse_id > 0),
    team_id              BIGINT           NOT NULL CHECK (team_id > 0),
    product_id           BIGINT           NOT NULL CHECK (product_id > 0),
    -- The transaction that MINTED it.
    transaction_id       BIGINT           NOT NULL REFERENCES inventory_transactions (id) ON DELETE RESTRICT,
    price_unit           DOUBLE PRECISION NOT NULL,
    stock_count          BIGINT           NOT NULL CHECK (stock_count >= 0),
    stock_valuation      DOUBLE PRECISION NOT NULL,
    init_stock_count     BIGINT           NOT NULL CHECK (init_stock_count >= 0),
    init_stock_valuation DOUBLE PRECISION NOT NULL,
    -- Copied from the restock line or the source batch (a-batch-keeps-its-supplier). 0 = not named.
    supplier_id          BIGINT           NOT NULL DEFAULT 0 CHECK (supplier_id >= 0),
    supplier_channel_id  BIGINT           NOT NULL DEFAULT 0 CHECK (supplier_channel_id >= 0),
    -- Read by the expiry report only, never by the take (expiry-is-a-report).
    expired_at           TIMESTAMPTZ,
    updated_at           TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    created_at           TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- The take: a team's batches of a product in a warehouse, oldest (lowest id) first, only those with units.
CREATE INDEX batches_take_idx       ON batches (warehouse_id, team_id, product_id, id) WHERE stock_count > 0;
-- The last price, emptied batches included (last-price-is-the-teams-newest-batch-here).
CREATE INDEX batches_last_price_idx ON batches (warehouse_id, team_id, product_id, created_at DESC);
CREATE INDEX batches_expiry_idx     ON batches (warehouse_id, expired_at)
    WHERE stock_count > 0 AND expired_at IS NOT NULL;

-- 4. THE BATCH LEDGER'S LOG — append-only, no updated_at (ledger-logs-are-append-only). Read in id order: the balance
--    after is a sequence written under the lock, not a time. A problem's rows carry the reason, broken or lost.
CREATE TABLE batch_logs (
    id                    BIGSERIAL PRIMARY KEY,
    warehouse_id          BIGINT           NOT NULL CHECK (warehouse_id > 0),
    team_id               BIGINT           NOT NULL CHECK (team_id > 0),
    batch_id              BIGINT           NOT NULL REFERENCES batches (id) ON DELETE RESTRICT,
    transaction_id        BIGINT           NOT NULL REFERENCES inventory_transactions (id) ON DELETE RESTRICT,
    change_type           TEXT             NOT NULL CHECK (change_type IN (
                              'order', 'revaluation', 'return', 'restock', 'adjustment', 'broken', 'lost',
                              'transfer_in', 'transfer_out', 'found', 'sample')),
    change_count          BIGINT           NOT NULL,
    change_valuation      DOUBLE PRECISION NOT NULL,
    stock_count_after     BIGINT           NOT NULL CHECK (stock_count_after >= 0),
    stock_valuation_after DOUBLE PRECISION NOT NULL,
    -- The batch's price once this row applies, on every row (batch-logs-carry-price-unit-after).
    price_unit_after      DOUBLE PRECISION NOT NULL,
    description           TEXT             NOT NULL DEFAULT '',
    actor_id              BIGINT           NOT NULL DEFAULT 0 CHECK (actor_id >= 0),
    created_at            TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX batch_logs_batch_idx       ON batch_logs (batch_id, id);
CREATE INDEX batch_logs_transaction_idx ON batch_logs (transaction_id);

-- 5. EVERY PRICE A BATCH HAS HAD — a mint writes the first, a revaluation each change. Append-only.
CREATE TABLE batch_price_logs (
    id               BIGSERIAL PRIMARY KEY,
    batch_id         BIGINT           NOT NULL REFERENCES batches (id) ON DELETE RESTRICT,
    new_price_unit   DOUBLE PRECISION NOT NULL,
    delta_price_unit DOUBLE PRECISION NOT NULL,
    description      TEXT             NOT NULL DEFAULT '',
    actor_id         BIGINT           NOT NULL DEFAULT 0 CHECK (actor_id >= 0),
    created_at       TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE INDEX batch_price_logs_batch_idx ON batch_price_logs (batch_id, id);

-- 6. THE PLACEMENT LEDGER'S STATE — one row per product per rack (one-shelf-row-per-product-per-placement). A rack never
--    goes below zero, checked by the database (a-shelf-never-goes-below-zero). It never knows a batch
--    (expiry-is-a-report). The FK points at `racks`, which becomes `placements` in stage 3; Postgres carries it across.
CREATE TABLE product_placements (
    id           BIGSERIAL PRIMARY KEY,
    team_id      BIGINT      NOT NULL CHECK (team_id > 0),
    warehouse_id BIGINT      NOT NULL CHECK (warehouse_id > 0),
    product_id   BIGINT      NOT NULL CHECK (product_id > 0),
    placement_id BIGINT      NOT NULL REFERENCES racks (id) ON DELETE RESTRICT,
    stock_count  BIGINT      NOT NULL DEFAULT 0 CHECK (stock_count >= 0),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT product_placements_one_per_product UNIQUE (product_id, placement_id)
);

-- The take locks all of a product's racks by id, then chooses among them.
CREATE INDEX product_placements_take_idx      ON product_placements (warehouse_id, team_id, product_id, id);
CREATE INDEX product_placements_placement_idx ON product_placements (placement_id);

-- 7. THE PLACEMENT LEDGER'S LOG — append-only, read in id order.
CREATE TABLE product_placement_logs (
    id             BIGSERIAL PRIMARY KEY,
    warehouse_id   BIGINT      NOT NULL CHECK (warehouse_id > 0),
    team_id        BIGINT      NOT NULL CHECK (team_id > 0),
    product_id     BIGINT      NOT NULL CHECK (product_id > 0),
    placement_id   BIGINT      NOT NULL REFERENCES racks (id) ON DELETE RESTRICT,
    transaction_id BIGINT      NOT NULL REFERENCES inventory_transactions (id) ON DELETE RESTRICT,
    change_type    TEXT        NOT NULL CHECK (change_type IN (
                       'order', 'restock', 'return', 'sample', 'transfer_in', 'transfer_out',
                       'adjustment', 'move', 'broken', 'lost', 'found')),
    stock_change   BIGINT      NOT NULL,
    stock_after    BIGINT      NOT NULL CHECK (stock_after >= 0),
    description    TEXT        NOT NULL DEFAULT '',
    actor_id       BIGINT      NOT NULL DEFAULT 0 CHECK (actor_id >= 0),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A rack's stock flow; the pick page by transaction id (the-placement-page-reads-racks-by-transaction-id); rollback.
CREATE INDEX product_placement_logs_flow_idx        ON product_placement_logs (placement_id, product_id, id);
CREATE INDEX product_placement_logs_transaction_idx ON product_placement_logs (warehouse_id, transaction_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE product_placement_logs;
DROP TABLE product_placements;
DROP TABLE batch_price_logs;
DROP TABLE batch_logs;
DROP TABLE batches;
DROP TABLE inventory_transaction_items;
DROP TABLE inventory_transactions;
-- +goose StatementEnd
