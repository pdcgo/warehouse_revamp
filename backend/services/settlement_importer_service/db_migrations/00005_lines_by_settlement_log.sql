-- +goose Up
-- +goose StatementBegin
-- THE STATEMENT A LEDGER ROW CAME FROM (docs/technical/frontend/settlement_report_decision.md#the-shop-entries-page-is-accepted):
-- settlement's Shop Entries asks, per page, for the lines naming its rows — StatementLinesBySettlementLogIds, by
-- `settlement_log_id`. A held or skipped line names none (0), so the index leaves those out.
CREATE INDEX uploaded_file_lines_settlement_log_idx ON uploaded_file_lines (settlement_log_id, id) WHERE settlement_log_id <> 0;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS uploaded_file_lines_settlement_log_idx;
-- +goose StatementEnd
