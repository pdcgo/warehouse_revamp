# WithdrawalHandler — performance audit

**Verdict:** 🟡 heavy by the query-count rule only — **8 statements** per call, over the skill's 5, every one fixed; 4.0 ms median — the statement count never grows with the data
**Measured:** 2026-10-01 · [`withdrawal_listener.go`](../../../../backend/services/financial_account_service/financial_account_v1/withdrawal_listener.go) · seed 10 000 `financial_accounts`, 50 000 `financial_account_logs` (20 000 on the account written), ~50 000 `financial_account_daily_reports` · warm, median of 5 · `withdrawal_listener_perf_test.go` (`-tags perfaudit`) · the count excludes the test's own `SAVEPOINT`, which production replaces with `BEGIN`

| | median |
| --- | --- |
| wall | 4.0 ms |
| statements | 8 |
| slowest single statement | ≤ 1.1 ms  |

The statements, in order — none inside a loop:

| # | statement |
| --- | --- |
| 1 | claim the event id |
| 2 | read the shop's link |
| 3 | lock the account |
| 4 | re-read the link under the lock |
| 5 | log |
| 6 | balance |
| 7 | day row |
| 8 | later-day shift |

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

---

## Not measured

- concurrency — see [../concurrency/lock-order.md](../concurrency/lock-order.md)
- the committing cost — measured inside the test's transaction; a real `COMMIT` adds its fsync
- cache-cold behaviour

---

## History

| Date | Median | Statements | Change |
| --- | --- | --- | --- |
| 2026-10-01 | 4.0 ms | 8 | first audit |
