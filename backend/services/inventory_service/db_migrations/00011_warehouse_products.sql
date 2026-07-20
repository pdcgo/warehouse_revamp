-- +goose Up
-- WHICH PRODUCTS A WAREHOUSE HANDLES (#142).
--
-- A warehouse must not see the whole catalogue. It handles the products somebody has asked it to
-- handle, and this table is that list: one row per (warehouse, product) arrangement.
--
-- It lives in inventory_service because this service already owns warehouse×product facts —
-- `stock_levels` is keyed on exactly that pair — and it owns the restock flow that creates the link
-- (owner, 2026-07-20). No cross-service write is needed to maintain it.
--
-- It is NOT the same fact as `stock_levels`, which is why it is a separate table rather than a query
-- over that one: a product linked by a restock request that has not been fulfilled yet has no stock
-- level at all, and it still has to be visible to the crew who are expecting it.
--
-- product_id is an OPAQUE product_service id — no FK across services. warehouse_id is a team id.
CREATE TABLE warehouse_products (
    id BIGSERIAL PRIMARY KEY,
    warehouse_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- The arrangement exists once. Linking the same product twice is not an error worth surfacing to
    -- a person creating a restock request, so writers upsert against this (ON CONFLICT DO NOTHING).
    CONSTRAINT warehouse_products_unique UNIQUE (warehouse_id, product_id)
);

-- The read this table exists for: "the products MY warehouse handles", newest first.
CREATE INDEX warehouse_products_warehouse_idx ON warehouse_products (warehouse_id, id DESC);

-- +goose Down
DROP TABLE warehouse_products;
