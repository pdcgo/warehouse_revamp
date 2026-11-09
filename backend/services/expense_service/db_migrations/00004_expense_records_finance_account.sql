-- +goose Up
-- WHICH ACCOUNT PAID (an-expense-must-name-the-account-that-paid). Every expense a person types names the account it was
-- paid from — one of the team's ACTIVE OPERATIONAL accounts, checked by the handler against financial_account_service
-- (an opaque id, no FK across services). An adjustment copies its expense's account, never typed: a correction posts
-- where the original did (a-correction-follows-the-expenses-account).
--
-- 0 = made before *Paid from* existed, or a STOCK_LOSS (inventory posts it by an internal call, and it moves no cash).
-- Nothing posts for 0, and nothing posts back for the past: each account's opening balance already holds it.
ALTER TABLE expense_records ADD COLUMN finance_account_id BIGINT NOT NULL DEFAULT 0;

-- +goose Down
ALTER TABLE expense_records DROP COLUMN finance_account_id;
