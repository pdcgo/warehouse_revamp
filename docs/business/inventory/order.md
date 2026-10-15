# Order & Inventory Related.

## General.
1. for order creation in Order Context. [see this](../order/order_creation.md)


## Inventory Service Flow When Order Created Called Our `OrderTransactionCreate`
### Reference.
1. for order side reference. [see this](../order/order_creation.md)

### What We Should Check When `OrderTransactionCreate` Called.
1. Product is Private.
2. Product Reserved Stock.

### Flow.
```mermaid

stateDiagram-v2

direction LR

state "`OrderTransactionCreate` Called" as rpc
state "Product Service" as prod
state "Product Not Allowed" as perr
state pcheck_if <<choice>>
state icheck_if <<choice>>
state "Refuse Because its Already Created" as existtx

[*]-->rpc
rpc-->idemcheck


state idemcheck {
    state "Try Get Transaction with Idempotency Key" as invcheck
    [*]-->invcheck
    invcheck-->[*]
}

idemcheck-->icheck_if
icheck_if-->prodcheck: inventory_transaction not exist
icheck_if-->existtx: inventory_transaction exist
existtx-->[*]


prod-->prodcheck: give product configuration, reserved stock / product private
prodcheck: Product Checking
state prodcheck {

    state "Check Product Not Private" as checkp
    state "Check Reserved Stock" as checkre
    [*]-->checkp

    checkp-->checkre
    checkre-->[*]
}

prodcheck-->pcheck_if
pcheck_if-->tx: yes, Open Transaction
pcheck_if-->perr: no, Return Error
perr-->[*]




tx: Database Transaction
state tx {
    
    state "Inventory Transaction" as itx
    state "Batch Ledger" as bleg
    state "Placement Ledger" as pleg



    otx-->itx: create transaction
    itx-->bleg: post in batch ledger
    itx-->pleg: post in placement ledger

    bleg-->ctx
    pleg-->ctx
    

}

tx-->[*]

```





## How Warehouse Process The Order.
```mermaid
stateDiagram-v2
direction LR

sell: Selling Team
state sell {

    state "New Order" as nord

    [*]-->nord
    nord-->[*]

}

sell-->ware

ware: Warehouse Team
state ware {

    state "Order Processed" as confirm
    state "Staff Picking Goods" as pick
    state "Staff Scan Goods for verify" as scan
    state "Order Packing Completed" as pack
    state "Order Shipped" as shipped

    [*]-->confirm: Staff confirming order, change order status and print receipt
    confirm-->pick
    pick-->scan
    scan-->pack: staff start packing
    pack-->shipped: wait courrier pickup, before give to courrier, staff scan to change shipped
}

```



