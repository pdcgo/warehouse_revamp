-- +goose Up
-- +goose StatementBegin
-- EVERY DATE HERE IS A JAKARTA DAY (docs/technical/architecture/context_decision.md#the-system-runs-on-jakarta-time):
-- "`DATE` columns are Jakarta dates by definition, and the column comment should say so". Comments only — no DDL
-- change is needed: `posted_on`'s DEFAULT CURRENT_DATE is the Jakarta day once the session is (san_dbsession pins
-- TimeZone=Asia/Jakarta on every connection the server, `san` and the tests open).
--
-- Rows written before the session zone was pinned are NOT rewritten: revamp holds no real data yet
-- (revamp-has-no-real-orders-yet), so there is nothing to backfill.
COMMENT ON COLUMN settlement_logs.posted_on IS
    'The Jakarta (WIB) day the row was recorded — CURRENT_DATE on a session pinned to Asia/Jakarta. Every settlement report buckets on it.';
COMMENT ON COLUMN settlement_logs.occurred_on IS
    'The Jakarta (WIB) day the money moved, as the source states it.';
COMMENT ON COLUMN settlement_event_logs.day IS
    'The Jakarta (WIB) day of the folded row — its posted_on.';
COMMENT ON COLUMN shop_settlement_daily_reports.day IS
    'A Jakarta (WIB) day — the posted_on of the log rows folded into it.';
COMMENT ON COLUMN user_settlement_daily_reports.day IS
    'A Jakarta (WIB) day — the posted_on of the log rows folded into it.';
COMMENT ON COLUMN user_settlement_reports.last_day IS
    'The newest Jakarta (WIB) day the person has a daily report row on.';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
COMMENT ON COLUMN settlement_logs.posted_on IS NULL;
COMMENT ON COLUMN settlement_logs.occurred_on IS NULL;
COMMENT ON COLUMN settlement_event_logs.day IS NULL;
COMMENT ON COLUMN shop_settlement_daily_reports.day IS NULL;
COMMENT ON COLUMN user_settlement_daily_reports.day IS NULL;
COMMENT ON COLUMN user_settlement_reports.last_day IS NULL;
-- +goose StatementEnd
