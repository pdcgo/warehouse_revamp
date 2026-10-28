-- +goose Up
-- +goose StatementBegin
-- THE BUYER'S USERNAME on the marketplace, on `orders` and on `order_drafts` (the-buyers-username-is-optional): the
-- name the buyer goes by in the marketplace chat. NOT `customer_name`, which is who the parcel is addressed to — the
-- two can differ.
--
-- Optional everywhere: nothing refuses an empty one, on either door. Stored as typed, trimmed by the handlers — spaces
-- alone are stored as none.
--
-- '' = no username, never NULL: there is one way to say "none", and every order before this column reads as it. Not
-- back-filled — nothing held it before, and `customer_name` is not it.
--
-- No index: nothing searches or joins on it.
ALTER TABLE orders
    ADD COLUMN buyer_username TEXT NOT NULL DEFAULT '';

ALTER TABLE order_drafts
    ADD COLUMN buyer_username TEXT NOT NULL DEFAULT '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE order_drafts
    DROP COLUMN buyer_username;

ALTER TABLE orders
    DROP COLUMN buyer_username;
-- +goose StatementEnd
