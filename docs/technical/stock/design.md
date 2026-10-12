# Stock Design
**This is architectural design for stock related.**

## General Brief
1. In Stock there is 2 component that we track the movement.
    - stock quantity &rarr; that be `int`
    - stock valuation &rarr; that be `float64`
2. The reason valuation used `float64` is because later in [cogs Price](#cogs-price-of-stock) there is additional price that calculate and divided by quantity. for comparing between `float64` we use 4 digit precision.


## Implementing The Ledger from [Mutation & Ledger](../ledger/mutation_and_ledger.md) on Stocks.
1. Because we have 2 thing that be tracked. the `state` should be have:
    - stock_balance
    - valuation_balance
2. Because we have 2 thing that be tracked. the `ledger log` should be have:
    - stock_balance_after
    - valuation_balance_after
    - stock_change
    - valuation_change

4. smallest grain that we tracked is by `batch_id`
5. table `batches` is used of the ledger as `state` with field:
    - stock_balance
    - valuation_balance
6. for the `ledger log`, we table `batch_logs`.


## Flow Of Create Restock.
1. its okay upsert to `warehouse_products` without transaction. its not critical ops.
```mermaid
sequenceDiagram

participant pub as Pub/Sub

participant susr as Selling User

box Backend
participant inv as Inventory Service RPC
participant mut as Restock Mutation
end



box Database
    participant wp as Warehouse Product Table
    participant re as Restock Table
    participant db as Database
end

susr->>+inv: create restock
inv->>+wp: upsert product
wp-->>-inv: upsert success

inv->>+mut: create restock mutation

    mut->>+db: Open Transaction
    mut->>+re: insert data
    re-->>-mut: insert data success
    db-->>-mut: Close Transaction

mut-->>inv: return restock id
inv->>pub: send event create restock

inv-->>-susr: create restock success

```


## Flow Of Accept Stock.
Guideline for accepting stock:
1. there is no unplaced goods, we enforce goods to be placed in placements. so when accepting we already decided where goods to be placed.

```mermaid
sequenceDiagram

participant pub as Pub/Sub

participant wusr as Warehouse User

box Backend
    participant inv as Inventory Service RPC
    participant plmut as Placement Mutation
    participant stmut as Restock Accept Mutation
end

participant db as Database

wusr->>+inv: Accept Stock
inv->>+db: Open Database Transaction

    inv->>+plmut: add placement
    plmut-->>-inv: placement success

    inv->>+stmut: stock mutation
    stmut-->>-inv: stock mutation

db-->>-inv: Close Database Transaction

inv->>pub: send event
inv-->>-wusr: Accept Stock Success

```

## COGS Price of Stock.
Component that COGS Price is Constructed.
- product unit price.
- shipping fee.
- warehouse_ops_fee.

So COGS is:
```math
COGSPrice = ProductUnitPrice + ((ShippingFee + WarehouseOpsFee) / ProductQtyCount)
```
This COGS price is using to unit price in `batches` table.


## Stock Entity Relationship.
1. `warehouse_transfer_teams` table is just dictionary. So we can query in `owner_team_id` side.
```mermaid
erDiagram

wp[warehouse_products]{
    uint id "primary_key"
    uint warehouse_id "this unique (warehouse_id, product_id)"
    uint product_id "this unique (warehouse_id, product_id)"
    uint owner_team_id "this owner team of the product, (its selling team)"
    datetime created_at
}

re[restocks]{
    uint id "primary_key"
    uint owner_team_id "this owner team of the product, (its selling team)"
    uint warehouse_id
    uint inventory_transaction_id

    float64 total
    datetime updated_at
    datetime created_at
}

reitem[restock_items]{
    uint id "primary_key"
    uint restock_id
    uint product_id
    int quantity
    float64 unit_price
    float64 total
    datetime created_at
}

recost[restock_cost_detail]{
    uint id "primary_key"
    uint restock_id
    float64 shipping_fee
    float64 warehouse_ops_fee
    datetime created_at
}

ord[orders]{
    uint id "primary_key"
    uint owner_team_id "this owner team of the product, (its selling team)"
    uint warehouse_id
    uint inventory_transaction_id
}






tx[inventory_transactions]{
    uint id "primary_key"
    string type "order, return, adjustment, transfer_in, transfer_out, broken, and lost"
    string status
    datetime created_at
}

bch[batches]{
    uint id "primary_key"
    uint owner_team_id "this owner team of the product, (its selling team)"
    uint warehouse_id
    uint product_id
    uint inventory_transaction_id

    int stock_balance
    float64 valuation_balance 
    float64 unit_price "unit price is COGS Price that calculated in accept stock"
    
    int stock_accepted_qty "this just record qty when restock accepted and not change again"
    float64 stock_accepted_valuation "this just record valuation when restock accepted and not change again"
    datetime updated_at
    datetime created_at
}

bclog[batch_logs]{
    uint id "primary_key"
    uint batch_id
    uint inventory_transaction_id

    int stock_change
    float64 valuation_change

    int stock_balance_after
    float64 valuation_balance_after

    string reason

    datetime updated_at
    datetime created_at

}

tf[warehouse_transfers]{
    uint id "primary_key"
    uint from_warehouse_id
    uint to_warehouse_id
    uint dispath_inventory_transaction_id
    uint accept_inventory_transaction_id
    

    string status
    
    
    datetime created_at
}

tft[warehouse_transfer_teams]{
    uint id "primary_key"
    uint transfer_id
    uint owner_team_id
}

re|o--o|tx : "zero or one"
ord|o--o|tx : "zero or one"
re||--|{reitem : "many of"
tx||--|{bch : "many of"
tx||--o{bclog : "none or many of"
bclog}|--||bch : "many of many"
recost||--||re : "one of one"
tf||--|{tx : "for dispatch inventory transaction and accept inventory transaction"


```

## Inventory Transaction Cancelation.
This is flow how transaction to be canceled. this is simplified, locking and open database not included. its just explain how writing data cancel accros table.

```mermaid
sequenceDiagram
participant usr as Warehouse User
participant tx as Inventory Transaction
participant log as Batch & Placement Log

usr->>+tx: create transfer transaction
tx->>+log: writing log
log-->>-tx: writing success
tx-->>-usr: create success

Note over usr,tx: Human Error Happen

usr->>+tx: getting tx info
tx-->-usr: result
usr->>+log: getting log
log-->-usr: result

usr->>+tx: update status
tx-->>-usr: update success


usr->>+log: writing rollback on log as append
log-->>-usr: write success

```



## Batch
Batch is usefull data table for how we provisioning stock later.

# Placements Design.
Placement is hold where quantity goods that have been places. For example this Product A placed in two rack, first `Rack A` with qty `90` and `Rack B` with qty `23`.

## General Brief
1. In Placement there is 1 component that we track the movement.
    - stock quantity product on rack &rarr; that be `int`

## Implementing The Ledger from [Mutation & Ledger](../ledger/mutation_and_ledger.md) on Placements.
1. Because we have qty that be tracked. the `state` should be have:
    - qty_balance
2. Because we have qty that be tracked. the `ledger log` should be have:
    - qty_balance_after
    - qty_change

3. for the state we use table `product_placements`.

4. smallest grain that we tracked is by `(placement_id, product_id)` and that must composite unique.
5. for the `ledger log`, we table `placement_logs`.


## Entity Relationship.
1. We stop using term `rack` we use new term `places`. In practical its same, its just physical rack inside warehouse building.
2. `inventory_transactions` table is same table on [Stock ERD](#stock-entity-relationship).
3. when placement deleted, `code` is updated to `[code]_[unix_timestamp_second]`

```mermaid
erDiagram



pl[places]{
    uint id "primary_key"
    uint warehouse_id
    string code "composite unique with warehouse_id"
    string name
    
    bool is_deleted
    datetime updated_at
    datetime created_at
}

pst[product_placements]{
    uint id "primary_key"
    uint placement_id
    uint product_id
    
    int qty_balance

    datetime updated_at
    datetime created_at
}

pllog[placement_logs]{
    uint id "primary_key"
    uint placement_id
    uint inventory_transaction_id
    
    int qty_change
    int qty_balance_after

    datetime created_at
}

tx[inventory_transactions]

pl||--|{pst : "one to many"
pl||--o{pllog : "none or one to many"
tx||--o{pllog : "none or one to many"



```

## How We Moving Goods Between Placements [incomplete].
```mermaid
sequenceDiagram

participant pub as Pubsub

participant usr as Warehouse User
participant srv as Service RPC
participant mut as Move Mutation

box Database
participant db as Database
end

usr->>+srv: Move Product A in Place 1 to Place 2, with Qty 20
srv->>+db: Open Transaction
    srv->>+mut: create session handler that suply


db-->>-srv: Close Transaction
srv->>pub: Send Event

srv-->>-usr: Move Success

``` 
