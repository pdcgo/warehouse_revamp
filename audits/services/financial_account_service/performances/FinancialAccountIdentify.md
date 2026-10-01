# FinancialAccountIdentify — performance audit

**Verdict:** 🟡 heavy by the query-count rule only — **15 statements** per call, over the skill's 5, every one fixed; 5.9 ms (move-in) median — the statement count never grows with the data
**Measured:** 2026-10-01 · [`financial_account_identify.go`](../../../../backend/services/financial_account_service/financial_account_v1/financial_account_identify.go) · seed 10 000 `financial_accounts`, 50 000 `financial_account_logs` (20 000 on the account written), ~50 000 `financial_account_daily_reports` · warm, median of 5 · `financial_account_identify_perf_test.go` (`-tags perfaudit`) · the count excludes the test's own `SAVEPOINT`, which production replaces with `BEGIN`

| | median |
| --- | --- |
| wall | 5.9 ms (move-in) |
| statements | 15 |
| slowest single statement | ≤ 1.1 ms  |

The statements, in order — none inside a loop:

| # | statement |
| --- | --- |
| 1 | lock both accounts, in id order |
| 2 | the group id |
| 3 | out leg: log · balance · day row · shift |
| 4 | in leg: log · balance · day row · shift |
| 5 | re-point the shops |
| 6 | archive the unknown account |
| 7 | reload: the account |
| 8 | reload: its marks |
| 9 | reload: its shops |

---

## Findings

### 1. Four statements per ledger leg 🟡

Each leg is the decided write ([the-daily-row-is-written-with-the-log-row](../../../../docs/business/financial_account/context_decision.md#the-daily-row-is-written-with-the-log-row)):
the log row, the balance, the day's report row, and the shift of every later day — four round trips on a locked row.
Two legs here, so eight. The count is FIXED — it does not grow with the data; only the shift's row
count does, by the days after a late row (a transfer dated 200 days back: 10.6 ms, against 3.2 ms today).

**→ Recommend: leave it.** Folding the four into one writable-CTE statement saves 6 round trips (~2 ms) at
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
| 2026-10-01 | 5.9 ms (move-in) | 15 | first audit |
