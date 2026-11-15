# LiabilityDaily — performance audit

**Verdict:** 🟡 HEAVY for one shape only — a busy warehouse's **three years read yearly** takes **≈ 72 ms** (one
statement): every leg of the team in the window is read and hashed into its few buckets. A month read daily is
**2.1 ms**, a year **22–23 ms** at either grain.
**Measured:** 2026-11-15 · `liability_service/liability_v1/liability_daily.go` after
[periods-are-grouped-on-the-server](../../../../docs/business/settlement/context_decision.md#periods-are-grouped-on-the-server)
(the grain on the server, spans of 60 months / 20 years unlocked) · a busy warehouse's 100 000 legs over 2024–2026 among
575 000 legs of 20 teams, interleaved in time · warm-up + 5 runs (`liability_daily_perf_test.go`, `-tags perfaudit`),
the before/after and index rounds on one seed in one process

| case | median wall | rows | statements |
| --- | --- | --- | --- |
| a month, daily | 2.1 ms | 31 | 1 |
| a year, daily | 21.9 ms | 365 | 1 |
| a year, monthly | 23.3 ms | 12 | 1 |
| three years, yearly | 71.8 ms | 3 | 1 |

The three-year plan: `Bitmap Index Scan on liability_logs_team_created_idx` (99 971 legs, 3.9 ms) → heap → `HashAggregate`
(6 groups), 71.4 ms in all.

---

## Findings

### 0. No index could narrow a period — ✅ applied `liability_logs_team_created_idx`

The only index starting with `team_id` was `liability_logs_pair_idx (team_id, counterparty_id, id DESC)`: a month's read
walked the team's whole history (bitmap on the prefix, then the `created_at` filter) or seq-scanned the table. A pure
index ([a-pure-index-is-added-without-asking](../../../../docs/technical/architecture/context_decision.md#a-pure-index-is-added-without-asking)),
liability `00015` — `(team_id, created_at)`. Three rounds without / with it on one seed, 15 runs each:

| case | without | with |
| --- | --- | --- |
| a month, daily | 22.6 ms (generic plan 152 ms) | 2.5 ms (generic 2.6 ms) |
| a year, daily | 37.4 ms | 23.5 ms |
| a year, monthly | 38.4 ms | 23.9 ms |
| three years, yearly | 160 ms | 157 ms (the sort below) |

Every liability write adds one entry to it.

### 1. An `ORDER BY` made three years spill a sort — ✅ fixed in the same build

With `ORDER BY bucket`, Postgres grouped by SORTING every leg (it cannot estimate how few buckets a `date_trunc` makes):
three years = 100 000 legs, past `work_mem` (4 MB) → `Sort Method: external merge Disk: 3600kB`, 157–165 ms warm and
0.47–1.8 s cold. The handler now sorts the few grouped rows in Go; without the `ORDER BY` the plan is a `HashAggregate`
(40 kB): **≈ 72 ms**. Same shape in ExpenseDaily.

### 2. Three years read every leg of the team — open

At the yearly grain the window is the team's whole history, so the cost grows with the ledger: ≈ 72 ms at 100 000 legs.
Options when a warehouse grows far past this, the owner's call:

- a monthly rollup per (team, counterparty, source) folded on `PostEntry` — a write-path change (a concurrency audit and
  a lock-order row with it);
- a covering index `(team_id, created_at) INCLUDE (source_type, amount)` for an index-only scan — a pure index, but its
  gain needs a committed, vacuumed copy to measure (the test transaction cannot set the visibility map).

The daily statement still opens Yearly on this year only (366-day bound on the screen), so today it never asks for three.

## History

| date | change | result |
| --- | --- | --- |
| 2026-11-05 | the Jakarta day (the-liability-day-is-the-jakarta-day) | 10.7 ms / 30 ms (31 / 366 days) at 50 000 legs among 500 000 — no file then |
| 2026-11-15 | the grain on the server; `00015` index; `ORDER BY` → Go sort | the table above; a month 22.6 → 2.1 ms; three years 72 ms (finding 2, open) |
