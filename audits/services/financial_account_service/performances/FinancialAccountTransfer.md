# FinancialAccountTransfer — performance audit

**Verdict:** 🟡 heavy by the query-count rule only — **10 statements** per call, over the skill's 5, every one fixed; 3.2 ms today · 10.6 ms dated 200 days back median — the statement count never grows with the data
**Measured:** 2026-10-01 · [`financial_account_transfer.go`](../../../../backend/services/financial_account_service/financial_account_v1/financial_account_transfer.go) · seed 10 000 `financial_accounts`, 50 000 `financial_account_logs` (20 000 on the account written), ~50 000 `financial_account_daily_reports` · warm, median of 5 · `financial_account_transfer_perf_test.go` (`-tags perfaudit`) · the count excludes the test's own `SAVEPOINT`, which production replaces with `BEGIN`

| | median |
| --- | --- |
| wall | 3.2 ms today · 10.6 ms dated 200 days back |
| statements | 10 |
| slowest single statement | ≤ 1.1 ms (4.5 ms: the 200-day shift) |

The statements, in order — none inside a loop:

| # | statement |
| --- | --- |
| 1 | lock both accounts, in id order |
| 2 | the group id |
| 3 | out leg: log · balance · day row · shift |
| 4 | in leg: log · balance · day row · shift |

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

---

## Not measured

- concurrency — see [../concurrency/lock-order.md](../concurrency/lock-order.md)
- the committing cost — measured inside the test's transaction; a real `COMMIT` adds its fsync
- cache-cold behaviour

---

## History

| Date | Median | Statements | Change |
| --- | --- | --- | --- |
| 2026-10-01 | 3.2 ms today · 10.6 ms dated 200 days back | 10 | first audit |
