# RestockRequestUpdate — performance audit

**Verdict:** ✅ ok — **13 statements, 4.2 ms** at one line and **6.4 ms** at twenty. The paying-account check
(a-restock-names-its-paying-account) adds the same three indexed reads as Create, BEFORE the row is locked; it is judged
under the lock only when the account changed.
**Measured:** 2026-11-05 · `inventory_service/inventory_v1/restock_request_update.go` through the REAL account seam
(`cmd/app_development/restock_accounts.go` → `financial_account_v1.FinancialAccountByIds`) · `financial_accounts` 20 200
rows (the team holds 200, 40 marked operational) · warm, 5 runs · probe
`backend/cmd/app_development/restock_accounts_perf_test.go` (`-tags perfaudit`, `TestPerf_RestockPayingAccount`)

| lines | median wall | queries |
| --- | --- | --- |
| 1 | 4.2 ms | 13 |
| 20 | 6.4 ms | 13 |

---

## Queries (20 lines, ongoing — a full replace)

| # | What | ×N | Time | Plan | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | the account: `financial_accounts` by pkey · `operational_accounts` · `shop_accounts` | 3 | 0.5 ms | pkey / 40-row scan | ok — before the lock |
| 2 | `SELECT * FROM restocks WHERE id = ? AND team_id = ? … FOR UPDATE` · `SELECT restock_items` | 2 | <0.1 ms | pkey · by restock | ok |
| 3 | `UPDATE restocks SET …` (fields) · `DELETE restock_items` · `INSERT restock_items` (all lines) | 3 | 3.4 ms | pkey | ok — the replace is one statement each |
| 4 | `UPDATE restocks SET subtotal, total` · `INSERT restock_logs` · `INSERT warehouse_products … ON CONFLICT DO NOTHING` | 3 | 2.6 ms | pkey | ok |

---

## Findings

### the-totals-are-a-second-update

ℹ️ Noted, not fixed (audits never apply fixes). An ongoing edit writes `restocks` twice — the fields, then `subtotal`
and `total` — 1.4 ms at twenty lines. Folding the totals into the first `UPDATE` would save one statement; it is not a
problem at this size.
