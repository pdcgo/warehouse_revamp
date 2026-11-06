-- +goose Up
-- +goose StatementBegin
-- ⚠ SUPERSEDED 2026-11-06 (docs/business/order/context_decision.md#the-backend-never-rounds-money): nothing rounds any
-- more — every figure is stored exact, and only the screen rounds it. Where the note below says a figure is frozen or
-- rounded to whole rupiah, read "stored exact"; the column type it sets stands.
-- A SUPPLIER'S VALUATIONS ARE DOUBLES (docs/business/order/context_decision.md#every-ledger-moves-to-double-rounded-when-frozen):
-- the three rupiah columns of `supplier_product_daily_reports` move from whole-rupiah BIGINT to `double precision`.
-- Never `numeric`. The fold values each line at total × units ÷ ordered and freezes it to whole rupiah (san_money.Whole)
-- as it writes the row, so the day's sums stay exact. The unit counts stay integers.
--
-- The casts are exact. Revamp holds no real data yet (revamp-has-no-real-orders-yet), so nothing is backfilled.
ALTER TABLE supplier_product_daily_reports
    ALTER COLUMN restock_valuation TYPE double precision USING restock_valuation::double precision,
    ALTER COLUMN shipping_lost_valuation TYPE double precision USING shipping_lost_valuation::double precision,
    ALTER COLUMN shipping_broken_valuation TYPE double precision USING shipping_broken_valuation::double precision;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE supplier_product_daily_reports
    ALTER COLUMN restock_valuation TYPE bigint USING round(restock_valuation)::bigint,
    ALTER COLUMN shipping_lost_valuation TYPE bigint USING round(shipping_lost_valuation)::bigint,
    ALTER COLUMN shipping_broken_valuation TYPE bigint USING round(shipping_broken_valuation)::bigint;
-- +goose StatementEnd
