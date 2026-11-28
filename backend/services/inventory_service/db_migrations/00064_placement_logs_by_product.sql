-- +goose Up
-- +goose StatementBegin
-- A PRODUCT'S RACK ROWS (a pure index — a-pure-index-is-added-without-asking). The warehouse product page's Stock
-- History, Placement History and last stock-take (StockHistory without a batch — stock_history.go productHistory, backlog
-- #142/#143) read every rack row of one product in one warehouse, `WHERE l.warehouse_id = ? AND l.product_id = ?`, and
-- each now names its batch, so the read walks all of them before the page is cut; product_placement_logs held no index
-- on the product (only placement-first 00025 and transaction 00031), so each statement SEQ-SCANNED the whole table.
-- Measured 2026-11-27 on a VACUUM FULL'd warehouse_test, one seed (TestPerf_StockHistory_AProductsBatches's: 5 201 rack
-- rows of the product among 305 000, 3 000 takes, 100 moves, 20 price corrections), states none / E interleaved in one
-- process, medians: the read page 1 ≈ 100–130 → 48 ms (56 alternating calls: 101 → 48), page 100 ≈ 105–135 → 45 ms,
-- Placement History ≈ 90–110 → 9–15 ms, the last stock-take ≈ 95–110 → 9–12 ms, ProductStockSummary ≈ 47–58 → 7–8 ms.
-- Unchanged: a batch's history (#47's lateral now probes this index exactly — same buffers; 56 calls 26.6 → 26.3 ms),
-- StockPickLocations (still transaction_idx, ≈ 1 ms), OwnerStockHistory, BatchPlacementList. The order take's write
-- (TestPerf_OrderTakeLatency_Committed, none/E/none/E): 1 line 9.0 / 10.0 / 11.3 / 9.9 ms, 20 lines 18.2 / 19.6 /
-- 21.0 / 18.2 ms median — inside the noise. Column order: product first, so a (transaction, product) lookup without a
-- warehouse is exact too; (warehouse_id, product_id) sent a batch's history 14 → 383 ms and (warehouse_id, product_id,
-- transaction_id) StockPickLocations 1.3 → 6.4 ms — both rejected (audits/services/inventory_service/performances/
-- StockHistory.md). Changes no query and no answer.
CREATE INDEX product_placement_logs_product_idx ON product_placement_logs (product_id, transaction_id, warehouse_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX product_placement_logs_product_idx;
-- +goose StatementEnd
