-- +goose Up
-- +goose StatementBegin
-- CAPITAL'S SECOND DOOR (docs/business/financial_account/context_decision.md —
-- prive-and-deposit-on-pengeluaran-are-the-accounts-capital: one act, one record, two doors;
-- the-expense-types-prototype-is-accepted). A SELLING team's Setor / Tarik Modal made on the account page is recorded
-- here as the same one record — Setoran modal / Prive — from financial_account_service's
-- FinancialAccountCapitalRecorded (expense_v1/capital_from_account.go), and the ones made before this door existed are
-- brought in once by `san expense import-capital`.
--
-- `origin` is ExpenseOrigin's NUMBER — the door it came in by: 0 typed on Biaya (every row so far, every adjustment),
-- 1 ACCOUNT_PAGE. Closed to the two values the screen reads (an unknown door would draw no mark at all).
ALTER TABLE expense_records
    ADD COLUMN origin SMALLINT NOT NULL DEFAULT 0 CHECK (origin IN (0, 1));

-- `account_log_id` is the account's by-hand `capital` row an ACCOUNT_PAGE expense IS (financial_account_logs.id — an
-- opaque id of another service, no FK). ONE expense per account row, whoever brings it — the live door, a redelivery
-- under another event id, the import beside it: the listener's insert is ON CONFLICT DO NOTHING on this index. 0 on
-- every other row, so the index holds only the account-page rows.
ALTER TABLE expense_records
    ADD COLUMN account_log_id BIGINT NOT NULL DEFAULT 0 CHECK (account_log_id >= 0);

-- An account-page row always names its account row, and only an account-page row does.
ALTER TABLE expense_records
    ADD CONSTRAINT expense_records_account_page_is_linked
        CHECK ((origin = 1) = (account_log_id > 0));

CREATE UNIQUE INDEX expense_records_account_log_unique
    ON expense_records (account_log_id)
    WHERE account_log_id > 0;

-- THE LISTENER's CLAIMS — one row per event already handled (san_event.NewDedup's shape), so a redelivered
-- FinancialAccountCapitalRecorded records nothing (one-contract-for-both-handler-types). expense_service's first
-- listener, so its first claim table.
CREATE TABLE expense_event_logs (
    event_id         TEXT        PRIMARY KEY,
    occurred_at_unix BIGINT      NOT NULL,
    received_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX expense_event_logs_received_idx ON expense_event_logs (received_at);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE expense_event_logs;
DROP INDEX expense_records_account_log_unique;
ALTER TABLE expense_records DROP CONSTRAINT expense_records_account_page_is_linked;
ALTER TABLE expense_records DROP COLUMN account_log_id;
ALTER TABLE expense_records DROP COLUMN origin;
-- +goose StatementEnd
