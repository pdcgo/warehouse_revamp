# Order Context.

## General.
1. for order settlement, its follow [this](../settlement/context.md).

## Whats Order Responsbility And Not.
### Responsbility.
1. Manage Orders.
2. Manage Draft Orders.

### Whats Not.
1. The Cash, about withdrawal & platform wallet. we separate in other service. for now its defer development, we think later.
2. The debt related shared/cross product. we dont manage it. we just send it as event and other service handle it.

## Order Anatomy.
when order created. its bring 4 things.
1. Shop Related.
2. Warehouse Related.
3. Marketplace Order Info Related.
4. Product Related.

## Table That Must Have.
1. `orders`,

    field that must have:
    - `id`, primary key
    - `order_external_ref_id`, its for order uniqueness, its cannot empty
    - `shop_id`
    - `status`
    - `marketplace_type`
    - `warehouse_fee`
    - `receipt`
    - `receipt_file`


2. `order_drafts`,

    field that must have:
    - `id`, primary key
    - `order_external_ref_id`, its for order uniqueness, its cannot empty
    - `shop_id`
    - `marketplace_type`

### Order Status.
1. Status That Existed.
    - `cancel`
    - `pending`
    - `processed`
    - `shipped`
    - `completed`
    - `problem`
    - `lost`
    - `return`

2. Status Move.
    ```mermaid
    stateDiagram-v2

    pending-->cancel
    pending-->processed
    processed-->cancel
    processed-->shipped
    shipped-->completed
    shipped-->problem
    problem-->completed
    problem-->lost
    problem-->return
    shipped-->lost
    shipped-->return
    completed-->return
    ```

    

## How We Manage Order Uniqueness.
1. Order uniqueness manage by code.
2. Unique Scope by `order_external_ref_id` + `shop_id`

    ```mermaid
    flowchart TD
    
    s(("Start"))
    e(("End"))

    s-->ordcreate["Order need Create"]
    ordcreate-->refcheck{"is `order_external_ref_id` exist ?"}
    refcheck-->|no|created["Order Created"]
    refcheck-->|yes|fetch["Fetch existing order with `order_external_ref_id` that not canceled"]

    fetch-->iscancel{"Is Existing Order Cancel"}
    iscancel-->|no|created
    iscancel-->|yes|deny["Deny Order Create"]

    deny-->e
    created-->e
    ```

## How Order Enter Our System.
1. Order Draft is stored to another place. not in table `orders` but in `order_drafts`
```mermaid
stateDiagram-v2
    state "Unrecorded New Order" as new
    state "External App" as external
    state "New Order Created" as new_order
    state "Cs Manual Check Platform" as manual_check
    state "Drop Draft" as drop_draft
    state review <<choice>>

    [*]-->new

    new-->external
    new-->manual_check
    external-->draft: call by external app by rpc
    manual_check-->new_order: Create Manually By Cs

    draft-->review
    review-->new_order: Cs Review And Accept
    review-->drop_draft: Cs Review And Drop Draft
    new_order-->[*]
    drop_draft-->[*]
    
```

## Cross Product Feature.
### Preface
1. Our system have multi selling team and multi warehouse team.
2. Every selling team maybe have stock in across multiple warehouse team.
3. Every Selling team can create order with own product or cross/shared product other selling team with same warehouse team (same warehouse location). 
    Because its only can shipped and processed in single warehouse.
```mermaid
block-beta

columns 3

block
    columns 2

    sa["Selling Team A"]
    space:1

    space:2

    space:1
    p2["Product 2"]
    space:2

    o["Order"]
    space:2
    space:2

    

    sa-->o
    sa-->p2
    

end

block
    columns 3
    w["Warehouse Team"]:3

    space:3
    space:1

    s2["Stock Product 2"]
    space:3
    space:3
    s1["Stock Product 1"]
    space:3
    space:3

    w-->s1
    w-->s2
end

block
    columns 1

    sb["Selling Team B"]
    space:1

    p1["Product 1"]

    sb-->p1
end

p1-->s1
p2-->s2
s1-->o
s2-->o

```

    

## Complete Journey Of The Orders.
```mermaid
flowchart TD
s(("start"))
e(("End"))

s-->create["Order Created"]
create-->cancel{"Is Cancel ?"}
cancel-->|yes|uc["User Cancel Order"]
    uc-->e
cancel-->|no|waccept["Warehouse Accept Order"]
    waccept-->process["Warehouse Process Order (Packing/Picking)"]
    process-->give["Warehouse Give to Shipping Channel"]
    give-->setwcompleted["set status warehouse process `completed`"]
    setwcompleted-->setship["set status `shipped`"]
    setship-->shipproblem{"is Shipment Problem ?"}
    shipproblem-->|yes|setproblem["set status `problem`"]
        setproblem-->e
    shipproblem-->|no|completed["set status `completed`"]
        completed-->e

```

## How New Order Processed.

1. How User Input The Order.
    ```mermaid
    flowchart TD
    s(("start"))
    s-->u("User Check not recorded order on their own selling platform marketplace")
    u-->isdraft{"make draft first ?"}
    isdraft-->|yes|draftmake["User Input Draft Order"]
        draftmake-->rev("User Review Order")
        rev-->final("finalize the order")
        final-->e
    isdraft-->|no|insertfinal["User Make and finalize Order"]
        insertfinal-->e


    e(("end"))

    ```
2. How Selling third parties record order
    ```mermaid
    flowchart TD
    s(("Start"))
    e(("End"))

    s-->th("Third Parties App Scan Order")
    th-->draft("Create Draft Order")
    draft-->u("User Review Order")
    u-->final("User Finalize the Order")
    final-->e
    
    ```


## Stock Ownership When Order Return. 
```mermaid
flowchart TD

s(("Start"))
e(("End"))

s-->ret["Order Return Happen"]
ret-->iscross{"Is Product Cross"}
iscross-->|yes|linkmap{"Is Product Have LinkMap"}
    linkmap-->|no|pcreate["Duplicate Cross Product"]
        pcreate-->own["Set Ownership to Own"]
        own-->reg["Register To LinkMap"]
        reg-->claim["Claim Cross Return Stock With Own Product"]
    linkmap-->|yes|pget["Getting Own Product Have Linked"]
        pget-->claim
    
    claim-->ivcreate["Create Return"]

iscross-->|no|ivcreate
ivcreate-->e


```
### What Is Product LinkMap
1. its use for prevent duplicate create product when order return happened.
2. its use for map product ownership when its return.




### Responsbility
1. Order draft is keep :
    - marketplace info
    - warehouse info
    - shipping info 
    - customer info
    - external product info



