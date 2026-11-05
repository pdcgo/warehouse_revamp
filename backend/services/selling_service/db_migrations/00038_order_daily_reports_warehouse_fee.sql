-- +goose Up
-- +goose StatementBegin
-- WAREHOUSE FEE (docs/business/analytic/rpc_provide_decision.md#the-warehouse-fee-prototype-is-accepted) is a sixth
-- `metric` of order_daily_reports, not a column beside the five: its figures are NET, each on its own day
-- (a-warehouse-fee-counts-on-its-day-and-a-cancel-takes-it-back-on-its-day) — the placement's day gets +1 and + the
-- frozen fee, the cancel's day −1 and − the fee — so its own row carries a signed `order_count` (the fee transactions)
-- and a signed `total` (the fee amount), keyed by the same day, seller, shop, warehouse and creator as the order metrics
-- (warehouse-fee-groups-like-the-order-metrics). `mp_total` stays 0 on it.
--
-- ⚠ NO REFOLD of orders folded before this migration: revamp has no real orders (revamp-has-no-real-orders-yet), so a
-- dev order placed before it has no fee row, and a later cancel of one nets its seller's figure below zero.
ALTER TABLE order_daily_reports DROP CONSTRAINT order_daily_reports_metric_check;
ALTER TABLE order_daily_reports ADD CONSTRAINT order_daily_reports_metric_check
    CHECK (metric IN ('created', 'cancelled', 'return_created', 'return_arrived', 'lost_created', 'warehouse_fee'));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DELETE FROM order_daily_reports WHERE metric = 'warehouse_fee';
ALTER TABLE order_daily_reports DROP CONSTRAINT order_daily_reports_metric_check;
ALTER TABLE order_daily_reports ADD CONSTRAINT order_daily_reports_metric_check
    CHECK (metric IN ('created', 'cancelled', 'return_created', 'return_arrived', 'lost_created'));
-- +goose StatementEnd
