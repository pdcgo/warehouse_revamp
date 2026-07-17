-- +goose Up
-- +goose StatementBegin
-- Stock is located ON a rack (#135, implementing the §3 decision recorded in plans/inventory_service).
-- The grain becomes (warehouse, rack, product); it was (warehouse, product).
--
-- NULL rack_id means UNPLACED: "somewhere in this warehouse, not yet on a shelf." Every existing row
-- becomes unplaced, which is the truth — nobody has ever told this system where anything sits, and it
-- must not invent a location it was never given. Unplaced is a real state a warehouse works off (the
-- put-away queue, #136), not a migration artefact.
--
-- The rack is a REAL FK: racks live in this same service, unlike warehouse_id/product_id which are
-- opaque cross-service ids. ON DELETE RESTRICT is deliberate — see #138: stock on a rack that is being
-- deleted must be dealt with explicitly, never stranded at a location nobody can reach.
ALTER TABLE stock_levels
    ADD COLUMN rack_id BIGINT REFERENCES racks (id) ON DELETE RESTRICT;

ALTER TABLE stock_movements
    ADD COLUMN rack_id BIGINT REFERENCES racks (id) ON DELETE RESTRICT;

-- The PK cannot simply grow rack_id: a PRIMARY KEY column may not be NULL, and "unplaced" MUST be
-- NULL. So the composite PK becomes a composite UNIQUE INDEX instead.
--
-- NULLS NOT DISTINCT is the load-bearing clause (Postgres 15+; docker-compose pins 17). By default
-- Postgres treats every NULL as distinct from every other NULL, so a plain unique index would happily
-- accept SIX unplaced rows for the same (warehouse, product) — each one a separate "somewhere",
-- silently double-counting the same goods on every read. NULLS NOT DISTINCT collapses them: exactly
-- one unplaced row per (warehouse, product), which is what "unplaced" means.
ALTER TABLE stock_levels
    DROP CONSTRAINT stock_levels_pkey;

CREATE UNIQUE INDEX stock_levels_place_unique
    ON stock_levels (warehouse_id, product_id, rack_id) NULLS NOT DISTINCT;

-- A warehouse total is now a SUM across a product's racks, so reads group by (warehouse, product).
CREATE INDEX stock_levels_warehouse_product_idx ON stock_levels (warehouse_id, product_id);
-- "What is on this rack?" (#138) reads the other way round.
CREATE INDEX stock_levels_rack_idx ON stock_levels (rack_id) WHERE rack_id IS NOT NULL;
CREATE INDEX stock_movements_rack_idx ON stock_movements (rack_id) WHERE rack_id IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Reversing collapses every rack's stock back into one row per (warehouse, product). That is only
-- lossless while all stock is unplaced — which is exactly the state this migration leaves behind, and
-- the only state in which a Down is meaningful. Once #136 has placed stock, reversing would have to
-- merge rows and destroy the placements; the ledger (stock_movements) still holds the history, so
-- rebuilding is possible, but this Down deliberately refuses to guess and will fail loudly on the
-- unique index if two rack rows exist for one product.
DROP INDEX stock_movements_rack_idx;
DROP INDEX stock_levels_rack_idx;
DROP INDEX stock_levels_warehouse_product_idx;
DROP INDEX stock_levels_place_unique;

ALTER TABLE stock_movements DROP COLUMN rack_id;
ALTER TABLE stock_levels DROP COLUMN rack_id;

ALTER TABLE stock_levels
    ADD CONSTRAINT stock_levels_pkey PRIMARY KEY (warehouse_id, product_id);
-- +goose StatementEnd
