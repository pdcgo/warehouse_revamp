-- +goose Up
-- +goose StatementBegin
-- THE REST OF THE LINE'S MONEY, as the owner's §Table That Must Have lists it for `order_items`:
--
--   unit_cost_with_markup — "price product, if cross, price after markup"
--   markup_total          — "total - (unit_cost * qty)"
--
-- Both frozen from inventory's take beside `unit_cost` and `total` (00023), in the order's own transaction, and never
-- recomputed (a-lines-money-is-frozen-at-finalize). The order applies nothing: the take returns every figure of the line
-- from one draw (inventory-computes-the-markup). On a line the team owns the take applies no markup, so
-- unit_cost_with_markup is the draw's unit cost and markup_total is 0.
--
-- DOUBLE PRECISION, unrounded, as the take returned them (rupiah-is-floating-point) — the same type as `total`.
-- `unit_cost` stays whole rupiah, so `markup_total` = `total` − `unit_cost` × `quantity` only within that rounding.
--
-- NULL = NEVER FROZEN: every line placed before this column, and a product the take named no draw for. Deliberately not
-- back-filled — the take's figures for those orders were never kept, and a markup rebuilt from today's rate would read
-- as frozen when it is not.
ALTER TABLE order_items
    ADD COLUMN unit_cost_with_markup DOUBLE PRECISION CHECK (unit_cost_with_markup >= 0),
    ADD COLUMN markup_total DOUBLE PRECISION CHECK (markup_total >= 0);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE order_items
    DROP COLUMN markup_total,
    DROP COLUMN unit_cost_with_markup;
-- +goose StatementEnd
