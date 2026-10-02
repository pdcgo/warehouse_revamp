-- +goose Up
-- THE TEAM RECORD HOLDS NO BANK (owner, 2026-09-30).
--
-- A team's bank is money it holds, and money a team holds is a financial account — the bank a team is
-- paid into belongs there, beside its balance and its log (financial_account/context_clarify.md Q9).
-- Kept here as well, it would be one bank typed in two places, and the day one is edited a payer is
-- sent to the other.
--
-- Dropped, not copied: the owner chose to drop now rather than keep the columns until the financial
-- account service exists to take a copy. A number stored here is gone; teams enter it again as an
-- account.
ALTER TABLE team_infos
    DROP COLUMN bank_type,
    DROP COLUMN bank_owner_name,
    DROP COLUMN bank_account_number;

-- +goose Down
-- The columns come back empty — what the Up dropped is not recoverable.
ALTER TABLE team_infos
    ADD COLUMN bank_type           TEXT NOT NULL DEFAULT '',
    ADD COLUMN bank_owner_name     TEXT NOT NULL DEFAULT '',
    ADD COLUMN bank_account_number TEXT NOT NULL DEFAULT '';
