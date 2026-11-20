-- +goose Up
-- +goose StatementBegin
-- DISPUTES RESOLVED (the-order-status-moves-prototype-is-accepted, its 2026-11-20 line — the owner's checklist,
-- analytic/order_metric.md given 14, *disputes resolved shown*): an 8th count of Order status moves, its own `metric`
-- value as the seven are (00052) — one row per resolve's day, seller, shop, warehouse and creator, `order_count` the
-- resolves, `total` and `mp_total` always 0 (counts only).
--
--   moves_disputes_resolved → completed, straight from problem (a resolve) — counted BESIDE moves_completed, which keeps
--                             counting every resolve as before, so no figure already shown changes
--
-- ⚠ NO BACKFILL (the-order-metrics-count-from-the-fold-onward): a resolve made before this migration has its Completed
-- row only. Every existing row keeps a value the old CHECK allowed, so the widened CHECK holds for them as they are.
ALTER TABLE order_daily_reports DROP CONSTRAINT order_daily_reports_metric_check;
ALTER TABLE order_daily_reports ADD CONSTRAINT order_daily_reports_metric_check
    CHECK (metric IN ('created', 'cancelled', 'return_created', 'return_arrived', 'lost_created', 'warehouse_fee',
                      'moves_confirmed', 'moves_back_to_pending', 'moves_picked', 'moves_handed_over', 'moves_shipped',
                      'moves_problem', 'moves_completed', 'moves_disputes_resolved'));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DELETE FROM order_daily_reports WHERE metric = 'moves_disputes_resolved';
ALTER TABLE order_daily_reports DROP CONSTRAINT order_daily_reports_metric_check;
ALTER TABLE order_daily_reports ADD CONSTRAINT order_daily_reports_metric_check
    CHECK (metric IN ('created', 'cancelled', 'return_created', 'return_arrived', 'lost_created', 'warehouse_fee',
                      'moves_confirmed', 'moves_back_to_pending', 'moves_picked', 'moves_handed_over', 'moves_shipped',
                      'moves_problem', 'moves_completed'));
-- +goose StatementEnd
