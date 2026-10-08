# Inventory Contexts.
**this design proposed by heri, toni have other design proposed too**

## General.
1. for restock reference, [see this](./restock.md)

## Responsbility.
1. managing stock.
2. managing restock.
3. managing return.
4. doing opname.
5. managing placements.
6. provide solid api for other service. like order for creating order.

## How We Breakdown Complexity in Inventory Service.
First, we have named `mutations`. Its collection of ready use function that acomodated batch ledger and placement ledger inside opened database transaction.

This is For Example:
```mermaid
stateDiagram-v2
direction LR

state "Api Called" as call

call-->db

db: Database Transaction
state db {
    state "Gorm Tx Object" as tx
    state "PlacementLedgerMutation" as pleg
    state "Order Function" as ord
    state "Adjust Function" as adj

    tx-->pleg: pass Tx Object as Parameter
    pleg-->ord: calling function
    pleg-->adj: calling function
}


```

## Placements.
Placement is like warehouse rack or physical placement in warehouse. like "rak 1", "rak ruang tengah" and other.

In Warehouse Team, we can:
- create placement
- update placement
- delete placement, placement can be delete if only have no stocks. And its soft delete

Placement have own ledger. [see this](./placement_ledger.md)

## Batches.
We have batch in inventory service. Because our product have different price unit across team and across time. for the reference [see this](./batch_ledger.md)




## General Table That Must Have.

3. Table `inventory_transactions`

    This table is for record all operation that happen in inventory.

    Field that must have:
    - `id` as primary key
    - `warehouse_id`
    - `team_id`
    - `tx_type`
    - `create_by_user_id`
    - `updated_at`
    - `created_at`

    Field `tx_type` contain:
    - `order`
    - `restock`
    - `return`
    - `sample`
    - `transfer_in`
    - `transfer_out`
    - `adjustment`




## Stock loss.
1. Selling Team bears the loss at receiving.
2. When Stocks already in Warehouse, and loss/opname happen, its shortfall a warehouse liability.

## How Warehouse Team Member Accept Stock / Return That Arrived
```mermaid
flowchart TD

s["Start"]
recv("Receiving Restock/Return")
check{"Check on System"}
e["End"]

s-->recv
recv-->check

check-->|found|accept("Accept Restock")
check-->|not found|report["Report Manually (Outside System)"]
accept-->fee{"Have Additional Fee"}
    fee-->|no|calcp("Calculate Unit Price")
        calcp-->checkqty{"Is Any Lost"}
    fee-->|yes|feeinp("Input Fee")
        feeinp-->calcp

checkqty-->|no|checkbroken{"Is Any Broken"}
checkqty-->|yes|lost("Input Losts")


checkbroken-->|yes|broken("Input Broken")

checkbroken-->|no|calc("Calculate valid Qty")

lost-->calc
broken-->calc
calc-->place("Set Placements")

place-->e
report-->e


```
