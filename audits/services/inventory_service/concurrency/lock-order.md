# inventory_service — lock order

The service's lock hierarchy, and the reference every new write handler is checked against. Written
even though nothing is currently unsafe: its value is being here **before** the next handler needs it.

| | |
| --- | --- |
| Isolation | READ COMMITTED (Postgres default — nothing in this repo raises it) |
| Last swept | 2026-11-19: the custom shipment's moves (backlog #88 P3) — see [Custom shipments — the moves](#custom-shipments--the-moves-2026-11-19) · 2026-11-16: `RestockRequestCreate` / `RestockRequestUpdate` — a resi or an Order ID held by one restock (inventory 00048) — see [A reference in use](#a-reference-in-use-2026-11-16) · 2026-11-13: `RestockReceivedCountCorrect` and `WarehouseTransferReceivedCountCorrect` (Koreksi Jumlah Terima) — see [Koreksi Jumlah Terima](#koreksi-jumlah-terima-2026-11-13) · 2026-11-12: every stock writer's report rows (the four inventory metrics) — see [The stock reports are every stock transaction's last locks](#the-stock-reports-are-every-stock-transactions-last-locks-2026-11-12) · 2026-11-12: `BatchRevalue` (Koreksi Harga) — see [Koreksi Harga](#koreksi-harga-2026-11-12) · 2026-11-09: `OrderTransactionReturn` (backlog #40, an accepted return back on the shelf) — see [An order comes back on its return](#an-order-comes-back-on-its-return-2026-11-09) · 2026-11-04: the `OrderCancelled` listener and `StockLockCheck` (backlog #10 slice 4) — see [A cancelled order released on its event](#a-cancelled-order-released-on-its-event-2026-11-04) · 2026-11-04: the `InventoryTxCancel` listener (backlog #10 slice 3) — see [Order takes and their release](#order-takes-and-their-release-2026-11-04) · 2026-10-07: the restock supplier check became a supplier_service RPC (an earlier sweep, 2026-08-20, added the SETTLEMENT tables) |

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
| `FoundRequestApprove` — a found naming a LOST order (2026-11-18) | `found_requests` (one row) → `inventory_transactions` (the order's take row — two approvals of one order's founds queue here, and the second reads the first's units) → `product_placements` (the rack row, `RefuseCounted` under it). No register, no existing batch (new batches only), no liability. A return accept locks the same take row before its racks — the same way round |
| `FoundRequestCreate` naming a lost order | no lock — plain reads of the take and the order's founds, the `found_requests` insert and the order's timeline note (selling's `order_timeline_logs`, through the composition root) in ONE transaction; two reports racing past the take's units are capped at the approval |
| `FoundRequestReject` | `found_requests` (one row) |
| `OpnameSessionFinalize` | `opname_sessions` → `found_requests` (the WAITING ones it settles, by id) → `warehouse_stock_problems` → `batches` → `product_placements` → **liability** |

Proved, with the races and the one accepted behaviour (two identical reports are two requests), in
[FoundRequest.md](FoundRequest.md). The lost order's found: `TestInterleave_FoundRequestOrder_TheSecondApprovalWaitsOnTheTake`
and `TestRace_FoundRequestOrder_NeverBringsBackMoreThanTaken` (`found_request_order_race_test.go`; both fail with the take's
lock removed).

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

## An order comes back on its return (2026-11-09)

Backlog #40 ([return_decision.md](../../../../docs/business/inventory/return_decision.md)): selling's `OrderReturnAccept`
calls `OrderTransactionReturn` in process **before** it takes its own `orders` row, outside its transaction — so no
selling lock is held across any of these ([selling's row](../../selling_service/concurrency/lock-order.md#per-handler-in-acquisition-order)).

| Handler | Locks, in order |
| --- | --- |
| `OrderTransactionReturn` | *(before the transaction: `order_return_checks` by the take, a plain read — a hit answers and locks nothing)* → **`inventory_transactions` — the TAKE's row `FOR UPDATE`** (an order take of this selling team, not rolled back) → `order_return_checks` re-read under it → the return warehouse's `racks` (a plain count) → the take's `batch_logs` ⋈ `batches` (a plain read of its layers) → `inventory_transactions` INSERT (the `return`) → `batches` INSERT (the mints) + `batch_logs` + `batch_price_logs` → `product_placements` (`EnsureAndLockRacks`: the named rack rows ensured and `FOR UPDATE`, in rack-key order) → `RefuseCounted` (a read of the open snapshots over them) → `product_placement_logs` → `inventory_transaction_items` → `order_return_problem_items` INSERT → `warehouse_products` (the link upsert) → **`order_return_checks` INSERT last** (the once-only key, primary key = the take) |

**The take's row is the queue.** Every return of one parcel locks the same take row first, so a same-second twin waits
there, then re-reads `order_return_checks` and answers the first one's return — it never mints the parcel again. The
claim's primary key is the backstop: a caller that somehow passed both reads meets it at commit (`AlreadyExists`).

**No cycle.** Nothing else takes the take's row after a shelf: `OrderTransactionCreate` INSERTs a take (it never locks
an existing one), and a release (`releaseByKey` → `RollbackTake`) locks `idempotency_order_check`, then the take's row
`FOR UPDATE`, and only then the take's own batches and racks. A return locks the take's row first too, then only NEW
batches and the RETURN warehouse's rack rows of the selling team — so a release and a return of one take would queue on
the take's row, never cross. They cannot meet anyway: an order is cancelled before its handover and returned after it.
(Were they to, a return that waited would re-read the row as rolled back — `NOT is_rollback` is re-checked under
READ COMMITTED — and answer `NotFound`.) Against a stock count: the rack rows are locked before `RefuseCounted` reads
the open snapshots, as every put-away does
([a-lock-stops-sales-and-cancels-too](../../../../docs/business/inventory/opname_decision.md#a-lock-stops-sales-and-cancels-too)).

| Claim | Proof |
| --- | --- |
| **The take's row lock holds**, and the waiter re-reads the claim after it | `TestInterleave_OrderTransactionReturn_SecondWaitsOnTheTake` — B blocked on A's `FOR UPDATE`, released on A's commit, answered A's return (`posted` false, its door row) — one return, one claim, one door row |
| Eight returns of one take at once stock the parcel once | `TestRace_OrderTransactionReturn_OnceForEightCallers` — ×5 rounds: every caller answered, exactly one posted, all answered the same transaction, one return and one claim, the units on the racks once |
| Eight accepts of one parcel over the REAL stack (selling's accept → the stock picker → this handler) leave one return | `TestRace_OrderReturnAccept_OneReturnTransaction` (`backend/cmd/app_development`) — ×5 rounds: one accept, seven *"already accepted"*, one return transaction and one claim, the units on the rack once, the order `return_completed` naming that return |

```sh
go test -tags raceaudit -p 1 -run 'TestRace_OrderTransactionReturn|TestInterleave_OrderTransactionReturn' -v ./backend/services/inventory_service/inventory_v1/
go test -tags raceaudit -p 1 -run 'TestRace_OrderReturnAccept' -v ./backend/cmd/app_development/
```

## Koreksi Harga (2026-11-12)

[the-correct-price-prototype-is-accepted](../../../../docs/business/inventory/context_decision.md#the-correct-price-prototype-is-accepted):
the owning team corrects ONE batch's unit price. It moves no unit and touches no rack.

| Handler | Locks, in order |
| --- | --- |
| `BatchRevalue` | *(before the transaction: the policy, the reason and the floor — lock-free)* → **`batches` — the ONE row `FOR UPDATE`** (`LockBatch`; whose, units left, the form's price and the same price all judged under it) → `inventory_transactions` INSERT (`revaluation`) → `batch_logs` + `batch_price_logs` INSERT → `batches` UPDATE (the same row) → `inventory_transaction_items` INSERT |

**No cycle.** It takes exactly one lock, and first — so it can wait, never hold one thing while asking for another. Every
take (an order, a sample, a transfer's out-leg, a problem, a count's finalize) locks the product's batches by id; a
correction queues ahead of or behind it on the one row they share
([batches-lock-before-shelves-by-id](../../../../docs/business/inventory/context_decision.md#batches-lock-before-shelves-by-id)).
No `product_placements` row is locked, so an open count's rack lock neither blocks a correction nor is broken by one.

**The form's price is the guard, judged under the lock.** Two corrections from the same form price: the second waits on
the row, re-reads it after the first commits (READ COMMITTED), and is refused as stale with the price now — never priced
off the old one. A take that waited on a correction costs at the NEW price (it reads `price_unit` after its own lock).

| Claim | Proof |
| --- | --- |
| Eight corrections of one batch from one form price: one lands, seven refused as stale | `TestRace_BatchRevalue_TwoCorrectionsAtOnceOneWins` — ×5 rounds, 0 deadlocks, exactly 5 corrections in all |
| **The batch row lock holds**, and the waiter judges the form's price after it | `TestInterleave_BatchRevalue_TheSecondWaitsAndSeesTheFirst` — B blocked on A's `FOR UPDATE`, released on A's commit, refused as stale; the batch at A's price and value |
| A take that waits on a correction costs at the corrected price | `TestInterleave_BatchRevalue_ATakeWaitsAndCostsAtTheNewPrice` — the take blocked, then moved −2 × the new price |
| A correction racing three order takes: no deadlock, every batch row consistent with the price it stood at, both ledgers agree, every transaction verifies | `TestRace_BatchRevalue_RacingOrderTakesKeepsTheValueConsistent` — ×6 rounds, the correction delayed `round % 5` ms, all 6 corrections landed |
| The same racing a transfer's out-leg (the receiver mints at the price copied from that row) | `TestRace_BatchRevalue_RacingTransfersOutKeepsTheValueConsistent` — ×6 rounds, all 6 landed, batches and racks agree |

```sh
go test -tags raceaudit -p 1 -count=1 -run 'TestRace_BatchRevalue|TestInterleave_BatchRevalue' -v ./backend/services/inventory_service/inventory_v1/
```

## Koreksi Jumlah Terima (2026-11-13)

[the-received-count-prototype-is-accepted](../../../../docs/business/inventory/adjustment_decision.md#the-received-count-prototype-is-accepted):
the receiving warehouse corrects an ACCEPTED restock's or transfer's received count, line by line; units out leave the
line's batch(es) and the named rack, units in go back into them onto the named rack, as ONE `adjustment` transaction.

| Handler | Locks, in order |
| --- | --- |
| `RestockReceivedCountCorrect` | *(before the transaction: the policy, the reason, the lines' shape — lock-free)* → **`restocks` — the ONE row `FOR UPDATE`** (the lock accept and cancel take; the status, the lines' counts and the form's expected count judged under it) → *(reads: items, broken rows, racks, the line's batch)* → **`batches` — the lines' batches `FOR UPDATE`, in id order** (`LockBatchesWith`) → **`product_placements` — the lines' (product, rack) rows**, created at 0 for units in, then `FOR UPDATE` in id order (`EnsureAndLockRacks`) → the count locks over them, read under the rack lock (`count_lock.go`) → `inventory_transactions` / `batch_logs` / `batches` / `product_placement_logs` / `product_placements` / `inventory_transaction_items` writes → `restock_items` UPDATE (the rows under the restock's lock) → `restock_count_corrections` INSERT → door report → change report |
| `WarehouseTransferReceivedCountCorrect` | the same, with **`warehouse_transfers` — the ONE row `FOR UPDATE`** (`lockTransfer`, as B; the lock every status change takes) first, and `warehouse_transfer_items` / `warehouse_transfer_count_corrections` in place of the restock's; the batches are the line's layers' batches at B, still one statement in id order — a layer with no batch yet is MINTED (no lock to take) |

**No cycle.** Parent before child: the parent row first, then — exactly as every stock writer —
batches before shelves, by id ([batches-lock-before-shelves-by-id](../../../../docs/business/inventory/context_decision.md#batches-lock-before-shelves-by-id)),
then the report rows last. Nothing that holds a batch or a shelf asks for a `restocks` or `warehouse_transfers` row:
accept and cancel lock the parent first too, and no take touches either. A take (order, sample, transfer out-leg,
problem, finalize) locks the product's batches in id order and queues with a correction on the rows they share; a count
start takes the shelf rows `FOR SHARE` and nothing after — so a correction and a count meet on the shelf rows only, one
waiting for the other.

**The expected count is the guard, judged under the parent lock.** Two corrections from one form: the second waits on
the parent row, re-reads the line after the first commits (READ COMMITTED) and is refused as stale — never two
corrections off the same count. **A count holds the rack**: a correction that waited on a count's `FOR SHARE` reads the
count's lock after its own rack lock and is refused, naming the count; a count that waited on a correction snapshots
the corrected units.

| Claim | Proof |
| --- | --- |
| Eight corrections of one restock line from one form: one lands, seven refused as stale | `TestRace_RestockReceivedCountCorrect_TwoCorrectionsAtOnceOneWins` — ×4 rounds, 0 deadlocks, exactly 4 `adjustment` transactions; the line = the accept's − Σ units out, ledgers agree, every transaction verifies |
| A correction racing three order takes of the same batch: no deadlock, nothing fails, all 6 land | `TestRace_RestockReceivedCountCorrect_RacingOrderTakesKeepsTheLedgersConsistent` — ×6 rounds, the correction delayed `round % 5` ms; 30 − 6 − 18 = 6 left, batches = racks, ledger = report |
| A count started during a correction waits on the rack row and snapshots the corrected units | `TestInterleave_RestockReceivedCountCorrect_ACountWaitsAndSnapshotsTheCorrection` — blocked, released on commit, snapshot 8 not 10 |
| A correction during a started count waits on the shelf rows and is refused by the count | `TestInterleave_RestockReceivedCountCorrect_ACorrectionWaitsAndIsRefusedByTheCount` — blocked, released, FailedPrecondition; the line still 10 |
| Eight corrections of one transfer line at B: one lands, seven stale | `TestRace_WarehouseTransferReceivedCountCorrect_TwoCorrectionsAtOnceOneWins` — ×3 rounds, 0 deadlocks; B's batches = racks = the line |

```sh
go test -tags raceaudit -p 1 -count=1 -run 'TestRace_.*ReceivedCountCorrect|TestInterleave_.*ReceivedCountCorrect' -v ./backend/services/inventory_service/inventory_v1/
```

## The stock reports are every stock transaction's last locks (2026-11-12)

[ready-stock-is-folded-in-the-stock-changes-own-step](../../../../docs/business/analytic/rpc_provide_decision.md#ready-stock-is-folded-in-the-stock-changes-own-step):
every stock change writes its daily change row in its own transaction, the report rows the transaction's LAST locks.
Every handler that moves a batch runs in `inventory_ledgers.StockTransaction`; the ledger's three `batch_logs` writers
(`MintBatches`, `BatchWrites.Flush`, `Revalue`) note each row on the transaction's report, a restock or return accept
notes its door rows (`NoteDoor`), and the wrapper writes, after `fn` returned and before the commit:

| order | statement | rows, in order |
| --- | --- | --- |
| 1 | `INSERT … ON CONFLICT DO UPDATE` into `inventory_door_daily_reports` (restock / return accepts only) | keys sorted (warehouse, team, product, supplier, source) |
| 2 | `INSERT … ON CONFLICT DO UPDATE` into `inventory_stock_daily_changes` | keys sorted (warehouse, team, product, supplier, change type) |

So each handler's row in the tables above gains, at its very end, **→ door report → change report** — after
`idempotency_order_check` (the take), after `order_return_checks` (a return), after the liability / expense posts and
after Lost stock's `inventory_lost_daily_reports` row (`foldLost` stays where it was, mid-transaction, before them).
Wrapped: `OrderTransactionCreate`, `releaseByKey` (`OrderTransactionRelease`, the `InventoryTxCancel` and
`OrderCancelled` listeners), `RestockRequestAccept`, `WarehouseTransferCreate` / `Accept` / `Cancel`,
`OrderTransactionReturn`, `StockAdjust`, `OpnameSessionFinalize`, `FoundRequestApprove`, `RackSample`, `RackMove` (writes
no batch row — nothing to fold), `BatchRevalue`. A ledger write outside one is refused (`ErrNoStockReport`), so a new
writer cannot skip it.

**No cycle.** Nothing takes any lock after a report row, so a transaction holding one waits on nobody; and every
transaction takes its report rows in the same global order (door before changes, keys sorted). A report row's key is
(day, warehouse, owner, product, supplier, type): the transactions that share one are the ones touching the same
product's batches in the same warehouse — which already queue on those batches' row locks, taken first
([batches-lock-before-shelves-by-id](../../../../docs/business/inventory/context_decision.md#batches-lock-before-shelves-by-id)) —
or mints (restock, transfer in, return, found), which lock no existing batch and meet only on the report row, last.
The take's key claim stays where it was relative to the shelves: a same-key twin still waits on the batches, then on
`idempotency_order_check`'s unique index, never on a report row.

| Claim | Proof |
| --- | --- |
| Twelve takes of one product at one second land on ONE change row, each added, none lost | `TestRace_StockReport_TwelveTakesIntoOneRow` — 12/12 ok, the row −12 / Rp −12.000, one row, ledger = report |
| Two restock accepts of one key at one second add to the one change row and the one door row | `TestRace_StockReport_TwoAcceptsIntoOneRow` — ×5 rounds, 2/2 ok each, change row and door row exact, ledger = report |
| A fold racing takes: restock accepts, takes of A and of A + B, and a price correction of an A batch at once — no deadlock, nothing refused | `TestRace_StockReport_AFoldRacingTakesAndAnAccept` — ×6 rounds, 9/9 ok each, ledger = report after every round |
| Every writer's rows equal its `batch_logs`, per key, day and type | `ledgerMatchesReport` at the end of `TestStockReport_EveryWriterFoldsItsChanges` (take + release, Stock Adjust, count finalize, found, sample, revaluation) and of the restock / transfer / return / ready metric books |

The race suites that commit (`ledgerTables`, selling's `orderRaceTables`) wipe both report tables.

```sh
go test -tags raceaudit -p 1 -count=1 -run 'TestRace_StockReport' -v ./backend/services/inventory_service/inventory_v1/
```

## The warehouse link names its owner (2026-11-15)

[the-warehouse-link-names-its-owner-team](../../../../docs/business/inventory/context_decision.md#the-warehouse-link-names-its-owner-team):
`warehouse_products` carries `owner_team_id` (inventory 00047). The four writers' locking is **unchanged** — no new lock,
no change of order, no new file:

| Writer | The link step, as before | What is new |
| --- | --- | --- |
| `RestockRequestCreate` / `RestockRequestUpdate` | `INSERT … ON CONFLICT DO NOTHING`, last in the restock's transaction | the owner on the inserted rows; when a link was already there, one plain read of the stored owners (no `FOR UPDATE`) |
| `WarehouseTransferCreate` | the same upsert BEFORE the transaction, on its own connection — logged, never fails the create | the same |
| `OrderTransactionReturn` | the same upsert before `order_return_checks` | the same |

The upsert still waits only on a twin's uncommitted insert of the same `(warehouse_id, product_id)` — as before. Two
writers naming DIFFERENT owners for one new link: the second's insert waits for the first, then does nothing; its read
is a fresh READ COMMITTED snapshot, sees the first's committed owner, keeps it and logs the disagreement. No cycle: the
read takes no lock, and the upsert sits where it always sat in each writer.

| Claim | Proof |
| --- | --- |
| A second owner waits on the first's uncommitted link, then keeps it and reports — never overwrites, never misses it | `TestInterleave_WarehouseProductLink_ASecondOwnerWaitsThenKeepsTheFirst` — B (a restock of team 2) blocked on A's uncommitted link under team 77, released on A's commit; one link, under 77; B's restock committed; one warning naming 77 and 2. Mutation-checked: without the read, or with the upsert overwriting, red |
| The rule on one connection | `TestWarehouseProductLink_AnotherOwnerIsReportedAndNeverOverwritten` — the stored row's `ctid` unchanged, one warning |
| The writers' own races are unchanged | `TestRace_RestockRequestCreate_*`, `TestRace_RestockRequestUpdate_*`, `TestRace_WarehouseTransferCreate_*`, `TestRace_OrderTransactionReturn_OnceForEightCallers`, `TestRace_OrderReturnAccept_OneReturnTransaction` — re-run 2026-11-15 |

```sh
go test -tags raceaudit -p 1 -count=1 -run 'TestInterleave_WarehouseProductLink' -v ./backend/services/inventory_service/inventory_v1/
```

## A reference in use (2026-11-16)

[a-reference-in-use-stops-the-restock-form](../../../../docs/technical/frontend/restock_decision.md#a-reference-in-use-stops-the-restock-form):
a resi or an Order ID is held by ONE restock of the team that is not cancelled — inventory 00048's two partial unique
indexes on `restocks`. No new `FOR UPDATE` and no change of order; the one new wait is the index's own:

| Writer | Where it can wait now | On what |
| --- | --- | --- |
| `RestockRequestCreate` | its `INSERT INTO restocks`, the transaction's first write — holding nothing yet | a twin's uncommitted restock with the same (team, value); released on its commit (then a unique violation) or rollback |
| `RestockRequestUpdate` (ongoing) | its `UPDATE restocks` of the row it holds `FOR UPDATE` | another save's uncommitted new value — or another EDIT's old value, while that edit is changing it |

Two edits TRADING references (A takes B's resi while B takes A's) each hold their own row and wait on the other's old
value: a cycle Postgres breaks by aborting one (40P01). In either serial order both are refused — the other restock still
holds the value — so the aborted one is read as the same refusal (`isReferenceClash`): both answer AlreadyExists naming
the other, neither changes. The holder is named by an index probe AFTER the rollback, on no lock.

| Claim | Proof |
| --- | --- |
| Two creates of one Order ID (typed differently) — exactly one restock, the other AlreadyExists naming it | `TestRace_RestockReference_TwoCreatesOfOneOrderID` — 20 rounds. Mutation-checked: with the indexes dropped, red in round 0 |
| The same for one resi, and for an ongoing edit racing a create | `TestRace_RestockReference_TwoCreatesOfOneResi`, `TestRace_RestockReference_AnEditAndACreateOfOneResi` — 20 rounds each |
| Two edits trading resis — both refused, each naming the other, neither restock changed | `TestRace_RestockReference_TwoEditsTradingResis` — 20 rounds (the deadlock itself is rare at this speed: the trade usually meets a committed old value and is refused at once); the 40P01 classification is pinned by `TestIsReferenceClash` |
| The writers' own races are unchanged | `TestRace_RestockRequestCreate_*`, `TestRace_RestockRequestUpdate_*` — re-run 2026-11-16 |

```sh
go test -tags raceaudit -p 1 -count=1 -run 'TestRace_RestockReference|TestRace_RestockRequest' -v ./backend/services/inventory_service/inventory_v1/
```

## The selling note, in any status (2026-11-16)

[the-note-is-edited-in-any-status](../../../../docs/technical/frontend/restock_decision.md#the-note-is-edited-in-any-status):
`RestockRequestNoteSet` writes the selling team's note alone, in every status, with its own writer
([the-notes-are-one-per-writer](../../../../docs/technical/frontend/restock_decision.md#the-notes-are-one-per-writer), inventory
00050). No new lock and no new order — it takes the one every restock write takes:

| Writer | Locks, in order |
| --- | --- |
| `RestockRequestNoteSet` | **`restocks` — the ONE row `FOR UPDATE`** (Update's, Arrive's, Accept's, MarkLost's, Cancel's) → `restocks` UPDATE (note, its writer, `updated_at`) → `restock_logs` INSERT → `restock_log_changes` INSERT → *(read: `restock_items` by restock)*. Nothing to write when the note is unchanged |
| `RestockRequestUpdate` | unchanged — it now also writes the note's writer in the same `restocks` UPDATE, when the note changed |

| Claim | Proof |
| --- | --- |
| Eight writers of one note at once: all land, one after another; the note changes chain and the stored writer is the last change's | `TestRace_RestockRequestNoteSet_ManyWritersOneStory` — ×5 rounds. Mutation-checked: without `FOR UPDATE`, red in round 0 (seven changes start from the same note) |
| A note set racing the edit form (which sends the note it read): whichever lands second, note, writer and trail agree | `TestRace_RestockRequestNoteSet_RacingTheEditFormKeepsOneStory` — 12 rounds, both orders hit |

```sh
go test -tags raceaudit -p 1 -count=1 -run 'TestRace_RestockRequestNoteSet' -v ./backend/services/inventory_service/inventory_v1/
```

## The courier's charge noted at Tiba (2026-11-18)

[the-courier-charge-is-noted-at-tiba-and-final-at-terima](../../../../docs/business/inventory/restock_decision.md#the-courier-charge-is-noted-at-tiba-and-final-at-terima):
`RestockRequestArrive` now also writes the courier's charge, its note and its slip. No new lock and no new order — three
more columns in the `restocks` UPDATE the sign already made, on the row it already holds:

| Writer | Locks, in order |
| --- | --- |
| `RestockRequestArrive` | *(before the transaction: the note rule — lock-free)* → **`restocks` — the ONE row `FOR UPDATE`** (Update's, Accept's, MarkLost's, Cancel's, NoteSet's) → `restocks` UPDATE (status, arrived_by/at, the charge, its note, its slip, `updated_at`) → `restock_logs` INSERT → *(read: `restock_items` by restock)*. No event |
| `RestockRequestAccept` | unchanged — it writes Terima's charge on the same row, under the same lock, REPLACING the one noted at Tiba |

| Claim | Proof |
| --- | --- |
| A sign with a charge racing Terima on one box: sign first → Terima replaces its charge; Terima first → the sign is refused (FailedPrecondition). Either way the restock keeps Terima's charge, note and slip, and *Restock Accepted* carries it once | `TestRace_RestockArriveCharge_TerimasFigureWinsWhenItCommitsLast` — 16 rounds, 8 each way. Mutation-checked: without the sign's `FOR UPDATE`, red in round 1 (status back to arrived, Tiba's 15.000 over Terima's) |

```sh
go test -tags raceaudit -p 1 -count=1 -run 'TestRace_RestockArriveCharge' -v ./backend/services/inventory_service/inventory_v1/
```

## Restock before the accept, on the door report (2026-11-19)

[the-restock-before-the-accept-prototype-is-accepted](../../../../docs/business/analytic/rpc_provide_decision.md#the-restock-before-the-accept-prototype-is-accepted):
a restock's create, edit, cancel, mark lost and sign now run in `inventory_ledgers.StockTransaction`, as the accept always
did, and add what they moved of Analytic's Restock (ordered, lost on the way; the accept its courier COD) to the restock's
`inventory_door_daily_reports` rows. **One lock added to five writers, at their very end** — the report rows are every
stock transaction's last locks ([above](#the-stock-reports-are-every-stock-transactions-last-locks-2026-11-12)); no lock
before them moves:

| Writer | Locks, in order |
| --- | --- |
| `RestockRequestCreate` | `restocks` + `restock_items` INSERT → `restock_logs` INSERT → `warehouse_products` upsert → **door report upsert (last)** |
| `RestockRequestUpdate` | *(supplier / store / account asks — before the transaction)* → **`restocks` — the ONE row `FOR UPDATE`** → *(read: `restock_items`)* → lines rewritten (ongoing) or updated in place (arrived) → `restocks` totals → `restock_logs` + `restock_log_changes` INSERT → `warehouse_products` upsert → **door report upsert (last)** — the edit's difference is read under the row lock, from the lines as stored, then as written |
| `RestockRequestCancel` | **`restocks` `FOR UPDATE`** → `restocks` UPDATE → `restock_logs` INSERT → *(read: `restock_items`)* → **door report upsert (last)** |
| `RestockRequestMarkLost` | the same shape as Cancel |
| `RestockRequestArrive` | as above (the charge noted at Tiba) → **door report upsert (last)**, from lost only |
| `RestockRequestAccept` | unchanged — its door rows now also carry the COD (the same upsert) |

**No cycle.** The door rows are taken last, keys sorted (warehouse, team, product, supplier, source), and nothing locks
after them; two writes of one restock already queue on its row lock, taken first, so the second's difference is read
against what the first committed. Two restocks of one key on one day meet only on the report row, at the end — each adds.

| Claim | Proof |
| --- | --- |
| An edit racing the accept of one arrived restock (its line 4 → 6 against 4 counted in): edit first → the accept counts 4 of 6 (2 missing); accept first → the edit is refused (FailedPrecondition). Either way the report's ordered equals the lines as they stand and its missing what the box lacked | `TestRace_RestockMetric_AnEditAgainstTheAccept` — 12 rounds, 6 each way |
| Two edits of one ongoing restock at once (6 units / Rp 1.000 shipping, 9 units / Rp 2.000): both commit, one after the other; the report's ordered is exactly the one that committed last, units and value | `TestRace_RestockMetric_TwoEditsAtOnce` — 12 rounds |
| The door report's other writers keep their order and add into one row | `TestRace_StockReport_*` (unchanged, green), the restock race suites (`TestRace_Restock*`, green) |

```sh
go test -tags raceaudit -p 1 -count=1 -run 'TestRace_RestockMetric' -v ./backend/services/inventory_service/inventory_v1/
```

## Custom shipments (2026-11-19)

[the-custom-shipments-prototype-is-accepted](../../../../docs/business/custom_shipments/context_decision.md#the-custom-shipments-prototype-is-accepted)
(backlog #88 P1): `CustomShipmentCreate` writes a parcel. **One new lock-taker on an existing row — the reship's
`restocks` row — and no new order**:

| Writer | Locks, in order |
| --- | --- |
| `CustomShipmentCreate` — a **sample** | *(product facts, the paying account — asked before the transaction)* → `custom_shipments` INSERT → the team's `batches` (product order, ids ascending — `LockBatches`) → `inventory_transactions` INSERT → `product_placements` (`LockRacks`, ids ascending) → ledger log rows → `custom_shipment_items` INSERT → `custom_shipments` UPDATE (its own new row) → `custom_shipment_logs` INSERT → **stock report upserts (last)** — the transfer out-leg's order (`postSystemPickedTake` is the out-leg's code) |
| `CustomShipmentCreate` — a **reship** | *(the paying account — before the transaction)* → **`restocks` — the ONE row `FOR UPDATE`** → *(reads: `restock_items`, `restock_problem_items`, the live reships' `custom_shipment_items`)* → `custom_shipments` INSERT → `custom_shipment_items` INSERT → `custom_shipment_logs` INSERT. No ledger row, no batch, no rack |

**No cycle.** The reship takes the restock row first and nothing else that is locked — its other writes are INSERTs of new
rows. The restock's accept, cancel, edits and Koreksi Jumlah Terima take that same row FIRST too, then batches and racks;
a reship never holds a batch or a rack, so no writer waits on it while holding one. The sample takes no restock row: it
is the out-leg's lock order end to end (rows inserted first lock nothing another writer waits on).

**Why the restock row.** A reship's cap is *broken − units on live reships*, a SUM over rows no constraint can express;
two reships of one restock each read the sum and insert. Taking the restock row `FOR UPDATE` before the read queues them,
and the second re-reads the sum under READ COMMITTED after the first commits. A `reshipped` counter on
`restock_problem_items` (the alternative) would alter an existing table and keep a second copy of the sum.

| Claim | Proof |
| --- | --- |
| Two people send the last broken units back at once: a line of 3 broken, 8 reships of 1 → exactly 3 created, 5 refused (FailedPrecondition); 8 of 2 → exactly 1 created; never more on the way back than broken; no deadlock | `TestRace_CustomShipmentReship_NeverSendsMoreThanTheBrokenUnits` — 4 rounds × 2 sizes. Mutation-checked: the lock as `FOR SHARE` (no queue) → red in round 0, all 8 created for 3 broken |
| A parcel sample and an order race for the shelf's last units: 10 units, 8 samples and 8 order takes of 2 → exactly 5 win between them, 11 refused, no deadlock, both ledgers at 0, every take verifies, a parcel for every sample that won and only those | `TestRace_CustomShipmentSample_VsAnOrderForTheLastUnits` — 4 rounds (samples won 8, orders 12 of the 20 takes) |
| The other writers keep their order with the custom-shipment tables cleared first by every race suite (`ledgerTables`) | the inventory race suites (`TestRace_*`, `TestInterleave_*`), green |

```sh
go test -tags raceaudit -p 1 -count=1 -run 'TestRace_CustomShipment' -v ./backend/services/inventory_service/inventory_v1/
```

## Custom shipments — the moves (2026-11-19)

[a-custom-shipment-is-cancelled-only-while-requested](../../../../docs/business/custom_shipments/context_decision.md#a-custom-shipment-is-cancelled-only-while-requested),
[the-courier-is-paid-by-the-team-or-by-the-warehouse](../../../../docs/business/custom_shipments/context_decision.md#the-courier-is-paid-by-the-team-or-by-the-warehouse)
(backlog #88 P3): `CustomShipmentCostSet`, `CustomShipmentCancel`, `CustomShipmentPicked`, `CustomShipmentHandover`.
**One new lock-taker — the parcel row, taken FIRST by every move — and no new order**:

| Writer | Locks, in order |
| --- | --- |
| `CustomShipmentCancel` — a **sample** | **`custom_shipments` — the ONE row `FOR UPDATE`** (as its owning team) → *(`RollbackParcelSample`: the same row again — a no-op)* → **`inventory_transactions` — the take's row `FOR UPDATE`** → `batches` (`FOR UPDATE`, id order — `ReverseBatchLogs`) → `product_placements` (`FOR UPDATE`, id order — `ReversePlacementLogs`) → `RefuseCounted` (a read of the open snapshots over them) → the reversing log rows → `inventory_transactions` UPDATE (`is_rollback`) → `custom_shipments` UPDATE → `custom_shipment_logs` INSERT → **stock report upserts (last)** — the transfer cancel's order with the parcel row in the transfer row's seat |
| `CustomShipmentCancel` — a **reship** | **`custom_shipments` — the ONE row `FOR UPDATE`** → `custom_shipments` UPDATE → `custom_shipment_logs` INSERT. No ledger row; no restock row (a cancel only FREES broken units, so a reship create judging the live sum under the restock's lock can only see too many, never too few) |
| `CustomShipmentPicked` | **`custom_shipments` — the ONE row `FOR UPDATE`** (as its shipping warehouse) → UPDATE → `custom_shipment_logs` INSERT |
| `CustomShipmentHandover` | the same as Picked (the cost and resi in the same UPDATE) |
| `CustomShipmentCostSet` | *(the paying account — asked before the transaction)* → **`custom_shipments` — the ONE row `FOR UPDATE`** (as its owning team) → UPDATE (account, cost, `cost_revision`) → `custom_shipment_logs` INSERT. Nothing written when nothing changed |

**No cycle.** Every move takes the parcel row FIRST; the only one that locks anything after it is a sample's cancel,
which then follows the order's own order (the take's row, batches, racks — each by id) and ends on the report rows. No
other writer locks a parcel row while holding a batch or a rack: the create inserts its own new row first, and orders,
transfers and counts never touch `custom_shipments`. The take's row is locked by nobody else (a `sample` is never an
order's take, a return's or a found's).

| Claim | Proof |
| --- | --- |
| The team cancels while the warehouse picks one parcel: 8 callers (4 cancel, 4 pick) → EXACTLY ONE wins, 7 refused (FailedPrecondition), one move out of requested on the trail; a won cancel leaves the take rolled back and its units back, a won pick leaves them out; both ledgers end at 40 − 2 × picks; no deadlock | `TestRace_CustomShipmentMove_CancelVsPickedExactlyOneWins` — 12 rounds (runs: the cancel won 4 / the pick 8, then 7 / 5; 7 refused every round). Mutation-checked: the parcel lock as `FOR KEY SHARE` (no queue for an UPDATE) → red in round 1 (3 callers deadlocked on the cancel's own row lock) |
| The team edits its cost while the warehouse hands the parcel over: 4 handovers + 4 edits → one handover, every edit that won committed BEFORE it (its trail row before the handed-over row), revision = edits won, one CostUpdated per won edit and one HandedOver, the stored cost the last edit's; no deadlock | `TestRace_CustomShipmentMove_HandoverVsCostSet` — 12 rounds, staggered by turns (edits won before the handover per round: 0 in 6–7 rounds, 1–2 in the rest). Mutation-checked: the parcel lock as `FOR KEY SHARE` → red in round 1 (two handovers both landed) |
| A cancelled sample's units go back onto a shelf orders are taking from: 10 units, a sample of 4, then its cancel and 7 orders of 2 at once → the cancel always lands, orders win 3–5, both ledgers end at exactly 10 − 2 × won, the take rolled back, every transaction verifies; no deadlock | `TestRace_CustomShipmentMove_CancelRollbackVsAnOrderForTheSameUnits` — 24 rounds (orders won 3 in 17 rounds, 5 in 7). Mutation-checked: the undo taking racks BEFORE batches → deadlock detected (red twice of two runs; at 8 rounds it was missed once — a timing race, hence 24) |

```sh
go test -tags raceaudit -p 1 -count=1 -run 'TestRace_CustomShipmentMove' -v ./backend/services/inventory_service/inventory_v1/
```

## Restock resolutions and the inbound parcel (2026-11-20)

[a-restock-problem-is-settled-by-resolution-rows](../../../../docs/business/inventory/restock_decision.md#a-restock-problem-is-settled-by-resolution-rows),
[a-suppliers-reshipping-comes-in-as-a-custom-shipment](../../../../docs/business/custom_shipments/context_decision.md#a-suppliers-reshipping-comes-in-as-a-custom-shipment)
(backlog #101 P1). **New cross-row writes, one order: the RESTOCK row first, then the parcel row, then the ledgers** —
the order the reship create already takes (restock → parcel INSERT), extended:

| Writer | Locks, in order |
| --- | --- |
| `RestockResolutionCreate` — refund | *(the account — asked of financial_account before the transaction)* → **`restocks` — the ONE row `FOR UPDATE`** (as its selling team) → *(read: its problem tags)* → `restock_resolutions` INSERT. The money after commit (`RestockRefunded`) |
| `RestockResolutionCreate` — return | **`restocks` FOR UPDATE** → `restock_resolutions` INSERT → **`custom_shipments` — the reship's row `FOR UPDATE`** → `restock_custom_shipments` INSERT |
| `RestockResolutionCreate` — reshipping | *(product facts — before the transaction)* → **`restocks` FOR UPDATE** → `restock_resolutions` INSERT → *(read: `restock_items`' suppliers)* → `custom_shipments` / `custom_shipment_items` / `custom_shipment_logs` / `restock_custom_shipments` INSERTs — new rows only |
| `CustomShipmentCreate` — a reship WITH `resolution` | the reship's existing order (**`restocks` FOR UPDATE** → parcel INSERTs), then `restock_resolutions` + `restock_custom_shipments` INSERTs |
| `RestockRequestSettle` | **`restocks` FOR UPDATE** → *(read: its problem tags)* → `restocks` UPDATE (the mark) → `restock_tags` DELETE (its problem tags) |
| `CustomShipmentReceive` (Terima) | *(read, no lock: the parcel's restock id — it never changes)* → **`restocks` FOR UPDATE** → **`custom_shipments` FOR UPDATE** (as the warehouse it comes to) → `custom_shipment_items` UPDATE → `PostRestock`'s order (batches INSERT, `product_placements` by id, ledger rows, `inventory_transactions`) → `restock_custom_shipments` UPDATE → `custom_shipments` UPDATE + trail INSERT → on a shortfall `restocks` UPDATE (the mark lifted) + `restock_tags` INSERT (`ON CONFLICT DO NOTHING`) → **stock report upserts (last)** |
| `CustomShipmentResiSet` / `PricesSet` / `MarkLost` / `Arrive` | **`custom_shipments` — the ONE row `FOR UPDATE`** → its UPDATE (+ `custom_shipment_items` UPDATE for a price) → trail INSERT. No restock row: none of them touches the restock |

**No cycle.** Every writer that takes both takes the restock row BEFORE the parcel row (the return link, the reship
create, Terima); the parcel-only moves never take a restock row while holding a parcel. The restock's own acts (accept,
cancel, edits, Koreksi Jumlah Terima, tag puts) take the restock row first and never a parcel row. Terima reaches the
ledgers only after both rows, in `PostRestock`'s order (the restock accept's), and ends on the report rows.

**Why the restock row for Terima.** A shortfall REOPENS the restock (the settled mark lifted, the tags back on) — a write
to the row a settle writes. Without the lock, a settle and a reopening Terima each judge a stale `settled_at`: proved —
the mutation (Terima without the restock lock) leaves a restock SETTLED with a problem tag back on (round 1).

| Claim | Proof |
| --- | --- |
| Two people record resolutions at once, a form double-tapped: 8 own keys + 4 one shared key → 9 rows, 3 AlreadyExists; then 8 settles → exactly one wins, 7 FailedPrecondition; settled, no problem tag; no deadlock | `TestRace_RestockResolution_ConcurrentRowsAndOneSettle` — 4 rounds. Mutation-checked: the restock lock as `KEY SHARE` → red in round 0 (2 settles won) |
| A settle races a reshipping's short Terima: either order, never a settled restock carrying a problem tag nor an unsettled one with none; no deadlock | `TestRace_RestockResolution_SettleVsAReopeningTerima` — 12 rounds, staggered (settle last 8 / reopened last 4). Mutation-checked: Terima without the restock lock → red in round 1 (settled with 1 problem tag) |
| Two people count one inbound parcel in: 8 Terima → exactly one stock-in, 7 FailedPrecondition, the units on the shelf once, every transaction verifies | `TestRace_RestockResolution_TerimaCountsOnce` — 4 rounds |
| A refund event delivered four times at once beside other refunds and hand transfers on the same account: posted once, no deadlock, the sum exact | financial_account `TestRace_RestockRefund_OneEventFourDeliveriesBesideOthers` (`postPaymentLegs` — the claim beside the post, the account FOR UPDATE) |

```sh
go test -tags raceaudit -p 1 -count=1 -run 'TestRace_RestockResolution' -v ./backend/services/inventory_service/inventory_v1/
go test -tags raceaudit -p 1 -count=1 -run 'TestRace_RestockRefund' -v ./backend/services/financial_account_service/financial_account_v1/
```
