-- +goose Up
-- +goose StatementBegin
-- ⚠ SUPERSEDED 2026-11-06 (docs/business/order/context_decision.md#the-backend-never-rounds-money): nothing rounds any
-- more — every figure is stored exact, and only the screen rounds it. Where the note below says a figure is frozen or
-- rounded to whole rupiah, read "stored exact"; the column type it sets stands.
-- EVERY RUPIAH IS A DOUBLE (docs/business/order/context_decision.md#every-ledger-moves-to-double-rounded-when-frozen):
-- a statement line's amount is stored as the reader returned it, a double, and SettlementPost (now `double change`)
-- rounds it to whole rupiah as it posts. A fractional amount is still HELD by the importer (settlement_importer_clarify
-- #8) — it means the file is not what we think — so a stored line is whole rupiah either way.
ALTER TABLE uploaded_file_lines
    ALTER COLUMN change TYPE double precision USING change::double precision;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE uploaded_file_lines
    ALTER COLUMN change TYPE bigint USING round(change)::bigint;
-- +goose StatementEnd
