# Development state — order

**Pass:** `implementation` + `technical_test` + `Audit RPC` (2026-10-21) — the build that follows the order context's
design closing. Four slices, built together at the owner's ask: **the eleven statuses with one status move**, **root
reads every team's orders**, **settlement listens to the order events** (and the emulator pushes locally), and **the
return warehouse's table and screen**. Decisions: [context_decision.md](../../business/order/context_decision.md) — the
order context has **nothing open, critiqued, contradicted or awaiting**.

## What exists

| | |
| --- | --- |
| statuses | `OrderStatus` is the eleven: pending · processed · picked · shipping · shipped · completed · problem · lost · return · return_completed · cancel — numbers kept aligned with the old six, `4` reserved. Selling `00015` moved every order and history row (`placed → pending`, `confirmed`/`picking → processed`, `packed → picked`, `shipped → shipping`, `cancelled → cancel`). Selling `00017` then replaced `order_events` with the owner's `order_timeline_logs` (status, note, `from` warehouse/selling, actor) — [order-timeline-logs-replaces-order-events](../../business/order/context_decision.md#order-timeline-logs-replaces-order-events); nothing carried over, and nothing writes a note-only row yet |
| the move | `OrderStatusChange(team_id, order_ids 1–200, to, note)` — one per-order result, the table `orderMoves` (from → to → which side), a note required back to pending, the whole batch saved in one transaction of four statements locked in id order ([a-batch-move-saves-in-one-transaction](../../technical/frontend/warehouse_order_list_decision.md#a-batch-move-saves-in-one-transaction)). Cancel (`OrderCancel`, pending only) and the return accept keep their own RPCs. `OrderConfirm` · `OrderPick` · `OrderPack` · `OrderShip` are removed ([one-status-change-for-every-plain-move](../../technical/frontend/warehouse_order_list_decision.md#one-status-change-for-every-plain-move)) |
| list filters and row | `OrderListFilter` and `OrderStatFilter` gained `seller_team_id`, `marketplace`, `shipping_code`; `Order.item_quantity` is summed by the list query; `ShopByIds` names shops across teams — [the-filter-gains-seller-marketplace-and-courier](../../technical/frontend/warehouse_order_list_decision.md#the-filter-gains-seller-marketplace-and-courier), [the-warehouse-row-fills-from-shop-and-user-by-ids](../../technical/frontend/warehouse_order_list_decision.md#the-warehouse-row-fills-from-shop-and-user-by-ids). The seller list's strip is **10** parts, the warehouse list's **6** |
| export | `OrderExport`, a server stream: the list's filter and tab (or the warehouse bar's ticked rows, `order_ids`), the reader's columns, .xlsx with ids and phones as text, stored as a private `order_export` document (document `00008`) as the caller, an expiring link — [one-export-is-the-list-as-a-file](../../technical/frontend/warehouse_order_list_decision.md#one-export-is-the-list-as-a-file), flow in [rpc.md](../../services/selling_service/rpc.md#the-list-as-a-file--orderexport). Only real data: no invented tracking number, MP date or deadline |
| root | `OrderList` / `OrderDetail` drop the team clause for the root team (`readsEveryTeam`) |
| settlement | `OrderPlaced` carries `shop_id` + `marketplace_total`, `OrderCancelled` carries `shop_id`; settlement's `OrderSaleHandler` opens and cancels the sale, idempotent on its key. Selling no longer calls settlement |
| local events | the emulator pushes to `:8080` (project `warehouse-dev`) and to the e2e's `:8081` (`warehouse-e2e`) — [the-emulator-pushes-locally](../../technical/event_architecture/context_decision.md#the-emulator-pushes-locally) |
| return warehouse | selling `00016` `team_return_configurations` · `TeamReturnConfigurationService` (`Detail`, `Set` — an upsert, no clear, `ByIds` — root's) · Settings → **Return Warehouse** card (a selling team's managers) · root's Teams list badges each selling team with none. Team `00009` dropped `team_infos.return_warehouse_id` / `return_user_id`, proto fields 6–7 reserved |
| colours | every status's hue is the owner's: picked sky, shipping cyan, return red, return_completed pink decided 2026-10-21 ([shipping-is-cyan-and-picked-is-sky](../../technical/frontend/order_list_decision.md#shipping-is-cyan-and-picked-is-sky), [pink-follows-retur-diterima-to-return-completed](../../technical/frontend/order_list_decision.md#pink-follows-retur-diterima-to-return-completed)) |
| frontend | one tab per status plus All, one stage per status (`features/orders/stages.ts`), the 6-step stepper, the timeline's notes and *handed back*, the warehouse workbench's four steps (`pages/pick-queue-next/steps.ts`), batch handover through the one RPC |
| dev DB | migrated 2026-10-21 (team 9, selling 16): 2 pending, 1 shipping, 1 cancel. **No team has a return warehouse yet** |

```sh
go test ./backend/services/selling_service/... ./backend/services/settlement_service/... ./backend/services/team_service/...
go test -tags raceaudit -count=20 -run 'TestRace_OrderStatusChange|TestInterleave_OrderStatusChange|TestRace_TeamReturnConfigurationSet|TestInterleave_TeamReturnConfigurationSet' ./backend/services/selling_service/selling_v1/
go test -tags perfaudit -run 'TestPerf_OrderStatusChange|TestPerf_OrderList_Root|TestPerf_TeamReturnConfiguration' -v ./backend/services/selling_service/selling_v1/
cd frontend && npx playwright test e2e/orders.spec.ts      # 19 pass, 2 skipped (as before)
```

## Audits

| RPC | result |
| --- | --- |
| `OrderStatusChange` · concurrency | ✅ safe — 140/140 at `-count=20`, the interleave shows the row lock holding and B re-reading; re-run 80/80 on the one-transaction save ([lock-order](../../../audits/services/selling_service/concurrency/lock-order.md)) |
| `TeamReturnConfigurationSet` · concurrency | ✅ safe — the first set's phantom insert is serialised by the unique index, proved by interleave |
| `OrderStatusChange` · performance | ✅ [resolved](../../../audits/services/selling_service/performances/OrderStatusChange.md) — was 4 queries per order, 248 ms for 200; the owner took the set-based save: **4 queries, 11 ms** for 200 |
| `OrderList` (root) · performance | 🟡 [heavy by the rule](../../../audits/services/selling_service/performances/OrderList.md) — the total seq-scans the table, 5 ms at 50 000. Accept until ~500 000 |
| `TeamReturnConfigurationDetail` · `Set` · performance | 1 query each, under 1 ms over 10 000 rows — not heavy |

## Decided, not built

| | |
| --- | --- |
| the create check for a return warehouse | rollout steps **2** (each team sets its own — [each-team-sets-its-own-return-warehouse](../../business/order/context_decision.md#each-team-sets-its-own-return-warehouse)) and **3** (create refuses a team without one) — [create-refuses-a-team-with-no-return-warehouse](../../business/order/context_decision.md#create-refuses-a-team-with-no-return-warehouse). Step 1 is this pass |
| the return accept | `return → return_completed`, its own RPC — refused by `OrderStatusChange` today. Its inventory half is [return.md](../../business/inventory/return.md)'s brief |
| the total-required create check | [platform-total-is-required-at-finalize](../../business/order/context_decision.md#platform-total-is-required-at-finalize) — until it lands, settlement's handler skips a total of 0 |

## Asks for a yes

| | |
| --- | --- |

## Traps this pass walked into

| | |
| --- | --- |
| a dev and an e2e server on one emulator project | each got the other's orders pushed into its database. Fixed by a project each |
| a server bound to loopback in CI | the emulator's container cannot push to it. CI binds `E2E_API_ADDR=0.0.0.0:8081` |
| `-g` on the serial `orders.spec.ts` | skips the setup that creates the warehouse, so a later test fails on `undefined`. Run the whole file |
| the e2e and the race/perf audits share `warehouse_test` | the e2e drops it at the end. Never run them at once |

**Next agent:** step 2 of the return rollout is the teams' own — each sets its return warehouse on Settings, no backfill
([each-team-sets-its-own-return-warehouse](../../business/order/context_decision.md#each-team-sets-its-own-return-warehouse)).
Step 3 is one check before the create's transaction, turned on once root's Teams list shows no *No return warehouse*
badge ([root-sees-which-teams-have-no-return-warehouse](../../business/order/context_decision.md#root-sees-which-teams-have-no-return-warehouse)).
