# RestockReceivedCountCorrect — performance audit

**Verdict:** ✅ fixed in size — **31 statements** whatever the line count (one of them the test transaction's
SAVEPOINT), **11.5 ms** median for one line, **19.4 ms** for twenty. Filed because it is over the 5-statement line,
which the decided flow sets by itself: the write is the restock's lock, the line facts, ONE `adjustment` transaction
with its batch and rack rows at the batch's price, the correction rows, the line's count and the two report rows
([a-wrong-stock-in-is-a-received-count-correction](../../../../docs/business/inventory/adjustment_decision.md#a-wrong-stock-in-is-a-received-count-correction),
[a-received-count-correction-counts-on-its-own-day](../../../../docs/business/inventory/adjustment_decision.md#a-received-count-correction-counts-on-its-own-day));
the rest (~12) is the restock detail it answers with, read after the commit so the form shows what landed. Every
statement is one per correction, never one per line; no change proposed.
**Measured:** 2026-11-13 · `inventory_service/inventory_v1/restock_received_count_correct.go` →
`inventory_mutations.PostCountCorrection` · the ledgers' background (`perfLedgerBackground`, 50 000 batches and their
logs over 20 warehouses) · a restock of 1 and of 20 lines, 50 of 100 accepted a line onto one rack · warm, 5 runs, each
flipping every line one unit (out, then in) from the count the last run left · `received_count_correct_perf_test.go`
(`-tags perfaudit`)

| lines | runs | median wall | db | statements |
| --- | --- | --- | --- | --- |
| 1 | 5 (10.8 – 12.1 ms) | **11.5 ms** | ~11–13 ms | 31 |
| 20 | 5 (18.4 – 24.1 ms) | **19.4 ms** | ~19–25 ms | 31 |

---

## Statements (one run), in order

| # | What | Verdict |
| --- | --- | --- |
| 1 | `SAVEPOINT` (the test's transaction) | — |
| 2 | `SELECT … FROM restocks WHERE id = ? AND warehouse_id = ? … FOR UPDATE` | ok — by pk, the first lock |
| 3–4 | the restock's items; its broken rows (`restock_problem_items … problem_type = 'broken'`) | ok — by restock id |
| 5 | `SELECT count(*) FROM placements WHERE id IN (…)` — the racks are this warehouse's | ok |
| 6–7 | the line's batch: the accept's mint (`batches WHERE transaction_id = ? AND product_id IN (…)`), a correction's mint (`DISTINCT ON (restock_item_id) … restock_count_corrections`) | ok — `batches_transaction_idx` (00044), `restock_count_corrections_restock_idx` |
| 8 | `SELECT * FROM batches WHERE warehouse_id = ? AND id IN (…) ORDER BY id FOR UPDATE` | ok — by pk |
| 9–10 | `INSERT … product_placements … ON CONFLICT DO NOTHING` (a rack row at 0 for units in), `SELECT … FOR UPDATE` the rack rows | ok |
| 11 | the count locks over them (`opname_session_snapshots` open lock) | ok — `opname_session_snapshots_open_lock` |
| 12–17 | `INSERT inventory_transactions` · `INSERT batch_logs` · `UPDATE batches` (unnest) · `INSERT product_placement_logs` · `UPDATE product_placements` (unnest) · `INSERT inventory_transaction_items` | ok — one each, every line in it |
| 18–19 | `UPDATE restock_items` (unnest) · `INSERT restock_count_corrections` | ok |
| 20–21 | `INSERT … inventory_door_daily_reports` · `INSERT … inventory_stock_daily_changes` (`ON CONFLICT DO UPDATE`, the transaction's last locks) | ok |
| 22–31 | the detail: the restock, its items, problems and trail; the corrections; the line facts (the batches, their units, the racks holding the product) and the put-away rows | ok — each by an index; the two mint reads repeat 6–7 after the commit, deliberately |

Nothing reads `batch_logs` or grows with the batch's or the restock's history beyond the restock's own correction rows.

## History

| Date | Result |
| --- | --- |
| 2026-11-13 | First audit, as the RPC was built: 31 statements fixed in size, 11.5 ms (1 line) / 19.4 ms (20 lines) — the batch-by-transaction read got `batches_transaction_idx` (00044, see [WarehouseTransferReceivedCountCorrect](WarehouseTransferReceivedCountCorrect.md)) |
