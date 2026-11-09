# inventory_service — lock order

The service's lock hierarchy, and the reference every new write handler is checked against. Written
even though nothing is currently unsafe: its value is being here **before** the next handler needs it.

| | |
| --- | --- |
| Isolation | READ COMMITTED (Postgres default — nothing in this repo raises it) |
| Last swept | 2026-11-04: the `OrderCancelled` listener and `StockLockCheck` (backlog #10 slice 4) — see [A cancelled order released on its event](#a-cancelled-order-released-on-its-event-2026-11-04) · 2026-11-04: the `InventoryTxCancel` listener (backlog #10 slice 3) — see [Order takes and their release](#order-takes-and-their-release-2026-11-04) · 2026-10-07: the restock supplier check became a supplier_service RPC (an earlier sweep, 2026-08-20, added the SETTLEMENT tables) |

---

## The hierarchy

**Parent before child, and within one table a deterministic row order.**

```
restock_requests  →  restock_request_items  →  stock_levels  →  stock_shelf_batches
                                                                        ↓
                                        settlement_balances  →  settlement_entries
```

A handler may enter part-way down (`StockPick` starts at `stock_levels`), but it must never take
them in a different relative order.

## Per handler, in acquisition order

| Handler | Locks, in order | Row order within the table |
| --- | --- | --- |
| `RestockRequestFulfill` | `restock_requests` → `restock_request_items` → `stock_levels` → `stock_shelf_batches` → **settlement** | items `ORDER BY id ASC` |
| `RestockRequestCancel` | `restock_requests` → `restock_request_items` | items `ORDER BY id ASC` |
| `RestockRequestUpdate` | `restock_requests` → 🔴 *supplier_service call* → `restock_request_items` | items `ORDER BY id ASC` · see [below](#no-lock-across-a-call-to-another-service) |
| `StockAdjust` | `stock_levels` (one row) → `stock_shelf_batches` → **settlement** (damage/lost/found only) | single product — n/a |
| **`StockOpname`** | `stock_levels` (n rows) → `stock_shelf_batches` | **`ORDER BY product_id ASC`, sorted in the handler** |
| `StockPick` | `stock_levels` (n rows) → `stock_shelf_batches` | `ORDER BY (rack_id IS NOT NULL), r.code` — drain order |
| `StockReturn` | `stock_levels` → `stock_shelf_batches` | single product — n/a |
| `StockMove` | `stock_levels` (2 rows, via conditional UPDATE) → `stock_shelf_batches` | from, then to |

## The one thing that looks like a disagreement and is not

`StockOpname` and `StockPick` both lock **n rows of `stock_levels`, in different orders**:

| | walks | ordered by |
| --- | --- | --- |
| `StockOpname` | the products on ONE rack | `product_id` |
| `StockPick` | the racks holding ONE product | drain order (unplaced first, then rack code) |

Two different axes across the same table is exactly the shape of a lock inversion — but these two
**cannot** form a cycle. An opname's lock set is `{(p, R) : p ∈ counted}` for one rack `R`; a pick's is
`{(P, r) : r ∈ racks}` for one product `P`. Two such sets intersect in **at most one row**, `(P, R)` —
and a single shared row cannot deadlock, because a cycle needs each transaction to hold something the
other wants.

The same argument covers `StockOpname` vs `StockMove` (one product, two racks) and vs `StockAdjust`
(one row).

> ⚠ **This stops holding the moment either one widens.** An opname over several racks, or a pick that
> also touched a second product, would give the two sets two shared rows and the cycle becomes
> reachable. If either grows an axis, one order has to win — and the natural choice is
> `(rack_id, product_id)` everywhere, since that is the order a person physically walks.

## The settlement tables sit LAST, and only ever last

Two handlers post an obligation inside their own transaction — `RestockRequestFulfill` (the restock
outlay) and, since the damage reimbursement, `StockAdjust`. Both reach settlement **after** every
inventory row they touch, which is what keeps the hierarchy a line rather than a cycle.

- **Within settlement the order is settled there, not here.** `postBothLegs` writes the CREDITOR leg
  then the DEBTOR leg, always — a fixed order chosen precisely so two concurrent postings for one pair
  cannot deadlock. `moveBalance` is an `ON CONFLICT` upsert rather than lock-then-read, so a pair with
  no row yet serialises in the database instead of losing one of two inserts.
- **Two adjusts on different products of the same (owner, warehouse) pair** do contend on the same two
  balance rows — but they take them last and in the same order, so one simply waits.
- ⚠ **Nothing may take a settlement lock and then an inventory one.** That is the inversion this
  section exists to forbid. `SettlementPaymentConfirm` locks `settlement_payments` → `settlement_balances`
  and touches no inventory table, so it cannot close the cycle — and any future handler wanting both
  must take inventory first.

## No lock across a call to another service

Since the-supplier-gets-its-own-service, a restock's supplier check is an RPC (`SupplierChecker`), no longer a
local read. Where that call sits relative to the locks:

| Handler | Call | Locks held during it |
| --- | --- | --- |
| `RestockRequestUpdate` (supplier changed) | ✅ **before** the transaction (`askSupplier`); the answer is judged under `FOR UPDATE` | none — fixed 2026-10-07 ([RestockRequestUpdate.md](RestockRequestUpdate.md)); it was the request row |
| `RestockRequestCreate` | ✅ **before** `Transaction` | none, and no pinned connection — proved |
| `RestockRequestCreate` / `RestockRequestUpdate` — the paying account (`PayingAccounts`, 2026-11-05) | ✅ **before** the transaction; Update judges a changed account under `FOR UPDATE` | none — proved ([RestockRequestUpdate.md](RestockRequestUpdate.md#the-paying-account-2026-11-05)) |
| `WarehouseTransferCreate` / `WarehouseTransferUpdate` — the shipping's paying account (same seam, 2026-11-05) | ✅ **before** the transaction (Create: before the receiver's product link too); Update judges a changed account under the transfer's `FOR UPDATE` | none — proved ([WarehouseTransferUpdate.md](WarehouseTransferUpdate.md)) |

The rule this adds to the hierarchy: **a call to another service happens before the first lock, or after commit.**

## What is proved, and by what

| Claim | Proof |
| --- | --- |
| Two opnames of one shelf with **opposite line orders** do not deadlock | `TestRace_StockOpname_OppositeLineOrdersDoNotDeadlock` — n=8, ×15 runs, 0 deadlocks |
| Two opnames that **disagree** leave the shelf on one counted figure, and the ledger reconciles | `TestRace_StockOpname_TheLastCountWinsCleanly` — `seed + Σdelta = final` |
| The `stock_levels` `FOR UPDATE` **actually holds**, and the waiter re-reads after it | `TestInterleave_StockOpname_TheShelfLockHolds` — `⏸ blocked, released on the other commit`, B reads A's 45 not the stale 50 |
| `RestockRequestUpdate` does NOT hold the request across its supplier_service call (fixed) | `TestRace_RestockRequestUpdate_ACancelDoesNotWaitForTheSupplierRoundTrip`: Cancel 56 ms on an 800 ms call · before the fix, 817 ms |
| `RestockRequestCreate` holds no transaction during its call | `TestRace_RestockRequestCreate_HoldsNoTransactionDuringTheSupplierCall`: 0 idle in transaction, 0 locks |
| Neither restock write holds a lock across the paying-account call | `TestRace_RestockRequestUpdate_ACancelDoesNotWaitForTheAccountRoundTrip` (Cancel 62 ms on 800 ms) · `TestRace_RestockRequestCreate_HoldsNoTransactionDuringTheAccountCall` (0 / 0) |
| Neither transfer write holds a lock across the paying-account call | `TestRace_WarehouseTransferUpdate_ACancelDoesNotWaitForTheAccountRoundTrip` (Cancel 65 ms on 800 ms) · `TestRace_WarehouseTransferCreate_HoldsNoTransactionDuringTheAccountCall` (0 / 0) |

```sh
go test -tags raceaudit -run 'StockOpname' -v ./backend/services/inventory_service/inventory_v1/
go test -tags raceaudit -run 'RestockRequest' -v ./backend/services/inventory_service/inventory_v1/
```

## Not proved

Named rather than left to be assumed safe:

- **Opname vs pick, opname vs move, opname vs fulfil** were reasoned about (the set-intersection
  argument above) but **not raced**. The argument is sound and the sets are disjoint by construction;
  it is still an argument rather than a counter-example.
- **`stock_shelf_batches` has no lock of its own.** Every writer reaches it while holding the
  `stock_levels` row for the same `(warehouse, product, rack)`, which is what serialises it —
  ⚠ except `StockMove`, whose `moveShelfBatch` runs before its `applyDelta` takes the level's row lock.
  That ordering was not exercised here and is the first thing to race if shelf-batch quantities are
  ever seen drifting from on-hand.

## Found requests (2026-11-03)

`found_requests` sits **above** the count's ledgers: every writer that locks a request row locks it before the register,
the batches and the racks, and a finalize locks the requests it settles right after its session.

| Handler | Locks, in order |
| --- | --- |
| `FoundRequestApprove` | `found_requests` (one row) → `warehouse_stock_problems` (open losses, oldest first) → `batches` (by id) → `product_placements` (the rack row) → **liability** |
| `FoundRequestReject` | `found_requests` (one row) |
| `OpnameSessionFinalize` | `opname_sessions` → `found_requests` (the WAITING ones it settles, by id) → `warehouse_stock_problems` → `batches` → `product_placements` → **liability** |

Proved, with the races and the one accepted behaviour (two identical reports are two requests), in
[FoundRequest.md](FoundRequest.md).

## Order takes and their release (2026-11-04)

An order's take, its release by key, and the `InventoryTxCancel` listener (backlog #10 slice 3,
[the-compensation-event-is-inventory-tx-cancel](../../../../docs/business/order/context_decision.md#the-compensation-event-is-inventory-tx-cancel)).
The listener and `OrderTransactionRelease` run **one** function, `releaseByKey`, so they take the same locks in the same
order. Since slice 3 the order service calls the take BEFORE its own order row, outside its transaction, so no selling
lock is held across any of these.

| Handler | Locks, in order |
| --- | --- |
| `OrderTransactionCreate` | *(before the transaction: the key lookup and the product facts, lock-free)* → `inventory_transactions` INSERT → `batches` (`FOR UPDATE`, by product then id) → `product_placements` (`FOR UPDATE`) → the logs → **`idempotency_order_check` INSERT last** — a same-key twin, or a release's uncommitted claim of the key, makes it wait here on the unique index |
| `OrderTransactionRelease` · `InventoryTxCancel` listener (`releaseByKey`) | `idempotency_order_check` (the key's row `FOR UPDATE`; an unseen key is first claimed by `INSERT … ON CONFLICT DO NOTHING`, which waits on a take's uncommitted claim) → `inventory_transactions` (the take, team-checked) → `batches` (`FOR UPDATE`, by id) → `product_placements` (`FOR UPDATE`) → the reversing logs → `inventory_transactions` UPDATE (`is_rollback`) |

**No cycle.** The take reaches the key LAST, holding the shelves; a release reaches it FIRST. The only release that can
hold a key's row while a take waits on it is the *unseen key* claim, which touches no shelf and commits at once — so a
take never waits on a release that waits on the take. A release of a key whose take committed locks the claim row and
then the shelves, in the take's own shelf order.

| Claim | Proof |
| --- | --- |
| A take and its `InventoryTxCancel` at once, same key, net to zero — the take refused as a used key, or landed and rolled back | `TestRace_TakeVsTxCancel` — ×20 rounds per run, both outcomes hit (e.g. 11 rolled back / 9 refused), 0 failures, shelves at 20/20 without a settling release, a release afterwards finds nothing |
| A redelivered `InventoryTxCancel` gives the stock back once | `TestRace_TxCancelRedelivery` — two deliveries at once ×10 rounds: one rollback, the second waits on the claim row and finds it released |
| A release racing its own take nets to zero | `TestRace_OrderTransactionRelease_RacingItsTakeNetsToZero` |
| A twin submit takes once | `TestRace_OrderTransactionCreate_ATwinSubmitTakesOnce` |

The listener's other outcomes are unit-tested (`inventory_tx_cancel_listener_test.go`): another team's key is
acknowledged and released nothing; a key held by a stock count returns an error until the count ends
([a-cancel-still-meets-the-count-first](../../../../docs/business/order/context_decision.md#a-cancel-still-meets-the-count-first)).

```sh
go test -tags raceaudit -p 1 -run 'TestRace_TakeVsTxCancel|TestRace_TxCancelRedelivery|TestRace_OrderTransaction' -v ./backend/services/inventory_service/inventory_v1/
```

## A cancelled order released on its event (2026-11-04)

Backlog #10 slice 4 ([inventory-returns-stock-on-order-cancelled](../../../../docs/business/order/context_decision.md#inventory-returns-stock-on-order-cancelled)):
the order's cancel asks `StockLockCheck` first and inventory releases on `OrderCancelled`.

| Handler | Locks, in order |
| --- | --- |
| `StockLockCheck` (in process, called by `OrderCancel` while it holds its own `orders` row) | **none** — three plain reads: `idempotency_order_check` ⋈ `inventory_transactions` by K, the take's `product_placement_logs`, the open `opname_session_snapshots` over them (`RefuseCounted`, no lock of its own) |
| `OrderCancelled` listener (`releaseByKey`) | exactly `OrderTransactionRelease`'s order above: `idempotency_order_check` → `inventory_transactions` → `batches` → `product_placements` → the reversing logs → `inventory_transactions` UPDATE |

**No cycle with selling.** The check takes no lock, so the selling `orders` row lock held across it cannot meet an
inventory lock; the release runs after the cancel committed, from the broker, holding nothing of selling's. A count
planned between the check and the release is the decided fallback, not a hole: the release's own lock check
(`ReversePlacementLogs` → `RefuseCounted`, after the rack rows are locked) refuses it, and the listener errors until the
count ends ([a-cancel-still-meets-the-count-first](../../../../docs/business/order/context_decision.md#a-cancel-still-meets-the-count-first)).

| Claim | Proof |
| --- | --- |
| `OrderCancelled`, its redelivery and a late `InventoryTxCancel` on the same key at once roll the take back ONCE | `TestRace_OrderCancelled_AndALateTxCancelRollBackOnce` — three deliveries at once ×10 rounds: shelves at 20/20, exactly one `is_rollback` transaction per key, 0 failures |
| A cancel racing a count start — the check passes, then the count locks — waits, and releases after the count | `TestRace_OrderCancelled_RacingACountStartWaitsForIt` — ×10 rounds, all three ends hit (e.g. 4 refused by the check, 3 released before the count, 3 refused by the lock): the count's book always equals the racks, every refused release names the count, and the delivery after the count is cancelled releases (20/20) |

Unit-tested beside them (`order_cancelled_listener_test.go`): released once and a redelivery a no-op, an empty key
acknowledged with nothing claimed, another team's take acknowledged and kept, a count lock an error until the count ends;
`StockLockCheck` names the count and answers nil for no take, another team's or warehouse's take, a released take.

```sh
go test -tags raceaudit -p 1 -run 'TestRace_OrderCancelled' -v ./backend/services/inventory_service/inventory_v1/
```
