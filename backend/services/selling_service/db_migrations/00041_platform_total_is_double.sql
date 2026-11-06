-- +goose Up
-- +goose StatementBegin
-- ⚠ SUPERSEDED 2026-11-06 (docs/business/order/context_decision.md#the-backend-never-rounds-money): nothing rounds any
-- more — every figure is stored exact, and only the screen rounds it. Where the note below says a figure is frozen or
-- rounded to whole rupiah, read "stored exact"; the column type it sets stands.
-- WHAT THE BUYER PAID IS A DOUBLE (docs/business/order/context_decision.md#every-ledger-moves-to-double-rounded-when-frozen):
-- `orders.platform_total`, the same figure on the draft it is placed from (`order_drafts.platform_total`), and its daily
-- sum (`order_daily_reports.mp_total`) move from whole-rupiah BIGINT to `double precision` — the shape `total_cost` and
-- `warehouse_fee` beside them already have. Never `numeric`.
--
-- ⚠ FROZEN AT PLACEMENT, WHOLE RUPIAH: placement rounds the figure to whole rupiah (san_money.Whole) as the order row is
-- written — the moment it stops changing — so settlement's `initial_total`, which posts it, and every sum of it stay
-- exact. A draft still being edited keeps what was typed.
--
-- The casts are exact. Revamp holds no real data yet (revamp-has-no-real-orders-yet), so nothing is backfilled.
ALTER TABLE orders
    ALTER COLUMN platform_total TYPE double precision USING platform_total::double precision;
ALTER TABLE order_drafts
    ALTER COLUMN platform_total TYPE double precision USING platform_total::double precision;
ALTER TABLE order_daily_reports
    ALTER COLUMN mp_total TYPE double precision USING mp_total::double precision;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE orders
    ALTER COLUMN platform_total TYPE bigint USING round(platform_total)::bigint;
ALTER TABLE order_drafts
    ALTER COLUMN platform_total TYPE bigint USING round(platform_total)::bigint;
ALTER TABLE order_daily_reports
    ALTER COLUMN mp_total TYPE bigint USING round(mp_total)::bigint;
-- +goose StatementEnd
