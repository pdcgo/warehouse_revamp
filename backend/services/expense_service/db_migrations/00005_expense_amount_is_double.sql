-- +goose Up
-- +goose StatementBegin
-- ⚠ SUPERSEDED 2026-11-06 (docs/business/order/context_decision.md#the-backend-never-rounds-money): nothing rounds any
-- more — every figure is stored exact, and only the screen rounds it. Where the note below says a figure is frozen or
-- rounded to whole rupiah, read "stored exact"; the column type it sets stands.
-- AN EXPENSE IS A DOUBLE (docs/business/order/context_decision.md#every-ledger-moves-to-double-rounded-when-frozen):
-- `expense_records.amount` (an expense and its signed corrections) moves from whole-rupiah BIGINT to `double precision`.
-- Never `numeric`.
--
-- ⚠ FROZEN WHOLE: ExpenseCreate and ExpenseAdjust round the figure to whole rupiah (san_money.Whole) as the row is
-- written — a stock loss arrives from inventory priced at a FIFO unit cost — so the account it moves and every daily sum
-- stay exact. The sign CHECK carries over unchanged.
--
-- The casts are exact. Revamp holds no real data yet (revamp-has-no-real-orders-yet), so nothing is backfilled.
ALTER TABLE expense_records
    ALTER COLUMN amount TYPE double precision USING amount::double precision;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE expense_records
    ALTER COLUMN amount TYPE bigint USING round(amount)::bigint;
-- +goose StatementEnd
