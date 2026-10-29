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
| 3 | `placeOrder` (OrderCreate, which a draft's Promote now is) calls `WarehouseFeeCalculate` in-process on `cogs`, before its transaction, and freezes `orders.warehouse_fee` (selling `00019`); a warehouse with no rate is refused before any stock moves. The order form and the draft page price it live (`useWarehouseFeeQuote`) and keep Save / Promote off on a refusal. The Settings card's copy says new orders are priced at the fee while the ledger still posts the flat one |

~~⚠ **The window between 3 and 4 is real.**~~ Closed by step 4 below.

## Step 4 — built 2026-10-29, the switch-over

| | |
| --- | --- |
| the event | `OrderPlaced.warehouse_fee` (`optional double`, 12) = `orders.warehouse_fee` as stored, set by `placeOrder`'s publish |
| liability | `chargeWarehouseFee` posts it as the `ORDER_FEE`, rounded half-up once (its entries are `BIGINT`, as the product fee and courier charge already round). Unset (an order before `00019`) and 0 post nothing. `chargeHandlingFee` and `termsFor` are gone — **`liability_terms.handling_fee` is read only by step 2's carry-over now** |
| screens | Credit Terms: the handling fee's help says it is no longer charged. Warehouse Fee card: *not charged yet* → an order keeps the fee it was placed at (`warehouse-fee-frozen`) |
| tests | `TestOrderCreate_TheEventCarriesTheFrozenWarehouseFee`; liability's order-fee tests now read the fee from the order, `TestChargeOrder_TheFlatRateIsNoLongerRead` pins the switch-over, plus `NoFrozenFeeChargesTheWarehouseNothing` and `AZeroFeePostsNothing` |
| audits | no new lock, no new statement — one FEWER (the terms read is gone); the posting path and its idempotency key are unchanged |

⚠ **Dev DB:** only Dev Warehouse (13) had a default flat fee, so it is the only warehouse with a rate. Every other
warehouse there refuses orders until it sets one on Settings.

## Decided, not built — the rest of the rollout

| step | what |
| --- | --- |
| 5 | `liability_terms.handling_fee` dropped, with its Credit Terms field |

## Open

| | |
| --- | --- |
| the warehouse profile | does `warehouse_infos` move from team_service into this service — [does-the-warehouse-profile-move-out-of-team-service](../../../business/teams/warehouse/context_clarify.md#does-the-warehouse-profile-move-out-of-team-service) |
| rounding | when a frozen fee is rounded to whole rupiah — [rupiah-is-floating-point](../../../business/order/context_decision.md#rupiah-is-floating-point)'s mitigations are not decided |

**Next agent:** step 5 — drop `liability_terms.handling_fee` (a liability migration, the proto fields reserved, the Credit
Terms field). ⚠ Step 2's carry-over (`san warehouse carry-over-fees`, a `dev setup` step, `liability_v1.DefaultHandlingFees`)
reads that column, so it goes with it, and [docs/tools/san.md](../../../tools/san.md) with it. The terms log keeps
`old_/new_handling_fee` as history. Each step ships on its own commit.
