-- +goose Up
-- +goose StatementBegin
-- WHERE A PAYMENT LEFT AND WHERE IT LANDED (a-team-payment-posts-on-accept, docs/business/financial_account).
--
-- The payer names the account the transfer left when recording; the creditor names the account it
-- landed in when accepting. On acceptance both ride `LiabilityPaymentAccepted`, and the financial
-- accounts post one `team_payment` row on each.
--
-- Opaque financial_account_service ids, no FK — the same rule as every other cross-service id here.
-- 0 = not named, as `recorded_by` and `confirmed_by` read it: `to` until the payment is accepted,
-- and `from` on every payment recorded before this column existed. Those rows are left at 0 rather
-- than guessed — their acceptance posts only the `to` leg, and a reconcile finds the payer's side.
ALTER TABLE liability_payments
    ADD COLUMN from_account_id BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN to_account_id   BIGINT NOT NULL DEFAULT 0;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- ⚠ THE DOWN FORGETS WHICH ACCOUNTS PAID. The rows the accounts already posted stay — they are the
-- financial accounts' own facts — but this side no longer says which account a payment named.
ALTER TABLE liability_payments
    DROP COLUMN to_account_id,
    DROP COLUMN from_account_id;
-- +goose StatementEnd
