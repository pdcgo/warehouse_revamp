# FinancialAccountCreate — performance audit

**Verdict:** 🟡 heavy by the query-count rule only — **11 statements** per call, over the skill's 5, every one fixed; 4.3 ms median — the statement count never grows with the data
**Measured:** 2026-10-01 · [`financial_account_create.go`](../../../../backend/services/financial_account_service/financial_account_v1/financial_account_create.go) · seed 10 000 `financial_accounts`, 50 000 `financial_account_logs` (20 000 on the account written), ~50 000 `financial_account_daily_reports` · warm, median of 5 · `financial_account_create_perf_test.go` (`-tags perfaudit`) · the count excludes the test's own `SAVEPOINT`, which production replaces with `BEGIN`

| | median |
| --- | --- |
| wall | 4.3 ms |
| statements | 11 |
| slowest single statement | ≤ 1.1 ms  |

The statements, in order — none inside a loop:

| # | statement |
| --- | --- |
| 1 | the number check |
| 2 | the name check |
| 3 | insert the account |
| 4 | lock it |
| 5 | the opening row: log |
| 6 | balance |
| 7 | day row |
| 8 | later-day shift |
| 9 | reload: the account |
| 10 | reload: its marks |
| 11 | reload: its shops |

---

## Findings

### 1. Four statements per ledger leg 🟡

Each leg is the decided write ([the-daily-row-is-written-with-the-log-row](../../../../docs/business/financial_account/context_decision.md#the-daily-row-is-written-with-the-log-row)):
the log row, the balance, the day's report row, and the shift of every later day — four round trips on a locked row.
One leg here. The count is FIXED — it does not grow with the data; only the shift's row
count does, by the days after a late row (a transfer dated 200 days back: 10.6 ms, against 3.2 ms today).

**→ Recommend: leave it.** Folding the four into one writable-CTE statement saves 3 round trips (~1 ms) at
the cost of one large statement whose failures are harder to name. Worth it only if writes become a throughput
problem — they are a person typing, or one event per withdrawal.

### 2. The answer is re-read in three queries 🟡

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
| 2026-10-01 | 4.3 ms | 11 | first audit |
