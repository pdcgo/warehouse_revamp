-- +goose Up
-- +goose StatementBegin
-- THE PLACEMENT LOG IS INDEXED BY ITS TRANSACTION (placement-logs-are-indexed-by-transaction). Every reader asks for a
-- transaction's rack rows by transaction_id alone — the rollback, the transfer's leg racks, the restock's put-away and
-- labels, a batch's placements, the goods receipt — and the 00025 index led with warehouse_id, which none of them names,
-- so each one scanned the whole log. A transaction id is unique system-wide, so the warehouse adds nothing to it; one
-- index of the same width replaces the other, as batch_logs_transaction_idx already is.
DROP INDEX product_placement_logs_transaction_idx;
CREATE INDEX product_placement_logs_transaction_idx ON product_placement_logs (transaction_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX product_placement_logs_transaction_idx;
CREATE INDEX product_placement_logs_transaction_idx ON product_placement_logs (warehouse_id, transaction_id);
-- +goose StatementEnd
