-- +goose Up
-- +goose StatementBegin
-- A SUPPLIER'S GOODS OF ONE PRODUCT, BY STORE (a pure index — a-pure-index-is-added-without-asking). A supplier page's
-- Produk tab (SupplierStoreProductGoods, supplier_store_product_goods.go) looks up each row's batches by (supplier,
-- store, product) — and the Gudang terkait chip's warehouse — but batches_supplier_idx (00039) holds no product, so for a
-- big supplier every row walked all its batches of that store and dropped the other products on the heap
-- (audits/services/inventory_service/performances/SupplierGoods.md, Finding 3). A big supplier's 200 rows 0.7–1.3 s →
-- 41–77 ms, 20 rows 66–130 → 5–8 ms (TestPerf_SupplierStoreProductGoods); under a chip the cached generic plan still
-- picks batches_supplier_idx. The take's batch updates were never HOT (stock_count is in two partial predicates): this
-- adds ≈ 10–20 µs a moved batch, inside the noise (TestPerf_OrderTakeLatency_Committed 1 line 8.9–10.2 → 8.0–9.0 ms
-- median, 20 lines 16.5–18.1 → 14.0–16.3). Full, not partial: Siap sums emptied batches too and Terjual reads their
-- order rows. Changes no query and no answer.
CREATE INDEX batches_supplier_product_idx ON batches (supplier_id, supplier_channel_id, product_id, warehouse_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX batches_supplier_product_idx;
-- +goose StatementEnd
