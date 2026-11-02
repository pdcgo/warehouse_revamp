-- +goose Up
-- A restock line's and a transfer line's snapshot of the product's code take the code's name
-- (the-field-is-product-code-composed-on-write): `product_code`, as product_service now calls it. Still SNAPSHOTS, taken
-- when the line was written — a line keeps reading as it was raised.
ALTER TABLE restock_items RENAME COLUMN sku TO product_code;
ALTER TABLE warehouse_transfer_items RENAME COLUMN sku TO product_code;

-- +goose Down
ALTER TABLE warehouse_transfer_items RENAME COLUMN product_code TO sku;
ALTER TABLE restock_items RENAME COLUMN product_code TO sku;
