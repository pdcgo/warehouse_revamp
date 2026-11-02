-- +goose Up
-- +goose StatementBegin
-- `sku` IS `product_code`, and it is unique over EVERY ROW (the-field-is-product-code-composed-on-write). The team types
-- its own part and product_service stores `<team_code>-<part>`; an archived product KEEPS its code
-- (a-used-product-is-archived-never-deleted), so the partial per-team index — which freed a code on archive — becomes one
-- unique index over all rows. Only a Delete, of a never-used product, frees a code.
ALTER TABLE products RENAME COLUMN sku TO product_code;
ALTER TABLE products RENAME CONSTRAINT products_sku_present TO products_product_code_present;

DROP INDEX products_team_sku_active_unique;

-- Today's rows were unique per team among ACTIVE products only, so two teams — or an active and an archived product of
-- one team — may share a code. Nothing is in production; rather than fail on a dev database, every row but the oldest of
-- a shared code takes its id as a suffix (`SHOE-42` → `SHOE-42-17`), visibly. `san product recompose-codes` then puts
-- each team's code in front, through team_service — a migration never reads another service's table (HARD RULE 3).
UPDATE products p
SET product_code = p.product_code || '-' || p.id
WHERE EXISTS (
    SELECT 1 FROM products o
    WHERE o.product_code = p.product_code AND o.id < p.id
);

CREATE UNIQUE INDEX products_product_code_unique ON products (product_code);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- A suffix the Up added is not taken back: it is a code, and the per-team index accepts it as one.
DROP INDEX products_product_code_unique;

ALTER TABLE products RENAME CONSTRAINT products_product_code_present TO products_sku_present;
ALTER TABLE products RENAME COLUMN product_code TO sku;

CREATE UNIQUE INDEX products_team_sku_active_unique ON products (team_id, sku) WHERE archived = FALSE;
-- +goose StatementEnd
