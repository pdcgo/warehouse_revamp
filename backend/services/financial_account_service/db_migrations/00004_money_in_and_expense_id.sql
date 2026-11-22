-- +goose Up
-- +goose StatementBegin
-- MONEY IN TYPED ON BIAYA IS ITS OWN CHANGE TYPE (docs/business/financial_account/context_decision.md —
-- money-in-on-biaya-is-its-own-change-type): Piutang luar diterima and Uang masuk lain post a `money_in` row INTO the
-- operational account they entered, never a plus-sign `expense` — so the account's expense rows stay spending only. A
-- change type is ALSO a daily-report column (the-daily-row-is-one-account-one-day), so the CHECK and the column move
-- together.
ALTER TABLE financial_account_logs DROP CONSTRAINT financial_account_logs_type_known;
ALTER TABLE financial_account_logs ADD CONSTRAINT financial_account_logs_type_known CHECK (change_type IN (
    'expense', 'ads_expense', 'adjustment', 'withdrawal', 'restock',
    'opening_balance', 'transfer', 'team_payment', 'capital', 'money_in'
));

ALTER TABLE financial_account_daily_reports ADD COLUMN money_in double precision NOT NULL DEFAULT 0;

-- THE EXPENSE A ROW CAME FROM — expense_service's `expense_records` id, for every row the expense listener posts (an
-- expense, a correction, a Prive or Setoran modal typed on Biaya, money in); 0 for every other row. The history's
-- *dari Biaya #N* (the-expense-types-prototype-is-accepted). Another service's id: no FK. Rows posted before it stay 0
-- (their description already names the expense, "Expense E-N") — no backfill.
ALTER TABLE financial_account_logs ADD COLUMN expense_id BIGINT NOT NULL DEFAULT 0 CHECK (expense_id >= 0);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE financial_account_logs DROP COLUMN expense_id;
ALTER TABLE financial_account_daily_reports DROP COLUMN money_in;
ALTER TABLE financial_account_logs DROP CONSTRAINT financial_account_logs_type_known;
ALTER TABLE financial_account_logs ADD CONSTRAINT financial_account_logs_type_known CHECK (change_type IN (
    'expense', 'ads_expense', 'adjustment', 'withdrawal', 'restock',
    'opening_balance', 'transfer', 'team_payment', 'capital'
));
-- +goose StatementEnd
