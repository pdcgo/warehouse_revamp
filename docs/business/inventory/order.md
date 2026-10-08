# Order & Inventory Related.

## General.
1. for order creation in Order Context. [see this](../order/order_creation.md)

## Order Created Flow.
```mermaid
stateDiagram-v2


ordsrv: Order Service
state ordsrv {
    state "Creating Order" as ocreate
    [*]-->ocreate
    ocreate-->[*]
    
}
ocreate-->invsrv: Calling Inventory Service

invsrv: Inventory Service
state invsrv {
    state "Open Database Transaction" as otx
    state "Close Database Transaction" as ctx
    state "Inventory Transaction" as itx
    state "Batch Ledger" as bleg
    state "Placement Ledger" as pleg

    [*]-->otx

    otx-->itx: create transaction
    itx-->bleg: post in batch ledger
    itx-->pleg: post in placement ledger

    bleg-->ctx
    pleg-->ctx
    
    ctx-->[*]

}

```

