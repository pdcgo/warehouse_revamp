-- +goose Up
-- +goose StatementBegin
-- A SUPPLIER'S GOODS ARE READ BY SUPPLIER (SupplierGoods — the supplier pages' Terjual / Siap / Gudang terkait): every
-- batch minted with a supplier's id, grouped by its store or its warehouse. Without it each read scanned every batch,
-- and the planner then hashed all of batch_logs against them.
CREATE INDEX batches_supplier_idx ON batches (supplier_id, supplier_channel_id, warehouse_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX batches_supplier_idx;
-- +goose StatementEnd
