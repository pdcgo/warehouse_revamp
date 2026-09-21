-- +goose Up
-- +goose StatementBegin
-- A restock request carries MANY priced lines, not one product (#124), plus optional context: the
-- selling order it is for, the courier's tracking number, and who the goods are bought from.
--
-- Same shape as orders/order_items: a header, and lines that SNAPSHOT sku/name at request time
-- (the product may live in another team's catalogue and may be renamed later).
CREATE TABLE restock_request_items (
    id                 BIGSERIAL   PRIMARY KEY,

    -- Same service, so this is a real FK: a request's lines die with it.
    restock_request_id BIGINT      NOT NULL REFERENCES restock_requests (id) ON DELETE CASCADE,

    -- Opaque product_service id — no FK.
    product_id         BIGINT      NOT NULL,
    sku                TEXT        NOT NULL,
    name               TEXT        NOT NULL,

    quantity           BIGINT      NOT NULL,
    -- Whole rupiah, PER UNIT. Zero is legitimate (a transfer, a sample), so it is >= 0, not > 0.
    price              BIGINT      NOT NULL DEFAULT 0,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT restock_request_items_quantity_positive CHECK (quantity > 0),
    CONSTRAINT restock_request_items_price_non_negative CHECK (price >= 0)
);

CREATE INDEX restock_request_items_request_idx ON restock_request_items (restock_request_id);

ALTER TABLE restock_requests
    -- The selling order this restock is FOR. Opaque selling_service id — NO FK. 0 = not tied to one.
    ADD COLUMN order_id    BIGINT NOT NULL DEFAULT 0,
    -- The courier's tracking number (resi). Empty = none yet.
    ADD COLUMN receipt     TEXT   NOT NULL DEFAULT '',
    -- Who the goods are bought from. suppliers is the SAME service, so unlike the ids above this one
    -- is a real FK; SET NULL keeps a request's history if a supplier is ever hard-deleted.
    ADD COLUMN supplier_id BIGINT NULL REFERENCES suppliers (id) ON DELETE SET NULL;

-- Carry every existing request's single product across as its first line, rather than dropping it.
INSERT INTO restock_request_items (restock_request_id, product_id, sku, name, quantity, price)
SELECT id, product_id, sku, name, quantity, 0 FROM restock_requests;

ALTER TABLE restock_requests
    DROP COLUMN product_id,
    DROP COLUMN sku,
    DROP COLUMN name,
    DROP COLUMN quantity;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE restock_requests
    ADD COLUMN product_id BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN sku        TEXT   NOT NULL DEFAULT '',
    ADD COLUMN name       TEXT   NOT NULL DEFAULT '',
    ADD COLUMN quantity   BIGINT NOT NULL DEFAULT 1;

-- Going back, only ONE line can survive per request — take the first. Prices are lost: the old shape
-- has nowhere to put them.
UPDATE restock_requests r SET
    product_id = i.product_id,
    sku        = i.sku,
    name       = i.name,
    quantity   = i.quantity
FROM (
    SELECT DISTINCT ON (restock_request_id) restock_request_id, product_id, sku, name, quantity
    FROM restock_request_items
    ORDER BY restock_request_id, id
) i
WHERE i.restock_request_id = r.id;

ALTER TABLE restock_requests
    DROP COLUMN order_id,
    DROP COLUMN receipt,
    DROP COLUMN supplier_id;

DROP TABLE restock_request_items;
-- +goose StatementEnd
