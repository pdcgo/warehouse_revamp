# expense_service — lock order

The service's lock hierarchy, and the reference every new write handler is checked against. Written even though nothing
is unsafe: its value is being here **before** the next handler needs it (the inventory_service and financial_account
precedent).

| | |
| --- | --- |
| Isolation | READ COMMITTED (Postgres default — nothing in this repo raises it) |
| Last swept | 2026-11-06: the Analytic expense-metrics fold (`expense_v1/metric_fold.go` — expense-figures-are-read-from-its-own-records) joined ExpenseCreate and ExpenseAdjust |

---

## The hierarchy

**The expense row first, its report row last.**

```
expense_records (the corrected expense, FOR UPDATE)  →  expense_records (the new row, INSERT)  →  expense_metric_daily_reports (one row, upsert)
```

## Per handler, in acquisition order

| Handler | Locks, in order | Outside calls | Proof |
| --- | --- | --- | --- |
| `ExpenseCreate` | `expense_records` INSERT (a new row — no conflict) → `expense_metric_daily_reports` upsert (typed kinds only; a STOCK_LOSS takes none) | the paying account (`PayingAccounts`) and the team's side (`TeamSides`) — both **before** the transaction | `TestRace_MetricFold_CreatesAndCorrectionsOnOneDayRow` |
| `ExpenseAdjust` (Adjust and Batalkan) | `expense_records` the expense `FOR UPDATE` (the floor check) → INSERT the adjustment → `expense_metric_daily_reports` upsert on the **correction's** day | the team's side — **before** the transaction | `TestRace_ExpenseAdjust_TheFloorHolds`, `TestInterleave_MetricFold_TheSecondCorrectionQueuesOnTheRow` |

## Why the report row cannot deadlock or lose an update

| Concern | Answer |
| --- | --- |
| Lost update — two entries into one day row at once | One `INSERT … ON CONFLICT (day, team_id, kind, shop_id, user_id) DO UPDATE SET amount = amount + EXCLUDED.amount`: the conflict takes the existing row's lock and adds in the statement, so the second waits and adds on top. 10 rounds × 16 racers (creates and corrections on one row): the report always equals Σ `expense_records`. |
| Deadlock | Each transaction writes ONE report row, and it is its LAST statement. Two corrections of two expenses share no expense lock; of one expense they queue on its `FOR UPDATE` before either reaches the report. No cycle is possible. |
| First insert of a new day row | Two first entries race on the unique index: the loser's `ON CONFLICT` turns into the update — no unique violation reaches the caller. |
| A round-trip under a lock | None: the team's side is asked before the transaction (kept for the process by the composition root, `expense_team_sides.go`). |

No unsafe finding — no handler report.
