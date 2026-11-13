-- +goose Up
-- +goose StatementBegin
-- A TRANSACTION'S BATCHES, BY ITS ID. KOREKSI JUMLAH TERIMA finds the batches a restock accept or a transfer's in-leg
-- minted by the minting transaction (RestockReceivedCountCorrect, WarehouseTransferReceivedCountCorrect and their detail
-- reads), as the restock labels and the product summary already join them — and no index led with transaction_id, so
-- each read scanned every batch (4.2 ms at 50 000 batches, linear in the table; audits/services/inventory_service/
-- performances/WarehouseTransferReceivedCountCorrect.md). A transaction mints a handful of batches; the index is narrow.
CREATE INDEX batches_transaction_idx ON batches (transaction_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX batches_transaction_idx;
-- +goose StatementEnd
