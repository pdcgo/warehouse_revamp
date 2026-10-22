# Development state — warehouse

**Pass:** step 1 of the warehouse fee's five-step rollout
([the-flat-rate-is-dropped-last](../../../business/teams/warehouse/context_decision.md#the-flat-rate-is-dropped-last)), 2026-10-21 —
then steps 2 and 3, 2026-10-22 (below).
`warehouse_service` exists for the first time. Decisions: [context_decision.md](../../../business/teams/warehouse/context_decision.md).

## What exists

| | |
| --- | --- |
| service | `backend/services/warehouse_service/` — `warehouse_v1`, mounted in the dev server |
| table | `warehouse_fees` (warehouse `00001`): one row per warehouse — `fee_percent`, `min_fee`, `max_fee` NULL = no cap, never 0 |
| RPCs | `WarehouseFeeDetail` (the warehouse's own) · `WarehouseFeeSet` (an upsert, its managers) · `WarehouseFeeCalculate` (the selling team's scope, one warehouse, `FailedPrecondition` naming a warehouse with no rate) |
| screen | Settings → **Warehouse Fee**, for a warehouse team. It says the rate is not charged yet |
| docs | [database-schema.md](../../../database-schema.md#warehouse_service) · [rpc.md](../../../services/warehouse_service/rpc.md) |
| audits | concurrency safe — [lock-order](../../../../audits/services/warehouse_service/concurrency/lock-order.md), 40/40 at `-count=20`. Performance: each RPC is one query on the unique `warehouse_id` index |

```sh
go test ./backend/services/warehouse_service/...
go test -tags raceaudit -count=20 -run 'TestRace_WarehouseFeeSet|TestInterleave_WarehouseFeeSet' ./backend/services/warehouse_service/warehouse_v1/
cd frontend && npm run test:stories -- src/pages/settings
```

## Steps 2 and 3 — built 2026-10-22

| step | what exists |
| --- | --- |
| 2 | `san warehouse carry-over-fees` (and a `dev setup` step): each WAREHOUSE team's default `liability_terms` row → `0%`, floor = cap = its `handling_fee` (a 0 → `0%`, no floor, no cap); an existing rate is never replaced; idempotent. `liability_v1.DefaultHandlingFees` + `team_v1.WarehouseTeamIDs` read, `warehouse_v1.CarryOverFlatFees` writes. `seed dev` gives Dev Warehouse its own flat fee, or 2.5% / 2.000 / 20.000 without one ([docs/tools/san.md](../../../tools/san.md)) |
| 3 | `placeOrder` (OrderCreate and OrderDraftPromote) calls `WarehouseFeeCalculate` in-process on `cogs`, before its transaction, and freezes `orders.warehouse_fee` (selling `00019`); a warehouse with no rate is refused before any stock moves. The order form and the draft page price it live (`useWarehouseFeeQuote`) and keep Save / Promote off on a refusal. The Settings card's copy says new orders are priced at the fee while the ledger still posts the flat one |

⚠ **The window between 3 and 4 is real.** The order keeps the warehouse's fee; liability still posts the flat
`handling_fee` from `OrderPlaced`. For a carried-over warehouse the two are the same amount; for one that set its own
percent they differ until step 4.

⚠ **Dev DB:** only Dev Warehouse (13) had a default flat fee, so it is the only warehouse with a rate. Every other
warehouse there refuses orders until it sets one on Settings.

## Decided, not built — the rest of the rollout

| step | what |
| --- | --- |
| 4 | `OrderPlaced` carries the frozen `warehouse_fee` ([the-event-carries-the-warehouse-fee](../../../business/teams/warehouse/context_decision.md#the-event-carries-the-warehouse-fee)); liability posts it and stops reading `handling_fee` — the switch-over day |
| 5 | `liability_terms.handling_fee` dropped, with its Credit Terms field |

## Open

| | |
| --- | --- |
| the warehouse profile | does `warehouse_infos` move from team_service into this service — [does-the-warehouse-profile-move-out-of-team-service](../../../business/teams/warehouse/context_clarify.md#does-the-warehouse-profile-move-out-of-team-service) |
| rounding | when a frozen fee is rounded to whole rupiah — [rupiah-is-floating-point](../../../business/order/context_decision.md#rupiah-is-floating-point)'s mitigations are not decided |

**Next agent:** step 4 — the event field and liability's switch to it. Each step ships on its own commit; steps 1–3 are
in the working tree, uncommitted, waiting on the owner's yes.
