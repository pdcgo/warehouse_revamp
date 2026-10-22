-- +goose Up
-- +goose StatementBegin
-- THE OLD STOCK TABLES GO (ledgers stage 5). The decided ledgers replace them outright
-- (no-switch-over-the-ledgers-replace-todays-tables): every reader and writer moved onto inventory_transactions,
-- batches, product_placements and their logs in stage 3, so nothing reads or writes these any more.
--
--   stock_levels, stock_movements       → product_placements, product_placement_logs
--   stock_batches, stock_shelf_batches  → batches, batch_logs (a rack counts per product, never per batch)
--   stock_owner_movements               → batch_logs of the owner's batches (a-batch-carries-its-owner)
--   restock_received_placements         → the accept's own rack rows in product_placement_logs
--
-- One statement, so the foreign keys among them never stand in the way of the order.
DROP TABLE stock_owner_movements, stock_shelf_batches, stock_movements, stock_batches, stock_levels,
           restock_received_placements;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- ⚠ NOT REVERSIBLE, and saying so is better than pretending. Down would recreate six tables nothing reads, with no rows
-- to put back: development data is reseeded, not migrated (no-switch-over-the-ledgers-replace-todays-tables). To go
-- back, check out the commit before this one and rebuild the database.
SELECT 1;
-- +goose StatementEnd
