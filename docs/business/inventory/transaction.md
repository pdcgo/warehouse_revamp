# Transaction.


## General Table That Must Have.

1. Table `inventory_transactions`

    This table is for record all operation that happen in inventory.

    Field that must have:
    - `id` as primary key
    - `warehouse_id`
    - `team_id`
    - `tx_type`
    - `create_by_user_id`
    - `is_rollback`
    - `description`
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

2. Table `inventory_transaction_items`

    Field that must have:
    - `id` as primary key
    - `warehouse_id`
    - `transaction_id`
    - `quantity`
    - `total`
    - `created_at`



## Transaction Flow Related.
```mermaid
stateDiagram-v2
direction LR

state "Restock Accepted" as res
state "Order Created" as ord

state "Api" as api2
state "Order Canceled" as ordcancel


res-->rapi: call
ord-->rapi: call

rapi-->new
api2-->rollback

ordcancel-->api2

ordsrv: Order Service
state ordsrv {
    [*]-->asdasd

}

invsrv: Inventory Service
state invsrv {

    state "Restock Accepted Api" as rapi

    new: New Inventory Transaction
    state new {
        state "New Inventory Transaction" as inv
        state "Transaction Items" as item
        state "Post to Placement Ledger" as pmut
        state "Post to Batch Ledger" as bmut

        [*]-->inv: create 
        inv-->item: create items
        item-->pmut
        item-->bmut

        pmut-->[*]
        bmut-->[*] 
    }

    rollback: Rollback Inventory Transaction
    state rollback {
        state "Existed Transaction" as txexist
        state "Get Items" as ritems
        state "Post to Placement Ledger" as rpmut
        state "Post to Batch Ledger" as rbmut
        state "update field `is_rollback`" as rollfield
        state if_rollback <<choice>>
        state "Do Nothing" as nothing

        [*]-->txexist: find and lock existing Inventory Transaction

        txexist-->if_rollback
        if_rollback-->ritems: [ if not rollback ] getting item
        if_rollback-->nothing: [ if rollbacked ]

        nothing-->[*]

        ritems-->rpmut
        ritems-->rbmut

        rpmut-->rollfield
        rbmut-->rollfield

        rollfield-->[*]
    }

}




```
