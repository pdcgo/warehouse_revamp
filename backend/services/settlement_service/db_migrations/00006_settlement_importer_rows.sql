-- +goose Up
-- +goose StatementBegin
-- WHAT THE SETTLEMENT IMPORTER WRITES — three changes that land before its first row.

-- 1. THE FIVE TYPES OF 2026-09-24 get a report column each (the type list grew to thirteen). WIDENED
--    WITH SettlementPost, never after it: the fold refuses a type it has no column for, and nothing
--    compares the report with the log (#the-reconcile-check-is-not-built) — a type accepted first would
--    be a row missing from the report, silently.
--
--    ⚠ `withdrawal` COUNTS IN THE POSITION like every column (#withdrawal-counts-in-the-position): the
--    fold adds it to `change` and the carry, so close_balance is the shortfall PLUS what was withdrawn.
ALTER TABLE shop_settlement_daily_reports
    ADD COLUMN withdrawal             BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN shipment_adjustment    BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN logistic_reimbursement BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN platform_reimbursement BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN marketplace_program    BIGINT NOT NULL DEFAULT 0;

ALTER TABLE user_settlement_daily_reports
    ADD COLUMN withdrawal             BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN shipment_adjustment    BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN logistic_reimbursement BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN platform_reimbursement BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN marketplace_program    BIGINT NOT NULL DEFAULT 0;

-- 2. WHO AN IMPORTED SHOP ROW COUNTS FOR (#settlement-asks-the-shop-for-its-primary-cs) — the shop's
--    primary CS, asked of the shop before the write and kept on the row, so a replay folds the person
--    the row was written with and never asks again. 0 on every other row: an order row counts for its
--    creator, a hand-posted shop row for its actor.
ALTER TABLE settlement_logs
    ADD COLUMN user_id BIGINT NOT NULL DEFAULT 0;

-- 3. THE SOURCE IS `importer` (#the-source-is-named-importer). Nothing in the product has written
--    `exporter` — only tests and local runs — so the rename rewrites what they left, and no stored row
--    keeps the old spelling. The enum's NUMBER did not change, so an event already on the broker reads
--    the same.
UPDATE settlement_logs SET source_type = 'importer' WHERE source_type = 'exporter';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
UPDATE settlement_logs SET source_type = 'exporter' WHERE source_type = 'importer';

ALTER TABLE settlement_logs
    DROP COLUMN user_id;

ALTER TABLE user_settlement_daily_reports
    DROP COLUMN withdrawal,
    DROP COLUMN shipment_adjustment,
    DROP COLUMN logistic_reimbursement,
    DROP COLUMN platform_reimbursement,
    DROP COLUMN marketplace_program;

ALTER TABLE shop_settlement_daily_reports
    DROP COLUMN withdrawal,
    DROP COLUMN shipment_adjustment,
    DROP COLUMN logistic_reimbursement,
    DROP COLUMN platform_reimbursement,
    DROP COLUMN marketplace_program;
-- +goose StatementEnd
