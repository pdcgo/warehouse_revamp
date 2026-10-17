-- +goose Up
-- +goose StatementBegin
-- A WAREHOUSE TRANSFER: a selling team moves its own stock from warehouse A to warehouse B
-- (docs/business/inventory/warehouse_transfer.md and its decisions). Its two legs are ledger transactions — the
-- transfer_out at create, the transfer_in at accept (the-decided-ledgers-come-before-the-transfer) — so these tables hold
-- only what the ledgers cannot: the trip, the lifecycle, and what went wrong at B's door.
--
-- Money is DOUBLE PRECISION and compared at 4 digits (stock-money-is-float64-compared-at-4-digits). A line's pick list
-- and where B put its units are NOT stored here: they are the legs' rack rows, read back from product_placement_logs.

-- 1. THE TRANSFER. One selling team, A and B never equal (a-transfer-never-goes-to-its-own-warehouse), seven statuses
--    (a-transfer-has-seven-statuses), in the owner's words.
CREATE TABLE warehouse_transfers (
    id                             BIGSERIAL PRIMARY KEY,
    -- The selling team that owns the goods.
    team_id                        BIGINT           NOT NULL CHECK (team_id > 0),
    from_warehouse_id              BIGINT           NOT NULL CHECK (from_warehouse_id > 0),
    to_warehouse_id                BIGINT           NOT NULL CHECK (to_warehouse_id > 0),
    status                         TEXT             NOT NULL CHECK (status IN (
                                       'created', 'process', 'shipped', 'arrived', 'accepted', 'cancel', 'lost')),
    note                           TEXT             NOT NULL DEFAULT '',
    -- Σ the items' totals — the value the out-leg took (the-system-fills-a-transfers-prices).
    total                          DOUBLE PRECISION NOT NULL DEFAULT 0,

    -- The trip, entered by A at ship (the-sender-enters-the-courier-at-ship); all optional
    -- (a-transfer-may-travel-without-a-courier). shipment_id is shipping_service's — no FK.
    shipment_id                    BIGINT           NOT NULL DEFAULT 0 CHECK (shipment_id >= 0),
    receipt                        TEXT             NOT NULL DEFAULT '',
    receipt_file                   TEXT             NOT NULL DEFAULT '',

    -- The shipping expense, the selling team's, from its own account (a-transfer-names-its-paying-account): the
    -- account is required when there is a cost, and empty when there is none.
    shipment_cost                  DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (shipment_cost >= 0),
    finance_account_id             BIGINT           NOT NULL DEFAULT 0 CHECK (finance_account_id >= 0),
    -- Bumped by every edit that moves money, so each edit's event has its own id
    -- (the-shipping-expense-reaches-the-account-by-event).
    cost_revision                  BIGINT           NOT NULL DEFAULT 0 CHECK (cost_revision >= 0),
    -- The courier's charge at B's door, entered at accept, with its note (the-on-site-charge-is-paid-by-b-at-accept).
    warehouse_additional_cost      DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (warehouse_additional_cost >= 0),
    warehouse_additional_cost_note TEXT             NOT NULL DEFAULT '',

    -- The two legs. NULL = not written yet; the inbound stays NULL when no unit arrived good.
    outbound_transaction_id        BIGINT           REFERENCES inventory_transactions (id) ON DELETE RESTRICT,
    inbound_transaction_id         BIGINT           REFERENCES inventory_transactions (id) ON DELETE RESTRICT,

    -- Who did what, and when. 0 / NULL = not yet.
    created_by_user_id             BIGINT           NOT NULL DEFAULT 0 CHECK (created_by_user_id >= 0),
    processed_by_user_id           BIGINT           NOT NULL DEFAULT 0 CHECK (processed_by_user_id >= 0),
    processed_at                   TIMESTAMPTZ,
    shipped_by_user_id             BIGINT           NOT NULL DEFAULT 0 CHECK (shipped_by_user_id >= 0),
    shipped_at                     TIMESTAMPTZ,
    arrived_by_user_id             BIGINT           NOT NULL DEFAULT 0 CHECK (arrived_by_user_id >= 0),
    arrived_at                     TIMESTAMPTZ,
    accepted_by_user_id            BIGINT           NOT NULL DEFAULT 0 CHECK (accepted_by_user_id >= 0),
    accepted_at                    TIMESTAMPTZ,
    cancelled_by_user_id           BIGINT           NOT NULL DEFAULT 0 CHECK (cancelled_by_user_id >= 0),
    cancelled_at                   TIMESTAMPTZ,
    lost_by_user_id                BIGINT           NOT NULL DEFAULT 0 CHECK (lost_by_user_id >= 0),
    lost_at                        TIMESTAMPTZ,

    updated_at                     TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    created_at                     TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

    CONSTRAINT warehouse_transfers_never_to_itself  CHECK (from_warehouse_id <> to_warehouse_id),
    CONSTRAINT warehouse_transfers_cost_has_account CHECK (shipment_cost = 0 OR finance_account_id > 0),
    CONSTRAINT warehouse_transfers_charge_has_note  CHECK (warehouse_additional_cost = 0 OR warehouse_additional_cost_note <> '')
);

-- Each side lists its own, newest first: the selling team, A (outgoing), B (incoming).
CREATE INDEX warehouse_transfers_team_idx ON warehouse_transfers (team_id, id DESC);
CREATE INDEX warehouse_transfers_from_idx ON warehouse_transfers (from_warehouse_id, id DESC);
CREATE INDEX warehouse_transfers_to_idx   ON warehouse_transfers (to_warehouse_id, id DESC);

-- 2. ONE LINE PER PRODUCT (a-product-appears-once-per-transfer), never edited after create
--    (a-transfers-lines-are-never-edited). total is what the out-leg took for it; price_unit is total ÷ count, for
--    display only (the-system-fills-a-transfers-prices).
CREATE TABLE warehouse_transfer_items (
    id            BIGSERIAL PRIMARY KEY,
    transfer_id   BIGINT           NOT NULL REFERENCES warehouse_transfers (id) ON DELETE RESTRICT,
    product_id    BIGINT           NOT NULL CHECK (product_id > 0),
    -- The product's sku and name at create.
    sku           TEXT             NOT NULL DEFAULT '',
    name          TEXT             NOT NULL DEFAULT '',
    count         BIGINT           NOT NULL CHECK (count > 0),
    price_unit    DOUBLE PRECISION NOT NULL DEFAULT 0,
    total         DOUBLE PRECISION NOT NULL DEFAULT 0,
    -- What was in the box at B, broken included. 0 until accepted; never above what was sent.
    arrived_count BIGINT           NOT NULL DEFAULT 0 CHECK (arrived_count >= 0 AND arrived_count <= count),
    created_at    TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

    CONSTRAINT warehouse_transfer_items_one_per_product UNIQUE (transfer_id, product_id)
);

-- 3. WHAT WENT WRONG AT B'S DOOR, one row per product per kind (broken-and-missing-at-the-door-are-problem-rows,
--    a-product-appears-once-per-transfer), priced from the layers the units came off, newest first. The selling team
--    bears them (the-selling-team-bears-broken-missing-and-lost).
CREATE TABLE warehouse_transfer_problem_items (
    id           BIGSERIAL PRIMARY KEY,
    transfer_id  BIGINT           NOT NULL REFERENCES warehouse_transfers (id) ON DELETE RESTRICT,
    product_id   BIGINT           NOT NULL CHECK (product_id > 0),
    problem_type TEXT             NOT NULL CHECK (problem_type IN ('broken', 'missing')),
    -- B's note (a-transfer-problem-row-carries-a-note).
    note         TEXT             NOT NULL DEFAULT '',
    count        BIGINT           NOT NULL CHECK (count > 0),
    price_unit   DOUBLE PRECISION NOT NULL DEFAULT 0,
    total        DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

    CONSTRAINT warehouse_transfer_problem_items_one_per_kind UNIQUE (transfer_id, product_id, problem_type)
);

-- 4. THE TRAIL, one row per status change (every-transfer-status-change-is-logged). from_status is '' on the first.
CREATE TABLE warehouse_transfer_logs (
    id            BIGSERIAL PRIMARY KEY,
    transfer_id   BIGINT      NOT NULL REFERENCES warehouse_transfers (id) ON DELETE RESTRICT,
    from_status   TEXT        NOT NULL DEFAULT '' CHECK (from_status IN (
                      '', 'created', 'process', 'shipped', 'arrived', 'accepted', 'cancel', 'lost')),
    to_status     TEXT        NOT NULL CHECK (to_status IN (
                      'created', 'process', 'shipped', 'arrived', 'accepted', 'cancel', 'lost')),
    actor_user_id BIGINT      NOT NULL DEFAULT 0 CHECK (actor_user_id >= 0),
    description   TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX warehouse_transfer_logs_transfer_idx ON warehouse_transfer_logs (transfer_id, id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE warehouse_transfer_logs;
DROP TABLE warehouse_transfer_problem_items;
DROP TABLE warehouse_transfer_items;
DROP TABLE warehouse_transfers;
-- +goose StatementEnd
