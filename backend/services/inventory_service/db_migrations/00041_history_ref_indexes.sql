-- +goose Up
-- +goose StatementBegin
-- A HISTORY ROW NAMES WHAT IT CAME FROM (ledger_history.go refExpr): an order's take by its key, a restock's accept by its
-- receipt — two lookups BY TRANSACTION per row. Neither table was indexed on it, so each row of a batch's or an owner's
-- history scanned both tables, and the owner's history works its running balance over EVERY row of the product before it
-- pages. Measured on a batch with 3 000 takes against the background volume
-- (audits/services/inventory_service/performances/OwnerStockHistory.md): the owner's history 12.5 s -> 20 ms, a batch's
-- history 203 ms -> 2.4 ms. Pure indexes — no query, write or result changes (a-pure-index-is-added-without-asking).
CREATE INDEX idempotency_order_check_transaction_idx ON idempotency_order_check (transaction_id);
CREATE INDEX restocks_transaction_idx ON restocks (transaction_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX restocks_transaction_idx;
DROP INDEX idempotency_order_check_transaction_idx;
-- +goose StatementEnd
