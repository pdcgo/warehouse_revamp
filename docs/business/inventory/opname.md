# Stock Opname Contexts.

## General.
1. Every Warehouse only can have 1 active opname session.

## Table That Must have in Stock Opname.

1. Table `opname_sessions`.

    Field that must have:
    - `id` as primary key
    - `warehouse_id`
    - `status`

    - `created_by_id`
    - `created_at`

    Field `status` have:
    - `active`
    - `finish`
    - `cancel`

2. Table `opname_session_snapshots`

    Field that must have:
    - `id` as primary key
    - `warehouse_id`
    - `team_id`
    - `product_id`
    - `placement_id`
    - `opname_session_id`
    - `transaction_id`

    - `status`

    - `system_stock_count`
    - `recounted_stock_count`
    
    - `counted_by_id`
    - `released_at`
    - `created_at`

    Field `status` have:
    - `created`
    - `counted`

3. Table `opname_problems_drafts`

    Field that must have:
    - `id` as primary key
    - `warehouse_id`
    - `team_id`
    - `product_id`
    - `placement_id`
    - `opname_session_id`
    
    - `note`
    - `problem_type`
    - `problem_stock_count`
    - `created_at`

    Field `problem_type` contain:
    - `broken`
    - `lost`

4. Table `warehouse_stock_problems`

    Field that must have:
    - `id` as primary key
    - `warehouse_id`
    - `team_id`
    - `product_id`
    - `transaction_id`
    - `batch_id`
    - `placement_id`

    - `note`

    - `problem_type`
    
    - `problem_stock_count`
    - `price_unit`

    - `claimable_stock_count`
    - `claimed_stock_count`



    - `created_at`

    Field `problem_type` contain:
    - `broken`
    - `lost`

5. Table `problem_claimed_transactions`
    Field that must have:
    - `id` as primary key
    - `warehouse_id`
    - `problem_id`
    - `transaction_id`
    - `created_at`



## Stock Opname Flow.
```mermaid
stateDiagram-v2

state "Start Opname Session" as start
state "Create Session" as csess
state "Plan Opname All Rack" as all
state "Plan Specific Team" as pteam
state "Plan Specific Product" as pprod
state "Plan Specific Placement" as pplace
state "Snapshot & Lock Product Placement" as snap
state "Staff Counted in Real Condition" as verify
state "Staff writing the difference" as submit
state "FInalize and Submit to The Ledger" as finalize
state "End" as end

[*]-->start: warehouse admin decide opname
start-->csess: admin create session
csess-->all
csess-->pprod
csess-->pteam
csess-->pplace

pplace-->snap: snapshot bring count in system
pteam-->snap: snapshot bring count in system
pprod-->snap: snapshot bring count in system
all-->snap: snapshot bring count in system

snap-->verify
verify-->submit
submit-->finalize

finalize-->end: release lock

```

## How Staff Work On Session.
```mermaid
stateDiagram-v2

state "Opname Session Created" as opc
state "Opname Cancel" as opcancel
state op_choice <<choice>>
state "Finalize Opname" as finalize


[*]-->opc
opc-->op_choice
op_choice-->countops: admin watch page and refresh opname session detail periodically
op_choice-->opcancel: canceled
opcancel-->[*]

countops: Counting Operation
state countops {
    state "Session Page Watch" as watch
    state "Snapshot Counted" as counted
    state "Counting Snapshot" as counting
    state "Create Draft Change" as draft

    
    watch-->counting: Staff Start Counting
    counting-->counted: Staff mark counted snapshot
    counted-->draft: create draft change
    draft-->watch: admin see updated
}

countops-->finalize

finalize-->[*]

```
## How We Manage Stock Problem In Warehouses.
1. A stock problem comes in by two doors: *Finalize Opname* and *Adjustment*.
2. At *Finalize Opname* each product is settled: broken drafts are posted as written; the rest (sellable counted against book minus broken) is lost when short, surplus when over, and when 0 only the racks are corrected.
3. Broken and lost are written in `warehouse_stock_problems` per batch, oldest batch first, broken before lost. Broken has claimable 0; lost is claimable for all its units.
4. A surplus first claims the oldest open lost problem, and goes back into that problem's batch at its price. With nothing to claim, it is a new batch at the team's last price in this warehouse. If the team never had the product here, it is not posted.
5. Every claim writes a row in `problem_claimed_transactions`.

```mermaid
stateDiagram-v2

state "Finalize Opname" as finalize
state "Adjustment" as adjust
state "Net Each Product" as net
state "Broken Found" as broken
state "Lost Found" as lost
state "Surplus Found" as surplus
state "Units Moved Between Racks" as moved
state "Write In `warehouse_stock_problems`" as stockprob
state "Find Oldest Claimable Lost Problem" as find
state is_found <<choice>>
state "Increment Claimed and Write `problem_claimed_transactions`" as inc
state "Get Last Price" as last
state has_price <<choice>>
state "New Batch" as newbatch
state "Not Posted - Owner Unknown" as hold
state ledger <<fork>>
state "Placement Ledger" as pledger
state "Batch Ledger" as bledger

[*]-->finalize: from How Staff Work On Session
[*]-->adjust: a unit broken, lost or found at the shelf

finalize-->net: one opname transaction per team
net-->broken: broken drafts
net-->lost: the rest is short
net-->surplus: the rest is over
net-->moved: the rest is 0

adjust-->broken: staff report broken
adjust-->lost: staff report lost
adjust-->surplus: staff report found, a second person confirms

broken-->stockprob: with claimable qty 0
lost-->stockprob: with claimable qty
stockprob-->ledger: per batch, oldest first, broken before lost

surplus-->find
find-->is_found
is_found-->inc: yes
is_found-->last: no
inc-->ledger: back into the problem's batch
last-->has_price
has_price-->newbatch: yes
has_price-->hold: never had it here
newbatch-->ledger: create new batch

moved-->pledger: racks corrected only
ledger-->pledger
ledger-->bledger

pledger-->[*]
bledger-->[*]
hold-->[*]
```