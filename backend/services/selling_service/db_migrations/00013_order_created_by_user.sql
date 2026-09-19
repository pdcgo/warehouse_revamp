-- +goose Up
-- +goose StatementBegin
-- WHO CREATED THE ORDER (settlement #the-creator-is-read-from-the-token-at-placement).
--
-- Read from the AUTHENTICATED CALLER at placement — `san_auth.GetIdentity(ctx)` — and never taken from
-- the request: a client-supplied creator is a client that can attribute somebody else's sales. It is
-- written once, when the order is placed, and never updated.
--
-- settlement_service copies it onto the order's settlement account when that account opens, which is
-- what its per-user report attributes the order's money to.
--
-- 0 = not recorded. True of every order placed before this column, whose creator nothing captured —
-- and deliberately not back-filled from `order_events.actor_user_id`, which records who performed each
-- STEP rather than who owns the sale.
ALTER TABLE orders
    ADD COLUMN created_by_user_id BIGINT NOT NULL DEFAULT 0;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE orders
    DROP COLUMN created_by_user_id;
-- +goose StatementEnd
