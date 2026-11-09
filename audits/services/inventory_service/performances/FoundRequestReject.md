# FoundRequestReject — performance audit

**Verdict:** 🟢 fast — **4 statements, 1.1 ms**: lock the row, update it, read its rack's code for the answer.
**Measured:** 2026-11-03 · `inventory_service/inventory_v1/found_request_reject.go` · the ledgers' background volume ([OrderTransactionCreate](OrderTransactionCreate.md)) and the stock count's
([OpnameSessionFinalize](OpnameSessionFinalize.md)) plus **50 000 found requests** (one in ten waiting) · warm, 5 runs
(`found_request_perf_test.go`, `-tags perfaudit`)

| case | median wall | statements |
| --- | --- | --- |
| a waiting request rejected by the Admin | 1.1 ms | 4 |

---

## Statements

| # | What | ×N | Time | Verdict |
| --- | --- | --- | --- | --- |
| 1 | savepoint | 1 | < 0.1 ms | ok |
| 2 | the request `FOR UPDATE` | 1 | 0.5 ms | ok — the primary key |
| 3 | `UPDATE found_requests` — rejected, who, when, why | 1 | 0.5 ms | ok |
| 4 | the rack's code for the answer | 1 | < 0.1 ms | ok |

A rejection — and a withdrawal — posts nothing, so the answer needs no preview.

---

## History

| Date | Median | Statements | Change |
| --- | --- | --- | --- |
| 2026-11-03 | 1.1 ms | 4 | first audit, at the build |
