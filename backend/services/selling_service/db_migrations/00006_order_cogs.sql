-- +goose Up
-- +goose StatementBegin
-- What the goods COST us, frozen at order time (#74). `unit_price` is what the buyer pays; this is
-- what we paid, and the gap between them is the margin:
--
--   margin = total - cogs - shipping_cost
--
-- The per-line cost is the truth; `orders.cogs` is the sum, denormalised onto the header because
-- OrderList returns a summary WITHOUT lines — a list that shows margin would otherwise have to load
-- every order's items. It cannot drift, because the lines it was computed from are frozen too, exactly
-- like `subtotal` and `total` already are.
--
-- 0 means UNKNOWN, not free. A product that was never restocked has no recorded cost, and margin on
-- such a line reads as if the goods cost nothing — so 0 is a flag that the number is not to be trusted
-- rather than a value to compute with. Every row predating this column is in that position, which is
-- honest: nobody recorded what those orders' goods cost, and inventing a figure now would be
-- fabricating money.
ALTER TABLE order_items
    ADD COLUMN unit_cost BIGINT NOT NULL DEFAULT 0;

ALTER TABLE orders
    ADD COLUMN cogs BIGINT NOT NULL DEFAULT 0;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE orders
    DROP COLUMN cogs;

ALTER TABLE order_items
    DROP COLUMN unit_cost;
-- +goose StatementEnd
