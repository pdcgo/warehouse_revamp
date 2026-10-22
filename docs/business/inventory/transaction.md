# Transaction.


## General Table That Must Have in Transaction.

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
    - `revaluation`
    - `problem`
    - `found`
    - `move`

2. Table `idempotency_order_check`
    Field that must have:
    - `id` as primary key
    - `idempotency_key`, its unique
    - `transaction_id`


3. Table `inventory_transaction_items`

    Field that must have:
    - `id` as primary key
    - `warehouse_id`
    - `transaction_id`
    - `product_id`
    - `product_team_id`
    - `is_owned`
    - `quantity`
    - `total`
    - `created_at`

### Field `product_team_id` and `is_owned`
1. Its extra data for giving info that that product is shared/cross


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
        state "Post to Placement Ledger" as rpmut
        state "Post to Batch Ledger" as rbmut
        state "update field `is_rollback`" as rollfield
        state if_rollback <<choice>>
        state mut_fork <<fork>>
        state "Do Nothing" as nothing
        state "Placement Log" as plog
        state "Batch Log" as blog

        [*]-->txexist: find and lock existing Inventory Transaction

        txexist-->if_rollback
        if_rollback-->mut_fork: [ if not rollback ] getting item
        if_rollback-->nothing: [ if rollbacked ]

        nothing-->[*]

        mut_fork-->plog: getting placement log by inventory_transactions.id
        plog-->rpmut: rollback invert
        mut_fork-->blog: getting batch log by inventory_transactions.id
        blog-->rbmut: rollback invert
        rpmut-->rollfield
        rbmut-->rollfield

        rollfield-->[*]
    }

}




```
