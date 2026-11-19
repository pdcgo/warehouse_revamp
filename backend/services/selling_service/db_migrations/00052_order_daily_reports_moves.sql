-- +goose Up
-- +goose StatementBegin
-- ORDER STATUS MOVES (the-order-status-moves-prototype-is-accepted): one metric, `metrics/orders/moves`, with a COUNT per
-- status an order moved TO on its way out — each a `metric` value of order_daily_reports, as Warehouse Fee is (00038),
-- not a column beside the five: one row per move's day, seller, shop, warehouse and creator, `order_count` the moves,
-- `total` and `mp_total` always 0 (counts only — lost-is-a-metric-and-completed-is-not, its 2026-11-18 line).
--
--   moves_confirmed         → processed
--   moves_back_to_pending   → pending, after the placement (processed or picked handed back)
--   moves_picked            → picked
--   moves_handed_over       → shipping
--   moves_shipped           → shipped
--   moves_problem           → problem
--   moves_completed         → completed (from shipped, or a resolved problem)
--
-- ⚠ NO BACKFILL (the-order-metrics-count-from-the-fold-onward): a move made before this migration has no row. Every
-- existing row keeps a value the old CHECK allowed, so the widened CHECK holds for them as they are.
ALTER TABLE order_daily_reports DROP CONSTRAINT order_daily_reports_metric_check;
ALTER TABLE order_daily_reports ADD CONSTRAINT order_daily_reports_metric_check
    CHECK (metric IN ('created', 'cancelled', 'return_created', 'return_arrived', 'lost_created', 'warehouse_fee',
                      'moves_confirmed', 'moves_back_to_pending', 'moves_picked', 'moves_handed_over', 'moves_shipped',
                      'moves_problem', 'moves_completed'));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DELETE FROM order_daily_reports
WHERE metric IN ('moves_confirmed', 'moves_back_to_pending', 'moves_picked', 'moves_handed_over', 'moves_shipped',
                 'moves_problem', 'moves_completed');
ALTER TABLE order_daily_reports DROP CONSTRAINT order_daily_reports_metric_check;
ALTER TABLE order_daily_reports ADD CONSTRAINT order_daily_reports_metric_check
    CHECK (metric IN ('created', 'cancelled', 'return_created', 'return_arrived', 'lost_created', 'warehouse_fee'));
-- +goose StatementEnd
