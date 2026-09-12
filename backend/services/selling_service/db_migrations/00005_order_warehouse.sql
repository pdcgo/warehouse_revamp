-- +goose Up
-- +goose StatementBegin
-- Which warehouse fulfils an order (#72) — chosen per order by whoever types it in, and stored on the
-- order rather than looked up from the shop. A shop's default changing later would otherwise silently
-- make old orders read as if they had shipped from a building they never shipped from; what an order
-- says happened must stay what happened.
--
-- Opaque team_service id (a WAREHOUSE team) — no FK, like every other cross-service id here (HARD
-- RULE 3). Scope is enforced by the access interceptor, not the database.
--
-- 0 means "recorded before orders named a warehouse" and is NOT a valid warehouse. Existing rows get
-- it because nobody knows which building those orders shipped from, and picking one would invent a
-- fact — the same reason #135 left existing stock unplaced rather than inventing a rack. Every order
-- created from now on carries a real id: the contract requires gt 0 on create, so the zeros can only
-- ever be historical and never grow.
--
-- No CHECK (warehouse_id > 0) for exactly that reason: it would be true of every new row and false of
-- every old one, so it could not be added without either rewriting history or failing to apply.
ALTER TABLE orders
    ADD COLUMN warehouse_id BIGINT NOT NULL DEFAULT 0;

-- #69 takes an order's stock out of this warehouse at placement, and #70 puts it back on cancel, so
-- "which orders touched this warehouse" becomes a real question the moment those land.
CREATE INDEX orders_warehouse_idx ON orders (warehouse_id) WHERE warehouse_id > 0;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX orders_warehouse_idx;

ALTER TABLE orders
    DROP COLUMN warehouse_id;
-- +goose StatementEnd
