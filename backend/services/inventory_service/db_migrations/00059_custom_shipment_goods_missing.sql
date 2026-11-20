-- +goose Up
-- +goose StatementBegin
-- CUSTOM SHIPMENTS — *BARANG TIDAK KETEMU* (backlog #88 P6, docs/business/custom_shipments/context_decision.md):
-- the shipping warehouse notes goods it cannot find on a parcel still REQUESTED — what is missing and from which rack —
-- as a row on the parcel's trail (missing-goods-leave-a-note-on-the-custom-shipment). The parcel stays requested; no
-- status, no stock and no money moves, so nothing else is written. A reship's units such a note names are never offered
-- again once that reship is cancelled (missing-reship-units-are-not-offered-again) — read from the lines below.
--
-- 1. A TRAIL ROW'S KIND. Until now a row whose from equals its to was always a cost edit (00057); a goods-missing note
--    is from = to = requested too, so the row says what it is. Existing rows are back-filled from their shape: a from =
--    to row is a cost edit, every other a status step (the create's row included). The shape check keeps the three
--    honest: a step moves, a cost edit does not, a note is written only while requested.
ALTER TABLE custom_shipment_logs
    ADD COLUMN kind TEXT NOT NULL DEFAULT 'status' CHECK (kind IN ('status', 'cost_edit', 'goods_missing'));

UPDATE custom_shipment_logs
SET kind = 'cost_edit'
WHERE from_status = to_status;

ALTER TABLE custom_shipment_logs
    ADD CONSTRAINT custom_shipment_logs_kind_shape CHECK (
        (kind = 'status' AND from_status <> to_status)
        OR (kind = 'cost_edit' AND from_status = to_status)
        OR (kind = 'goods_missing' AND from_status = 'requested' AND to_status = 'requested'));

-- 2. A NOTE'S LINES — one per parcel line and rack: a sample's line on one rack its take drew from, or a reship's line
--    (rack 0 — its broken units were never on a rack, a-restocks-broken-units-are-just-broken-for-now). The rack is the
--    take's placement (no FK: 0 is none); the handler checks it is one the take drew this line from, and the quantity at
--    most what the take drew there (a reship: at most the line's units). Code, name and the rack's code are read from
--    the parcel line and the placement at read time.
CREATE TABLE custom_shipment_missing_lines (
    id                      BIGSERIAL PRIMARY KEY,
    custom_shipment_log_id  BIGINT      NOT NULL REFERENCES custom_shipment_logs (id) ON DELETE RESTRICT,
    custom_shipment_item_id BIGINT      NOT NULL REFERENCES custom_shipment_items (id) ON DELETE RESTRICT,
    rack_id                 BIGINT      NOT NULL DEFAULT 0 CHECK (rack_id >= 0),
    quantity                BIGINT      NOT NULL CHECK (quantity > 0),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT custom_shipment_missing_lines_once UNIQUE (custom_shipment_log_id, custom_shipment_item_id, rack_id)
);

-- The units notes named of ONE parcel line — summed per note for a cancelled reship's line, under the restock row's lock
-- at every reship create and in the reship choices (the units on live reships, extended).
CREATE INDEX custom_shipment_missing_lines_item_idx ON custom_shipment_missing_lines (custom_shipment_item_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE custom_shipment_missing_lines;

ALTER TABLE custom_shipment_logs
    DROP CONSTRAINT custom_shipment_logs_kind_shape;

-- A goods-missing row has no meaning without its kind: it goes with it.
DELETE FROM custom_shipment_logs
WHERE kind = 'goods_missing';

ALTER TABLE custom_shipment_logs
    DROP COLUMN kind;
-- +goose StatementEnd
