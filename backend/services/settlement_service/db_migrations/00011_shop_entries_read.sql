-- +goose Up
-- +goose StatementBegin
-- SHOP ENTRIES (docs/technical/frontend/settlement_report_decision.md#the-shop-entries-page-is-accepted) lists a team's
-- SHOP-ADDRESSED rows (order_id IS NULL), newest learned day first. They are a minority of the log — every order writes
-- several rows of its own — so the read walks a PARTIAL index over the shop rows alone, in the page's own order, rather
-- than every row of the team (the perf probe in shop_settlement_entry_list_perf_test.go reads both plans).
CREATE INDEX settlement_logs_shop_rows_idx ON settlement_logs (team_id, posted_on DESC, id DESC) WHERE order_id IS NULL;

-- A ROW IS REVERSED ONCE (a-shop-entry-reverses-inline): SettlementPost looks the reversal up by `reverses_id` under the
-- account's lock, and the list marks each row of a page with the row that reversed it. Only reversals carry one.
CREATE INDEX settlement_logs_reverses_idx ON settlement_logs (reverses_id) WHERE reverses_id IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS settlement_logs_reverses_idx;
DROP INDEX IF EXISTS settlement_logs_shop_rows_idx;
-- +goose StatementEnd
