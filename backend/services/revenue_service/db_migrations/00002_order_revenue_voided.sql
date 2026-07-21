-- +goose Up
-- A CANCELLED ORDER EARNED NOTHING (#164).
--
-- The row is written when an order is PLACED (#153), and an order can be cancelled right up to
-- SHIPPED (#150) — so without this the report counts money from orders that fell through.
--
-- VOIDED, NOT DELETED (owner, 2026-07-21). A deleted row cannot tell you an order was placed and then
-- cancelled, and that is a thing somebody looking at the money wants to see. It mirrors the stock
-- ledger, which keeps a cancelled order's PICK rows and nets them (#154) rather than erasing them.
--
-- NULL = live. A timestamp rather than a boolean because "when did this stop counting" is the next
-- question anybody asks, and a boolean cannot answer it.
ALTER TABLE order_revenues ADD COLUMN voided_at TIMESTAMPTZ;

-- The reads all say "the live ones" (the list, and every total), so the index carries that predicate.
CREATE INDEX order_revenues_live_idx ON order_revenues (team_id, id DESC) WHERE voided_at IS NULL;

-- +goose Down
DROP INDEX order_revenues_live_idx;
ALTER TABLE order_revenues DROP COLUMN voided_at;
