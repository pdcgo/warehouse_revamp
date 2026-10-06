# Restock Related.

## Restock Flow.
```mermaid
flowchart TD
s(("Start"))
e(("End"))

s-->need["Selling Team Need Restock"]
need-->wareselect["choose the warehouse"]
wareselect-->create["create restock on system"]
create-->ship["restock send to warehouse"]
ship-->wait["wait over the day"]

wait-->issent{"is restock arrived in warehouse ?"}
issent-->|yes|check["Warehouse team check the condition"]
check-->is_item_problem{"is problem happen ? (any item broken/lost)"}
is_item_problem-->|yes|additem_problem["entry problem item in restock"]
    additem_problem-->accept

is_item_problem-->|no|accept["accept the rest of good stock"]
    accept-->e

issent-->|no|isshipproblem{"is shipment problem happen / not receive forever ?"}
isshipproblem-->|yes|setlost["Selling Team set `lost`"]
    setlost-->e

isshipproblem-->|no|wait
```


## Table Should We Have.

First for restock:

1. Table `restocks`

    Field that must have:
    - `id` as primary key
    - `warehouse_id`
    - `team_id`
    - `status`, it has `ongoing`, `arrived`, `accepted`, `lost` and `cancel`
    - `shipment_cost`
    - `warehouse_additional_cost`
    - `subtotal`
    - `total`
    - `updated_at`
    - `created_at`


2. Table `restock_items`

    Field that must have:
    - `id` as primary key
    - `restock_id`
    - `product_id`
    - `supplier_channel_id`, its optionals

    - `count`
    - `price_unit`
    
    - `total`


3. Table `restock_problem_items`

    Field that must have:
    - `id` as primary key
    - `restock_id`
    - `product_id`

    - `supplier_channel_id`, its optionals

    - `problem_type`

    - `count`
    - `price_unit`
    - `total`
    - `created_at`


    Field `problem_type` is contain:
    - `broken`
    - `lost`
