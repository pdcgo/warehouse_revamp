-- +goose Up
-- +goose StatementBegin
-- The restock layout (#127): the order becomes a free-text REFERENCE, and a restock records what the
-- shipment cost, how it was paid for, and a note.
--
-- order_id -> order_ref is a TYPE change, not a rename. The order is written down from a marketplace
-- or a chat somewhere else — it was never a row in this system, so an integer id was the wrong shape:
-- a reference that happens to be numeric never pointed at anything here.
ALTER TABLE restock_requests
    ADD COLUMN order_ref     TEXT   NOT NULL DEFAULT '',
    -- What the freight cost, whole rupiah. The goods' cost is per line (restock_request_items.price);
    -- this sits on top and is what the summary adds to the products' total.
    ADD COLUMN shipping_cost BIGINT NOT NULL DEFAULT 0,
    -- 'shopee_pay' | 'bank_account' — mapped in the handler (no CHECK IN-list, cf. #80).
    ADD COLUMN payment_type  TEXT   NOT NULL DEFAULT '',
    ADD COLUMN note          TEXT   NOT NULL DEFAULT '',
    -- ADD CONSTRAINT, not a bare CONSTRAINT: inside ALTER TABLE every clause needs its own verb.
    ADD CONSTRAINT restock_requests_shipping_cost_non_negative CHECK (shipping_cost >= 0);

-- Carry the old ids across as text rather than dropping them: 0 meant "not tied to an order", which
-- is the empty string now.
UPDATE restock_requests SET order_ref = order_id::text WHERE order_id <> 0;

ALTER TABLE restock_requests DROP COLUMN order_id;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE restock_requests ADD COLUMN order_id BIGINT NOT NULL DEFAULT 0;

-- Only a reference that is entirely digits can go back into a BIGINT; anything else had no home in
-- the old shape and is dropped.
UPDATE restock_requests
SET order_id = order_ref::bigint
WHERE order_ref ~ '^[0-9]+$' AND length(order_ref) <= 18;

ALTER TABLE restock_requests
    DROP CONSTRAINT restock_requests_shipping_cost_non_negative,
    DROP COLUMN order_ref,
    DROP COLUMN shipping_cost,
    DROP COLUMN payment_type,
    DROP COLUMN note;
-- +goose StatementEnd
