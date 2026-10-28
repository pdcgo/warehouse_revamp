-- +goose Up
-- +goose StatementBegin
-- THE ORDER'S MONEY, as the owner's §Table That Must Have lists it for `orders`:
--
--   goods_cost  — "goods only, used for warehouse fee charge calculation"
--   total_cost  — "goods + warehouse fee"
--   platform_total (00026) — what the buyer paid the platform
--
-- and nothing else. Three build columns have no place in it:
--
--   subtotal, total  — a quote that was not the same figure on the two doors (OrderCreate: the goods at cost; Promote:
--                      the draft rows' marketplace prices). Our side of the trade is `total_cost`.
--   shipping_cost    — an order records no shipping (an-order-records-no-shipping-cost, cod-and-shipping-are-the-platforms):
--                      the buyer pays the platform, the platform pays the courier, and none of it passes through us.
--
-- `cogs` IS RENAMED, its values kept. From here on placeOrder writes it as Σ the lines' frozen `total` — borrowed lines
-- WITH their markup, what the goods cost the seller (the-cross-charge-lives-on-the-line, the-fee-is-priced-on-goods-cost)
-- — and prices the warehouse fee on it. Rows already written keep the figure they were frozen with
-- (a-lines-money-is-frozen-at-finalize): the drawn cost, which equals Σ line `total` on every order with no borrowed
-- line. Whole rupiah, rounded once; 0 = UNKNOWN, not free, as before.
--
-- `total_cost` is frozen beside it: goods_cost + warehouse_fee, unrounded like the fee (rupiah-is-floating-point).
-- Back-filled for the rows that exist, with a never-priced fee (NULL) counted as nothing — the fee's own NULL still says
-- it was never priced, and every reader that needs it (the margin) checks the fee, not this.
ALTER TABLE orders
    RENAME COLUMN cogs TO goods_cost;

ALTER TABLE orders
    ADD COLUMN total_cost DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (total_cost >= 0);

UPDATE orders
SET total_cost = goods_cost + COALESCE(warehouse_fee, 0);

ALTER TABLE orders
    DROP COLUMN subtotal,
    DROP COLUMN total,
    DROP COLUMN shipping_cost;

-- The draft is the platform's header and lines, nothing of ours and no shipping money (the owner's `order_drafts`).
ALTER TABLE order_drafts
    DROP COLUMN shipping_cost;

-- A touched mark naming a field that no longer exists protects nothing.
UPDATE order_drafts
SET touched_fields = (
    SELECT COALESCE(jsonb_agg(name), '[]'::jsonb)
    FROM jsonb_array_elements_text(touched_fields) AS name
    WHERE name <> 'shipping_cost'
)
WHERE touched_fields @> '["shipping_cost"]'::jsonb;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- The dropped figures cannot come back: they return as the columns' old defaults (0), and the touched marks as dropped.
ALTER TABLE order_drafts
    ADD COLUMN shipping_cost BIGINT NOT NULL DEFAULT 0;

ALTER TABLE orders
    ADD COLUMN subtotal BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN shipping_cost BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN total BIGINT NOT NULL DEFAULT 0;

ALTER TABLE orders
    DROP COLUMN total_cost;

ALTER TABLE orders
    RENAME COLUMN goods_cost TO cogs;
-- +goose StatementEnd
