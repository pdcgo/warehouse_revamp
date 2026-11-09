# warehouse_service — RPC flows

warehouse_service owns what a warehouse charges per order, and nothing else
([warehouse-prices-balance-records](../../business/teams/warehouse/context_decision.md#warehouse-prices-balance-records)): the
fee configuration and its calculation. It never posts, never records, and never knows an order exists.

## Pricing an order — `WarehouseFeeCalculate`

One warehouse per call ([the-fee-is-priced-one-warehouse-at-a-time](../../business/teams/warehouse/context_decision.md#the-fee-is-priced-one-warehouse-at-a-time)).
The ordering team is the permission scope only; the rate never depends on it
([one-rate-per-warehouse](../../business/teams/warehouse/context_decision.md#one-rate-per-warehouse)).

```mermaid
sequenceDiagram
    autonumber
    participant C as the order form, and order create - as the selling team
    participant W as WarehouseFeeCalculate
    participant DB as warehouse_fees
    participant T as team_service

    C->>W: team_id, order_total (the goods_cost), warehouse_id
    W->>DB: the warehouse's row, by its unique warehouse_id
    alt no row - the warehouse never set its fee
        W->>T: TeamByIds - the warehouse's name, as the caller
        W-->>C: FailedPrecondition - Gudang A has not set its fee
    else a rate
        W->>W: clamp(goods_cost x percent / 100, floor, cap) - no cap when the cap is empty
        W-->>C: the fee, and the percent, floor and cap it used
    end
```

| | |
| --- | --- |
| the formula | `max(goods_cost × fee_percent / 100, min_fee)`, then `min(…, max_fee)` only when a cap is set ([an-empty-cap-means-no-cap](../../business/teams/warehouse/context_decision.md#an-empty-cap-means-no-cap)) |
| no rate | `FailedPrecondition`, naming the warehouse — never a number ([a-warehouse-with-no-rate-takes-no-orders](../../business/teams/warehouse/context_decision.md#a-warehouse-with-no-rate-takes-no-orders)). `0%` is a rate and prices to 0 (or the floor) |
| the name | team_service's `TeamByIds`, through a client forwarding the caller's token. If the name cannot be had, the refusal says `warehouse <id>` rather than failing |
| rounding | none: when a frozen figure is rounded is not decided ([rupiah-is-floating-point](../../business/order/context_decision.md#rupiah-is-floating-point)) |
| who calls it | the order form, while the order is typed, and **order create**, which freezes the answer as `orders.warehouse_fee` and passes a refusal through — step 3 of [the-flat-rate-is-dropped-last](../../business/teams/warehouse/context_decision.md#the-flat-rate-is-dropped-last), see [selling's flow](../selling_service/rpc.md). `OrderPlaced` carries the frozen answer and the ledger posts it (step 4) |
| where the rates came from | each warehouse's own `WarehouseFeeSet`. Before step 5 dropped the flat fee, step 2's carry-over (`san warehouse carry-over-fees`, removed with it) turned each warehouse's default flat fee into a rate — 0%, floor = cap = the fee ([docs/tools/san.md](../../tools/san.md#warehouse-carry-over-fees)). `san seed dev` gives Dev Warehouse the worked example when it has none |

`WarehouseFeeDetail` and `WarehouseFeeSet` are single-table reads and an upsert, and need no flow here.

## The closed-day warning — `WarehouseReceivingStatus`

The warehouse profile — both weekly grids, the location, the one-off closures — is this service's
([the-warehouse-profile-lives-in-warehouse-service](../../business/teams/warehouse/context_decision.md#the-warehouse-profile-lives-in-warehouse-service)). The order form asks, for the warehouse on screen,
whether it receives orders NOW; a closed one is MARKED and the order is created as usual
([a-closed-day-warns-and-never-refuses](../../business/teams/warehouse/context_decision.md#a-closed-day-warns-and-never-refuses)).

```mermaid
sequenceDiagram
  participant UI as the order form
  participant W as warehouse_service
  participant DB as warehouse_infos, warehouse_closures
  UI->>W: WarehouseReceivingStatus — the warehouse ids on screen
  W->>DB: the receiving grids, and the closures whose last day is today or later
  W->>W: now in Asia/Jakarta — in a closure? inside today's slot?
  W-->>UI: per warehouse — receiving now, or the next opening and the closure's reason
  UI->>UI: a warning under the picker, a Closed badge on the option — Save stays on
```

| | |
| --- | --- |
| in a closure today | closed, its reason, and the first slot of the grid after every closure day |
| inside today's slot | receiving now — `open_time` inclusive, `close_time` exclusive |
| otherwise | closed, and the next slot that falls on no closure day — within 60 days, else none |
| refuses | nothing — no order is ever refused for the hours |
