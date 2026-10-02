# Order Return Flow.

## General.
1. Team Selling Have Order Return Warehouse Location Configuration.
2. if Order Return Warehouse Location not configured, Selling Team Cannot Create Orders.

## Table Must Have.
1. `team_return_configurations`.

    that have fields:
    - `id` primary key
    - `team_id`, its unique.
    - `warehouse_id`

2. `product_return_maps`

    that have fields:
    - `id` primary key
    - `team_id`, team that have map
    - `shared_product_id`, composite unique with `to_product_id`, shared/cross product 
    - `own_product_id`, product id that owned by `team_id`
    - `warehouse_id`
    - `updated_at`
    - `created_at`


## Order Return Flow.
```mermaid
flowchart TD

s(("Start"))
e(("End"))


s-->rethappen["Order Return Happen"]

rethappen-->retconf["Get Team Return Configuration"]
retconf-->|set `warehouse_id`|invpay["Inventory Transaction Create Payload"]
retconf-->iscross{"Is Product Shared/Cross"}

subgraph "Iterate Over Order Item"
    
    iscross-->|no|setretconf["Set Team Return Configuration, `warehouse_id` from order."]
        setretconf-->itemlist

    iscross-->|yes|prodlink["Get Product Map"]
    prodlink-->ismapped{"is cross product mapped"}
    

    ismapped-->|no|clone["Clone Product"]
        clone-->mapadd["Add Product Map"]

    
end

mapadd-->|add to item list payload |itemlist["Item List Payload"]
ismapped-->|yes, add to item list payload|itemlist
itemlist-->invpay

invpay-->calinv["Call Inventory Service to Create Return Transaction"]
calinv-->change["Change Order Status"]
change-->e


```

## Who Change The Returns.
```mermaid
flowchart TD

s(("Start"))
e(("End"))


s-->rethappen["Order Return Happen"]
rethappen-->cs["Customer Service Notice First"]
rethappen-->ware["Warehouse Person Receive Packet First"]

cs-->retcreate["Order Change to Return by cs"]
retcreate-->wait["Waiting Warehouse Person Accept"]
wait-->accept["Warehouse Person Accepting Return"]

ware-->search{"Warehouse Search Order"}
search-->|order status already return|accept
search-->|order status not return|force["Warehouse Force Order To Return"]
force-->accept

accept-->e

```

