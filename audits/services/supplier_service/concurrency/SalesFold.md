# SalesFoldHandler — concurrency audit

**Verdict:** ✅ SAFE — proved, not read: `sales_fold_race_test.go` (`-tags raceaudit`, committing through
`san_race`, `-p 1`).
**Audited:** 2026-11-07 · `supplier_service/supplier_v1/sales_fold.go` — Penjualan's fold of `OrderPlaced` /
`OrderCancelled` (penjualan-is-the-selling-value-on-the-order-day) · READ COMMITTED

## Locks

| step | lock |
| --- | --- |
| the replay's lock | `process_event_lock` read `FOR SHARE` FIRST (since 2026-11-21, when the replay began clearing these tables — `refuseWhileReplaying`, the restock fold's read): a replay's flip waits for a fold in flight; a fold while a replay holds it is refused (`errFoldLocked`, 500 → redelivered) |
| the order's claim | `INSERT supplier_sale_orders (order_id) ON CONFLICT DO NOTHING`, then the row `FOR UPDATE` — both events of one order serialize here |
| the day's rows | one `INSERT … SELECT … ORDER BY supplier_id, product_id, team_id ON CONFLICT DO UPDATE` — every transaction locks a day's rows in the same key order |
| inventory | read BEFORE the transaction (the take's own ledger rows, never rewritten) — no lock held across the seam |

## Proofs

| claim | test | result |
| --- | --- | --- |
| A placement and its cancel, each delivered twice AT ONCE, fold exactly once each, in either order | `TestRace_SalesPlacementAndCancelOfOneOrder` — 10 rounds × 4 callers, the late half shifted `round%10` ms so both orders are hit | 0 errors; the order's day +30 units / Rp 300.000, the cancel's day −30 / −Rp 300.000 — never doubled, never lost |
| Beside a replay (2026-11-21): the replay waits for a fold in flight; a fold during the held window is refused at once; a replay racing live sales counts every order once | `analytic_replay_compute_sales_race_test.go` — `TestInterleave_ReplaySales_WaitsForASaleFoldInFlight`, `…ASaleFoldWhileTheLockIsHeldIsRefused` (4 park points), `TestRace_ReplaySales_BesideLiveSalesCountsEveryOrderOnce` (10 rounds) | blocked ≈ 420 ms then released; refused in ≈ 1 ms at every point; every day exact every round, ×5 runs (per run 19–25 landed, 35–41 refused). Rows in [lock-order.md](lock-order.md) |
| Eight orders of ONE day over the same two suppliers, their parts in opposite orders, never deadlock | `TestRace_SalesOrdersOfOneDayShareTheirRows` — 8 callers released together | 0 deadlocks, 0 errors; each supplier +8 units / Rp 80.000 |

## Not proved

- A cancel whose placement NEVER arrives leaves a `supplier_sale_orders` row with only `cancelled_day` — harmless (it
  counts nothing) and not pruned (a replay from before its cancel deletes it; the seek brings the cancel back).
