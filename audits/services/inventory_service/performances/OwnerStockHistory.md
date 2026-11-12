# OwnerStockHistory (and a batch's StockHistory) — performance audit

**Verdict:** ✅ fixed 2026-11-12 — was 🔴 heavy: every history row names what it came from (`refExpr` in
`ledger_history.go`: an order's key from `idempotency_order_check`, a restock's receipt from `restocks`, both looked up
BY TRANSACTION), and neither table was indexed on `transaction_id`, so each row SCANNED both. The owner's history runs its
running-balance window over EVERY row of the product before it pages, so it paid the two scans for all of them:
**12.5 s** for page 1 of a product with 3 000 takes. Inventory `00041` adds the two pure indexes
(a-pure-index-is-added-without-asking): **~19 ms**; a batch's history **203 ms → ~2 ms**. One 🟡 left, pre-existing:
the owner's read finds the product's batches by a seq scan (below).
**Measured:** 2026-11-12 · `inventory_service/inventory_v1/owner_stock_history.go`, `stock_history.go` (narrowed to a
batch), `ledger_history.go` · the ledgers' background (`perfLedgerBackground`: 50 000 transactions, batches and their
logs, the order keys, and restocks — given their own transaction ids on the probe, as an accepted restock carries) plus
ONE batch of 5 000 units with 3 000 one-unit order takes and 20 price corrections on its ledger · warm, 5 runs ·
`batch_detail_perf_test.go` `TestPerf_BatchDetail_ALongCorrectedBatch` (`-tags perfaudit`)

| read (page 1 of 50) | before — no index | after `00041` (three runs' medians) | after, executed | queries |
| --- | --- | --- | --- | --- |
| `OwnerStockHistory` | **12.5 s** median | **17.0 / 19.2 / 22.8 ms** | 7.8 – 11.8 ms | 2 |
| `StockHistory`, the batch | **203 ms** median | **1.9 / 1.9 / 2.3 ms** | 0.6 – 0.9 ms | 2 |

---

## Finding 1 — each history row scanned two tables 🔴 → ✅ applied

Before, the plan's two lookups under the window were `Seq Scan on idempotency_order_check` and `Seq Scan on restocks`,
once for each of the product's rows. After `00041` (probe of 2026-11-12):

```
WindowAgg  (actual time=1.679..6.831 rows=3021 loops=1)
  SubPlan 2
    ->  Index Scan using idempotency_order_check_transaction_idx on idempotency_order_check k  (actual time=0.000..0.000 rows=0 loops=3021)
          Index Cond: (transaction_id = l.transaction_id)
  SubPlan 3
    ->  Index Scan using restocks_transaction_idx on restocks r  (actual time=0.000..0.000 rows=0 loops=3021)
          Index Cond: (transaction_id = l.transaction_id)
Execution Time: 7.822 ms
```

**Applied** — inventory `00041_history_ref_indexes.sql`, a pure index (no query, write, constraint or result changes):

```sql
CREATE INDEX idempotency_order_check_transaction_idx ON idempotency_order_check (transaction_id);
CREATE INDEX restocks_transaction_idx ON restocks (transaction_id);
```

The restocks index also serves every batch read's `LEFT JOIN restocks r ON r.transaction_id = b.transaction_id`.

## Finding 2 — the owner's read finds the product's batches by a seq scan 🟡 open, pre-existing

`… FROM batch_logs l JOIN batches b ON b.id = l.batch_id WHERE b.team_id = ? AND b.product_id = ?` — the only index
leading with `(team_id, product_id)` is `batches_owner_product_idx`, partial on `stock_count > 0` (00032, for the take's
reserve), and the history must include emptied batches. The planner picks either `batches_last_price_idx` on its
non-leading columns (0.3 ms, 152 buffers) or `Seq Scan on batches b` (3.6 ms at 50 000 batches) — both grow with the
table. **→ Proposal:** a full `(team_id, product_id)` index; a pure index, but its gain at revamp's volumes is ≤ 3 ms and
it is not this feature's — left for the owner's next audit of the owner reads.

## Still open — the owner's history computes `ref` for every row, not the page 🟡

The running-balance window's select carries `refExpr`, so its two lookups run for every row of the product before
`LIMIT`; with the indexes that is a few µs a row (≈ 5 ms of the 7.8 ms at 3 021 rows) and grows linearly. Moving `refExpr`
to the paged outer select — as the override flag already is — would make it per page. A query rewrite, so it goes to the
owner; not needed at revamp's volumes.

## History

| Date | Result |
| --- | --- |
| 2026-11-12 | First audit (Koreksi Harga's read half: `priceExprs` added to both reads — per-row arithmetic, nil): the `refExpr` scans found and fixed by `00041`; Finding 2 and the per-row `ref` left open |
