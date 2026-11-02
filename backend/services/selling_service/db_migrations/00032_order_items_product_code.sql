-- +goose Up
-- An order line's snapshot of the product's code takes the code's name (the-field-is-product-code-composed-on-write):
-- `product_code`, as product_service now calls it. Still a SNAPSHOT, frozen when the order was placed — a line keeps the
-- code it was sold under. `order_draft_items.external_sku` is the MARKETPLACE's seller SKU, not our code, and keeps its
-- name.
ALTER TABLE order_items RENAME COLUMN sku TO product_code;

-- +goose Down
ALTER TABLE order_items RENAME COLUMN product_code TO sku;
