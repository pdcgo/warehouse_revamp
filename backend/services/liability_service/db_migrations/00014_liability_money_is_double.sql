-- +goose Up
-- +goose StatementBegin
-- ⚠ SUPERSEDED 2026-11-06 (docs/business/order/context_decision.md#the-backend-never-rounds-money): nothing rounds any
-- more — every figure is stored exact, and only the screen rounds it. Where the note below says a figure is frozen or
-- rounded to whole rupiah, read "stored exact"; the column type it sets stands.
-- THE TEAM BALANCE LEDGER IS A DOUBLE (docs/business/order/context_decision.md#every-ledger-moves-to-double-rounded-when-frozen):
-- every rupiah column moves from whole-rupiah BIGINT to `double precision`. Never `numeric`.
--
-- ⚠ FROZEN WHOLE: PostEntry rounds a posting to whole rupiah (san_money.Whole) at the moment it is written — an order's
-- percentage fee and a loss priced at a FIFO unit cost arrive as fractions — so every stored leg is a whole number, a sum
-- of legs is exact, and a balance always equals the sum of its logs. A payment's claim and a credit limit freeze the same
-- way where they are written. The CHECKs (amount > 0, credit_limit >= 0) carry over unchanged.
--
-- The casts are exact. Revamp holds no real data yet (revamp-has-no-real-orders-yet), so nothing is backfilled.
ALTER TABLE liability_balances
    ALTER COLUMN balance TYPE double precision USING balance::double precision;
ALTER TABLE liability_logs
    ALTER COLUMN amount TYPE double precision USING amount::double precision,
    ALTER COLUMN balance_after TYPE double precision USING balance_after::double precision;
ALTER TABLE liability_payments
    ALTER COLUMN amount TYPE double precision USING amount::double precision;
ALTER TABLE liability_payment_requests
    ALTER COLUMN amount TYPE double precision USING amount::double precision;
ALTER TABLE liability_terms
    ALTER COLUMN credit_limit TYPE double precision USING credit_limit::double precision;
ALTER TABLE liability_terms_logs
    ALTER COLUMN old_credit_limit TYPE double precision USING old_credit_limit::double precision,
    ALTER COLUMN new_credit_limit TYPE double precision USING new_credit_limit::double precision,
    ALTER COLUMN old_handling_fee TYPE double precision USING old_handling_fee::double precision,
    ALTER COLUMN new_handling_fee TYPE double precision USING new_handling_fee::double precision;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE liability_balances
    ALTER COLUMN balance TYPE bigint USING round(balance)::bigint;
ALTER TABLE liability_logs
    ALTER COLUMN amount TYPE bigint USING round(amount)::bigint,
    ALTER COLUMN balance_after TYPE bigint USING round(balance_after)::bigint;
ALTER TABLE liability_payments
    ALTER COLUMN amount TYPE bigint USING round(amount)::bigint;
ALTER TABLE liability_payment_requests
    ALTER COLUMN amount TYPE bigint USING round(amount)::bigint;
ALTER TABLE liability_terms
    ALTER COLUMN credit_limit TYPE bigint USING round(credit_limit)::bigint;
ALTER TABLE liability_terms_logs
    ALTER COLUMN old_credit_limit TYPE bigint USING round(old_credit_limit)::bigint,
    ALTER COLUMN new_credit_limit TYPE bigint USING round(new_credit_limit)::bigint,
    ALTER COLUMN old_handling_fee TYPE bigint USING round(old_handling_fee)::bigint,
    ALTER COLUMN new_handling_fee TYPE bigint USING round(new_handling_fee)::bigint;
-- +goose StatementEnd
