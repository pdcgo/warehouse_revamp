-- +goose Up
-- AS OF WHEN (a-money-metric-says-as-of-when): every order metric answers the newest claim's created_at, read as
-- MAX(created_at) — an index read with this, a scan of every claim ever without it. settlement_event_logs and
-- supplier_event_logs carry the same index from their first migration.
CREATE INDEX order_event_logs_created_idx ON order_event_logs (created_at);

-- +goose Down
DROP INDEX order_event_logs_created_idx;
