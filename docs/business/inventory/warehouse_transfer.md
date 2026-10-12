# Warehouse Transfer.


## Table Should Have in Warehouse Transfers.

1. Table `warehouse_transfers`

    Field that must have:
    - `id` as primary key
    - `team_id`
    - `from_warehouse_id`
    - `to_warehouse_id`
    
    - `finance_account_id`
    - `shipment_id`
    - `shipment_cost`
    - `warehouse_additional_cost`
    
    - `receipt`, optional
    - `receipt_file`, optional
    

    - `inbound_transaction_id`
    - `outbound_transaction_id`
    - `status`
    - `note`
    - `total`
    - `updated_at`
    - `created_at`

    Inside `status`:
    - `created`
    - `shipped`
    - `process`
    - `arrived`
    - `accepted`
    - `cancel`
    - `lost`

2. Table `warehouse_transfer_items`
    - `id` as primary key
    - `transfer_id`
    - `product_id`
    - `count`
    - `price_unit`
    - `total`
    - `created_at`


3. Table `warehouse_transfer_problem_items`

    Field that must have:
    - `id` as primary key
    - `transfer_id`
    - `product_id`

    - `problem_type`
    - `note`
    - `count`
    - `price_unit`
    - `total`
    - `created_at`


    Field `problem_type` is contain:
    - `broken`
    - `missing`


## Warehouse Transfer Flow.
```mermaid
stateDiagram-v2
direction LR

state "Selling Need Rebalance Stock on Their Region/Place" as rebal
state "New Transfer" as ctransf

rebal-->ctransf: create new Transfer, Warehouse A to Warehouse B
ctransf-->ware

ware: Warehouse Team A
state ware {
    state "New Transfer" as nw

    [*]-->nw
    nw-->process
    process-->shipped

    shipped-->[*]
}

ware-->wareb

wareb: Warehouse B
state wareb {
    state "New Transfer" as nwb
    state "Wait Shipped" as wait

    [*]-->nwb
    nwb-->wait
    wait-->accepted
}

```