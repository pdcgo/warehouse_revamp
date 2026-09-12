-- +goose Up
-- +goose StatementBegin
-- SETTLEMENT HAS TWO GRAINS (#an-entry-names-an-order-or-a-shop).
--
-- A row is addressed to an ORDER or to a SHOP. `shop_id` and `team_id` are on every row either way, so
-- both grains fold into the same daily report — but only the order grain has an account keyed by order.
--
-- ⚠ WHY A SHOP GRAIN EXISTS AT ALL. Two things could not be recorded without it, and both were blocked
-- by the NOT NULL this migration removes: a platform WITHDRAWAL (wallet to bank, naming no order) and a
-- `system_adjustment` repairing a report-level error that spans many orders. Neither has an order id to
-- give, and inventing one would file real money against an arbitrary sale.
ALTER TABLE settlement_logs ALTER COLUMN order_id DROP NOT NULL;

-- ⚠ THE ORDER INDEX MUST EXCLUDE THE SHOP ROWS.
--
-- `(order_id, id)` backs the detail panel — one order's whole log, oldest first. With `order_id`
-- nullable, every shop-addressed row in the system would sit in that index under a single NULL group,
-- which the panel never reads. A partial index keeps it the size of the thing it actually serves.
DROP INDEX IF EXISTS settlement_logs_order_idx;

CREATE INDEX settlement_logs_order_idx
    ON settlement_logs (order_id, id)
    WHERE order_id IS NOT NULL;

-- THE SHOP'S ACCOUNT — the mirror of `order_settlements` for the second grain.
--
-- ⚠ IT EXISTS TO BE LOCKED, not merely to be read. A shop-addressed write computes `balance` as
-- "the previous shop balance plus this change", and without a row to take FOR UPDATE two concurrent
-- posts both read the same previous value and the second silently overwrites the first's position.
-- `order_settlements.order_id` has served exactly this purpose for the order grain since 00001; this is
-- the same guarantee for the other one.
CREATE TABLE shop_settlements (
    -- ⚠ THE SHOP IS THE PRIMARY KEY, one column, so the row is lockable by a single value. A shop
    -- belongs to one team, which is why `team_id` rides along denormalised rather than joining the key.
    shop_id      BIGINT      PRIMARY KEY,

    team_id      BIGINT      NOT NULL,

    -- ⚠ THE SHOP'S OWN DIRECT MOVEMENTS ONLY — `SUM(change)` over rows with `order_id IS NULL`.
    --
    -- NOT the shop's whole position. Order-addressed rows carry this same `shop_id` and fold into the
    -- same daily report, so `shop_settlement_daily_reports.close_balance` is a DIFFERENT and larger
    -- number. Two figures, one word: use this one only where "what has moved outside the orders" is
    -- what is meant.
    last_balance BIGINT      NOT NULL DEFAULT 0,

    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A team's shops, for the team-scoped reads every list does.
CREATE INDEX shop_settlements_team_idx ON shop_settlements (team_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE shop_settlements;

DROP INDEX IF EXISTS settlement_logs_order_idx;

CREATE INDEX settlement_logs_order_idx ON settlement_logs (order_id, id);

-- ⚠ Fails if any shop-addressed row exists, and that is correct: those rows have no order to be given,
-- so restoring the constraint means deciding what happens to them. It is not this migration's call.
ALTER TABLE settlement_logs ALTER COLUMN order_id SET NOT NULL;
-- +goose StatementEnd
