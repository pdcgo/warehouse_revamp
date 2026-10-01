# FinancialAccountUpdate — performance audit

**Verdict:** 🟡 heavy by the query-count rule only — **6 statements** per call, over the skill's 5, every one fixed; 2.6 ms median — the statement count never grows with the data
**Measured:** 2026-10-01 · [`financial_account_update.go`](../../../../backend/services/financial_account_service/financial_account_v1/financial_account_update.go) · seed 10 000 `financial_accounts`, 50 000 `financial_account_logs` (20 000 on the account written), ~50 000 `financial_account_daily_reports` · warm, median of 5 · `financial_account_update_perf_test.go` (`-tags perfaudit`) · the count excludes the test's own `SAVEPOINT`, which production replaces with `BEGIN`

| | median |
| --- | --- |
| wall | 2.6 ms |
| statements | 6 |
| slowest single statement | ≤ 1.1 ms  |

The statements, in order — none inside a loop:

| # | statement |
| --- | --- |
| 1 | lock the account |
| 2 | the name check |
| 3 | update it |
| 4 | reload: the account |
| 5 | reload: its marks |
| 6 | reload: its shops |

---

## Findings

### 1. The answer is re-read in three queries 🟡

Every account write answers with the account as it now stands, read back as the row, its operational mark and its
shops — three queries where one would do.

**→ Recommend: read the answer in ONE statement** — the row with `EXISTS (operational_accounts …)` and
`array_agg(shop_accounts.shop_id)` — saving two queries on Archive, Create, Identify, ShopSet and Update alike. A
small, mechanical change to `reloadAccount`; **I would make it.**

---

## Not measured

- concurrency — see [../concurrency/lock-order.md](../concurrency/lock-order.md)
- the committing cost — measured inside the test's transaction; a real `COMMIT` adds its fsync
- cache-cold behaviour

---

## History

| Date | Median | Statements | Change |
| --- | --- | --- | --- |
| 2026-10-01 | 2.6 ms | 6 | first audit |
