# Stock Design
**This is architectural design for stock related.**

## General Brief
1. In Stock there is 2 component that we track the movement.
    - stock quantity &rarr; that be `int`
    - stock valuation &rarr; that be `float64`

2. important thing component should be know in this design.


## Implementing The Ledger from [Mutation & Ledger](./mutation_and_ledger.md)
1. Because we have 2 thing that be tracked. the `state` should be have:
    - stock_balance
    - valuation_balance
2. Because we have 2 thing that be tracked. the `ledger log` should be have:
    - stock_balance_after
    - valuation_balance_after
    - stock_change
    - valuation_change

4. smallest grain that we tracked is by `batch_id`

## Flow Of Create Restock.
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
```mermaid
sequenceDiagram

participant wusr 

```


## Entity Relationship.
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

    datetime updated_at
    datetime created_at
}

ord[orders]{
    uint id "primary_key"
}

reitem[restock_items]{
    uint id "primary_key"
    uint restock_id
    datetime created_at
}


tx[inventory_transactions]{
    uint id "primary_key"
    string type "order, return, adjustment, transfer_in, transfer_out, broken, and lost"
    datetime created_at
}

bch[batches]{
    uint id "primary_key"
}


re|o--o|tx : ""
ord|o--o|tx : "one to one"
re||--|{reitem : "many of"

```

## Batch
Batch is usefull data table for how we provisioning stock later.


