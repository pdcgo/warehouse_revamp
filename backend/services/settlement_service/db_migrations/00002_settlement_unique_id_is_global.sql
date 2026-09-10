-- +goose Up
-- +goose StatementBegin
-- THE IDEMPOTENCY KEY BECOMES GLOBAL — `unique_id` alone, no longer `(order_id, unique_id)`.
--
-- WHY. `order_id` is becoming NULLABLE: a settlement row may now be addressed to a SHOP rather than to
-- an order (a platform withdrawal, a system adjustment). Postgres treats NULL as DISTINCT from NULL in a
-- unique index, so `(order_id, unique_id)` would have admitted `(NULL, 'abc')` twice — silently, with no
-- error and two rows. The duplicate-write guarantee every writer rests on ("a retry produces the same
-- key and this index absorbs it") would have held for order rows and evaporated for exactly the new
-- ones.
--
-- ⚠ THIS IS STRICTLY STRONGER than what it replaces: a key that was legal on two different orders is now
-- a collision. That is intended — every caller's recipe already embeds the order id or the platform's
-- own reference (`hash(date + order_ref_id)`, and `hash(order_id + act_date + "cancel")` for the
-- cancel), so all of them are globally unique in practice. A recipe that was NOT is a caller bug this
-- index now surfaces instead of hiding.
--
-- ⚠ If this migration fails with a uniqueness violation, that is the finding, not an obstacle: two rows
-- already share a key across orders, and one of the writers has a recipe that does not identify what it
-- is recording.
DROP INDEX IF EXISTS settlement_logs_unique_idx;

CREATE UNIQUE INDEX settlement_logs_unique_idx ON settlement_logs (unique_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS settlement_logs_unique_idx;

CREATE UNIQUE INDEX settlement_logs_unique_idx ON settlement_logs (order_id, unique_id);
-- +goose StatementEnd
