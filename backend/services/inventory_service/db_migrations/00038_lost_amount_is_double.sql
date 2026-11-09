-- +goose Up
-- +goose StatementBegin
-- ⚠ SUPERSEDED 2026-11-06 (docs/business/order/context_decision.md#the-backend-never-rounds-money): nothing rounds any
-- more — every figure is stored exact, and only the screen rounds it. Where the note below says a figure is frozen or
-- rounded to whole rupiah, read "stored exact"; the column type it sets stands.
-- THE LOST STOCK REPORT'S VALUE IS A DOUBLE, NOT NUMERIC (docs/business/order/context_decision.md#numeric-money-moves-to-
-- double-too): `inventory_lost_daily_reports.lost_amount` moves from NUMERIC(20,2) to `double precision`, the type the
-- batches it is valued from already have. The fold freezes each row's figure to whole rupiah (san_money.Whole) as it
-- writes it.
--
-- Revamp holds no real data yet (revamp-has-no-real-orders-yet), so nothing is backfilled.
ALTER TABLE inventory_lost_daily_reports
    ALTER COLUMN lost_amount TYPE double precision USING lost_amount::double precision;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE inventory_lost_daily_reports
    ALTER COLUMN lost_amount TYPE numeric(20,2) USING round(lost_amount::numeric, 2);
-- +goose StatementEnd
