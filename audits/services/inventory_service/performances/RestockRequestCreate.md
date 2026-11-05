# RestockRequestCreate — performance audit

**Verdict:** ✅ ok — **8 statements, 3.4 ms** at one line and **4.1 ms** at twenty. The paying-account check
(a-restock-names-its-paying-account) adds three indexed reads BEFORE the transaction; the restock's own writes are one
statement per table whatever the line count.
**Measured:** 2026-11-05 · `inventory_service/inventory_v1/restock_request_create.go` through the REAL account seam
(`cmd/app_development/restock_accounts.go` → `financial_account_v1.FinancialAccountByIds`) · `financial_accounts` 20 200
rows (the team holds 200, 40 marked operational) · warm, 5 runs · probe
`backend/cmd/app_development/restock_accounts_perf_test.go` (`-tags perfaudit`, `TestPerf_RestockPayingAccount`)

| lines | median wall | queries |
| --- | --- | --- |
| 1 | 3.4 ms | 8 |
| 20 | 4.1 ms | 8 |

---

## Queries (20 lines)

| # | What | ×N | Time | Plan | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | `SELECT * FROM financial_accounts WHERE team_id = ? AND id IN (?)` — the account the restock names | 1 | <0.1 ms | `financial_accounts_pkey`, 3 buffers | ok — outside the transaction |
| 2 | `SELECT account_id FROM operational_accounts WHERE account_id IN (?)` — its operational mark | 1 | 0.6 ms | seq scan on 40 rows (`operational_accounts_account_unique` exists; the planner prefers the scan at this size) | ok |
| 3 | `SELECT * FROM shop_accounts WHERE account_id IN (?)` — ByIds' shop slice, unused here | 1 | <0.1 ms | — | ok — see below |
| 4 | `INSERT restocks` · `INSERT restock_items` (all lines) · `INSERT restock_logs` · `INSERT warehouse_products … ON CONFLICT DO NOTHING` | 4 | 3.7 ms | — | ok |

---

## Findings

### the-account-question-reads-the-shop-slice-too

ℹ️ Noted, not a problem. `FinancialAccountByIds` asked for the `ACCOUNT` data type still reads `shop_accounts` for the
account (one indexed read, <0.1 ms). Shared with expense's Paid from; not worth a second ByIds shape.
