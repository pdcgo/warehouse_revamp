-- +goose Up
-- +goose StatementBegin
-- ⚠ SUPERSEDED 2026-11-06 (docs/business/order/context_decision.md#the-backend-never-rounds-money): nothing rounds any
-- more — every figure is stored exact, and only the screen rounds it. Where the note below says a figure is frozen or
-- rounded to whole rupiah, read "stored exact"; the column type it sets stands.
-- THE ACCOUNTS' MONEY IS A DOUBLE, NOT NUMERIC (docs/business/order/context_decision.md#numeric-money-moves-to-double-too,
-- every-ledger-moves-to-double-rounded-when-frozen): the 15 NUMERIC(20,2) columns 00001 created — the account's balance,
-- a log's change and balance_after, and the twelve figures of a daily report — move to `double precision`.
--
-- ⚠ FROZEN WHOLE: every posting rounds to whole rupiah as it is written (rupiah() = san_money.Whole), so a balance is the
-- exact sum of its logs and the reports' sums stay exact. NUMERIC(20,2) → double is exact for every whole figure.
--
-- Revamp holds no real data yet (revamp-has-no-real-orders-yet), so nothing is backfilled.
ALTER TABLE financial_accounts
    ALTER COLUMN balance TYPE double precision USING balance::double precision;
ALTER TABLE financial_account_logs
    ALTER COLUMN change TYPE double precision USING change::double precision,
    ALTER COLUMN balance_after TYPE double precision USING balance_after::double precision;
ALTER TABLE financial_account_daily_reports
    ALTER COLUMN expense TYPE double precision USING expense::double precision,
    ALTER COLUMN ads_expense TYPE double precision USING ads_expense::double precision,
    ALTER COLUMN adjustment TYPE double precision USING adjustment::double precision,
    ALTER COLUMN withdrawal TYPE double precision USING withdrawal::double precision,
    ALTER COLUMN restock TYPE double precision USING restock::double precision,
    ALTER COLUMN opening_balance TYPE double precision USING opening_balance::double precision,
    ALTER COLUMN transfer TYPE double precision USING transfer::double precision,
    ALTER COLUMN team_payment TYPE double precision USING team_payment::double precision,
    ALTER COLUMN capital TYPE double precision USING capital::double precision,
    ALTER COLUMN change TYPE double precision USING change::double precision,
    ALTER COLUMN open_balance TYPE double precision USING open_balance::double precision,
    ALTER COLUMN close_balance TYPE double precision USING close_balance::double precision;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE financial_accounts
    ALTER COLUMN balance TYPE numeric(20,2) USING round(balance::numeric, 2);
ALTER TABLE financial_account_logs
    ALTER COLUMN change TYPE numeric(20,2) USING round(change::numeric, 2),
    ALTER COLUMN balance_after TYPE numeric(20,2) USING round(balance_after::numeric, 2);
ALTER TABLE financial_account_daily_reports
    ALTER COLUMN expense TYPE numeric(20,2) USING round(expense::numeric, 2),
    ALTER COLUMN ads_expense TYPE numeric(20,2) USING round(ads_expense::numeric, 2),
    ALTER COLUMN adjustment TYPE numeric(20,2) USING round(adjustment::numeric, 2),
    ALTER COLUMN withdrawal TYPE numeric(20,2) USING round(withdrawal::numeric, 2),
    ALTER COLUMN restock TYPE numeric(20,2) USING round(restock::numeric, 2),
    ALTER COLUMN opening_balance TYPE numeric(20,2) USING round(opening_balance::numeric, 2),
    ALTER COLUMN transfer TYPE numeric(20,2) USING round(transfer::numeric, 2),
    ALTER COLUMN team_payment TYPE numeric(20,2) USING round(team_payment::numeric, 2),
    ALTER COLUMN capital TYPE numeric(20,2) USING round(capital::numeric, 2),
    ALTER COLUMN change TYPE numeric(20,2) USING round(change::numeric, 2),
    ALTER COLUMN open_balance TYPE numeric(20,2) USING round(open_balance::numeric, 2),
    ALTER COLUMN close_balance TYPE numeric(20,2) USING round(close_balance::numeric, 2);
-- +goose StatementEnd
