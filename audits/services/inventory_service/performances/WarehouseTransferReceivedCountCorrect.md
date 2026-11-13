# WarehouseTransferReceivedCountCorrect — performance audit

**Verdict:** ✅ after one fix — **33 statements** whatever the line count, **11.3 ms** median for one line, **19.4 ms**
for twenty. It found a problem: the in-leg's batches were read by `batches.transaction_id`, which no index led with, so
each of the two reads (the write's layers, the detail's form facts) scanned every batch — **4.2 ms each at 50 000
batches, growing with the table**. Fixed by `batches_transaction_idx` (00044_batches_by_transaction.sql, a pure index —
standing owner OK): **0.38 ms each**, the 20-line call 37.1 → 19.4 ms.
**Measured:** 2026-11-13 · `inventory_service/inventory_v1/warehouse_transfer_received_count_correct.go` →
`inventory_mutations.TransferLayers` + `PostCountCorrection` · the ledgers' background (`perfLedgerBackground`) plus 20
products × 10 layers of 100 at Gudang 5 · one transfer of 1 and of 20 lines, 6 sent a line, accepted whole at Gudang 6 ·
warm, 5 runs, each flipping every line one unit · `received_count_correct_perf_test.go` (`-tags perfaudit`)

| lines | before (no index) | after | statements |
| --- | --- | --- | --- |
| 1 | 19.5 ms | **11.3 ms** (10.4 – 12.8) | 33 |
| 20 | 37.1 ms | **19.4 ms** (18.2 – 20.2) | 33 |

---

## The finding

```
EXPLAIN (ANALYZE, BUFFERS) SELECT id, product_id FROM batches WHERE transaction_id = 101909 ORDER BY product_id, id
Sort … -> Seq Scan on batches (actual time=4.185..4.189 rows=20) Filter: (transaction_id = 101909)
          Rows Removed by Filter: 50201 · Buffers: shared hit=1829 · Execution Time: 4.208 ms
```

After 00044: an Index Scan on `batches_transaction_idx`, 0.38 ms per call including the round trip. The same index
serves the restock correction's mint read and the two existing joins on it (`restock_request_labels.go`,
`product_stock_summary.go`).

## Statements

The restock's shape ([RestockReceivedCountCorrect](RestockReceivedCountCorrect.md)) with the transfer row
(`warehouse_transfers … FOR UPDATE`, the lock every status change takes) in place of the restock's, and the layers in
place of the one batch: the out-leg's rows (`batch_logs` of the out transaction, `batch_logs_transaction_idx`), the
in-leg's batches (`batches_transaction_idx`) and the earlier corrections (`warehouse_transfer_count_corrections_transfer_idx`)
— read once in the write and once more by the detail's form facts, after the commit. Every write is one statement for
every line; no event is published (no supplier figure or balance reads a transfer door).

## History

| Date | Result |
| --- | --- |
| 2026-11-13 | First audit, as the RPC was built: the batch-by-transaction seq scan (4.2 ms ×2) fixed by `batches_transaction_idx` — 33 statements, 11.3 ms / 19.4 ms |
