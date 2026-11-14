-- +goose Up
-- +goose StatementBegin
-- A SUPPLIER'S PRODUCTS — one row per product per store it was bought from
-- (docs/business/supplier/context_decision.md#products-hang-off-a-channel), and per supplier with NO store for a line
-- that named the supplier alone (#a-line-with-no-store-links-under-the-supplier). What the Produk tab lists.
--
-- ⚠ WRITTEN ONLY BY THE ACCEPTED RESTOCK — the RestockAccepted fold, in the SAME transaction that folds the restock's
-- figures (#restock-accepted-links-the-product-to-its-channel), and `san supplier backfill-links` for the accepts that
-- came before this table. Never by hand: no RPC writes or removes a link (#a-link-remembers-its-last-restock).
-- Every accepted line naming a supplier links ITS OWN product, broken and short lines included
-- (#every-accepted-line-links-its-own-product); a line naming no supplier links nothing.
--
-- No foreign key on `supplier_id` / `channel_id`, on purpose: the fold must never refuse an accept's figures over a
-- reference check, and suppliers and stores are never removed (delete is soft — #a-store-delete-is-soft-too), so a key
-- would guard nothing. A link of a deleted store or supplier stays, hidden with it.
CREATE TABLE supplier_channel_products (
    id                 BIGSERIAL   PRIMARY KEY,
    -- The restocking team — the product's owner (opaque, team_service). Immutable: a product never changes team.
    team_id            BIGINT      NOT NULL,
    -- The line's supplier. Immutable: a store never changes supplier.
    supplier_id        BIGINT      NOT NULL,
    -- The store the line was bought from; NULL = the line named the supplier with no store — Toko reads "—".
    channel_id         BIGINT,
    -- The restocking team's product (opaque, product_service).
    product_id         BIGINT      NOT NULL,
    -- The EARLIEST accept that named this link — the tab's "pertama" (first bought). LEAST on every write, so a
    -- backfill run after the live fold still dates it right.
    first_restocked_at TIMESTAMPTZ NOT NULL,
    -- The LATEST accept that named it — the tab's "terakhir dibeli", newest first. GREATEST on every write: a late or
    -- repeated event never lowers it.
    last_restocked_at  TIMESTAMPTZ NOT NULL,
    -- The restock of that latest accept (inventory_service's restocks.id, opaque) — ties on the instant break by id.
    last_restock_id    BIGINT      NOT NULL,
    -- When the row was written and last moved (bookkeeping — the dates the tab shows are the two above).
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT supplier_channel_products_dates_ordered CHECK (first_restocked_at <= last_restocked_at)
);

-- ONE LINK per supplier, store, product and team — the fold's ON CONFLICT target. NULLS NOT DISTINCT is load-bearing
-- (Postgres 15+; docker-compose and CI pin 17): without it every store-less line would insert a new row. Leading on
-- `supplier_id` it also serves the Produk tab's store filter (supplier, then store).
CREATE UNIQUE INDEX supplier_channel_products_key
    ON supplier_channel_products (supplier_id, channel_id, product_id, team_id) NULLS NOT DISTINCT;

-- The Produk tab's page — one supplier's links, newest restock first
-- (docs/technical/frontend/suppliers_decision.md#a-supplier-product-row-says-whose-where-and-when).
CREATE INDEX supplier_channel_products_newest_idx
    ON supplier_channel_products (supplier_id, last_restocked_at DESC, id DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE supplier_channel_products;
-- +goose StatementEnd
