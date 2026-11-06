-- +goose Up
-- +goose StatementBegin
-- ⚠ SUPERSEDED 2026-11-06 (docs/business/order/context_decision.md#the-backend-never-rounds-money): nothing rounds any
-- more — every figure is stored exact, and only the screen rounds it. Where the note below says a figure is frozen or
-- rounded to whole rupiah, read "stored exact"; the column type it sets stands.
-- AN ORDER'S COSTS ARE DOUBLES (docs/business/order/context_decision.md#every-ledger-moves-to-double-rounded-when-frozen):
-- `orders.goods_cost`, `order_items.unit_cost`, and a draft line's `order_draft_items.unit_price` move from whole-rupiah
-- BIGINT to `double precision` — the shape `total_cost`, `warehouse_fee` and the lines' `total` beside them already have.
-- Never `numeric`.
--
-- ⚠ FROZEN AT PLACEMENT, WHOLE RUPIAH: placement rounds goods_cost (Σ the lines' frozen totals, once) and each line's unit
-- cost (the take's drawn cost ÷ the quantity) to whole rupiah with san_money.Whole. A draft still being edited keeps what
-- was typed. The courier's charge at a return is frozen whole by the accept and rides only its event (no column).
--
-- The casts are exact. Revamp holds no real data yet (revamp-has-no-real-orders-yet), so nothing is backfilled.
ALTER TABLE orders
    ALTER COLUMN goods_cost TYPE double precision USING goods_cost::double precision;
ALTER TABLE order_items
    ALTER COLUMN unit_cost TYPE double precision USING unit_cost::double precision;
ALTER TABLE order_draft_items
    ALTER COLUMN unit_price TYPE double precision USING unit_price::double precision;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE orders
    ALTER COLUMN goods_cost TYPE bigint USING round(goods_cost)::bigint;
ALTER TABLE order_items
    ALTER COLUMN unit_cost TYPE bigint USING round(unit_cost)::bigint;
ALTER TABLE order_draft_items
    ALTER COLUMN unit_price TYPE bigint USING round(unit_price)::bigint;
-- +goose StatementEnd
