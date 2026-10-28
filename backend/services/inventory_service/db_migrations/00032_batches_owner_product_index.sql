-- +goose Up
-- +goose StatementBegin
-- THE RESERVE READ HAS ITS OWN INDEX (the-reserve-is-read-once-for-every-line). The take and StockTakeQuote read an
-- owner's total stock of a product across EVERY warehouse, by (team_id, product_id), and the only index carrying both
-- led with warehouse_id, so each read walked the whole index for one row. Partial on stock_count > 0: an empty batch
-- adds nothing to the sum, and a batch a take empties leaves the index.
CREATE INDEX batches_owner_product_idx ON batches (team_id, product_id) WHERE stock_count > 0;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX batches_owner_product_idx;
-- +goose StatementEnd
