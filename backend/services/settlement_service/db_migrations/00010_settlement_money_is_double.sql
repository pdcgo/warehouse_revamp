-- +goose Up
-- +goose StatementBegin
-- ⚠ SUPERSEDED 2026-11-06 (docs/business/order/context_decision.md#the-backend-never-rounds-money): nothing rounds any
-- more — every figure is stored exact, and only the screen rounds it. Where the note below says a figure is frozen or
-- rounded to whole rupiah, read "stored exact"; the column type it sets stands.
-- EVERY RUPIAH IS A DOUBLE (docs/business/order/context_decision.md#every-ledger-moves-to-double-rounded-when-frozen, on
-- top of #rupiah-is-floating-point): the ledger, its state rows and both daily reports move from whole-rupiah BIGINT to
-- `double precision` — the shape order cost figures, batch prices and expense amounts already have. Never `numeric`.
--
-- ⚠ A POSTED ROW IS STILL WHOLE RUPIAH: SettlementPost rounds `change` to whole rupiah as it posts (the freeze point,
-- san_money.Whole), so every balance and every report sum below is a sum of whole numbers — exact in a double below
-- 2^53 (≈ Rp 9 quadrillion), and the reports still equal the log to the rupiah.
--
-- The casts are exact (every bigint here is far below 2^53). Revamp holds no real data yet
-- (revamp-has-no-real-orders-yet), so nothing is backfilled; the dev rows simply change type.
ALTER TABLE settlement_logs
    ALTER COLUMN change TYPE double precision USING change::double precision,
    ALTER COLUMN balance TYPE double precision USING balance::double precision;
ALTER TABLE order_settlements
    ALTER COLUMN initial_total TYPE double precision USING initial_total::double precision,
    ALTER COLUMN last_balance TYPE double precision USING last_balance::double precision;
ALTER TABLE shop_settlements
    ALTER COLUMN last_balance TYPE double precision USING last_balance::double precision;
ALTER TABLE shop_settlement_daily_reports
    ALTER COLUMN initial_total TYPE double precision USING initial_total::double precision,
    ALTER COLUMN initial_total_cancel TYPE double precision USING initial_total_cancel::double precision,
    ALTER COLUMN other TYPE double precision USING other::double precision,
    ALTER COLUMN fund TYPE double precision USING fund::double precision,
    ALTER COLUMN external_ads_fee TYPE double precision USING external_ads_fee::double precision,
    ALTER COLUMN affiliate_fee TYPE double precision USING affiliate_fee::double precision,
    ALTER COLUMN marketplace_adjustment TYPE double precision USING marketplace_adjustment::double precision,
    ALTER COLUMN system_adjustment TYPE double precision USING system_adjustment::double precision,
    ALTER COLUMN withdrawal TYPE double precision USING withdrawal::double precision,
    ALTER COLUMN shipment_adjustment TYPE double precision USING shipment_adjustment::double precision,
    ALTER COLUMN logistic_reimbursement TYPE double precision USING logistic_reimbursement::double precision,
    ALTER COLUMN platform_reimbursement TYPE double precision USING platform_reimbursement::double precision,
    ALTER COLUMN marketplace_program TYPE double precision USING marketplace_program::double precision,
    ALTER COLUMN change TYPE double precision USING change::double precision,
    ALTER COLUMN open_balance TYPE double precision USING open_balance::double precision,
    ALTER COLUMN close_balance TYPE double precision USING close_balance::double precision;
ALTER TABLE user_settlement_daily_reports
    ALTER COLUMN initial_total TYPE double precision USING initial_total::double precision,
    ALTER COLUMN initial_total_cancel TYPE double precision USING initial_total_cancel::double precision,
    ALTER COLUMN other TYPE double precision USING other::double precision,
    ALTER COLUMN fund TYPE double precision USING fund::double precision,
    ALTER COLUMN external_ads_fee TYPE double precision USING external_ads_fee::double precision,
    ALTER COLUMN affiliate_fee TYPE double precision USING affiliate_fee::double precision,
    ALTER COLUMN marketplace_adjustment TYPE double precision USING marketplace_adjustment::double precision,
    ALTER COLUMN system_adjustment TYPE double precision USING system_adjustment::double precision,
    ALTER COLUMN withdrawal TYPE double precision USING withdrawal::double precision,
    ALTER COLUMN shipment_adjustment TYPE double precision USING shipment_adjustment::double precision,
    ALTER COLUMN logistic_reimbursement TYPE double precision USING logistic_reimbursement::double precision,
    ALTER COLUMN platform_reimbursement TYPE double precision USING platform_reimbursement::double precision,
    ALTER COLUMN marketplace_program TYPE double precision USING marketplace_program::double precision,
    ALTER COLUMN change TYPE double precision USING change::double precision,
    ALTER COLUMN open_balance TYPE double precision USING open_balance::double precision,
    ALTER COLUMN close_balance TYPE double precision USING close_balance::double precision;
ALTER TABLE shop_settlement_reports
    ALTER COLUMN close_balance TYPE double precision USING close_balance::double precision;
ALTER TABLE user_settlement_reports
    ALTER COLUMN close_balance TYPE double precision USING close_balance::double precision;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE settlement_logs
    ALTER COLUMN change TYPE bigint USING round(change)::bigint,
    ALTER COLUMN balance TYPE bigint USING round(balance)::bigint;
ALTER TABLE order_settlements
    ALTER COLUMN initial_total TYPE bigint USING round(initial_total)::bigint,
    ALTER COLUMN last_balance TYPE bigint USING round(last_balance)::bigint;
ALTER TABLE shop_settlements
    ALTER COLUMN last_balance TYPE bigint USING round(last_balance)::bigint;
ALTER TABLE shop_settlement_daily_reports
    ALTER COLUMN initial_total TYPE bigint USING round(initial_total)::bigint,
    ALTER COLUMN initial_total_cancel TYPE bigint USING round(initial_total_cancel)::bigint,
    ALTER COLUMN other TYPE bigint USING round(other)::bigint,
    ALTER COLUMN fund TYPE bigint USING round(fund)::bigint,
    ALTER COLUMN external_ads_fee TYPE bigint USING round(external_ads_fee)::bigint,
    ALTER COLUMN affiliate_fee TYPE bigint USING round(affiliate_fee)::bigint,
    ALTER COLUMN marketplace_adjustment TYPE bigint USING round(marketplace_adjustment)::bigint,
    ALTER COLUMN system_adjustment TYPE bigint USING round(system_adjustment)::bigint,
    ALTER COLUMN withdrawal TYPE bigint USING round(withdrawal)::bigint,
    ALTER COLUMN shipment_adjustment TYPE bigint USING round(shipment_adjustment)::bigint,
    ALTER COLUMN logistic_reimbursement TYPE bigint USING round(logistic_reimbursement)::bigint,
    ALTER COLUMN platform_reimbursement TYPE bigint USING round(platform_reimbursement)::bigint,
    ALTER COLUMN marketplace_program TYPE bigint USING round(marketplace_program)::bigint,
    ALTER COLUMN change TYPE bigint USING round(change)::bigint,
    ALTER COLUMN open_balance TYPE bigint USING round(open_balance)::bigint,
    ALTER COLUMN close_balance TYPE bigint USING round(close_balance)::bigint;
ALTER TABLE user_settlement_daily_reports
    ALTER COLUMN initial_total TYPE bigint USING round(initial_total)::bigint,
    ALTER COLUMN initial_total_cancel TYPE bigint USING round(initial_total_cancel)::bigint,
    ALTER COLUMN other TYPE bigint USING round(other)::bigint,
    ALTER COLUMN fund TYPE bigint USING round(fund)::bigint,
    ALTER COLUMN external_ads_fee TYPE bigint USING round(external_ads_fee)::bigint,
    ALTER COLUMN affiliate_fee TYPE bigint USING round(affiliate_fee)::bigint,
    ALTER COLUMN marketplace_adjustment TYPE bigint USING round(marketplace_adjustment)::bigint,
    ALTER COLUMN system_adjustment TYPE bigint USING round(system_adjustment)::bigint,
    ALTER COLUMN withdrawal TYPE bigint USING round(withdrawal)::bigint,
    ALTER COLUMN shipment_adjustment TYPE bigint USING round(shipment_adjustment)::bigint,
    ALTER COLUMN logistic_reimbursement TYPE bigint USING round(logistic_reimbursement)::bigint,
    ALTER COLUMN platform_reimbursement TYPE bigint USING round(platform_reimbursement)::bigint,
    ALTER COLUMN marketplace_program TYPE bigint USING round(marketplace_program)::bigint,
    ALTER COLUMN change TYPE bigint USING round(change)::bigint,
    ALTER COLUMN open_balance TYPE bigint USING round(open_balance)::bigint,
    ALTER COLUMN close_balance TYPE bigint USING round(close_balance)::bigint;
ALTER TABLE shop_settlement_reports
    ALTER COLUMN close_balance TYPE bigint USING round(close_balance)::bigint;
ALTER TABLE user_settlement_reports
    ALTER COLUMN close_balance TYPE bigint USING round(close_balance)::bigint;
-- +goose StatementEnd
