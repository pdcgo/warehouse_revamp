-- +goose Up
-- +goose StatementBegin
-- AN ORDER LINE CARRIES NO PRICE OF ITS OWN (an-order-line-carries-no-marketplace-price, corrected 2026-10-23): the
-- owner's `order_items` holds `unit_cost`, `unit_cost_with_markup`, `markup_total` and `total` — every one the take's
-- — and no `unit_price`. Since 00025 the column was only a copy of `unit_cost` on new lines; on lines promoted before
-- that it still held the draft row's marketplace price, which is lost here (dev data only — accepted).
--
-- Its readers moved to `unit_cost` (what one unit cost) and `unit_cost_with_markup` (what one unit cost the seller).
-- The marketplace's price lives on the draft's platform rows (`order_draft_items.unit_price`), not here.
ALTER TABLE order_items
    DROP COLUMN unit_price;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- Back as the copy it last was: the take's unit cost.
ALTER TABLE order_items
    ADD COLUMN unit_price BIGINT NOT NULL DEFAULT 0;

UPDATE order_items
SET unit_price = unit_cost;
-- +goose StatementEnd
