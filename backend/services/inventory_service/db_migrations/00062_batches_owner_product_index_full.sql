-- +goose Up
-- +goose StatementBegin
-- A PRODUCT'S BATCHES, EVERY ONE OF THEM, BY ITS OWNER (a pure index — a-pure-index-is-added-without-asking). Pemasok
-- (ProductSupplierGoods, the-supplier-tab-names-the-store) and Riwayat Stok (OwnerStockHistory, DiscoverStockHistory)
-- read a product's batches across EVERY warehouse by (team_id, product_id), emptied ones included — and the only index
-- leading with both, batches_owner_product_idx (00032), is partial on stock_count > 0 for the take's reserve. So they
-- scanned the whole table or a non-leading index (audits/services/inventory_service/performances/OwnerStockHistory.md,
-- Finding 2). Pemasok at 303 600 batches, every warehouse, a product of 3 600 batches: 12.7-15.1 ms median → 9.7-10.9 ms,
-- its batch read a parallel seq scan of 38 ms (or 1.6 ms on batches_last_price_idx's non-leading columns, by plan) →
-- 0.08 ms (TestPerf_ProductSupplierGoods); the order take unchanged (TestPerf_OrderTakeLatency_Committed, 1 line 8.2 →
-- 7.9 ms median, 20 lines 15.4 → 14.5). Changes no query and no answer.
CREATE INDEX batches_owner_product_all_idx ON batches (team_id, product_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX batches_owner_product_all_idx;
-- +goose StatementEnd
