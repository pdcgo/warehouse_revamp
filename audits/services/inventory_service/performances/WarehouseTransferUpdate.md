# WarehouseTransferUpdate — performance audit

**Verdict:** ✅ ok — **11 statements, 3.5 ms** at one line and **3.8 ms** at twenty; the line count does not change the
statement count (the lines are never edited, only read back in the answer).
**Measured:** 2026-11-05 · `inventory_service/inventory_v1/warehouse_transfer_update.go` through the REAL account seam
(`cmd/app_development/restock_accounts.go` → `financial_account_v1.FinancialAccountByIds`) · `financial_accounts` 20 200
rows (the team holds 200, 40 marked operational) · warm, 5 runs, each edit moving the cost · probe
`backend/cmd/app_development/transfer_accounts_perf_test.go` (`-tags perfaudit`, `TestPerf_TransferPayingAccount`)

| lines | median wall | queries |
| --- | --- | --- |
| 1 | 3.5 ms | 11 |
| 20 | 3.8 ms | 11 |

---

## Queries (20 lines)

| # | What | ×N | Time | Plan | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | `SELECT * FROM financial_accounts WHERE team_id = ? AND id IN (?)` — the account the edit names | 1 | 0.6 ms | `financial_accounts_pkey` | ok — outside the transaction |
| 2 | `SELECT account_id FROM operational_accounts WHERE account_id IN (?)` — its operational mark | 1 | <0.1 ms | seq scan on 40 rows (see [RestockRequestCreate](RestockRequestCreate.md)) | ok |
| 3 | `SELECT * FROM shop_accounts WHERE account_id IN (?)` — ByIds' shop slice, unused here | 1 | <0.1 ms | — | ok — [noted](RestockRequestCreate.md#the-account-question-reads-the-shop-slice-too) |
| 4 | `SAVEPOINT` (the test transaction's nesting) · `SELECT … FROM warehouse_transfers WHERE id = ? AND team_id = ? FOR UPDATE` · `UPDATE warehouse_transfers` | 3 | 1.5 ms | pkey | ok |
| 5 | the answer: the transfer, its items, problems, trail and the out-leg's rack rows, re-read | 5 | 2.2 ms | pkey · `product_placement_logs_transaction_idx` | ok |

---

## Findings

None. The account is asked on every edit that names one, changed or not — the answer is judged only when it changed
(that is known only under the lock), and asking is three indexed reads.

## Not measured

- concurrency — see [concurrency/WarehouseTransferUpdate.md](../concurrency/WarehouseTransferUpdate.md)
- `warehouse_transfers` was not seeded to volume — its reads are by primary key
