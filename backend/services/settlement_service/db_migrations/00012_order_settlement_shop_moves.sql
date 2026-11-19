-- +goose Up
-- +goose StatementBegin
-- AN ORDER'S ACCOUNT MOVES WITH ITS SHOP (an-orders-shop-is-fixed-and-counted-on-the-day): one row per OrderShopChanged
-- settlement applied — the order's fix (selling's `order_shop_changes` id, opaque, no FK), the shop the ACCOUNT was on
-- and the shop it moved to. The ledger itself stays append-only: the move is a pair of rows per settlement type, out of
-- the old shop and into the new, on the day settlement learns of it.
--
-- The key is the CLAIM: a redelivery inserts nothing and moves nothing. And because fixes of one order are serialised
-- by the order's row lock, a later fix carries a larger change id — a fix delivered after a later one was applied finds
-- a larger id here and moves nothing, so the account always ends on the order's latest shop.
CREATE TABLE order_settlement_shop_moves (
    change_id    BIGINT      PRIMARY KEY,
    order_id     BIGINT      NOT NULL,
    team_id      BIGINT      NOT NULL,
    -- The shop the account was on, and the one it is on now. Equal when nothing moved: the account was already there,
    -- not yet opened, or a later fix had already been applied.
    from_shop_id BIGINT      NOT NULL,
    to_shop_id   BIGINT      NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Has a later fix of this order been applied?" — asked under the account's lock on every move.
CREATE INDEX order_settlement_shop_moves_order_idx ON order_settlement_shop_moves (order_id, change_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE order_settlement_shop_moves;
-- +goose StatementEnd
