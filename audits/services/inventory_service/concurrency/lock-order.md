# inventory_service — lock order

The service's lock hierarchy, and the reference every new write handler is checked against. Written
even though nothing is currently unsafe: its value is being here **before** the next handler needs it.

| | |
| --- | --- |
| Isolation | READ COMMITTED (Postgres default — nothing in this repo raises it) |
| Last swept | 2026-08-14, adding `StockOpname` |

---

## The hierarchy

**Parent before child, and within one table a deterministic row order.**

```
restock_requests  →  restock_request_items  →  stock_levels  →  stock_shelf_batches
```

A handler may enter part-way down (`StockPick` starts at `stock_levels`), but it must never take
them in a different relative order.

## Per handler, in acquisition order

| Handler | Locks, in order | Row order within the table |
| --- | --- | --- |
| `RestockRequestFulfill` | `restock_requests` → `restock_request_items` → `stock_levels` → `stock_shelf_batches` | items `ORDER BY id ASC` |
| `RestockRequestCancel` | `restock_requests` → `restock_request_items` | items `ORDER BY id ASC` |
| `RestockRequestUpdate` | `restock_requests` → `restock_request_items` | items `ORDER BY id ASC` |
| `StockAdjust` | `stock_levels` (one row) → `stock_shelf_batches` | single product — n/a |
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

## What is proved, and by what

| Claim | Proof |
| --- | --- |
| Two opnames of one shelf with **opposite line orders** do not deadlock | `TestRace_StockOpname_OppositeLineOrdersDoNotDeadlock` — n=8, ×15 runs, 0 deadlocks |
| Two opnames that **disagree** leave the shelf on one counted figure, and the ledger reconciles | `TestRace_StockOpname_TheLastCountWinsCleanly` — `seed + Σdelta = final` |
| The `stock_levels` `FOR UPDATE` **actually holds**, and the waiter re-reads after it | `TestInterleave_StockOpname_TheShelfLockHolds` — `⏸ blocked, released on the other commit`, B reads A's 45 not the stale 50 |

```sh
go test -tags raceaudit -run 'StockOpname' -v ./backend/services/inventory_service/inventory_v1/
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
