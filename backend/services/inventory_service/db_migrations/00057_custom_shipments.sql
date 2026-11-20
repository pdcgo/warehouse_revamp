-- +goose Up
-- +goose StatementBegin
-- CUSTOM SHIPMENTS (backlog #88 P1 — docs/business/custom_shipments/context_decision.md): a parcel the warehouse sends
-- that is NOT a marketplace order (a-custom-shipment-is-a-parcel-that-is-not-an-order) — a SAMPLE of the owning team's
-- units to someone, or a RESTOCK RESHIP of a received restock's broken units back to its supplier. The owning selling
-- team creates it, the warehouse it ships from picks, packs and hands it over (the-selling-team-asks-the-warehouse-ships).
--
-- A sample's units leave the books AT CREATE in ITS `sample` transaction (transaction_id) — the take a transfer's
-- out-leg writes, oldest batch first, racks the system picks (the-custom-shipments-prototype-is-accepted). A reship moves
-- no ledger at all: broken units never entered a batch or a rack (a-restocks-broken-units-are-just-broken-for-now); its
-- lines are only counted against the restock line's broken row. No existing table is altered.
--
-- Money is DOUBLE PRECISION (stock-money-is-float64-compared-at-4-digits). Its racks are NOT stored here: they are the
-- take's rack rows, read back by StockPickLocations.

-- 1. THE PARCEL.
CREATE TABLE custom_shipments (
    id                     BIGSERIAL PRIMARY KEY,
    -- The owning selling team; the warehouse it ships from (a reship's is its restock's).
    team_id                BIGINT           NOT NULL CHECK (team_id > 0),
    warehouse_id           BIGINT           NOT NULL CHECK (warehouse_id > 0),
    kind                   TEXT             NOT NULL CHECK (kind IN ('sample', 'restock_reship')),
    status                 TEXT             NOT NULL CHECK (status IN ('requested', 'picked', 'handed_over', 'cancelled')),

    -- A reship's restock, and the supplier its lines name (0 = they name none — one supplier per parcel); 0 on a sample.
    restock_id             BIGINT           NOT NULL DEFAULT 0 CHECK (restock_id >= 0),
    supplier_id            BIGINT           NOT NULL DEFAULT 0 CHECK (supplier_id >= 0),

    -- Who receives it — free text, as the supplier's own facts are.
    recipient_name         TEXT             NOT NULL CHECK (recipient_name <> ''),
    recipient_phone        TEXT             NOT NULL DEFAULT '',
    recipient_address      TEXT             NOT NULL DEFAULT '',

    -- The courier (shipment_service's channel — no FK) and who pays it
    -- (the-courier-is-paid-by-the-team-or-by-the-warehouse): TEAM names one of its accounts and its cost, editable until
    -- the handover; WAREHOUSE names no account, and its cost is typed at the handover.
    shipment_channel_id    BIGINT           NOT NULL CHECK (shipment_channel_id > 0),
    payer                  TEXT             NOT NULL CHECK (payer IN ('team', 'warehouse')),
    finance_account_id     BIGINT           NOT NULL DEFAULT 0 CHECK (finance_account_id >= 0),
    shipping_cost          DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
    -- Bumped by every cost edit that moves money, so each edit's event has its own id.
    cost_revision          BIGINT           NOT NULL DEFAULT 0 CHECK (cost_revision >= 0),
    resi                   TEXT             NOT NULL DEFAULT '',
    note                   TEXT             NOT NULL DEFAULT '',

    -- A sample's take, and its value at the batches it drew from (a-sample-is-a-stock-out-at-batch-value). NULL / 0 on a
    -- reship.
    transaction_id         BIGINT           REFERENCES inventory_transactions (id) ON DELETE RESTRICT,
    total                  DOUBLE PRECISION NOT NULL DEFAULT 0,

    -- The form's key for its one create — a double tap would otherwise take a sample's stock twice.
    idempotency_key        TEXT             NOT NULL CHECK (idempotency_key <> ''),

    -- Who did what, and when. 0 / NULL = not yet.
    created_by_user_id     BIGINT           NOT NULL DEFAULT 0 CHECK (created_by_user_id >= 0),
    picked_by_user_id      BIGINT           NOT NULL DEFAULT 0 CHECK (picked_by_user_id >= 0),
    picked_at              TIMESTAMPTZ,
    handed_over_by_user_id BIGINT           NOT NULL DEFAULT 0 CHECK (handed_over_by_user_id >= 0),
    handed_over_at         TIMESTAMPTZ,
    cancelled_by_user_id   BIGINT           NOT NULL DEFAULT 0 CHECK (cancelled_by_user_id >= 0),
    cancelled_at           TIMESTAMPTZ,

    updated_at             TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    created_at             TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

    -- A sample names no restock and no supplier; a reship names its restock and takes no stock.
    CONSTRAINT custom_shipments_kind_shape CHECK (
        (kind = 'sample' AND restock_id = 0 AND supplier_id = 0)
        OR (kind = 'restock_reship' AND restock_id > 0 AND transaction_id IS NULL AND total = 0)),
    -- TEAM pays from an account it names; WAREHOUSE names none.
    CONSTRAINT custom_shipments_payer_account CHECK (
        (payer = 'team' AND finance_account_id > 0) OR (payer = 'warehouse' AND finance_account_id = 0))
);

-- A key is used once per team (the-order-refuses-a-used-key's shape): a second create with it is refused.
CREATE UNIQUE INDEX custom_shipments_idempotency_key ON custom_shipments (team_id, idempotency_key);

-- Each side lists its own, newest first: the selling team, the warehouse that ships (the transfer's shape).
CREATE INDEX custom_shipments_team_idx      ON custom_shipments (team_id, id DESC);
CREATE INDEX custom_shipments_warehouse_idx ON custom_shipments (warehouse_id, id DESC);

-- 2. ONE LINE PER PRODUCT — a sample's product, or a reship's restock line (a product is once per restock, so once per
--    parcel either way). Code and name are snapshots at create; total is a sample line's taken value (0 on a reship).
CREATE TABLE custom_shipment_items (
    id                 BIGSERIAL PRIMARY KEY,
    custom_shipment_id BIGINT           NOT NULL REFERENCES custom_shipments (id) ON DELETE RESTRICT,
    product_id         BIGINT           NOT NULL CHECK (product_id > 0),
    product_code       TEXT             NOT NULL DEFAULT '',
    name               TEXT             NOT NULL DEFAULT '',
    quantity           BIGINT           NOT NULL CHECK (quantity > 0),
    total              DOUBLE PRECISION NOT NULL DEFAULT 0,
    -- A reship's restock line, and that line's broken note copied at create. NULL / '' on a sample.
    restock_item_id    BIGINT           REFERENCES restock_items (id) ON DELETE RESTRICT,
    broken_note        TEXT             NOT NULL DEFAULT '',
    created_at         TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

    CONSTRAINT custom_shipment_items_one_per_product UNIQUE (custom_shipment_id, product_id)
);

-- The units a live reship already carries of a restock line — summed under the restock row's lock at every reship create.
CREATE INDEX custom_shipment_items_restock_item_idx ON custom_shipment_items (restock_item_id)
    WHERE restock_item_id IS NOT NULL;

-- 3. THE TRAIL, one row per status change; a cost edit is a row whose from equals its to
--    (every-transfer-status-change-is-logged's shape). from_status is '' on the create's row.
CREATE TABLE custom_shipment_logs (
    id                 BIGSERIAL PRIMARY KEY,
    custom_shipment_id BIGINT      NOT NULL REFERENCES custom_shipments (id) ON DELETE RESTRICT,
    from_status        TEXT        NOT NULL DEFAULT '' CHECK (from_status IN (
                           '', 'requested', 'picked', 'handed_over', 'cancelled')),
    to_status          TEXT        NOT NULL CHECK (to_status IN ('requested', 'picked', 'handed_over', 'cancelled')),
    actor_user_id      BIGINT      NOT NULL DEFAULT 0 CHECK (actor_user_id >= 0),
    -- Root or the Administrator acting in a team they hold no role in (an-override-is-stamped-in-every-service).
    is_override        BOOLEAN     NOT NULL DEFAULT false,
    description        TEXT        NOT NULL DEFAULT '',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX custom_shipment_logs_shipment_idx ON custom_shipment_logs (custom_shipment_id, id);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE custom_shipment_logs;
DROP TABLE custom_shipment_items;
DROP TABLE custom_shipments;

-- +goose StatementEnd
