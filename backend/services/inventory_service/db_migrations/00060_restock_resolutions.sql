-- +goose Up
-- +goose StatementBegin
-- RESTOCK RESOLUTIONS (backlog #101 P1 — docs/business/inventory/restock_decision.md
-- a-restock-problem-is-settled-by-resolution-rows, docs/business/custom_shipments/context_decision.md
-- a-suppliers-reshipping-comes-in-as-a-custom-shipment, each with its 🔄 lines).
--
-- A problem restock (received, carrying *Barang kurang* / *Barang rusak*) or a lost one is settled by RESOLUTION ROWS —
-- refund, return, reshipping — and the selling team's SETTLED MARK. A `return` rides an outbound reship parcel; a
-- `reshipping` an INBOUND parcel, a new custom-shipment kind arriving as a restock box does. `restock_custom_shipments`
-- (the owner's table) joins a restock, its row, the parcel and the stock-in the parcel's Terima makes.
--
-- Existing rows are untouched: every new column has its default or is NULL, every widened check still holds the old
-- rows (they are outbound, named, in outbound statuses).

-- 1. THE SETTLED MARK on the restock (*Tandai Selesai*): when, by whom, as an override. NULL = not settled; an inbound
--    parcel's Terima with short or broken units lifts it again (🔄 A: a late shortfall reopens it).
ALTER TABLE restocks
    ADD COLUMN settled_at             TIMESTAMPTZ,
    ADD COLUMN settled_by_user_id     BIGINT  NOT NULL DEFAULT 0 CHECK (settled_by_user_id >= 0),
    ADD COLUMN settled_by_is_override BOOLEAN NOT NULL DEFAULT false;

-- 2. THE RESOLUTION ROWS — the owner's columns (restock.md §Table Should We Have In Restock, item 4: id, restock_id,
--    resolution_type, refund_amount, note, created_at), plus the refund's account (🔄 A: the refund names its account),
--    who recorded it, and the form's key (a double tap would record a refund twice). APPEND ONLY.
CREATE TABLE restock_resolutions (
    id                     BIGSERIAL PRIMARY KEY,
    restock_id             BIGINT           NOT NULL REFERENCES restocks (id) ON DELETE RESTRICT,
    resolution_type        TEXT             NOT NULL CHECK (resolution_type IN ('refund', 'return', 'reshipping')),
    -- A refund's money, and the selling team's account it went into (financial_account_service's id — no FK).
    refund_amount          DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (refund_amount >= 0),
    finance_account_id     BIGINT           NOT NULL DEFAULT 0 CHECK (finance_account_id >= 0),
    note                   TEXT             NOT NULL DEFAULT '',
    idempotency_key        TEXT             NOT NULL CHECK (idempotency_key <> ''),
    created_by_user_id     BIGINT           NOT NULL DEFAULT 0 CHECK (created_by_user_id >= 0),
    created_by_is_override BOOLEAN          NOT NULL DEFAULT false,
    created_at             TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

    -- A refund carries its amount and account; a return and a reshipping carry neither.
    CONSTRAINT restock_resolutions_refund_shape CHECK (
        (resolution_type = 'refund' AND refund_amount > 0 AND finance_account_id > 0)
        OR (resolution_type <> 'refund' AND refund_amount = 0 AND finance_account_id = 0))
);

-- A key is used once per restock; it also serves a restock's rows (Detail) and the list page's grouped count — restock_id
-- leads it.
CREATE UNIQUE INDEX restock_resolutions_restock_key ON restock_resolutions (restock_id, idempotency_key);

-- 3. THE INBOUND PARCEL — custom shipments go both ways now. A `supplier_reshipping` comes from the restock's supplier
--    to the warehouse chosen and arrives as a restock box: on_the_way → arrived (Tiba) → received (Terima), or lost. It
--    names no recipient; the warehouse pays the courier's charge at the door (payer `warehouse`, its charge in
--    shipping_cost — noted at Tiba, final at Terima — and its note here).
ALTER TABLE custom_shipments
    DROP CONSTRAINT custom_shipments_kind_check,
    DROP CONSTRAINT custom_shipments_status_check,
    DROP CONSTRAINT custom_shipments_recipient_name_check,
    DROP CONSTRAINT custom_shipments_kind_shape;

ALTER TABLE custom_shipments
    ADD CONSTRAINT custom_shipments_kind_check CHECK (kind IN ('sample', 'restock_reship', 'supplier_reshipping')),
    ADD CONSTRAINT custom_shipments_status_check CHECK (status IN (
        'requested', 'picked', 'handed_over', 'cancelled', 'on_the_way', 'arrived', 'received', 'lost')),
    ADD COLUMN charge_note         TEXT   NOT NULL DEFAULT '',
    ADD COLUMN arrived_by_user_id  BIGINT NOT NULL DEFAULT 0 CHECK (arrived_by_user_id >= 0),
    ADD COLUMN arrived_at          TIMESTAMPTZ,
    ADD COLUMN received_by_user_id BIGINT NOT NULL DEFAULT 0 CHECK (received_by_user_id >= 0),
    ADD COLUMN received_at         TIMESTAMPTZ,
    ADD COLUMN lost_by_user_id     BIGINT NOT NULL DEFAULT 0 CHECK (lost_by_user_id >= 0),
    ADD COLUMN lost_at             TIMESTAMPTZ,
    ADD COLUMN lost_reason         TEXT   NOT NULL DEFAULT '';

-- Each kind's shape, and its own steps: the outbound kinds name a recipient and move through the outbound statuses; the
-- inbound one names its restock, takes no sample's stock, is paid at the door by the warehouse, and moves through a
-- restock box's statuses.
ALTER TABLE custom_shipments
    ADD CONSTRAINT custom_shipments_kind_shape CHECK (
        (kind = 'sample' AND restock_id = 0 AND supplier_id = 0 AND recipient_name <> ''
            AND status IN ('requested', 'picked', 'handed_over', 'cancelled'))
        OR (kind = 'restock_reship' AND restock_id > 0 AND transaction_id IS NULL AND total = 0 AND recipient_name <> ''
            AND status IN ('requested', 'picked', 'handed_over', 'cancelled'))
        OR (kind = 'supplier_reshipping' AND restock_id > 0 AND transaction_id IS NULL AND payer = 'warehouse'
            AND status IN ('on_the_way', 'arrived', 'received', 'lost')));

-- An inbound line: the seller's price per unit (values the stock-in, moves no money), and Terima's count — what was in
-- the box (broken included, at most the line says), how many broken, the rack the good units went on. NULL until counted.
ALTER TABLE custom_shipment_items
    ADD COLUMN price_unit DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (price_unit >= 0),
    ADD COLUMN received   BIGINT,
    ADD COLUMN broken     BIGINT,
    ADD COLUMN rack_id    BIGINT NOT NULL DEFAULT 0 CHECK (rack_id >= 0),
    ADD CONSTRAINT custom_shipment_items_count_shape CHECK (
        (received IS NULL AND broken IS NULL)
        OR (received >= 0 AND received <= quantity AND broken >= 0 AND broken <= received));

-- The trail: the inbound steps, and two edit kinds of the seller's (from = to): the resi until Tiba, the prices until
-- Terima.
ALTER TABLE custom_shipment_logs
    DROP CONSTRAINT custom_shipment_logs_from_status_check,
    DROP CONSTRAINT custom_shipment_logs_to_status_check,
    DROP CONSTRAINT custom_shipment_logs_kind_check,
    DROP CONSTRAINT custom_shipment_logs_kind_shape;

ALTER TABLE custom_shipment_logs
    ADD CONSTRAINT custom_shipment_logs_from_status_check CHECK (from_status IN (
        '', 'requested', 'picked', 'handed_over', 'cancelled', 'on_the_way', 'arrived', 'received', 'lost')),
    ADD CONSTRAINT custom_shipment_logs_to_status_check CHECK (to_status IN (
        'requested', 'picked', 'handed_over', 'cancelled', 'on_the_way', 'arrived', 'received', 'lost')),
    ADD CONSTRAINT custom_shipment_logs_kind_check CHECK (kind IN (
        'status', 'cost_edit', 'goods_missing', 'resi_edit', 'price_edit')),
    ADD CONSTRAINT custom_shipment_logs_kind_shape CHECK (
        (kind = 'status' AND from_status <> to_status)
        OR (kind = 'cost_edit' AND from_status = to_status)
        OR (kind = 'goods_missing' AND from_status = 'requested' AND to_status = 'requested')
        OR (kind = 'resi_edit' AND from_status = 'on_the_way' AND to_status = 'on_the_way')
        OR (kind = 'price_edit' AND from_status = to_status AND to_status IN ('on_the_way', 'arrived')));

-- 4. THE LINK — the owner's table (a-suppliers-reshipping-comes-in-as-a-custom-shipment): the restock, its resolution
--    row, the parcel that row rides, and the stock movement the parcel made — a reshipping's stock-in at its Terima; NULL
--    for a return (its broken units are on no rack — 🔄 A). One per row, one per parcel.
CREATE TABLE restock_custom_shipments (
    id                       BIGSERIAL PRIMARY KEY,
    restock_id               BIGINT      NOT NULL REFERENCES restocks (id) ON DELETE RESTRICT,
    resolution_id            BIGINT      NOT NULL REFERENCES restock_resolutions (id) ON DELETE RESTRICT,
    custom_shipment_id       BIGINT      NOT NULL REFERENCES custom_shipments (id) ON DELETE RESTRICT,
    inventory_transaction_id BIGINT      REFERENCES inventory_transactions (id) ON DELETE RESTRICT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT restock_custom_shipments_one_per_resolution UNIQUE (resolution_id),
    CONSTRAINT restock_custom_shipments_one_per_parcel UNIQUE (custom_shipment_id)
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE restock_custom_shipments;
DROP TABLE restock_resolutions;

-- An inbound parcel has no meaning without its kind: it goes with it, its lines and trail first.
DELETE FROM custom_shipment_logs
WHERE custom_shipment_id IN (SELECT id FROM custom_shipments WHERE kind = 'supplier_reshipping');

DELETE FROM custom_shipment_items
WHERE custom_shipment_id IN (SELECT id FROM custom_shipments WHERE kind = 'supplier_reshipping');

DELETE FROM custom_shipments
WHERE kind = 'supplier_reshipping';

ALTER TABLE custom_shipment_logs
    DROP CONSTRAINT custom_shipment_logs_from_status_check,
    DROP CONSTRAINT custom_shipment_logs_to_status_check,
    DROP CONSTRAINT custom_shipment_logs_kind_check,
    DROP CONSTRAINT custom_shipment_logs_kind_shape;

ALTER TABLE custom_shipment_logs
    ADD CONSTRAINT custom_shipment_logs_from_status_check CHECK (from_status IN (
        '', 'requested', 'picked', 'handed_over', 'cancelled')),
    ADD CONSTRAINT custom_shipment_logs_to_status_check CHECK (to_status IN (
        'requested', 'picked', 'handed_over', 'cancelled')),
    ADD CONSTRAINT custom_shipment_logs_kind_check CHECK (kind IN ('status', 'cost_edit', 'goods_missing')),
    ADD CONSTRAINT custom_shipment_logs_kind_shape CHECK (
        (kind = 'status' AND from_status <> to_status)
        OR (kind = 'cost_edit' AND from_status = to_status)
        OR (kind = 'goods_missing' AND from_status = 'requested' AND to_status = 'requested'));

ALTER TABLE custom_shipment_items
    DROP CONSTRAINT custom_shipment_items_count_shape,
    DROP COLUMN price_unit,
    DROP COLUMN received,
    DROP COLUMN broken,
    DROP COLUMN rack_id;

ALTER TABLE custom_shipments
    DROP CONSTRAINT custom_shipments_kind_shape,
    DROP CONSTRAINT custom_shipments_kind_check,
    DROP CONSTRAINT custom_shipments_status_check,
    DROP COLUMN charge_note,
    DROP COLUMN arrived_by_user_id,
    DROP COLUMN arrived_at,
    DROP COLUMN received_by_user_id,
    DROP COLUMN received_at,
    DROP COLUMN lost_by_user_id,
    DROP COLUMN lost_at,
    DROP COLUMN lost_reason;

ALTER TABLE custom_shipments
    ADD CONSTRAINT custom_shipments_kind_check CHECK (kind IN ('sample', 'restock_reship')),
    ADD CONSTRAINT custom_shipments_status_check CHECK (status IN ('requested', 'picked', 'handed_over', 'cancelled')),
    ADD CONSTRAINT custom_shipments_recipient_name_check CHECK (recipient_name <> ''),
    ADD CONSTRAINT custom_shipments_kind_shape CHECK (
        (kind = 'sample' AND restock_id = 0 AND supplier_id = 0)
        OR (kind = 'restock_reship' AND restock_id > 0 AND transaction_id IS NULL AND total = 0));

ALTER TABLE restocks
    DROP COLUMN settled_at,
    DROP COLUMN settled_by_user_id,
    DROP COLUMN settled_by_is_override;
-- +goose StatementEnd
