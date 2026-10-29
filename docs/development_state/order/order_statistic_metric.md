# Development state — order / order_statistic_metric

**BACKEND BUILT (2026-10-29), SCREEN NOT WIRED.** The five order metrics — Created, Cancel, Return Created, Return
Arrived, Lost Created — each counting whole orders on the day of its own move. The event three of them needed, the fold
and both reads exist and are tested; the analytic screen still shows its sample.

- Owner doc: [order_statistic_metric.md](../../business/order/order_statistic_metric.md) — ⚠ **untracked in git** until the owner commits it
- Decisions: [order_statistic_metric_decision.md](../../business/order/order_statistic_metric_decision.md) — 10
- Clarify: [order_statistic_metric_clarify.md](../../business/order/order_statistic_metric_clarify.md) — **2 questions**
  opened by the build (the ids, a backfill), 1 new contradiction (a user 0 cannot be a key), 2 slips in the owner's doc
- Flow: [selling rpc.md](../../services/selling_service/rpc.md#the-order-metrics--the-fold-and-orderanalyticservice) ·
  tables: [database-schema.md](../../database-schema.md) (`order_daily_reports`, `order_event_logs`)

## What exists

| | |
| --- | --- |
| analytic_base | `FILTER_TYPE_WAREHOUSE` (7) and `FILTER_TYPE_USER` (8), with `WarehouseFilter` / `UserFilter` cases 7 and 8 on `FilterItem`; `GROUP_TYPE_WAREHOUSE` (11) |
| the event | `OrderStatusChanged` (envelope 202, topic `order-status-changed`): team, order, from, to, actor, timeline row. `OrderStatusChange` publishes one per moved order after the commit, up to 16 at once; `event_id` = `order-status-changed:<timeline row id>`. `setOrdersStatus` now returns the rows it wrote |
| the tables | selling `00030`: `order_event_logs` (the dedup, keyed by the event id) and `order_daily_reports` (day, metric, team, shop, warehouse, user → order_count, total, mp_total), unique on the six, indexed by `(team_id, metric, day)` and `(warehouse_id, metric, day)` |
| the fold | `selling_v1.Analytic.FoldHandler` behind three push subscriptions (`selling-order-fold-placed`, `-cancelled`, `-moved`), declared in `tools/san/pubsub.go`. One transaction: claim, read the order, upsert. Any other move or variant is ACKED |
| the reads | `OrderAnalyticService.MetricSearch` / `MetricData` (`proto/warehouse/selling/v1/order_analytic.proto`), five metric messages generated from one template. Money fields `optional`; a warehouse's are unset and a sort on them refused. The reader comes from the scope: root every row, a warehouse by `warehouse_id`, anyone else by `team_id` — the team type through `TeamTypeReader`, adapted to `TeamByIds` in `backend/cmd/app_development/selling_team_types.go` |
| wiring | `selling_v1.NewAnalytic` + `NewSellingTeamTypes` in the dev server's Wire set; `selling_service.NewRegister` mounts the service and the three push routes |

```sh
go test -run 'TestOrderMetric|TestOrderStatusChange_PublishesEachMove' ./backend/services/selling_service/selling_v1/
go test -tags raceaudit -count=20 -run 'TestRace_OrderMetricFold' ./backend/services/selling_service/selling_v1/
go test -tags perfaudit -run TestPerf_OrderMetric -v ./backend/services/selling_service/selling_v1/
```

## Audits

| | |
| --- | --- |
| the fold · concurrency | ✅ safe — 40/40 at `-count=20`: eight orders into one row lose no increment, six deliveries of one event count once |
| the reads · performance | ✅ not heavy — over 100 375 rows: a seller's 30-day search 0.7 ms, a warehouse's year 2 ms, a seller's year of 8 shops × 5 metrics 7.6 ms (scope indexes); root's year by user 12.6 ms and its five summaries 29.5 ms (a scan of every row — fine now, grows with the table) |

## What does not exist yet

1. **The screen.** The five go under *Order* in `frontend/src/features/analytic/catalogue.ts`, replacing the sample
   `metrics/orders`. The screen's provider (`features/analytic/provider.ts`) is still synchronous and sample-backed for
   EVERY service — no metric reaches it through an RPC yet, `metrics/suppliers` included. Wiring means: an async
   provider on TanStack Query calling `OrderAnalyticService` for the order metrics; `team`, `warehouse` and `user` as
   groups and filters; names for real ids (`ShopByIds`, `TeamByIds`, `UserByIDs`); and dropping a column that came back
   unset for a warehouse.
2. **A backfill** of the orders placed before the fold — [are-past-orders-folded](../../business/order/order_statistic_metric_clarify.md#are-past-orders-folded), recommended, not decided.
3. **A replay and a dedup prune**, as supplier's fold has. Not asked for the order metrics.
4. **Return Arrived** counts the move into `return_completed`, which only the return accept makes — and that is not
   built ([order context](context.md)), so the metric reads zero until it is.

## Not to re-litigate

The day rule, the total, the user, the two team groups, warehouse scope and its money rule, Lost-not-Completed, and
product-to-inventory are all decided — each one is linked from the clarify's Proposed Design table.
