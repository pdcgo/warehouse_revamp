# Stock Opname Contexts.


## Table That Must have in Stock Opname.

1. Table `opname_sessions`.

    Field that must have:
    - `id` as primary key
    - `warehouse_id`

    - `created_by_id`
    - `created_at`

2. Table `session_placements`.

    Field that must have:
    - `id` as primary key
    - `placement_id`

    - `created_at`

3. Table `opname_session_snapshots`

    Field that must have:
    - `id` as primary key
    - `warehouse_id`
    - `team_id`
    - `warehouse_id`
    - `product_id`
    - `placement_id`
    
    - `system_stock_count`
    - `real_stock_count`
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