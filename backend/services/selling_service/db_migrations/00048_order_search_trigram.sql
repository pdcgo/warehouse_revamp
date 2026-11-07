-- +goose Up
-- +goose StatementBegin
-- THE ORDER SEARCH'S INDEXES (audits/services/selling_service/performances/OrderList.md, finding 1, as its 2026-11-06
-- re-measure recommends): the list's search is `ILIKE '%term%'` over the buyer's name and phone (on `order_addresses`
-- since 00045) and the order's marketplace ref and resi (on `orders`). No b-tree serves an infix match, so every search
-- read every row in scope — and a warehouse's search read every team's address rows. A GIN trigram index per table serves
-- the four `ILIKE`s as a BitmapOr.
--
-- pg_trgm is a TRUSTED extension (Postgres 13+), so the migrating role needs no superuser. IF NOT EXISTS: an extension is
-- the database's, not this service's, and another service may have created it first.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX order_addresses_customer_trgm_idx
    ON order_addresses USING gin (customer_name gin_trgm_ops, customer_phone gin_trgm_ops);

CREATE INDEX orders_ref_receipt_trgm_idx
    ON orders USING gin (order_external_ref_id gin_trgm_ops, receipt gin_trgm_ops);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- The extension stays: it is the database's, and another service's index may use it.
DROP INDEX IF EXISTS orders_ref_receipt_trgm_idx;
DROP INDEX IF EXISTS order_addresses_customer_trgm_idx;
-- +goose StatementEnd
