# BatchRevalue — performance audit

**Verdict:** ✅ fast, and fixed in size — **6 statements** whatever the batch's history (7 on the probe: the test
transaction's SAVEPOINT), **2.6 ms** median. Filed because it is over the 5-statement line, which the decided flow sets
by itself: [batch.md](../../../../docs/business/inventory/batch.md) §Change Price Flow Example (log, price log, batch)
plus the transaction and its item
([revaluation-and-opname-are-transaction-types](../../../../docs/business/inventory/transaction_decision.md#revaluation-and-opname-are-transaction-types)).
Each statement writes a different row the decisions ask for; no change proposed.
**Measured:** 2026-11-12 · `inventory_service/inventory_v1/batch_revalue.go` → `inventory_mutations.PostRevaluation` →
`inventory_ledgers.LockBatch` + `Revalue` · the ledgers' background (`perfLedgerBackground`, 50 000 batches and their logs
over 20 warehouses) plus one batch of 1 000 units in Gudang 5 · warm, 5 runs, each correcting from the price the last
left · `batch_revalue_perf_test.go` (`-tags perfaudit`)

| runs | median wall | db | in Go | statements |
| --- | --- | --- | --- | --- |
| 5 (2.10 – 2.77 ms) | **2.64 ms** | 2.64 ms | ~0 | 6 (+ SAVEPOINT) |

---

## Statements (one run)

| # | What | Rows | Time | Plan | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | `SELECT * FROM batches WHERE id = ? … LIMIT 1 FOR UPDATE` | 1 | 0.025 ms executed | Index Scan `batches_pkey` → LockRows | ok — the only lock, and the first |
| 2 | `INSERT INTO inventory_transactions …` | 1 | 0.52 ms | — | ok |
| 3 | `INSERT INTO batch_logs …` (0 units, Δ × units left) | 1 | 0.52 ms | — | ok |
| 4 | `INSERT INTO batch_price_logs …` | 1 | 0.53 ms | — | ok |
| 5 | `UPDATE batches SET price_unit, stock_valuation, updated_at WHERE id = ?` | 1 | < 0.01 ms | by id | ok |
| 6 | `INSERT INTO inventory_transaction_items …` (quantity 0, total \|Δ × units\|) | 1 | 0.52 ms | — | ok |

Nothing is read twice and nothing grows with the batch's history: a correction never reads `batch_logs`. The four
INSERTs' ~0.5 ms each is the round trip of a RETURNING insert on this machine, the same as every other write's.

## History

| Date | Result |
| --- | --- |
| 2026-11-12 | First audit, as the RPC was built: 6 statements, 2.64 ms median — set by the flow, nothing to fix |
