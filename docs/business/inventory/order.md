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
    direction LR

    [*]-->confirm: Staff confirming order, change order status and print receipt

    confirm: Order Processed
    state confirm{
        state "Open Web" as copen
        state "print `receipt_file` on order" as cprint
        state "Order set Processed" as cprocess

        [*]-->copen
        copen-->cprint
        cprint-->cprocess
        cprocess-->[*]
    }

    confirm-->picked: Staff Start Picking The goods and verify to picked

    picked: Order Picked Process
    state picked {
        state "All Goods Taken From Placement" as taken
        state "Order Picked Verification Page" as feopen 
        state "Update What Picked In Order" as pscan
        state "All Picked" as allp
        state "Set Picked" as ppick

        [*]-->taken: start walk and taking goods from placement and bring `receipt_file`
        taken-->feopen: opening order detail page. ussualy for fast, staff scan `receipt_file`
        feopen-->pscan: Staff scan label in each goods taken. and update in fe view
        pscan-->allp: ensure all picked
        allp-->ppick: change order status
        ppick-->[*]
    }

    picked-->packed

    packed: Packing Process
    state packed{

        state "Parcel Packed" as ppacked
        [*]-->ppacked: start packed goods and attach / gluing `receipt_file` that printed to parcel
        ppacked-->[*]
    }
    
    packed-->shipping: wait courrier pickup, before give to courrier, staff scan to change shipped

    shipping: Order Shipping
    state shipping {
        state "Courrier Arrived" as arrived
        state "Order Shipping" as sship
        state "Parcel Taken By Courrier" as staken

        [*]-->arrived: Waiting courrier arrived.
        arrived-->sship: scan parcel and change order status to shipping
        sship-->staken: Give Courrier

        staken-->[*]

    }

    shipping-->[*]

}

```




