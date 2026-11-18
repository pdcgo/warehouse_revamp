-- +goose Up
-- +goose StatementBegin
-- WHICH ORDER A RETURN'S BATCH CAME BACK FROM (a-returns-batch-opens-its-order). The batch screens name a batch a return
-- minted *Retur · order #<id>*: inventory hands over the page's `return` transactions and selling answers the orders
-- naming them (OrderIDsByReturnTransactions) — ONE statement per page, by this column. 00049 left it unindexed because
-- nothing read orders BY it; now the batch list does. Without it that statement reads every order (a sequential scan
-- of the whole table on each page of batches). Partial: only an order whose return was accepted names one, so the
-- index holds returns alone and an order placed never touches it. A pure index — no query, write or result changes
-- (a-pure-index-is-added-without-asking); measured in return_orders_perf_test.go.
CREATE INDEX orders_return_transaction_idx ON orders (return_transaction_id) WHERE return_transaction_id IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX orders_return_transaction_idx;
-- +goose StatementEnd
