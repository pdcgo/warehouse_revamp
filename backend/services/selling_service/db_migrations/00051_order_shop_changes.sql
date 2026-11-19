-- +goose Up
-- +goose StatementBegin
-- AN ORDER'S SHOP IS FIXED (an-orders-shop-is-fixed-and-counted-on-the-day): one row per fix — the shop the order was
-- filed under, the one it moved to, and the note row the fix wrote on its timeline. Append-only.
--
-- It keeps a past day of the order metrics where it was: a move of the order counts under the shop the order was in
-- WHEN it moved — the from-shop of the first fix whose note row comes after the move's timeline row, or the order's
-- shop now when none does. Every timeline row of one order is written under the order's row lock, so the timeline
-- ids order the fixes and the moves exactly.
CREATE TABLE order_shop_changes (
    id              BIGSERIAL   PRIMARY KEY,
    order_id        BIGINT      NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    -- The order's selling team, so a team's re-fold reads its day's fixes without joining every order.
    team_id         BIGINT      NOT NULL,
    from_shop_id    BIGINT      NOT NULL REFERENCES shops (id),
    to_shop_id      BIGINT      NOT NULL REFERENCES shops (id),
    timeline_log_id BIGINT      NOT NULL REFERENCES order_timeline_logs (id) ON DELETE CASCADE,
    -- Opaque user_service id, no FK. 0 = not recorded.
    actor_id        BIGINT      NOT NULL DEFAULT 0,
    is_override     BOOLEAN     NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- A fix moves the order: naming the shop it is already in writes nothing, never a row.
    CONSTRAINT order_shop_changes_moves CHECK (from_shop_id <> to_shop_id)
);

-- The as-of lookup: an order's fixes after a timeline row, in order (the fold, per event; the re-fold, per move).
CREATE INDEX order_shop_changes_order_idx ON order_shop_changes (order_id, timeline_log_id);
-- A team's fixes on one Jakarta day — the order-daily re-fold's read.
CREATE INDEX order_shop_changes_team_day_idx ON order_shop_changes (team_id, created_at);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE order_shop_changes;
-- +goose StatementEnd
