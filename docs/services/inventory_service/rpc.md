# inventory_service — RPC & event flows

**Money is an unrounded `double` on every read** (2026-11-06, part 2 of
[every-ledger-moves-to-double-rounded-when-frozen](../../business/order/context_decision.md#every-ledger-moves-to-double-rounded-when-frozen)).
The ledgers were already `double precision`; the stock reads stopped rounding them to whole-rupiah `int64` — batch
detail / list / receipt, the cost layers, the owner's batches, `StockCost`, the owner-stock reads, the product stock
summary and the rack detail / stock figures carry the stored figure (no `ROUND(…)::bigint` in the SQL), and a screen
rounds only for display (3 decimals, [a-fraction-of-a-rupiah-shows-three-decimals](../../business/order/context_decision.md#a-fraction-of-a-rupiah-shows-three-decimals)).
inventory freezes nothing itself: a loss or a breakage hands its unrounded value to liability (`PostStockLoss` /
`PostStockDamage`) and expense (`STOCK_LOSS`), which store it exact; an order's take returns unrounded line figures and
selling freezes them exact at placement ([the-backend-never-rounds-money](../../business/order/context_decision.md#the-backend-never-rounds-money), 2026-11-06). The one figure inventory stores frozen is
`inventory_lost_daily_reports.lost_amount` — `double precision` since `00038` (was `NUMERIC(20,2)`,
[numeric-money-moves-to-double-too](../../business/order/context_decision.md#numeric-money-moves-to-double-too)),
the exact sum the lost fold writes. `CostLayerList` groups batches whose prices agree to 4 places (a tolerance key) and
reads the layer's exact stored price (`MIN(price_unit)`), never the 4-place key.

## Pub/Sub push receiver — `/event/<sub>/push`

`inventory_service` hears other services' events on **Pub/Sub PUSH** routes — plain HTTP, **not** Connect RPCs — mounted
in [register.go](../../../backend/services/inventory_service/register.go) as `/event/<subscription id>/push` and wrapped
by `event_source.NewMuxPushHandler` (which continues the publisher's trace and encodes the ACK/NACK contract). One
handler, [push_handler.go](../../../backend/services/inventory_service/push_handler.go), dispatches on the event
**variant**; a variant it does not handle is ACKed. The old catch-all `/events/inventory` skeleton is gone.

| subscription | topic | handler |
| --- | --- | --- |
| `inventory-tx-cancel` (`InventoryTxCancelSubscription`) | `inventory-tx-cancel` | [`InventoryTxCancel`](#inventorytxcancel--the-compensations-listener) — release the take under the event's key |
| `inventory-order-cancelled` (`InventoryOrderCancelledSubscription`) | `order-cancelled` | [`OrderCancelled`](#ordercancelled--a-cancelled-orders-stock-back) — release a cancelled order's take by its key |

Created by `go run ./tools/san pubsub ensure` ([docs/tools/san.md](../../tools/san.md)) with an `event_type` filter and a
**dead-letter policy**: a non-2xx is a NACK and Pub/Sub redelivers it, so a message that never succeeds must be parked,
not looped. (Push-endpoint authentication — OIDC/token — is a deployment concern, not handled in code.)

---

## Restock requests

A **two-sided** flow across two teams. A SELLING team restocks into a WAREHOUSE; the warehouse signs for the box and
counts it in, and *the accept is what receives the stock*. The design is
[restock.md](../../business/inventory/restock.md) and its decisions in
[restock_decision.md](../../business/inventory/restock_decision.md); the contract was **rewritten in place** to it
([the-restock-contract-changes-in-place](../../business/inventory/restock_decision.md#the-restock-contract-changes-in-place)).

> 🔄 **00024 (2026-10-15): the tables caught up with the contract.** Every field is stored, the status words are the
> contract's, a missing problem row is `missing`, the trail is `restock_logs` and the courier's charge is one column
> pair on the restock ([restocks-non-stock-parts-come-before-the-switch-over](../../business/inventory/restock_decision.md#restocks-non-stock-parts-come-before-the-switch-over)).
> 🔄 **Ledger stage 2 (2026-10-16): the accept writes the decided ledgers** through `inventory_mutations.PostRestock`, in
> its own transaction, and the restock records its `transaction_id`
> ([the-decided-ledgers-come-before-the-restock-accept](../../business/inventory/restock_decision.md#the-decided-ledgers-come-before-the-restock-accept)).
> ⚠ It still writes today's stock tables beside them, until stage 3 moves their readers
> ([ledgers.md](../../development_state/inventory/ledgers.md)). Create and update now refuse another team's product
> ([a-restock-carries-only-the-teams-own-products](../../business/inventory/restock_decision.md#a-restock-carries-only-the-teams-own-products)).

| RPC | Who | From → to | What it does |
| --- | --- | --- | --- |
| `RestockRequestCreate` | selling team | → ongoing | the restock and its lines in one transaction, and the first trail row; each product once (refused as InvalidArgument, and by a unique index); each product the team's own, asked of product_service before the transaction (another team's or an unknown one is InvalidArgument); each line's supplier and store asked of supplier_service before the transaction (a store names its supplier and belongs to it); the paying account must be one of the team's ACTIVE OPERATIONAL accounts, asked of financial_account before the transaction (FailedPrecondition naming it — see [the paying account](#the-paying-account--one-of-the-teams-active-operational-accounts)). Announces *Restock Created* after commit |
| `RestockRequestList` / `Detail` | either side | — | rows where `team_id = team` **OR** `warehouse_id = team`; a third team reads **NotFound**. Every filter server-side; a lens narrows the two-sided scope, never replaces it |
| `RestockRequestUpdate` | selling team | ongoing / arrived | a full replace; every product the team's own, asked before the lock, as create. **Ongoing:** every field, the paying account required — a CHANGED account must be active and operational (asked before the lock, judged under it); an unchanged one is kept even if archived or un-marked since. **Arrived:** the lines only — count, total, note; new lines may name their supplier and store, a stored line keeps its own, none removed; any other field that differs is refused. Every edit is a trail row, status unchanged. An edit that moves money announces *Restock Updated* |
| `RestockRequestArrive` | warehouse | ongoing / lost → arrived | signs for the box: who and when, a trail row; moves no stock. Locked FOR UPDATE, scoped to `warehouse_id` — the selling team and another warehouse read NotFound. A late lost box keeps its lost-by. Opens the arrived window of Update |
| `RestockRequestAccept` | warehouse | ongoing / arrived → accepted | counts the box in — below |
| `RestockRequestMarkLost` | selling team | ongoing → lost | gives the parcel up: who and when, a trail row carrying the optional why; moves no money. Ongoing only — a box in the building is not lost. A lost restock is neither accepted nor cancelled; only signing for a late box brings it back |
| `RestockRequestCancel` | selling team | ongoing → cancelled | ongoing only, so a second cancel is refused — the money comes back once; whether it did is written on the trail row and announced in *Restock Cancelled* |
| `RestockRequestLabels` | warehouse | accepted | one label per placement the good units went to |
| `RestockInboundStat` | warehouse | — | what is still coming: ongoing **and** arrived |
| `RestockReceiptPhoto` | warehouse (+ Root, Administrator) | any | a signed link to the seller's label photo — below |

### Lifecycle

```mermaid
stateDiagram-v2
    [*] --> ongoing: Create — selling team
    ongoing --> ongoing: Update — anything
    ongoing --> arrived: Arrive — warehouse signs for the box
    ongoing --> accepted: Accept — warehouse
    arrived --> arrived: Update — the lines only, a new line may name its supplier
    arrived --> accepted: Accept — warehouse
    ongoing --> lost: MarkLost — selling team
    lost --> arrived: Arrive — a late box
    ongoing --> cancelled: Cancel — selling team
    accepted --> [*]
    cancelled --> [*]
```

Every move takes the restock row `FOR UPDATE` first and checks the status under it, so an accept and a cancel at the
same second queue on one lock and the second sees what the first did
([accept-locks-the-restock](../../business/inventory/restock_decision.md#accept-locks-the-restock)).

### RestockReceiptPhoto — the warehouse opens the label photo

The restock's own warehouse opens the selling team's label photo (`receipt_file`) to match the box at its door
([the-restocks-warehouse-opens-its-label-photo](../../business/inventory/restock_decision.md#the-restocks-warehouse-opens-its-label-photo)). Policy: Root, Administrator,
Warehouse Owner / Admin / Staff; `team_id` is the scope; `NO_SIDE_EFFECTS` (the monitor and an agent may call it).

```mermaid
sequenceDiagram
    participant W as warehouse screen
    participant I as inventory RestockReceiptPhoto
    participant D as document_service LabelURL, in-process
    W->>I: team_id = the warehouse, request_id
    I->>I: restocks WHERE id AND warehouse_id = team_id
    alt another warehouse or no such restock
        I-->>W: NotFound
    else receipt_file empty
        I-->>W: FailedPrecondition - this restock has no label photo
    else
        I->>D: owner = the restock's selling team, receipt_file
        D-->>I: signed url and expiry, or NotFound
        I-->>W: url, expires_at_unix - NotFound from D reads as no label photo
    end
```

The owner handed to document_service is inventory's finding (the restock's `team_id`), never the browser's; the seam
signs only an active `order_receipt` (the type the restock form's ReceiptUpload stores) of that owner. No
`document_shares` row is written — GetDownloadUrl under the warehouse stays NotFound. A document_service failure other
than NotFound is the call's error. The seam is inventory's `ReceiptPhotoLinker`, wired by
`cmd/app_development/restock_photo_linker.go`; nil answers Unimplemented. The selling team keeps opening its own
upload with GetDownloadUrl. Root and the Administrator name the warehouse as `team_id`, as `RestockRequestLabels`.
Code `inventory_v1/restock_receipt_photo.go`; audit
[RestockReceiptPhoto.md](../../../audits/services/inventory_service/performances/RestockReceiptPhoto.md) (1 PK lookup).

### The accept transaction

Per line the warehouse types **what is in the box** and **how many of those are broken**; good and missing are worked
out ([any-warehouse-member-counts-what-arrived](../../business/inventory/restock_decision.md#any-warehouse-member-counts-what-arrived)).

```mermaid
sequenceDiagram
    participant W as Warehouse member
    participant H as RestockRequestAccept
    participant DB as Postgres - one tx

    W->>H: lines [item, received, broken, notes, placements], courier charge + note
    H->>H: charge above 0 without a note → InvalidArgument
    H->>DB: SELECT restock WHERE id AND warehouse_id FOR UPDATE
    alt not this warehouse's
        H-->>W: NotFound
    else not ongoing or arrived
        H-->>W: FailedPrecondition
    else a line missing, doubled, over its count, broken above received, or misplaced
        H-->>W: InvalidArgument — refused, never interpreted
    else the count is complete
        loop every line
            H->>DB: received_count = what was in the box, broken included
            H->>DB: restock_problem_items by restock and product — broken as typed, missing = count − received, at the landed unit price
        end
        H->>DB: PostRestock - a restock transaction, a batch per line with good units at the decided landed price, rack rows, items
        H->>DB: status accepted, accepted_by, accepted_at, transaction_id, the courier's charge and its note on the restock
        H->>DB: trail row, from ongoing or arrived to accepted, COMMIT
        H-->>W: the restock, accepted
    end
```

| Rule | Decision |
| --- | --- |
| received above the line's count is refused — the selling team adds the extra by an edit first | [accept-refuses-more-than-the-line-says](../../business/inventory/restock_decision.md#accept-refuses-more-than-the-line-says) |
| the short units are a MISSING row, worked out, never typed | [a-short-unit-at-the-door-is-missing](../../business/inventory/restock_decision.md#a-short-unit-at-the-door-is-missing) |
| the good units go onto placements of this warehouse, exactly received − broken; there is no unplaced choice | [there-is-no-unplaced-pile](../../business/inventory/restock_decision.md#there-is-no-unplaced-pile) |
| a problem row's worth is the landed unit price over every unit ordered, filled at accept and stored | [the-problem-price-is-filled-by-the-system](../../business/inventory/restock_decision.md#the-problem-price-is-filled-by-the-system), [all-qty-is-every-unit-ordered](../../business/inventory/restock_decision.md#all-qty-is-every-unit-ordered) |
| one batch per line with good units; the batch's price = line total ÷ line count + (shipping + courier charge) ÷ every unit ordered | [one-batch-per-line](../../business/inventory/restock_decision.md#one-batch-per-line), [unit-price-is-line-price-plus-costs-per-unit](../../business/inventory/restock_decision.md#unit-price-is-line-price-plus-costs-per-unit) |
| one courier's charge, its note required; outside the restock's total, inside the unit price; saved on the restock, and *Restock Accepted* carries it — liability posts the debt from the event | [the-courier-is-paid-once-per-restock](../../business/inventory/restock_decision.md#the-courier-is-paid-once-per-restock), [balance-posts-the-couriers-debt-from-the-event](../../business/inventory/restock_decision.md#balance-posts-the-couriers-debt-from-the-event) |
| a problem row's note is optional — an empty one stays empty | [a-broken-reason-is-optional](../../business/inventory/restock_decision.md#a-broken-reason-is-optional) |

✅ *(2026-10-16)* **The courier's debt left the accept**: `PostRestockOutlay` is gone, *Restock Accepted* carries the charge, its note and
the accepting person, and liability posts the debt from `/event/liability-restock-accepted/push`.
✅ *(2026-10-16)* **The unit cost is the decided one**: the line's `total ÷ count`, plus the costs over every unit
ORDERED, and a broken or missing row carries that same landed price
([all-qty-is-every-unit-ordered](../../business/inventory/restock_decision.md#all-qty-is-every-unit-ordered)).

✅ *(2026-10-17)* **The accept writes only the ledgers**: one `restock` transaction (`inventory_mutations.PostRestock`), a
batch per line with good units at the landed price, its rack rows. The old `stock_*` writes are gone, and the line's
placements are read back from the accept's rack rows.

✅ *(2026-10-17)* **The tables carry the owner's names and the money is `double`** (`00030`): `restocks`,
`restock_items`, `restock_problem_items` — the problem rows keyed by restock and product — and every money field on
the wire and in the tables a double, as the ledgers hold it
([money-is-double-in-the-api-too](../../technical/stock/design_decision.md#money-is-double-in-the-api-too)).
`restocks.subtotal` / `total` and a line's `price_unit` are stored, written by every create and edit.

---

## Order transactions — an order's take and its release, on the ledgers

`OrderTransactionService` (`order_transaction.proto`) — and since 2026-11-09 an accepted return's way back onto a shelf
([below](#an-order-comes-back--ordertransactionreturn)): the order service calls it while it creates an order, before the
order exists, so inventory knows the take only by the order form's key K
([every-release-goes-by-the-key](../../business/order/context_decision.md#every-release-goes-by-the-key)). ✅ *(2026-10-17)*
**Selling's order calls it** through the composition root's stock picker. ✅ *(2026-11-04, backlog #10 slice 3)* With the
order's own key K, passed through as sent, BEFORE the order row exists; the order stores the answered
`transaction_id`, which is what the pick page reads the take's racks by ([StockPickLocations](#stockpicklocations--the-pick-pages-racks-by-transaction)).

### OrderTransactionCreate

```mermaid
sequenceDiagram
    participant O as order service
    participant H as OrderTransactionCreate
    participant P as product_service
    participant DB as Postgres

    O->>H: team_id (the ORDERING team), K, warehouse, lines
    H->>DB: K in idempotency_order_check?
    alt claimed
        H-->>O: AlreadyExists - KEY_USED, never the earlier take
    end
    H->>P: ProductByIds - owner, private, reserve, markup
    Note over H: a borrowed line on a private product, an owner below its reserve, or an unknown product
    alt any line not allowed
        H-->>O: FailedPrecondition - NOT_ALLOWED, every such line
    end
    H->>DB: BEGIN
    H->>DB: per line, product order - lock the owner's batches by id, count
    alt any line short
        H-->>O: FailedPrecondition - NOT_ENOUGH_STOCK, every short line with wanted and available
    end
    H->>DB: one order transaction of the ordering team
    H->>DB: batches oldest first, every line, then racks holding the fewest first, every line
    H->>DB: one item per product
    H->>DB: claim K with the transaction - a same-second twin meets the unique index
    H->>DB: COMMIT
    H-->>O: transaction_id, per line owner, unit cost, cost with markup, markup, total
```

| Rule | Decision |
| --- | --- |
| K looked up first; a hit is refused, never answered | [a-used-key-is-refused-first](../../business/inventory/order_decision.md#a-used-key-is-refused-first) |
| the product read before any transaction; private and the reserve stop other teams only | [the-take-checks-the-product-first](../../business/inventory/order_decision.md#the-take-checks-the-product-first), [the-reserve-stops-other-teams-at-low-stock](../../business/product/context_decision.md#the-reserve-stops-other-teams-at-low-stock) |
| the reserve compares the owner's total stock, every warehouse, a plain read | [the-reserve-is-read-before-the-take](../../business/inventory/order_decision.md#the-reserve-is-read-before-the-take) |
| one error, one reason, every refused line, on an `OrderTransactionRefusal` detail | [a-refusal-names-its-reason-and-every-line](../../business/inventory/order_decision.md#a-refusal-names-its-reason-and-every-line) |
| one transaction per order, of the ordering team; each item names its owner | [an-order-is-one-inventory-transaction](../../business/order/context_decision.md#an-order-is-one-inventory-transaction), [an-item-carries-its-owning-team](../../business/inventory/transaction_decision.md#an-item-carries-its-owning-team) |
| the markup is inventory's, on cost, for another team's product only | [inventory-computes-the-markup](../../business/order/context_decision.md#inventory-computes-the-markup) |
| K claimed in its own table, inside the take's transaction | [the-key-is-claimed-in-its-own-table](../../business/inventory/transaction_decision.md#the-key-is-claimed-in-its-own-table) |
| lines in product order, batches before racks — no deadlock between two orders | [batches-lock-before-shelves-by-id](../../business/inventory/context_decision.md#batches-lock-before-shelves-by-id) · `order_transaction_race_test.go` |

### OrderTransactionRelease

```mermaid
flowchart LR
  R["release K - the order's team"] --> L{"K claimed?"}
  L -->|"no"| C["claim K with none - a late take is refused"]
  L -->|"with none"| N["nothing"]
  L -->|"with a transaction"| T{"the team's?"}
  T -->|"no"| X["NotFound"]
  T -->|"yes"| B["RollbackTake - once, every log row flipped, is_rollback set"]
```

One path for an order cancelled and for a create that failed after its take — `releaseByKey`, which the RPC, the
[InventoryTxCancel listener](#inventorytxcancel--the-compensations-listener) and the
[OrderCancelled listener](#ordercancelled--a-cancelled-orders-stock-back) all run, team-checked
([the-cancel-event-names-the-team](../../business/order/context_decision.md#the-cancel-event-names-the-team)). Only a take
is rolled back ([a-rollback-only-undoes-a-take](../../business/inventory/transaction_decision.md#a-rollback-only-undoes-a-take)); the
rollback reverses the log rows, not the items
([a-rollback-reverses-its-log-rows](../../business/inventory/transaction_decision.md#a-rollback-reverses-its-log-rows)).
✅ *(2026-11-04)* A failed create calls it directly as its compensation, then publishes `InventoryTxCancel` as the
backup. *Order Cancel* no longer calls it (backlog #10 slice 4): it asks [`StockLockCheck`](#stocklockcheck--the-cancels-count-check)
first and inventory releases on [`OrderCancelled`](#ordercancelled--a-cancelled-orders-stock-back).

### InventoryTxCancel — the compensation's listener

The order service's compensation of a create that failed after its take
([the-compensation-event-is-inventory-tx-cancel](../../business/order/context_decision.md#the-compensation-event-is-inventory-tx-cancel)):
the backup of its direct release ([the-release-is-direct-then-the-event](../../business/order/context_decision.md#the-release-is-direct-then-the-event)),
so it usually finds the take already released. `inventory_v1.Service.InventoryTxCancel`
([inventory_tx_cancel_listener.go](../../../backend/services/inventory_service/inventory_v1/inventory_tx_cancel_listener.go)).

```mermaid
sequenceDiagram
    participant PS as Pub/Sub
    participant H as /event/inventory-tx-cancel/push
    participant L as InventoryTxCancel listener
    participant DB as Postgres

    PS->>H: InventoryTxCancel - K, team, warehouse, actor, reason
    H->>L: the decoded variant
    L->>DB: releaseByKey(team, K, actor) - the RPC's own release
    alt taken by this team
        DB-->>L: rolled back, once
        L-->>PS: 200 ACK
    else already released, or K claimed with none
        DB-->>L: nothing to do
        L-->>PS: 200 ACK
    else K unseen
        DB-->>L: K claimed with none - a late take is refused
        L-->>PS: 200 ACK
    else another team's take
        DB-->>L: not this team's
        L-->>PS: 200 ACK - logged, nothing released
    else a stock count holds the take's rack
        DB-->>L: refused, the count named
        L-->>PS: 5xx NACK - redelivered until the count ends, then the dead-letter
    end
```

| | |
| --- | --- |
| idempotency | by the key — a released take is a no-op, so no `event_id` claim is needed; a redelivery and the direct release both find it released |
| another team | acknowledged and logged, never released ([the-cancel-event-names-the-team](../../business/order/context_decision.md#the-cancel-event-names-the-team)) |
| a count lock | an error, so the broker redelivers until the count ends ([a-cancel-still-meets-the-count-first](../../business/order/context_decision.md#a-cancel-still-meets-the-count-first)); after the retry limit the dead-letter holds it — `san pubsub redrive --topic inventory-tx-cancel` once the count is over |
| the actor | the variant's `actor_id` (who placed the failed order), never the envelope's identity |
| performance | 14 statements to roll back a take of 1 line or 20 (5.3 / 8.8 ms); 4 for an already-released take or an unseen key (≈1 ms) — `TestPerf_InventoryTxCancel` |
| races | `TestRace_TakeVsTxCancel`, `TestRace_TxCancelRedelivery` — [lock-order](../../../audits/services/inventory_service/concurrency/lock-order.md#order-takes-and-their-release-2026-11-04) |

### StockLockCheck — the cancel's count check

An **in-process read** (no RPC, no policy of its own — the cancel already passed its own), wired to selling through
`cmd/app_development/stock_picker.go`: `StockLockCheck(ctx, team, warehouse, K)` → the `*CountedError` of the count
holding a rack the take under K came from, or nil
([a-cancel-still-meets-the-count-first](../../business/order/context_decision.md#a-cancel-still-meets-the-count-first)).
It reads inventory's own tables only and locks nothing.

```mermaid
flowchart LR
  K["K, the order's team and warehouse"] --> T{"a take under K, this team's, this warehouse's, not rolled back?"}
  T -->|"no"| N["nil - nothing to hold back"]
  T -->|"yes"| R["its rack rows - product_placement_logs by transaction_id"]
  R --> C{"an open snapshot over one? - RefuseCounted"}
  C -->|"no"| N
  C -->|"yes"| E["the first in product, rack order - the count, who, when"]
```

| | |
| --- | --- |
| the words | the same `CountedError` the release refuses with (`RefuseCounted`), so the cancel's refusal and a refused release name the same count |
| a courtesy, not the lock | a count planned after it answered still stops the release on `OrderCancelled`, which errors and is redelivered (`TestRace_OrderCancelled_RacingACountStartWaitsForIt`) |
| performance | 3 statements, ≈1 ms at 1 line and 20 — `TestPerf_OrderCancelled`; index lookups on `idempotency_order_check`'s key and `product_placement_logs_transaction_idx` |

### OrderCancelled — a cancelled order's stock back

The order's cancel moves its status and announces `OrderCancelled{K, warehouse}`; inventory releases the take by K
([inventory-returns-stock-on-order-cancelled](../../business/order/context_decision.md#inventory-returns-stock-on-order-cancelled)).
`inventory_v1.Service.OrderCancelled`
([order_cancelled_listener.go](../../../backend/services/inventory_service/inventory_v1/order_cancelled_listener.go)),
on subscription `inventory-order-cancelled` (topic `order-cancelled`, `event_type` filter, dead-letter).

```mermaid
sequenceDiagram
    participant PS as Pub/Sub
    participant H as /event/inventory-order-cancelled/push
    participant L as OrderCancelled listener
    participant DB as Postgres

    PS->>H: OrderCancelled - team, order, K, warehouse, actor
    H->>L: the decoded variant
    alt no key - an order that never took stock
        L-->>PS: 200 ACK - nothing claimed
    else
        L->>DB: releaseByKey(team, K, actor) - the RPC's own release
        alt taken by this team
            DB-->>L: rolled back, once
            L-->>PS: 200 ACK
        else already released - a redelivery, or a late InventoryTxCancel came first
            L-->>PS: 200 ACK
        else another team's take
            L-->>PS: 200 ACK - logged, nothing released
        else a stock count holds the take's rack - the cancel slipped past its check
            L-->>PS: 5xx NACK - redelivered until the count ends, then the dead-letter
        end
    end
```

| | |
| --- | --- |
| idempotency | by the key, as `InventoryTxCancel` — no `event_id` claim |
| the actor | the variant's `actor_id` — who cancelled — on the rollback's ledger rows |
| a count lock | an error; after the retry limit the dead-letter holds it — `san pubsub redrive --topic order-cancelled` once the count is over (other subscribers ack a redrive by their own idempotency) |
| performance | 14 statements to roll back 1 line (≈4.4 ms) or 20 (≈8.2 ms); 4 when already released (≈1 ms) — `TestPerf_OrderCancelled`; end to end with the cancel in `TestPerf_OrderCancel_CountCheckThenEvent` (cmd/app_development: the cancel 8 statements ≈2.5 ms) |
| races | `TestRace_OrderCancelled_AndALateTxCancelRollBackOnce`, `TestRace_OrderCancelled_RacingACountStartWaitsForIt` — [lock-order](../../../audits/services/inventory_service/concurrency/lock-order.md) |

### StockPickLocations — the pick page's racks, by transaction

✅ *(2026-11-04, backlog #10 slices 5–6)* [the-placement-page-reads-racks-by-transaction-id](../../business/inventory/order_decision.md#the-placement-page-reads-racks-by-transaction-id):
the pick page reads the order, then asks for the racks of its take by the order's `transaction_id`. The request's old
`ref` (first `order:<id>`, then the order's key, read through `idempotency_order_check`) is removed and its number and
name reserved.

```mermaid
sequenceDiagram
    participant UI as pick page
    participant S as selling OrderDetail
    participant H as StockPickLocations
    participant DB as Postgres
    UI->>S: OrderDetail(warehouse, order)
    S-->>UI: the order with transaction_id T
    UI->>H: warehouse_id W (scoped), transaction_id T
    H->>DB: product_placement_logs WHERE transaction_id = T AND warehouse_id = W
    Note over DB: JOIN placements, GROUP BY product, rack — SUM(-stock_change) HAVING > 0
    DB-->>H: per product, per rack, the net taken
    H-->>UI: the walk, product then rack label
```

| | |
| --- | --- |
| request | `warehouse_id` (`use_scope`, gt 0) · `transaction_id` (gt 0). `2` / `ref` reserved |
| policy | unchanged — root, administrator, warehouse owner / admin / staff; `NO_SIDE_EFFECTS` |
| another building | a transaction taken in another warehouse reads as an EMPTY walk — the `warehouse_id` filter, not an error |
| netting | the take and its rollback net per rack; a released take nets to zero and drops out (empty walk) |
| unknown transaction | empty walk, not an error |
| performance | 1 query, ≈0.5 ms at 1 and 20 lines over 50 000 placement log rows — index scan on `product_placement_logs_transaction_idx` (`TestPerf_StockPickLocations`); not heavy, no audit file |

### StockTakeQuote — what the take WOULD draw

✅ *(2026-10-23)* [an-order-is-costed-at-what-leaves-the-shelf](../../business/order/context_decision.md#an-order-is-costed-at-what-leaves-the-shelf):
every money figure of an order is the cost of the units that leave the shelf, so the order form previews the very
draw the take will make. `InventoryService.StockTakeQuote` (`inventory.proto`) is the take's own path with the lock
and the writes taken out — `inventory_mutations.QuoteOrder` beside `PostOrder`, both drawing through
`inventory_ledgers.DrawOldestFirst`, so the two cannot disagree about which units leave.

```mermaid
sequenceDiagram
    participant F as order form
    participant H as StockTakeQuote
    participant P as product_service
    participant DB as Postgres

    F->>H: team_id (the ORDERING team), warehouse, lines - product and quantity, each product once
    H->>P: ProductByIds - owner, private, reserve
    Note over H: notAllowedLines - the take's own rule. A line it would refuse answers nothing available
    H->>DB: ReadBatches - the owners' batches with units left, by id, NO lock
    Note over H: per line, product order - available = the owner's units, the same count the take refuses on
    Note over H: enough - DrawOldestFirst, the take's selection, changes nothing
    H-->>F: per line - owner, available, enough, total cost, unit cost, batches oldest first
```

| | |
| --- | --- |
| policy | Root, Administrator, Selling Owner, Selling Admin, Selling CS — scoped to the ordering team (what `StockCost`'s was before it admitted the warehouse roles) |
| a short line | reported, not refused: `enough` false, `available` the owner's units, and NO cost — the take would draw nothing |
| a line the take would refuse | a product that exists nowhere, another team's private one, or one below its reserve: `available` 0, no cost |
| cost, not markup | the form applies a borrowed product's own `cross_markup_bps` for its invoice, as the take does |
| the racks | not read — where a unit sits never changes what it cost |
| a preview that moved | another order may take the same units first; the order freezes the draw its take really made |
| `StockCost` | the shelf's AVERAGE, as the rack valuation computes it; no order reads it. Its caller is the warehouse product page, so since 2026-11-03 its policy admits the warehouse Owner, Admin and Staff too — a warehouse caller for its own building only (`filter.warehouse_id` = `team_id`, else PermissionDenied) |

Tests: `stock_take_quote_test.go` — a two-batch product quoted for 1, 2 and 3 units matches the batches and cost a
real take then draws. Performance: [StockTakeQuote.md](../../../audits/services/inventory_service/performances/StockTakeQuote.md)
— one query for own lines at any count, but the reserve rule it shares with the take reads once per borrowed line.

### An order comes back — `OrderTransactionReturn`

✅ *(2026-11-09, backlog #40)* An accepted return's parcel back on the **return warehouse's** shelves
([return_decision.md](../../business/inventory/return_decision.md)). Called in process by selling's
[`OrderReturnAccept`](../selling_service/rpc.md#the-return-warehouse-accepts-a-return--orderreturnaccept) through
`StockPicker.ReturnStock` (`cmd/app_development/stock_picker.go`), **before** the order moves — the accept has already
checked that the caller is the selling team's return warehouse
([only-the-return-warehouse-accepts-a-return](../../business/order/context_decision.md#only-the-return-warehouse-accepts-a-return)).
`inventory_v1.Service.OrderTransactionReturn`
([order_transaction_return.go](../../../backend/services/inventory_service/inventory_v1/order_transaction_return.go)) →
`inventory_mutations.PostReturn`
([post_return.go](../../../backend/services/inventory_service/inventory_mutations/post_return.go)), on the transfer's
own layer helpers (`outboundLayers`, `splitLayers`).

```mermaid
sequenceDiagram
    participant S as selling OrderReturnAccept - the stock picker, in process
    participant H as OrderTransactionReturn
    participant DB as Postgres

    S->>H: team_id = the return warehouse, selling_team_id, take_transaction_id, lines - sound, broken, missing, note, racks
    H->>DB: order_return_checks by the take - a plain read
    alt already returned
        H-->>S: that return and its door rows, posted false - nothing written
    end
    H->>DB: BEGIN
    H->>DB: the take FOR UPDATE - an order take of this selling team, not rolled back
    alt no such take
        H-->>S: NotFound - nothing written
    end
    H->>DB: order_return_checks again, under the lock - a twin that waited answers the first one's return
    H->>DB: the racks named are the return warehouse's
    H->>DB: the take's batch rows - its layers, each at its price when it left the shelf
    Note over H: every product once, sound + broken + missing = what it drew, the racks hold exactly the sound units
    H->>DB: one return transaction of the selling team at the return warehouse
    H->>DB: one batch per sound layer - price, expiry, suppliers kept, a borrowed line at the markup paid, as the mapped own product
    H->>DB: the sound units onto the racks named - refused whole under a count lock
    H->>DB: one item per product, equal to its batches
    H->>DB: order_return_problem_items - broken then missing off the newest layers, with the crew's note
    H->>DB: warehouse_products - the products the units came back as, linked to the return warehouse
    H->>DB: order_return_checks INSERT - the take claimed with its return, last
    H->>DB: COMMIT
    H-->>S: transaction_id, posted true, the door rows
```

| | |
| --- | --- |
| request | `team_id` = the RETURN warehouse (`use_scope`) · `selling_team_id` = the ordering team, the transaction's team and every minted batch's owner · `take_transaction_id` = the order's `transaction_id` · `lines` (1–200): per product the take drew `product_id`, `return_product_id`, `markup_rate`, `sound` / `broken` / `missing`, `note`, `placements` (racks of the return warehouse, ≤ 50) · `description` (*"return of order #12"*) |
| policy | Root, Administrator, Warehouse Owner / Admin / Staff — the people holding the parcel. The in-process call runs no interceptor: the accept's own policy and its return-warehouse check are the gate |
| once per take | `order_return_checks` (the take is the primary key, claimed in the return's own transaction, last). A take already returned answers that return with `posted = false` and writes nothing — so an accept whose status move failed after the stock went in is retried to the same transaction |
| the batches | one per layer the take drew with sound units, each keeping its price (the take's batch row's `price_unit_after`), expiry and suppliers, owned by the selling team; the minted total of a whole parcel is the order line's frozen total ([a-return-mints-one-batch-per-batch-the-order-took](../../business/inventory/return_decision.md#a-return-mints-one-batch-per-batch-the-order-took), the transfer's [the-receiver-mints-one-batch-per-source-batch](../../business/inventory/warehouse_transfer_decision.md#the-receiver-mints-one-batch-per-source-batch)) |
| a borrowed line | comes back as the selling team's mapped own product (`return_product_id`, which must differ from `product_id`; an own line must keep it) and each layer at its price × (1 + the markup the team paid) — at 20 %, Rp 10.000 comes back as Rp 12.000 ([a-returned-borrowed-unit-is-relabelled-at-the-accept](../../business/order/context_decision.md#a-returned-borrowed-unit-is-relabelled-at-the-accept), [an-own-line-never-touches-the-map](../../business/order/context_decision.md#an-own-line-never-touches-the-map)). The lender's batches are untouched |
| broken / missing | `order_return_problem_items`, one row per product and kind, off the **newest** layers (broken before missing), priced at what the team paid, with the crew's note — the **selling team's**: no payable, no claim, not in Inventory Lost ([a-short-return-is-missing-at-the-door](../../business/inventory/return_decision.md#a-short-return-is-missing-at-the-door), [a-broken-returned-unit-is-thrown-away-at-the-door](../../business/inventory/return_decision.md#a-broken-returned-unit-is-thrown-away-at-the-door), [a-return-door-row-carries-an-optional-note](../../business/inventory/return_decision.md#a-return-door-row-carries-an-optional-note)) |
| nothing sound | still one `return` transaction, with no batch and no item — the count happened ([a-transaction-is-made-when-the-act-happens](../../business/inventory/transaction_decision.md#a-transaction-is-made-when-the-act-happens)) |
| the racks | refused whole, naming the count, when a stock count holds the product on a rack named ([a-lock-stops-sales-and-cancels-too](../../business/inventory/opname_decision.md#a-lock-stops-sales-and-cancels-too)); the products the sound units came back as are linked to the return warehouse ([a-transfer-links-its-products-to-the-receiver](../../business/inventory/context_decision.md#a-transfer-links-its-products-to-the-receiver)) |
| refusals | a count holding a rack — `FailedPrecondition` with the count's `CountedError`; a rack of another building, or a take that is not this team's standing order take (another team's, a rolled-back one) — `NotFound`; a count that does not fit the take (a product it never drew, one named twice or not at all, the three counts not what it drew, racks not holding exactly the sound units, a borrowed line not relabelled) — `InvalidArgument`; a twin's claim met at commit — `AlreadyExists` |
| performance | 20 statements for 1 line and for 20, 7.7 / 15.3 ms median over the background volume (an earlier run 20 / 18 ms) — flat, no N+1, every read an index scan; over the 5-statement line by the count alone, no fix proposed: [OrderTransactionReturn.md](../../../audits/services/inventory_service/performances/OrderTransactionReturn.md) |
| races | `TestInterleave_OrderTransactionReturn_SecondWaitsOnTheTake`, `TestRace_OrderTransactionReturn_OnceForEightCallers`; over the real stack with the accept, `TestRace_OrderReturnAccept_OneReturnTransaction` (`cmd/app_development`) — [lock-order](../../../audits/services/inventory_service/concurrency/lock-order.md#an-order-comes-back-on-its-return-2026-11-09) |

Tests: `order_transaction_return_test.go` — a batch per batch the take drew (price, expiry, supplier), a borrowed line
back as the own product at the markup, broken and missing as door rows (no payable, no problem row), written once, every
refusal above, a rolled-back take, a rack a count holds.

---

## Warehouse transfers

A selling team moves its OWN stock from one warehouse (A) to another (B) — **three teams on one record**: the team opens
it, A processes and ships it, B signs for it and counts it in. The design is
[warehouse_transfer.md](../../business/inventory/warehouse_transfer.md) and its decisions in
[warehouse_transfer_decision.md](../../business/inventory/warehouse_transfer_decision.md).

> **Built on the decided ledgers** — `inventory_v1/warehouse_transfer_*.go`, one file per RPC, the legs in
> `inventory_mutations/post_transfer.go` (`PostTransferOut`, `PostTransferIn`). It supersedes
> `InventoryService.StockTransfer`, the instant one-product move, which nothing calls and the cut-over retires.
> Money on the wire is `double`, rupiah as the `double` columns hold it — unrounded (since 2026-11-06, part 2 of
> [every-ledger-moves-to-double-rounded-when-frozen](../../business/order/context_decision.md#every-ledger-moves-to-double-rounded-when-frozen)).

| RPC | Who | From → to | What it does |
| --- | --- | --- | --- |
| `WarehouseTransferCreate` | selling team | → created | the transfer, its lines and its `transfer_out` at A in one transaction — below. With a cost, the paying account must be one of the team's ACTIVE accounts — operational or not (a-transfers-shipping-is-paid-from-any-active-account) — asked before anything is written (FailedPrecondition naming it, *"… is not one of the team's active accounts"*; [the paying account](#the-paying-account--one-of-the-teams-active-operational-accounts) shows the seam) |
| `WarehouseTransferList` / `Detail` | any side | — | rows where the team owns it, or is A, or is B; a fourth team reads **NotFound**. `direction` splits a warehouse's outgoing from its incoming |
| `WarehouseTransferUpdate` | selling team | until accepted | the shipping cost, its account and the note — never the lines. A CHANGED account must be one of the team's active accounts, operational or not (asked before the lock, judged under it); an unchanged one is kept even if archived since. Not a status change: no trail row. An edit that moved money bumps `cost_revision` and publishes *Warehouse Transfer Updated* with both sides |
| `WarehouseTransferCancel` | selling team | created → cancelled | rolls the `transfer_out` back (`RollbackTake`) under the transfer's lock; publishes *Warehouse Transfer Cancelled* — the cost back to its account |
| `WarehouseTransferMarkLost` | selling team | shipped → lost | the loss is the team's |
| `WarehouseTransferProcess` | A | created → process | from here on there is no cancel |
| `WarehouseTransferShip` | A | process → shipped | the courier, tracking number and label photo — all optional |
| `WarehouseTransferArrive` | B | shipped / lost → arrived | signs for the box |
| `WarehouseTransferAccept` | B | shipped / arrived → accepted | counts the box in — below |
| `WarehouseTransferLabelPhoto` | any side (+ Root, Administrator) | any | a signed link to A's label photo, for A, B and the owning team — below |

### WarehouseTransferLabelPhoto — every side opens the label photo

The photo A attached at ship (`receipt_file`, A's own upload through ReceiptUpload) is opened by **all three sides**: A,
B to match the parcel at its door, and the selling team that owns the transfer and paid for the shipping
([every-side-of-a-transfer-opens-its-label-photo](../../business/inventory/warehouse_transfer_decision.md#every-side-of-a-transfer-opens-its-label-photo)).
Policy: Root, Administrator, Selling Owner / Admin / CS, Warehouse Owner / Admin / Staff — Detail's roles; `team_id` is
the scope; `NO_SIDE_EFFECTS`.

```mermaid
sequenceDiagram
    participant W as any side's transfer detail
    participant I as inventory WarehouseTransferLabelPhoto
    participant D as document_service LabelURL, in-process
    W->>I: team_id = the reading team, transfer_id
    I->>I: warehouse_transfers WHERE id AND team_id, from_warehouse_id or to_warehouse_id = team_id
    alt a fourth team or no such transfer
        I-->>W: NotFound
    else receipt_file empty
        I-->>W: FailedPrecondition - this transfer has no label photo
    else
        I->>D: owner = A, the from_warehouse_id, and receipt_file
        D-->>I: signed url and expiry, or NotFound
        I-->>W: url, expires_at_unix - NotFound from D reads as no label photo
    end
```

The seam is the restock's: inventory's `ReceiptPhotoLinker` (`cmd/app_development/restock_photo_linker.go`), told the
owner by inventory — here A — never by the browser; it signs only an active `order_receipt` of that owner. No
`document_shares` row: GetDownloadUrl as B or the seller stays NotFound. All three screens call this RPC
(`features/warehouseTransfer/TransferDetailCards.tsx` `LabelPhoto`), A included. Code
`inventory_v1/warehouse_transfer_label_photo.go`; audit
[WarehouseTransferLabelPhoto.md](../../../audits/services/inventory_service/performances/WarehouseTransferLabelPhoto.md)
(1 PK lookup); e2e `transfers.spec.ts` *every side opens the label photo, a fourth team is refused*.

### Lifecycle

```mermaid
stateDiagram-v2
    [*] --> created: Create — selling team, stock leaves A
    created --> cancelled: Cancel — selling team
    created --> process: Process — A confirms
    process --> shipped: Ship — A hands to the courier
    shipped --> lost: MarkLost — selling team
    shipped --> arrived: Arrive — B signs
    lost --> arrived: Arrive — the box turns up
    shipped --> accepted: Accept — B counts on arrival
    arrived --> accepted: Accept — B
    accepted --> [*]
    cancelled --> [*]
```

Every status change takes the transfer row `FOR UPDATE` first, then batches, then shelves, each in id order, and checks
the status under the lock — a cancel racing A's confirm, or two accepts of one box, cannot both succeed
([a-transfer-is-locked-before-any-status-change](../../business/inventory/warehouse_transfer_decision.md#a-transfer-is-locked-before-any-status-change)).

### The create transaction — the stock leaves A

```mermaid
sequenceDiagram
    participant S as Selling team
    participant H as WarehouseTransferCreate
    participant DB as Postgres - one tx
    participant F as financial_account_service

    S->>H: from, to, lines [product, count], note, shipment_cost + account
    H->>H: from equals to, a product twice, or a cost without an account → InvalidArgument
    H->>H: ask product_service — a product not the team's own → InvalidArgument
    H->>F: with a cost, ask the account in-process — archived or not the team's → FailedPrecondition
    H->>DB: warehouse_transfers row, created — so the out-leg can name it
    H->>DB: lock A's batches of every line, in product order, and count them
    alt any line short
        H-->>S: FailedPrecondition naming every short line — the whole transaction rolls back
    else enough
        H->>DB: inventory_transactions row — transfer_out at A
        H->>DB: batch_logs oldest first, every line — then product_placement_logs fewest racks first
        H->>DB: items equal to the batch rows, the lines with their totals, the out-leg and total on the transfer
        H->>DB: warehouse_products for B, the first trail row, COMMIT
        H--)F: Warehouse Transfer Created after commit — the account and the cost, 0 included
        H-->>S: the transfer, created, with its pick list read back from the rack rows
    end
```

### The accept transaction — the stock arrives at B

```mermaid
sequenceDiagram
    participant B as Warehouse B member
    participant H as WarehouseTransferAccept
    participant DB as Postgres - one tx
    participant BAL as balance - by event

    B->>H: lines [item, arrived, broken, notes, placements], courier charge + note
    H->>DB: SELECT transfer WHERE id AND to_warehouse_id FOR UPDATE
    alt not this warehouse's
        H-->>B: NotFound
    else not shipped or arrived
        H-->>B: FailedPrecondition
    else a line missing, doubled, over its count, broken above arrived, or not all good units placed
        H-->>B: InvalidArgument
    else the count is complete
        H->>DB: read the out-leg's batch rows — the layers, per product, oldest first
        H->>DB: inventory_transactions row — transfer_in at B, even when nothing arrived good
        loop every line
            H->>DB: one batch at B per source layer with good units, at the layer's price when it left A
            Note over H,DB: good units fill the oldest layers, broken then missing come off the newest
        end
        H->>DB: the good units onto B's racks, items equal to the batch rows
        H->>DB: arrived counts on the lines, problem rows priced from their layers
        H->>DB: the courier charge and its note on the transfer
        H->>DB: status accepted, trail row, COMMIT
        H-->>B: the transfer, accepted
        H--)BAL: Warehouse Transfer Accepted, after commit — the charge, 0 included
        Note over BAL: the selling team owes B the charge, once per transfer — nothing for 0
    end
```

| Rule | Decision |
| --- | --- |
| the stock leaves A at create; too few fails the create | [a-transfer-takes-from-the-sender-at-create](../../business/inventory/warehouse_transfer_decision.md#a-transfer-takes-from-the-sender-at-create) |
| in transit, the units are in neither warehouse's book, only in the transfer | [the-transfer-is-where-goods-in-transit-are](../../business/inventory/warehouse_transfer_decision.md#the-transfer-is-where-goods-in-transit-are) |
| B mints one batch per source batch; the trip never changes a unit's price | [the-receiver-mints-one-batch-per-source-batch](../../business/inventory/warehouse_transfer_decision.md#the-receiver-mints-one-batch-per-source-batch), [a-transfer-never-changes-a-units-price](../../business/inventory/warehouse_transfer_decision.md#a-transfer-never-changes-a-units-price) |
| every price is the system's, from the batch rows | [the-system-fills-a-transfers-prices](../../business/inventory/warehouse_transfer_decision.md#the-system-fills-a-transfers-prices) |
| broken, missing and lost are the selling team's loss | [the-selling-team-bears-broken-missing-and-lost](../../business/inventory/warehouse_transfer_decision.md#the-selling-team-bears-broken-missing-and-lost) |
| the shipping expense reaches the account by event; B pays the on-site charge and saves it at accept, and balance posts the debt from the accepted event | [the-shipping-expense-reaches-the-account-by-event](../../business/inventory/warehouse_transfer_decision.md#the-shipping-expense-reaches-the-account-by-event), [the-on-site-charge-is-paid-by-b-at-accept](../../business/inventory/warehouse_transfer_decision.md#the-on-site-charge-is-paid-by-b-at-accept), [balance-posts-the-transfers-on-site-debt-from-the-event](../../business/inventory/warehouse_transfer_decision.md#balance-posts-the-transfers-on-site-debt-from-the-event) |
| one line per product, one problem row per product per kind | [a-product-appears-once-per-transfer](../../business/inventory/warehouse_transfer_decision.md#a-product-appears-once-per-transfer) |
| the receiving warehouse can find what is coming | [a-transfer-links-its-products-to-the-receiver](../../business/inventory/context_decision.md#a-transfer-links-its-products-to-the-receiver) |

**Choices the build made, inside the decisions** — none is a new rule; each is where the decisions were silent:

| | |
| --- | --- |
| the price B's batch copies | the source batch's `price_unit_after` on the out-leg's row — its price when it left A, so a revaluation at A after the out-leg never reaches B |
| broken and missing on one newest layer | broken first, then missing |
| a pick list and a put-away | never stored: read back from the legs' `product_placement_logs` (takes are negative, puts positive) |
| the events | four, published after commit and never failing the request: *Created* (every create, cost 0 included), *Updated* (only an edit that moved money, id `…:<cost_revision>`), *Cancelled*, *Accepted* (every accept, charge 0 included). Their money is `double` from day one. ✅ Heard since 2026-11-04: `transfer_shipping_listener.go` (financial account, the shipping cost) and `transfer_courier_charge.go` (liability, `transfer_fee` on *Accepted*) |
| not checked | that A and B are warehouse teams — as a restock's warehouse is not; a transfer to a team with no warehouse roles simply waits, unaccepted |

Proven under concurrency by `warehouse_transfer_race_test.go` (`-tags raceaudit`): eight accepts of one box count it in
once, sixteen creates never send more than A holds and never deadlock with their lines in opposite order, a cancel
racing A's confirm and a lost racing an accept each end in exactly one, and an Interleave shows a second accept waiting
on the first one's lock.

---

## Stock lives on the decided ledgers — and what that changes about reads

Every reader reads the ledgers ([database-schema.md § The decided ledgers](../../database-schema.md#the-decided-ledgers-00025-00026)),
and nothing reads the dropped `stock_*` tables. One idea explains most of the surprises:

> **A rack row counts units of ONE product on ONE rack; a batch counts units of ONE delivery. Neither knows the other.**

- **Where** a product sits is `product_placements` (one row per product per rack, its count after every change in
  `product_placement_logs`). `StockList`, `WarehouseStockList`'s on hand, `ProductPlaces`, `PlacementList`, `RackList`'s
  stock slice, `RackStock` and `RackHistory` read these.
- **What it is worth** is `batches` (price, units, value — `stock_valuation` is the truth). `StockAvailability`,
  `StockCost`, the batch and cost-layer reads and every owner read use these; the owner is `batches.team_id`.
- **No row carries both**, so a product's history without a batch reads the rack rows and with one reads the batch's
  rows; a batch's "racks" are where it was put away when it was minted
  ([a-batch-shows-the-racks-it-was-put-on](../../business/inventory/batch_decision.md#a-batch-shows-the-racks-it-was-put-on)).
- **There is no unplaced pile** ([there-is-no-unplaced-pile](../../business/inventory/restock_decision.md#there-is-no-unplaced-pile)):
  every unit is on a rack, and a request naming "unplaced" is refused.
- **"Last counted"** is the later of the newest `adjustment` rack row (a recount writes one even when it finds the rack
  exact) and the last FINISHED stock count that held a row there — a count writes nothing on a rack it found exact.

### A stock-take counts a RACK (#139) — provisionally, as an `adjustment`

`StockAdjust`'s recount survives the cut-over as a provisional `adjustment` transaction — its found is a found request
now, § Found stock waiting for approval (the one-rack
`StockOpname` is retired; damaged and lost are a shelf report on the register — § Broken, lost, and found)
([old-shelf-corrections-move-onto-the-ledgers-provisionally](../../technical/stock/design_decision.md#old-shelf-corrections-move-onto-the-ledgers-provisionally));
every choice the port made is open in [adjustment_clarify.md](../../business/inventory/adjustment_clarify.md). The
request must say which rack it counted — a required `oneof`, re-checked by the handler — and "unplaced" is refused.

```mermaid
sequenceDiagram
    participant W as Warehouse manager
    participant H as StockAdjust - recount
    participant DB as Postgres - one tx
    W->>H: product, rack A-01-3, counted 37
    alt no rack named, or unplaced
        H-->>W: InvalidArgument
    else a rack of this warehouse
        H->>DB: lock the owner's batches of the product, then the rack row
        alt counted below the rack
            H->>DB: adjustment tx - the shortfall off the rack, and off the batches oldest first
        else counted above
            H->>DB: adjustment tx - a batch minted at the owner's newest price here, onto the rack
        else exact
            H->>DB: adjustment tx - a 0 rack row, so the rack reads as counted
        end
        H->>DB: the warehouse's total after, read back, COMMIT
        H-->>W: Movement - the rack's change and count after, plus the warehouse total
    end
```

Correcting one rack leaves the product's other racks **exactly as they were**. Damaged, lost and found name a batch
and take from or return to it; a damaged or lost unit is owed to its owner inside the transaction and written off to
expense after it (§ Broken, lost, and found).

### Reading a rack, and why it needs another service (#138)

`RackStock` answers the question a person standing at a shelf actually has: **what is on THIS rack, and
how much of each**. It is the mirror of `StockList` — that one sums a product *across* its racks
("how much of X does this warehouse hold"), this one reads a single rack.

Two things it refuses to conflate:

- **Another warehouse's rack is NotFound, never an empty shelf.** If "not yours" looked like "nothing
  on it", a probe could map another warehouse's rack ids by which came back empty.
- **A line counted to zero is not on the rack.** A level can fall to 0 without being deleted (a
  stock-take zeroing a shelf), and listing it would show a product that is not there.

**It returns product ids only — never names.** That is not laziness, it is the service boundary: a
warehouse holds **other teams' goods** (a selling team's restock puts its product on this shelf), so
the ids belong to catalogues `inventory_service` does not own, and inventing a name for them would be
guessing. The caller resolves them through `product_service`'s **`ProductByIds`** — added for exactly
this, and the reason the §4 question ("whose product is in whose warehouse") had to be settled before
this screen could exist. Two things that decision is honest about: it is **new exposure for warehouse
roles**, and *"only what it holds"* is **not enforced** and cannot be by `product_service`, which
does not know what any warehouse holds.

### Moving stock inside a warehouse (#136)

A move is `RackMove` (below) — `StockMove`, `StockReceive`, `StockTransfer`, `StockPick` and `StockReturn` are gone:
goods come in by a restock, move between racks by `RackMove`, leave for an order by `OrderTransactionCreate`, and go to
another warehouse by a warehouse transfer. **A rack that still holds stock cannot be deleted** (#138) —
`FailedPrecondition`, empty it first; the check sums its `product_placements` rows, because `RackDelete` is a soft delete
and the FK never fires. **Nor can a rack a stock count holds** ([a-rack-a-count-holds-cannot-be-deleted](../../business/inventory/opname_decision.md#a-rack-a-count-holds-cannot-be-deleted)): the rack row is
locked `FOR UPDATE` first, then `RefuseRackCounted` reads, in a statement of its own, an open snapshot row on it or an
active `all` count. A count's plan locks its rack rows `FOR SHARE OF pp, p`, so the two queue: the delete is refused, or
the count re-checks `deleted_at` and leaves the rack out (`TestRace_RackDelete_RacingACountPlan`,
`TestInterleave_RackDelete_ThePlanLeavesTheDeletedRackOut`).

### `RackMove` and `RackSample` — on the decided ledgers

The placement decisions ([placement_decision.md](../../business/inventory/placement_decision.md)) give a rack two writes
of its own, both opened from Rack detail: **Move Goods** — staff reorganizing space, from one rack to one or more — and
**Record Sample** — goods handed to a person at the warehouse
([a-sample-is-handed-over-at-the-warehouse](../../business/inventory/transaction_decision.md#a-sample-is-handed-over-at-the-warehouse)).

> ✅ *(2026-10-16)* **Built on the decided ledgers** (`inventory_mutations.PostMove`, `PostSample`; tests in
> `rack_move_test.go`, `rack_sample_test.go`, races in `rack_move_race_test.go`). The rack screens read the ledgers, and
> `RackMove` replaced `StockMove`, whose one product, one batch and *unplaced* end all went.

| RPC | Who | What it writes |
| --- | --- | --- |
| `RackMove` | any warehouse member ([any-warehouse-member-may-move-goods](../../business/inventory/placement_decision.md#any-warehouse-member-may-move-goods)) | per owning team, one `move` transaction: per product, minus on the source rack and plus on each destination, nothing in the batch ledger ([a-move-writes-two-rack-rows-and-no-batch-row](../../business/inventory/placement_decision.md#a-move-writes-two-rack-rows-and-no-batch-row)) |
| `RackSample` | any warehouse member | per owning team, one `sample` transaction: minus on the request's rack ([a-sample-names-the-rack-it-was-taken-from](../../business/inventory/placement_decision.md#a-sample-names-the-rack-it-was-taken-from)), oldest batch first. Final: never rolled back ([a-handed-over-sample-is-final](../../business/inventory/placement_decision.md#a-handed-over-sample-is-final)) |

```mermaid
sequenceDiagram
  participant S as staff
  participant R as RackMove
  participant DB as Postgres
  S->>R: from A-01-1 — Kopi 4 to A-01-2, Gula 5 to A-01-2
  R->>DB: BEGIN
  R->>DB: lock the source and destination shelf rows, in id order
  R->>R: every line checked first — not counting, at most stock_count, no rack twice
  alt any line does not fit
    R->>DB: ROLLBACK
    R-->>S: FailedPrecondition — names the product, nothing moved
  else every line fits
    R->>DB: tx 7001 move, team 11 — Kopi -4 on A-01-1, +4 on A-01-2
    R->>DB: tx 7002 move, team 13 — Gula -5 on A-01-1, +5 on A-01-2
    R->>DB: COMMIT
    R-->>S: transactions 7001 and 7002
  end
```

The rules, as the stub played them and the handlers now keep:

| | |
| --- | --- |
| one rack to one or more | every destination in the team's warehouse, never the source; a product may be split, never twice to one rack ([a-move-is-one-rack-to-one-or-more-racks](../../business/inventory/placement_decision.md#a-move-is-one-rack-to-one-or-more-racks)) |
| all or nothing | one database transaction for every team's transaction; any line that does not fit refuses the whole write, naming the product ([a-move-is-all-or-nothing](../../business/inventory/placement_decision.md#a-move-is-all-or-nothing)) |
| one transaction per owning team | the response lists them in team id order ([a-move-writes-one-transaction-per-owning-team](../../business/inventory/placement_decision.md#a-move-writes-one-transaction-per-owning-team)) |
| the ceiling | a line takes at most the rack's stock count, so sold units waiting for the picker stay ([a-move-leaves-sold-units-on-their-rack](../../business/inventory/placement_decision.md#a-move-leaves-sold-units-on-their-rack)) |
| a product being counted | refused, naming the count (a-lock-stops-sales-and-cancels-too); `RackStockLine.counting` tells the dialog to lock it at 0 — read from the open snapshot rows |
| `RackList` STOCK slice | real today: each rack's stock count and product count for the Racks page, one grouped `SUM`/`COUNT` over the page's racks, only when asked — a picker never pays for it |
| `RackSample.recipient` | required, who received it, kept on the transaction ([a-sample-keeps-its-recipient](../../business/inventory/transaction_decision.md#a-sample-keeps-its-recipient)). No member of the owning team is asked to agree, and the sample posts nothing to balance ([a-sample-is-a-stock-out-at-batch-value](../../business/inventory/transaction_decision.md#a-sample-is-a-stock-out-at-batch-value)) |

---

## Accepting a delivery (#154, #155, #157)

Accepting is **counting** — what is in the box and how many are broken, per line — and **saying where the good units
went**, with the courier's charge at the door beside it. That is a form with sections, so the warehouse's Accept surface
is a **page**, not a dialog.

```mermaid
sequenceDiagram
    autonumber
    participant W as Warehouse member
    participant UI as Accept page
    participant I as inventory_service

    UI->>I: RestockRequestDetail — the lines, their notes
    UI->>I: ProductPlaces — where these products already live
    Note over W,UI: type received and broken, split the good units across placements, type the courier's charge and its note — HPP updates live
    UI->>I: RestockRequestAccept
    I-->>UI: the accepted restock
```

### The rules the screen mirrors

| Rule | Why |
| --- | --- |
| A blank count is **not** zero | 0 means "looked, none of it was in the box". Blank means nobody counted. |
| Received above the line's count **blocks** Accept | the selling team adds the extra by an edit first (accept-refuses-more-than-the-line-says) |
| Missing is **worked out**, never typed | ordered − received (a-short-unit-at-the-door-is-missing) |
| Placements must **sum** to received − broken | counting 8 good and placing 7 is an error in one of the two |
| The courier's charge needs a note, and sits **outside** the total | the-courier-is-paid-once-per-restock, the-couriers-charge-stays-out-of-total |

The guard is a single expression mirroring the handler's rules — a second one beside it is how a screen's idea of
"ready to send" drifts from the handler's idea of "acceptable". The HPP preview mirrors the accept's arithmetic, the
courier's charge included, so the figure on screen is the one the batch freezes.

---

## The paying account — one of the team's active operational accounts

Built 2026-11-05 — [a-restock-names-its-paying-account](../../business/inventory/restock_decision.md#a-restock-names-its-paying-account),
on the seam expense's *Paid from* uses. inventory_service owns an interface, `PayingAccounts`
([paying_accounts.go](../../../backend/services/inventory_service/inventory_v1/paying_accounts.go)); the composition
root's [restock_accounts.go](../../../backend/cmd/app_development/restock_accounts.go) answers it in-process from
`FinancialAccountByIds` (team-scoped — another team's account is absent; the lookup `teamAccount` is shared with
[expense_accounts.go](../../../backend/cmd/app_development/expense_accounts.go)).

```mermaid
sequenceDiagram
  participant UI as restock form
  participant I as inventory_service
  participant FA as financial_account, in-process
  participant DB as restocks
  UI->>I: RestockRequestCreate or Update(team, finance_account_id, lines)
  I->>FA: FinancialAccountByIds(team, the account) - BEFORE any transaction or lock
  alt Create, or an ongoing Update that CHANGES the account
    alt absent, archived, or not marked operational
      I-->>UI: FailedPrecondition, naming the account
    else the team's active operational account
      I->>DB: write the restock
    end
  else an Update keeping the account it holds
    I->>DB: write the restock - the account is preserved, even if archived since
  end
```

| | |
| --- | --- |
| refused | FailedPrecondition: *"BCA Tabungan is not one of the team's active operational accounts — pick another, or ask an admin to mark it operational"*, *"… is archived — …"*, or *"account #N …"* for another team's or an unknown id (never confirms an id) — the same words as expense's |
| 0 | asks nothing: Create's contract refuses 0 (`uint64.gt = 0`), an ongoing Update refuses it in the handler, and an arrived restock raised before paying accounts keeps its 0 |
| no seam wired | `NewService(…, nil)` counts every account as active and operational — unit tests only; the composition root always wires the real one |
| concurrency | the call happens before the transaction (Create) and before `FOR UPDATE` (Update); proved by `restock_request_account_race_test.go` ([audit](../../../audits/services/inventory_service/concurrency/RestockRequestUpdate.md#the-paying-account-2026-11-05)) |
| cost | three indexed reads outside the transaction, ≈0.5 ms ([Create](../../../audits/services/inventory_service/performances/RestockRequestCreate.md), [Update](../../../audits/services/inventory_service/performances/RestockRequestUpdate.md)) |

**Warehouse transfers too** (2026-11-05,
[a-transfer-names-its-paying-account](../../business/inventory/warehouse_transfer_decision.md#a-transfer-names-its-paying-account)):
`WarehouseTransferCreate` and `WarehouseTransferUpdate` ask the same seam, with the same words and the same rules, for
the account that pays the shipping — the transfer's owning (paying) team's. No second adapter: `restockPayingAccounts`
is team-scoped and answers both. Differences:

| | transfer |
| --- | --- |
| 0 | a transfer with no cost names no account (the handler drops it), so nothing is asked |
| create | asked after the product check and BEFORE the receiver's product link, so a refused create writes nothing |
| update | judged under the transfer's `FOR UPDATE` only when the account CHANGES (a cost going from 0 to above 0 always does); dropping the cost to 0 is never refused |
| mapping | `errAccountNotOperational` (paying_accounts.go) → FailedPrecondition in `transferErr`, as in `restockErr` |
| concurrency | `warehouse_transfer_account_race_test.go` ([audit](../../../audits/services/inventory_service/concurrency/WarehouseTransferUpdate.md)) |
| cost | the same three reads ([Create](../../../audits/services/inventory_service/performances/WarehouseTransferCreate.md#the-paying-account-2026-11-05), [Update](../../../audits/services/inventory_service/performances/WarehouseTransferUpdate.md)) |

## RestockInboundStat — the receiving warehouse's headline (owner, 2026-07-30)

The mirror of `OwnerStockStat` below, and it exists **because it is not the same question**. The buyer
asks *what have I committed that has not landed*; the warehouse asks *what work is still at my door*.

```mermaid
flowchart LR
    subgraph "the same rows, read from two ends"
      RR["restocks (ongoing or arrived)"]
      RI[restock_items]
      RI --> RR
    end
    RR -->|"team_id = team"| O["OwnerStockStat — money committed"]
    RR -->|"warehouse_id = team"| I["RestockInboundStat — work waiting"]
```

Four figures over **ongoing and arrived restocks coming to this warehouse**, narrowed by the same
`requesting_team_id` lens the list uses — a headline that ignored the filter under it would contradict
the table it sits above.

| Figure | What it is | Why not the obvious thing |
| --- | --- | --- |
| `restock_count` | `COUNT(*)` over the pending REQUESTS | Over requests, not the item join — a two-line delivery is **one** delivery. 3 deliveries of 400 pieces and 30 of 400 are the same stock and completely different amounts of door-opening. |
| `product_count` | **DISTINCT** `product_id` across the queue | Counting LINES reports 4 for one product on four deliveries. It is one thing to find a shelf for, and put-away is the job this number sizes. |
| `unit_count` | Σ ordered `count` | The **asked** quantity — nobody has counted these yet, which is exactly why they are in the queue. |
| `amount` | Σ line `total`, a double | **Goods only.** Shipping is what the buying team paid to get them moving and the courier's charge is 0 until someone accepts, so either would answer a question about somebody else's spending. |
| `oldest_pending_unix` | `MIN(created_at)` over the REQUESTS | Over requests, not their lines — a line-less request still waits at the door, and a MIN over the item join would skip it. A count of 7 hides the box that has sat since Monday. |

**Still coming is the whole meaning of it** — on its way, or at the door not yet counted. An accepted restock has
become stock; a lost or cancelled one never arrives. Either leaking in produces a queue that never drains.

`MIN`/`MAX` over no rows is **NULL, not 0** — the scan target is nullable, and an empty queue reports
`0` (the RPC's "never"), which the UI renders as an em dash rather than "0 days".

Its policy carries **warehouse roles only** — this is deliberately not one RPC serving both sides.
`OwnerStockStat`'s policy has no warehouse roles at all, so the receiving crew would have got
PermissionDenied from it; letting one RPC answer both is how two different numbers silently converge.

## OwnerStockByIds / OwnerStockStat — the catalogue owner's stock (the selling team's product list)

Every other read in this service answers **for a warehouse**: the caller is the building, and
`team_id` is that building's team. These two answer **for the selling team that owns the goods** —
*how much of my product is on a shelf, anywhere, and what is it worth* — which no RPC could answer
before.

### Ownership is written on the batch

A batch carries its owner, written at mint and never changed
([a-batch-carries-its-owner](../../business/inventory/warehouse_transfer_decision.md#a-batch-carries-its-owner)): the
restock's selling team, or the source batch's at a transfer. Every owner read filters `batches.team_id`, so a caller
passing another team's product id matches none of its batches and gets nothing back — no climb through restocks, and
no trust placed in the client.

```mermaid
flowchart LR
    R["restock accept - team 12's restock"] -->|"team_id = 12"| B7["batch 7 at Gudang A"]
    B7 -->|"transfer accept copies it"| B31["batch 31 at Gudang B - team 12"]
    B7 --> Q["OwnerStockByIds as team 12 - both batches"]
    B31 --> Q
```

### The page's three reads

The product list is one screen over three services, and each answers for the **whole page** rather
than per row — a per-row fetch is an N+1 that only reveals itself once a real catalogue is loaded.

```mermaid
sequenceDiagram
    participant UI as Products (selling team)
    participant P as product_service
    participant I as inventory_service
    participant S as selling_service

    UI->>P: ProductList (team, ACTIVE or ARCHIVED, q, page)
    P-->>UI: the page's products + ids

    par one round trip, two services
        UI->>I: OwnerStockByIds (team, ids, warehouse lens)
        I-->>UI: ready, ongoing, HPP spread, oldest batch, last restock
    and
        UI->>S: OrderProductActivityByIds (team, ids)
        S-->>UI: last order, units sold in 30d
    end
```

The stat row above the tabs is the same three questions asked of the whole catalogue —
`ProductList` for the count, `OwnerStockStat`, `OrderActivityStat` — and deliberately **not** a total
of the visible page: a headline that moved every time somebody typed in the search box would be
describing the search rather than the business.

### The rules these reads keep

| Rule | Why |
| --- | --- |
| Unknown-cost batches add **units, not money** | A batch whose HPP was never recorded is not free (#74). It counts in `ready_qty` and contributes nothing to `ready_value`; `cost_known` says whether the spread means anything at all. |
| The cost **spread**, not an average | The same product genuinely arrives at different prices. The average is exactly what hides that. |
| Oldest batch = oldest with **ready units** | A delivery that has sold out is not old stock; it is gone. Dating the column from it would flag healthy products as stale. |
| Ongoing is an **estimate** and never summed into ready | Its cost settles on what actually lands (#74). |
| A **cancelled** order is not a sale | On the selling side, both `last_order_unix` and the 30-day units exclude cancelled orders — otherwise a dead product reads as alive on the strength of a mistake somebody corrected. |
| A product with nothing behind it is **absent**, not zeroed | The caller knows which ids it asked about. "Nothing to say" travels lighter, and the UI renders it as *unknown* rather than a confident `0` beside a full shelf. |

### The warehouse lens

`filter.warehouse_id = 0` means every warehouse holding this team's goods. Set it and **every figure
restates as that one building's** — which is the honest reading, because stock is held per warehouse
and a total can never tell you whether *one* of them can fill an order. The UI says so out loud by
appending the warehouse's name to each stock column header.

## OwnerCostLayerList / OwnerBatchList / OwnerStockHistory — the owner's product DETAIL (#232)

`OwnerStockByIds` above answers per-product aggregates. These three answer **what those aggregates are
made of**, behind the selling team's product detail: its Price, Batch and Stock history tabs, which
until now had never shown a row.

They are not new questions — `CostLayerList`, `BatchList` and `StockHistory` have answered them for a
warehouse all along. But every one of those is scoped to the **warehouse team** and admits **warehouse
roles only**, so a selling team has no building to name and no role to ask with. The three owner reads
are the same questions asked by the team that owns the goods:

| | scope | warehouse | who may call |
| --- | --- | --- | --- |
| `CostLayerList` / `BatchList` / `StockHistory` | the warehouse team | **is** the scope | warehouse roles |
| `OwnerCostLayerList` / `OwnerBatchList` / `OwnerStockHistory` | the **selling** team | a **lens** (0 = all) | selling roles |

The warehouse becoming a *lens* rather than the scope is the substantive change. An owner's purchases
are not a fact about a building — 200 units in Surabaya and 300 in Jakarta are one purchase history —
so `warehouse_id` narrows the answer instead of defining it, and the Batch rows carry the building
they landed in as a column.

### The ledger the owner reads is the batch ledger

`OwnerStockHistory` reads the **batch rows** of the owner's batches (`batch_logs` joined to `batches.team_id`), not the
rack rows. A rack row answers for a SHELF — its count is a rack's running total, and a rack-to-rack move is among its
commonest rows — and none of that is a fact about what an owner holds. A move writes no batch row
([a-move-writes-two-rack-rows-and-no-batch-row](../../business/inventory/placement_decision.md#a-move-writes-two-rack-rows-and-no-batch-row)),
so it never appears here; every take, mint, adjustment and rollback does, each naming its batch.

### Why the balance is computed and not stored

`OwnerMovement.balance` is the owner's on-hand of that product **in that building** after the event —
a running `SUM(change_count) OVER (PARTITION BY warehouse_id ORDER BY id)` over their own batch rows.

- **Derived, not stored.** Stored, it would be a number maintained by two writers on different shelves
  of the same product with nothing serialising them: two concurrent receives would each read the same
  "previous" balance and write the same "after". Derived, it cannot drift from the rows it is made of.
- **The window runs BEFORE the filters.** Kind and date narrow the result *outside* the subquery.
  Summing after them would produce "the total of the adjustments I asked to see" — a number about the
  filter rather than about the stock.
- **`PARTITION BY warehouse_id`, always.** With the lens set it is a single partition and costs
  nothing. With the lens open it is what keeps each row's balance a statement about ONE building,
  rather than a total that adds together stock in cities which can never fill each other's orders.

---

## Koreksi Harga — `BatchRevalue` (built 2026-11-12)

The owning team corrects ONE batch's unit price, with a reason
([the-owning-team-revalues-with-a-reason](../../business/inventory/context_decision.md#the-owning-team-revalues-with-a-reason),
accepted as [the-correct-price-prototype-is-accepted](../../business/inventory/context_decision.md#the-correct-price-prototype-is-accepted),
floor [a-corrected-price-is-above-zero](../../business/inventory/context_decision.md#a-corrected-price-is-above-zero)) —
a typo or a markdown, never a late cost
([a-late-cost-is-an-expense-not-a-revaluation](../../business/inventory/context_decision.md#a-late-cost-is-an-expense-not-a-revaluation)).
It reprices the units LEFT: no unit moves, no rack row is written, units already gone keep the price they left at; its
own `revaluation` transaction, never rolled back
([revaluation-and-opname-are-transaction-types](../../business/inventory/transaction_decision.md#revaluation-and-opname-are-transaction-types)).
The flow is [batch.md](../../business/inventory/batch.md)'s *Change Price Flow Example*.

| | |
| --- | --- |
| who | the scoped team's selling Owner or Admin, plus Root and the System Administrator (policy); `is_override` from `san_auth.IsOverride` |
| whose | the batch's `team_id` must be the scoped team — another team's batch, or none, is NotFound (one answer) |
| refused before the transaction | a reason empty or only spaces (trimmed), over 200 — InvalidArgument; a new price ≤ Rp 0 (also the proto's `gt: 0`) — InvalidArgument |
| refused under the batch's lock | no units left; `expected_price_unit` ≠ the price now (the form is stale — the text names the price now); the same price — FailedPrecondition, nothing written |
| writes | `inventory_transactions` (`revaluation`, the owner's, the batch's warehouse, the reason) → `batch_logs` (0 units, `change_valuation` = Δ × units left, `price_unit_after` = the new price) → `batch_price_logs` (new price, Δ) → `UPDATE batches` (price, value, `updated_at`) → one `inventory_transaction_items` row (quantity 0, total = \|value change\| — the batch row carries the sign) |
| code | `inventory_v1/batch_revalue.go` → `inventory_mutations.PostRevaluation` → `inventory_ledgers.LockBatch` + `Revalue` (its own ledger function: `BatchWrites.Flush` never changes a price) |
| no event | no money and no unit moved; nothing listens |

```mermaid
sequenceDiagram
  participant UI as Product page - Koreksi Harga
  participant H as BatchRevalue
  participant M as PostRevaluation
  participant DB as Postgres
  UI->>H: team_id, batch_id, expected_price_unit, new_price_unit, reason
  H->>H: trim the reason, refuse empty or over 200, refuse a price at or below 0
  H->>M: one DB transaction
  M->>DB: SELECT batches WHERE id FOR UPDATE - the only lock
  M->>M: refuse another team's batch, no units left, a stale form, the same price
  M->>DB: INSERT inventory_transactions - revaluation, is_override
  M->>DB: INSERT batch_logs - 0 units, delta x units left, price_unit_after
  M->>DB: INSERT batch_price_logs - new price, delta
  M->>DB: UPDATE batches - price_unit, stock_valuation
  M->>DB: INSERT inventory_transaction_items - quantity 0, total abs of the change
  H-->>UI: price before and after, value change, units
```

**Concurrency** — it locks exactly ONE batch row and nothing before it, so it joins no cycle: a take (order, sample,
transfer-out, problem) or a count's finalize locks the product's batches in id order and simply queues behind or ahead
of it; it touches no rack, so an open count's rack lock neither blocks it nor is broken by it. Two corrections of one
batch: the second waits on the row, re-reads it, and is refused by `expected_price_unit`. Proved in
`batch_revalue_race_test.go` — see [lock-order.md](../../../audits/services/inventory_service/concurrency/lock-order.md#koreksi-harga-2026-11-12).

**Performance** — 6 statements whatever the batch's history (7 in the probe, with the test transaction's SAVEPOINT),
2.64 ms median against the background volume (`TestPerf_BatchRevalue`, 50 000 batches): over the 5-statement line by the
decided flow itself — [BatchRevalue.md](../../../audits/services/inventory_service/performances/BatchRevalue.md).

### What the reads say about a correction

| read | change | performance |
| --- | --- | --- |
| `StockHistory` (a batch's — `filter.batch_id`) · `OwnerStockHistory` | a correction reads as `MOVEMENT_KIND_REVALUATION` (out of ADJUST; the kind filter takes it); every batch row carries `price_unit_before` / `price_unit_after` / `value_change` (14–16) — before = after − value ÷ units on a correction, = after elsewhere (`priceExprs`, no join: `batch_price_logs` has no transaction id). A rack's history never shows a correction (no rack row) | per-row arithmetic, nil. The probe on a batch with 3 000 takes found each row's two by-transaction lookups (`refExpr`) SCANNING `idempotency_order_check` and `restocks` — pre-existing — fixed by inventory `00041`'s two pure indexes: the owner's history 12.5 s → ~19 ms, a batch's 203 → ~2 ms ([OwnerStockHistory.md](../../../audits/services/inventory_service/performances/OwnerStockHistory.md)) |
| `BatchDetail` | each figure from its own rows, never re-priced at today's price: `batch.line_cost` (Tiba) = arrived × the ACCEPTED price (`init_stock_valuation ÷ init_stock_count`, every batch read), `broken_value` / `lost_value` = the door's `restock_problem_items.total`, `used_value` = accepted value + Σ corrections − value left; `price_corrected` / `price_corrected_from` = the newest correction's price before it (*dikoreksi dari Rp …*) | the returns query became ONE pass over the batch's rows with FILTERs (returns, Σ corrections, the newest's price before), the transaction looked up only for a row that added units (a join over every row hashed all of `inventory_transactions` — caught on the probe, 10 ms and growing); the door's sum only for a restocked batch: 2 queries, 3.4 ms median on the 3 000-take batch (`TestPerf_BatchDetail_ALongCorrectedBatch`) — no audit file |

---

## A stock opname — counting a whole shelf (`StockOpname`) — RETIRED

⛔ **Retired 2026-11-02** with the stock count below
([the-count-prototype-is-accepted](../../business/inventory/opname_decision.md#the-count-prototype-is-accepted)):
`InventoryService.StockOpname`, its one-rack page (`/inventories/opname`, which now redirects to the counts) and its e2e
spec are gone. It corrected one rack as provisional `adjustment` transactions; a count now nets a product over every rack
it sits on, and writes `problem`, `found` and `move`. `StockAdjust`'s recount still corrects one product on one rack
through the same `PostRecount`.

## Stock count sessions — `OpnameService`

A stock count of ONE warehouse, as a session: plan it, snapshot and lock the shelf book, count blind, write each difference
as a draft with its reason, and finalize into the stock-problem register. The design is
[opname.md](../../business/inventory/opname.md) and its decisions in
[opname_decision.md](../../business/inventory/opname_decision.md); the schema is
[database-schema.md § The stock count](../../database-schema.md#the-stock-count-00035).

> ✅ **Built 2026-11-02** — `inventory_v1/opname_*.go`, one file per RPC with its test; the settlement and its post are
> `inventory_mutations/post_count.go`; the lock is `inventory_ledgers/count_lock.go`. Races in `opname_race_test.go`
> (`-tags raceaudit`), the audit in `opname_perf_test.go` (`-tags perfaudit`), the flow end to end in
> `frontend/e2e/opname_sessions.spec.ts`.

| RPC | Who | What it does |
| --- | --- | --- |
| `OpnameSessionList` / `Detail` | any warehouse member — a read | the sessions, newest first, with progress; a counter's (staff) read of an active one carries no difference count |
| `OpnameSessionCreate` | Owner, Admin (+ Root) | the plan's `product_placements` rows — **rows at 0 included**, a rack plan widened to its products' other racks — read `FOR SHARE` and snapshotted, which locks them; refused while another session is active, naming it |
| `OpnameSessionCancel` | Owner, Admin | active → cancel under the session's lock; every row released, nothing posted, the counts kept |
| `OpnameRowList` | Owner, Admin — **never staff** — a read | every row WITH the book figure, by rack code then name, paged: the watch page |
| `OpnameRowSendBack` | Owner, Admin | a counted row back to created; its count, counter and drafts cleared; still locked |
| `OpnameRackList` | any member — a read | the racks to visit, paged; an `all` session lists every live rack, empty ones too |
| `OpnameRackCount` | any member — a read | one rack's rows, **blind** until each is counted, whoever asks |
| `OpnameRowCount` | any member | the blind count, then one recount that replaces it, a third refused; writes the system's `lost` (short) or `surplus` (over) draft |
| `OpnameRowMarkCounted` | any member | the broken count and every draft's reason; lost = shortage − broken, at least 0; refused while a draft has no reason |
| `OpnameRowAddFound` | any member | a product found on a rack: its row there and on each of its other racks join, at the book the shelf rows show now; refused when its team never had a batch of it here |
| `OpnameFinalizePreview` | Owner, Admin — a read | the finalize's own settlement over a plain read, per product and batch; why this person may not finalize |
| `OpnameSessionFinalize` | Owner, Admin, Root — never a counter | posts it: up to three transactions per owning team, the register, the debt; releases every row |

**The lock** is every open snapshot row, and nothing moves a counted product on its rack — on the shelf or in the book
([a-lock-stops-sales-and-cancels-too](../../business/inventory/opname_decision.md#a-lock-stops-sales-and-cancels-too)). `inventory_ledgers.RefuseCounted` reads it after the shelf rows are locked, in a
statement of its own, in every writer that moves units: the restock and transfer accept's put-away
(`PutOnPlacements`), `RackMove`, `RackSample`, `StockAdjust` (recount, damaged, lost), a found's report and approval
(`FoundRequestCreate`, `FoundRequestApprove`), and the ROLLBACK of a take
(`ReversePlacementLogs` — `OrderTransactionRelease`, `WarehouseTransferCancel`). Each refusal is FailedPrecondition naming
the count, who started it and when. A TAKE (an order's, and a transfer's out-leg, which shares it) runs only over the
racks no count holds (`LockedRacks.Free`); every line they cannot fill is named at once — `OrderTransactionCreate`
answers `ORDER_TRANSACTION_REFUSAL_REASON_BEING_COUNTED` with each line's free units and `counting_session_id`. No pick
waits any more (`StockPickLocation` field 5 is reserved). `RackStockLine.counting` locks the product in the Move and
Sample dialogs. `RackDelete` is refused while an open row names the rack or an `all` count runs
([a-rack-a-count-holds-cannot-be-deleted](../../business/inventory/opname_decision.md#a-rack-a-count-holds-cannot-be-deleted)).

### A row's life

```mermaid
stateDiagram-v2
    [*] --> created: SessionCreate — snapshot and lock
    created --> revealed: RowCount — the blind count
    revealed --> revealed: RowCount — the one recount
    revealed --> counted: RowMarkCounted — every draft has its reason
    counted --> created: RowSendBack — admin, drafts deleted
    counted --> [*]: SessionFinalize — released
    created --> [*]: SessionCancel — released
```

`revealed` is not a stored status: the row is still `created`, with `recounted_stock_count` set. Every row write takes the
session `FOR SHARE` and then the row `FOR UPDATE`; finalize and cancel take the session `FOR UPDATE` — so a row write and
a finalize never pass each other, and two phones on one row queue (the second count is the recount).

### What finalize posts

```mermaid
flowchart LR
  P["each product, over all its racks"] --> B["broken - the drafts', summed - posted as written"]
  P --> R["the rest - sellable, minus book, plus broken"]
  R -->|"short n"| L["lost n - per batch, oldest first, after broken"]
  R -->|"over n"| C["claims the oldest open loss, then mints at the newest price here"]
  R -->|"0"| M["a move - racks corrected only"]
  B --> PT["problem transaction"]
  L --> PT
  C --> FT["found transaction"]
  M --> MT["move transaction"]
```

```mermaid
sequenceDiagram
    participant A as Budi — warehouse Admin
    participant F as OpnameSessionFinalize
    participant M as PostCountFinalize
    participant DB as Postgres — one tx
    participant L as liability_service
    participant E as expense_service
    A->>F: finalize count 15
    F->>DB: lock the session FOR UPDATE
    F->>DB: read its rows and drafts
    alt not active, a row not counted, or Budi counted one
        F-->>A: FailedPrecondition — nothing written
    else
        F->>M: every product with its rows
        M->>DB: lock the open losses it may claim, oldest first
        M->>DB: lock the batches it takes from and claims into, one statement in id order
        M->>M: settle each product — broken, the rest, the racks
        M->>DB: per team — problem, found, move transactions
        M->>DB: lock every rack row of the session, check every change
        M->>DB: batch rows, mints, rack rows — increases first
        M->>DB: register rows per batch, claims, items
        F->>L: the warehouse owes each team — broken, lost — and a claim gives back, in the tx
        F->>DB: list the transactions, release every row, the session finish
        F-->>A: the session and its transactions
        F->>E: one stock-loss expense for the count, after commit
    end
```

**A worked example** (`TestOpnameSessionFinalize_ATearAndAnExtraClaimsThenMints`). Melati's Kaos Hitam: batch 1, 8 at
Rp 10.000; batch 2, 2 at Rp 12.000; a shelf report lost one of batch 2 earlier — an open loss. The count finds Rak A book 5,
counted 5 with one torn; Rak B book 4, counted 5.

| | |
| --- | --- |
| the arithmetic | book 9 · sellable 10 · broken 1 · the rest 10 − (9 − 1) = **+2** |
| `problem` | broken 1 off batch 1 (oldest) at Rp 10.000 — a register row, claimable 0, on Rak A (one rack's draft) |
| `found` | +1 claims the old loss back into batch 2 at its Rp 12.000, the claim row written · +1 minted as a new batch at the team's newest price here, Rp 12.000 |
| racks | Rak A −1 broken, +1 found → 5 · Rak B +1 found → 5 — each at its sellable count, no move |
| money | the warehouse owes Melati Rp 10.000 (broken) · Melati pays back Rp 12.000 (the claim) · the mint moves none · stock-loss expense Rp 10.000 |

How a team's rack corrections split across its three transactions — the ledgers' open point 15 — is decided in the build:
the broken come off the racks their drafts name; lost comes off the racks still short once their broken is off, found goes
onto the racks still over, each in rack id order; what is left nets to 0 and is the `move`. So each transaction moves the
same units on both ledgers (both-ledgers-count-the-same-units).

## Found stock waiting for approval — `FoundRequestService`

A unit found on a rack outside a count waits for the warehouse Owner or Admin and posts nothing until approved
([an-adjust-found-waits-for-the-owner-or-admin](../../business/inventory/opname_decision.md#an-adjust-found-waits-for-the-owner-or-admin),
accepted with its screens in [the-found-stock-prototype-is-accepted](../../business/inventory/opname_decision.md#the-found-stock-prototype-is-accepted)).
**Built 2026-11-03**: [found_request.proto](../../../proto/warehouse/inventory/v1/found_request.proto),
`inventory_v1/found_request_{create,list,approve,reject}.go`, the table `found_requests` (`00036`,
[schema](../../database-schema.md#found-stock-waiting-for-approval-00036)). State:
[opname.md](../../development_state/inventory/opname.md#found-stock-waits-for-approval--built).

| RPC | Who | What it does |
| --- | --- | --- |
| `FoundRequestCreate` | Owner, Admin, **Staff** (+ Root, Administrator) — the one door ([staff-may-report-a-found](../../business/inventory/opname_decision.md#staff-may-report-a-found)) | writes a WAITING request on the rack — product, owner team, units, note, reporter — and posts NOTHING. Refused: a rack another warehouse's or deleted (NotFound); a count holding the product on the rack (FailedPrecondition naming the count); a product its team never had a batch of here, emptied ones included (FailedPrecondition "… was never stocked here … — bring it in by restock", [a-found-never-stocked-here-is-refused-at-the-report](../../business/inventory/opname_decision.md#a-found-never-stocked-here-is-refused-at-the-report)) |
| `StockAdjust` FOUND | — | **refused** (InvalidArgument naming `FoundRequestCreate`); its policy is unchanged. The provisional found into a named batch (`PostBatchFound`) is retired |
| `FoundRequestList` | Owner, Admin, Staff (+ Root, Administrator), the monitor — a read (`NO_SIDE_EFFECTS`) | the warehouse's requests, newest first, one status or all, paged (RULE 9). **Staff get only their own**, filtered here. A waiting request says what approving NOW would post (the count's own settlement over one plain read) and why THIS caller may not (`block`: `OWN_REPORT`, `BEING_COUNTED` + `counting_session_id`, `NOT_WAITING`); an approved one what it posted; a settled one the count (`settled_by_counting_session_id`) |
| `FoundRequestApprove` | Owner, Admin (+ Root, stamped as an override) — **never the reporter**, checked against the person | one `found` transaction, below. Not waiting → FailedPrecondition; the reporter → FailedPrecondition; a count holding the rack → FailedPrecondition naming it; no price (the report's refusal makes this a backstop only) → FailedPrecondition, nothing written |
| `FoundRequestReject` | Owner, Admin (+ Root, Administrator) any; **the reporter their own — staff included** ([the-reporter-may-withdraw-their-found](../../business/inventory/opname_decision.md#the-reporter-may-withdraw-their-found)) | WAITING → REJECTED with a required reason (InvalidArgument without); nothing posts. Staff rejecting another's → PermissionDenied. A withdrawal is a rejection whose decider is the reporter — the screen says *Withdrawn by …* |
| `OpnameSessionFinalize` | — | **settles** every WAITING request on a (product, rack) the session holds a row for: status `settled`, the session, the finalizer and the time; nothing more posts — the count posted the units it found ([a-count-settles-the-found-it-counted](../../business/inventory/opname_decision.md#a-count-settles-the-found-it-counted)). A cancelled count settles nothing |

**The approval is the count's own found, not a second implementation.** `inventory_mutations.PostFoundApproval` runs
`PostCountFinalize` over ONE product with ONE row — the rack counted at the units over a book of 0 — so the claim of the
oldest open losses back into their batches at their price, the register's `claimed_stock_count` (never above what is
claimable, under the register's lock), the mint of the rest at the team's newest batch price here, both ledgers and the
money are exactly a count's surplus of the same units (proved: `TestFoundRequestApprove_PostsWhatACountsFoundPosts`).
`CountFinalize.Guard` is the one hook it adds: `inventory_ledgers.RefuseCounted` under the rack row's lock, in a statement
of its own. Each claim gives the owner's reimbursement back through `LiabilityPoster.PostStockDamage` (`found`, keyed by
the found transaction), inside the transaction.

```mermaid
sequenceDiagram
    participant A as Dewi — warehouse Owner
    participant F as FoundRequestApprove
    participant DB as Postgres — one tx
    participant L as liability_service
    A->>F: approve found request 301
    F->>DB: 1. the request row FOR UPDATE, then re-read
    alt not waiting, or Dewi reported it, or a count holds the rack
        F-->>A: FailedPrecondition — nothing written
    else
        F->>DB: 2. the open losses of the product FOR UPDATE, oldest first
        F->>DB: 3. the batches it claims into FOR UPDATE, by id
        F->>DB: 4. the rack row FOR UPDATE — then the count lock re-read (Guard)
        F->>DB: the found transaction — claims with their units, then a minted batch
        F->>DB: batch rows, the rack row, the register's claimed counts
        F->>L: each claim gives the reimbursement back, in the tx
        F->>DB: the request approved — who, when, the transaction, the minted batch
        F-->>A: the request and its transaction
    end
```

**Lock order** — the request row, then the count's own order (register → batches → racks). A finalize takes the session,
then the WAITING requests it settles (`FOR UPDATE`, by id), then the same register → batches → racks; an order's take and
a count's plan never touch `found_requests`. So nothing waits in a circle, and an approval and a finalize over the same
request serialise on its row: whichever is second finds it decided. Proved in `found_request_race_test.go` (below).

| Race | Outcome | Test |
| --- | --- | --- |
| eight approvals of one request | one posts, seven FailedPrecondition | `TestRace_FoundRequestApprove_PostsOnce` |
| an approval and the reporter's withdrawal | exactly one decides, ten rounds | `TestRace_FoundRequestApprove_RacingAWithdraw` |
| an approval and eight order takes of the product | no deadlock, both ledgers equal | `TestRace_FoundRequestApprove_RacingTakes` |
| an approval and a count's plan, then its finalize | the units post ONCE: approved first, the count finds the rack exact; planned first, the approval is refused and the finalize settles it | `TestRace_FoundRequestApprove_RacingACountPlanAndFinalize` |
| the settle against an approval in flight | the settle waits on the row and re-checks `waiting` | `TestInterleave_FoundRequest_TheSettleWaitsForAnApproval` |

> ⚠ **Two identical reports are two requests** — `FoundRequestCreate` has no idempotency key, on purpose (none was
> decided). A double click writes two WAITING rows; the approver sees both and rejects one
> ([concurrency audit](../../../audits/services/inventory_service/concurrency/FoundRequest.md)).

## Lost stock on the Analytic composer — `InventoryAnalyticService`

Built 2026-11-05 ([inventory-lost-counts-the-warehouses-custody-losses](../../business/analytic/rpc_provide_decision.md#inventory-lost-counts-the-warehouses-custody-losses),
[inventory-lost-is-gross](../../business/analytic/rpc_provide_decision.md#inventory-lost-is-gross),
[a-warehouse-sees-its-lost-amount](../../business/analytic/rpc_provide_decision.md#a-warehouse-sees-its-lost-amount)) —
[inventory_analytic.proto](../../../proto/warehouse/inventory/v1/inventory_analytic.proto), `inventory_v1/lost_metric_*.go`.

| | |
| --- | --- |
| metric | `metrics/inventory/lost` — `lost_count` (units), `lost_amount` (at the batch price) |
| groups / filters | summary, daily–yearly, product, supplier, team (the owning seller), warehouse / date range (required), team, warehouse, product, supplier — no shop |
| reader | `warehouse_id = team_id OR team_id = team_id` of the request: the warehouse that held the stock and the seller owning it, both fields; root every team's; any other team nothing |
| source | `inventory_lost_daily_reports`, written by `inventory_mutations.foldLost` inside the count's finalize and the Stock Adjust "lost" — the same transaction as the `warehouse_stock_problems` row. `as_of_unix` = the read's time |

```mermaid
sequenceDiagram
  participant w as Count finalize or Stock Adjust lost
  participant db as inventory DB
  participant ui as Analytic
  w->>db: one tx - the problem rows, ledgers, items
  w->>db: same tx, last - upsert the day's lost row per warehouse, team, product, supplier
  ui->>db: MetricSearch or MetricData - warehouse_id or team_id is the reader, a window of days
```

Supplier 0 (a batch naming none) counts everywhere but is left out of the Supplier group's keys (an id key is > 0).
Perf on 219 000 rows: 1–6 ms for a warehouse or a seller, 30–40 ms for root over every team.

---

## The warehouse's product picker — `WarehouseProductSearch`

A warehouse picks a product from **what it holds or has held**
([a-warehouse-picks-only-what-it-has-held](../../business/inventory/opname_decision.md#a-warehouse-picks-only-what-it-has-held)):
every product with a batch in this warehouse — any team's, emptied ones included — searched by name or product code on the
server. It backs Report Found (the rack page), a count's product plan (New Count) and a count's found (Add a Product Found
Here) — `ProductSelect scope="warehouse"`. `ProductDiscover` is **not** widened: its policy stays the selling roles' and
Root/Administrator's, and a warehouse never browses every team's catalogue. **Built 2026-11-04**:
[inventory.proto](../../../proto/warehouse/inventory/v1/inventory.proto), `inventory_v1/warehouse_product_search.go`,
product_service's `product_v1/product_search_among.go`, the composition root's reader
(`backend/cmd/app_development/product_reader.go`). State:
[opname.md](../../development_state/inventory/opname.md#the-warehouse-picks-only-what-it-has-held--built).

| | |
| --- | --- |
| who | Root, Administrator, warehouse Owner, Admin, Staff; the admin team's monitor and an agent (`NO_SIDE_EFFECTS`) — no selling role |
| scope | `warehouse_id` (`use_scope`) |
| term | `filter.q`, 2–100 characters, at least 2 after trimming (else InvalidArgument), anywhere in the name or the product code, case-insensitive |
| set | products with a row in `batches` for this warehouse, at 0 or not; an ARCHIVED one too, flagged `archived` and labelled by the picker ([an-archived-product-held-here-can-be-picked](../../business/inventory/opname_decision.md#an-archived-product-held-here-can-be-picked)); a LOCKED one is in |
| order | by name, then product code, then id — paged (`CommonPagination`, limit ≤ 200; the picker asks for 10) |
| each | `id`, `team_id` (the owner), `product_code`, `name` — the picker names the owner through `TeamByIds`, so two teams' same-named products are told apart |

**Two halves, each over its own rows** (HARD RULE 3). Inventory reads which products have been here; product_service
searches its names and codes among them. The held ids go from inventory to product_service **in-process**, through the
`ProductReader` inventory already holds (`Search`, beside `Facts`), to a plain method — `product_v1.SearchAmong` — not an
RPC: as an RPC it would take its id list from a caller, which is the very browse ProductDiscover keeps from warehouse roles.
No id list ever travels from the browser, and no product name is mirrored into inventory. product_service sends the
window and the count of every match back from ONE statement (`COUNT(*) OVER ()`), so the list goes to Postgres once.

```mermaid
sequenceDiagram
    participant S as Ani — warehouse Staff
    participant I as WarehouseProductSearch — inventory
    participant DB as Postgres
    participant P as SearchAmong — product_service
    participant T as TeamByIds — team_service
    S->>I: q = kaos tem, warehouse 11, page 1 of 10
    I->>I: policy — warehouse roles, scope warehouse 11
    I->>DB: DISTINCT product_id FROM batches WHERE warehouse_id = 11
    alt nothing ever held here
        I-->>S: no products, total 0 — product_service not asked
    else
        I->>P: Search — the held ids, the term, the window
        P->>DB: products WHERE id = ANY(held) AND name or code ILIKE, COUNT(*) OVER (), ORDER BY name LIMIT 10
        P-->>I: the page and the total
        I-->>S: id, owner team, code, name — by name
        S->>T: the owners' names, best-effort
    end
```

The owner team on a batch is the product's owner, written at mint (a-batch-carries-its-owner), so "held here" and "its
team had a batch here" are one set: what the picker offers is exactly what `FoundRequestCreate` and `OpnameRowAddFound`
accept, and their never-stocked refusals stay as the backstop. Measured: 2 statements, ≈ 19 ms at 10 000 products held
([performance audit](../../../audits/services/inventory_service/performances/WarehouseProductSearch.md)).

## The Stock screen — `WarehouseStockList`

A warehouse's **Products** (`/products`, [a-warehouses-products-is-what-it-holds](../../business/inventory/context_decision.md#a-warehouses-products-is-what-it-holds) —
a row opens the warehouse product page) and root and the admin team's **Inventory** (`/inventory`, a warehouse picked)
list **what the warehouse has held** — one list, `features/inventory/WarehouseStockList.tsx`; the old Inventories ▸ Stock
address (`/inventories/stock`) forwards to them
([the-stock-screen-lists-what-the-warehouse-has-held](../../business/inventory/context_decision.md#the-stock-screen-lists-what-the-warehouse-has-held)):
every product with a batch in this warehouse — any team's, archived ones flagged, at 0 or not — each with its owner team
and its units on hand here, searched by name or product code on the server, paged. A product emptied to 0 stays listed, so
it can still be found and adjusted. It replaced `ProductList` scoped to the warehouse (the warehouse TEAM's own catalogue —
always empty for a real warehouse) joined client-side to a fixed page of `StockList`; on a warehouse's Products it replaced
`WarehouseProductList` (what the warehouse was ASKED to hold) resolved through `ProductByIds` — an RPC no screen called
afterwards, DELETED 2026-11-11 ([warehouse-product-list-is-deleted](../../business/inventory/context_decision.md#warehouse-product-list-is-deleted)):
the rpc is gone, its request and response are empty tombstones in `inventory.proto` whose field numbers and names are
`reserved`, and the `warehouse_products` arrangement a restock or a transfer writes stays — `ProductHistory` still reads it. **Built 2026-11-04**:
[inventory.proto](../../../proto/warehouse/inventory/v1/inventory.proto), `inventory_v1/warehouse_stock_list.go`. State:
[opname.md](../../development_state/inventory/opname.md#the-stock-screen-lists-what-the-warehouse-has-held--built).

| | |
| --- | --- |
| who | Root, Administrator, warehouse Owner, Admin, Staff; the admin team's monitor and an agent (`NO_SIDE_EFFECTS`) — no selling role. The same policy as `StockList` |
| scope | `warehouse_id` (`use_scope`) |
| term | `filter.q` ≤ 100 — EMPTY lists everything held; otherwise at least 2 characters after trimming (else InvalidArgument), anywhere in the name or the product code, case-insensitive |
| set | `WarehouseProductSearch`'s: products with a row in `batches` for this warehouse, any `stock_count` |
| order | by name, then product code, then id — paged (`CommonPagination`, limit ≤ 200; the screen asks 10/20/50) |
| slices | `PRODUCT` (`WarehouseProductSearchItem`: id, owner `team_id`, `product_code`, `name`, `archived`) and `STOCK` (`StockLevel`: `on_hand`) by default; `GENERAL` on request |
| on hand | `StockList`'s formula, one helper (`warehouseOnHand`): `SUM(product_placements.stock_count)` over the warehouse's racks, for the page's products only; a held product with no rack row reads 0 |

**Three steps, each over its own rows** (HARD RULE 3) — the picker's two, then the shelves. product_service's
`SearchAmong` gained a list mode: with no term it returns the whole given set in the same order, still never a product
outside it, the page and its total from one statement (`COUNT(*) OVER ()`). The picker keeps its own minimum of 2.

```mermaid
sequenceDiagram
    participant A as Budi — warehouse Admin
    participant I as WarehouseStockList — inventory
    participant DB as Postgres
    participant P as SearchAmong — product_service
    participant T as TeamByIds — team_service
    A->>I: warehouse 11, no term, page 1 of 20
    I->>I: policy — warehouse roles, scope warehouse 11
    I->>DB: DISTINCT product_id FROM batches WHERE warehouse_id = 11
    alt nothing ever held here
        I-->>A: no products, total 0 — product_service not asked
    else
        I->>P: Search — the held ids, no term, the window
        P->>DB: products WHERE id = ANY(held), COUNT(*) OVER (), ORDER BY name, code, id LIMIT 20
        P-->>I: the page and the total
        I->>DB: SUM(stock_count) FROM product_placements WHERE warehouse_id = 11 AND product_id IN (the page) GROUP BY product
        I-->>A: id, owner team, code, name, archived, on hand — by name
        A->>T: the owners' names, best-effort
    end
```

Measured: 3 statements flat at a page of 20 and 50, ≈ 20 ms at 10 000 products held
([performance audit](../../../audits/services/inventory_service/performances/WarehouseStockList.md)).

## A supplier's goods — `SupplierGoods`

The supplier pages' **Terjual** (with the last order) and **Siap** (with the last restock) for a supplier on the supplier
list and Discover, for each store on the Toko tab, and per warehouse under **Gudang terkait** with its orders and restocks
([sales-are-all-time-with-their-last-dates](../../technical/frontend/suppliers_decision.md#sales-are-all-time-with-their-last-dates),
[the-detail-tabs-show-sold-and-ready](../../technical/frontend/suppliers_decision.md#the-detail-tabs-show-sold-and-ready),
[the-summary-is-sold-and-ready-with-their-counts](../../technical/frontend/suppliers_decision.md#the-summary-is-sold-and-ready-with-their-counts)).
A supplier's goods are the batches minted with its id ([a-batch-keeps-its-supplier](../../business/inventory/context_decision.md#a-batch-keeps-its-supplier)),
from EVERY team ([every-selling-team-sees-every-teams-figures](../../business/supplier/context_decision.md#every-selling-team-sees-every-teams-figures)).
**Built 2026-11-07**: `inventory_v1/supplier_goods.go`, index `00039` `batches_supplier_idx`, screens through
`features/suppliers/goods.ts`. inventory owns every row it reads, so no other service is called; the screen names the
warehouses with `TeamByIds`.

| | |
| --- | --- |
| who | Root, Administrator, selling Owner, Admin, CS; the admin team's monitor and an agent (`NO_SIDE_EFFECTS`). No warehouse role — a warehouse has no supplier pages |
| scope | `team_id` (`use_scope`) authorizes only — it never narrows the figures |
| ask | `supplier_ids` 1–100, `group` SUPPLIER · STORE (`supplier_channel_id`) · WAREHOUSE |
| sold · orders · last order | the batches' `order` rows of `batch_logs`, netted per transaction: a cancel's rollback writes flipped rows of the same type, so a cancelled order nets 0 — not sold, not an order, not the last order |
| ready | `SUM(stock_count)` of the batches |
| restocks · last restock | the distinct `restock` transactions that minted them, the newest batch's `created_at`; a transfer-in batch carries the supplier and is not a restock |
| absent | a supplier, store or warehouse none of whose goods ever arrived — the screen draws a dash |

```mermaid
sequenceDiagram
    participant S as Supplier list — a selling team
    participant I as SupplierGoods — inventory
    participant DB as Postgres
    S->>I: team 12, the page's supplier ids, group SUPPLIER
    I->>I: policy — selling roles, scope team 12 (authorizes only)
    I->>DB: SUM(stock_count) FROM batches WHERE supplier_id IN ids GROUP BY supplier
    I->>DB: COUNT(DISTINCT transaction_id), MAX(created_at) — the restock batches
    I->>DB: per batch, its order rows (LATERAL, batch_logs_batch_idx) — netted per transaction, then per supplier
    I-->>S: sold, orders, last order, ready, restocks, last restock — per supplier
```

Measured ([performance audit](../../../audits/services/inventory_service/performances/SupplierGoods.md), 🟡): a list page
of 50 in 41 ms, one ordinary supplier by warehouse in 2 ms; a supplier with 100 000 sold rows ≈ 5 s cold — the audit
recommends folding the sold figures on the take's write path (the owner's call).

### The same goods for supplier_service — two in-process seams, not RPCs

supplier_service asks inventory about a supplier's goods through its `GoodsReader`, answered by the composition root
(`cmd/app_development/supplier_goods_reader.go`) from these plain methods — no caller token, no policy, nothing over
Connect:

| method | for | reads |
| --- | --- | --- |
| `OrderTakeSuppliers(transaction_id)` (`supplier_order_take.go`) | Penjualan's sales fold, on OrderPlaced ([penjualan-is-the-selling-value-on-the-order-day](../../technical/frontend/suppliers_decision.md#penjualan-is-the-selling-value-on-the-order-day)) | the take's own `order` rows (`change_count < 0`, `batch_logs_transaction_idx`) joined to `batches` — units per product, supplier and the batch's team; GROSS, a release's rollback never subtracted; a batch from nobody left out |
| `SupplierIDsByFigure(figure, lo, hi)` (`supplier_ids_by_figure.go`) | SupplierList's range pills ([the-range-pills-are-a-fixed-set](../../technical/frontend/suppliers_decision.md#the-range-pills-are-a-fixed-set)) | the suppliers whose Terjual (every `order` row netted) or Siap (`SUM(stock_count)` of batches holding stock) lies in `[lo, hi)`, `hi` 0 open — every team's goods, only suppliers WITH goods |

Measured (`supplier_ids_by_figure_perf_test.go`, SupplierGoods' background — 200 000 batches, 1 000 000 `order` rows,
3 001 suppliers): Terjual's set ≈ 0.6–0.9 s (one pass over every `order` row) 🔴, Siap's ≈ 60 ms —
[SupplierIDsByFigure.md](../../../audits/services/inventory_service/performances/SupplierIDsByFigure.md).

## Broken, lost, and found — the warehouse reimburses the owner (business_level §Warehouse 5)

A `DAMAGED` / `LOST` adjust already wrote the units off the shelf and their frozen cost to expense.
That answered *"what did our losses cost us"* and left the other question unanswered: the goods
belonged to a **selling team**, and until now they were simply gone.

> ✅ *(2026-11-02)* **A damaged or lost report is the register's second door**
> ([an-adjustment-writes-the-same-problem-row](../../business/inventory/opname_decision.md#an-adjustment-writes-the-same-problem-row)):
> `inventory_mutations.PostShelfProblem` writes a `problem` transaction of the batch's owner — its batch and rack rows
> say `broken` or `lost` — and one `warehouse_stock_problems` row for the named batch, at its price, on the reported
> rack; lost is claimable, broken never. No session lists it. *(2026-11-03)* `FOUND` is no longer an adjust: it is a
> found request that waits for a second person and, approved, claims the oldest open loss — § Found stock waiting for
> approval. The money below is as it was.

```mermaid
sequenceDiagram
    participant W as Warehouse staff
    participant I as StockAdjust
    participant S as liability_service
    participant E as expense_service

    W->>I: StockAdjust{DAMAGED, batch, qty}
    Note over I: one transaction
    I->>I: a problem of the batch's owner - units off the batch, then off the rack, and its register row
    I->>I: the value the batch gave up, and its owner - batches.team_id
    I->>S: PostStockDamage — the WAREHOUSE owes the OWNER
    Note over I: commit
    I->>E: PostStockLoss — the warehouse's own P&L, best-effort

    opt the goods turn up
        W->>I: FoundRequestCreate, then another person's FoundRequestApprove
        I->>S: PostStockDamage found — the claim gives it back
        Note over S: the reimbursement is given back —<br/>both entries stay in the history
    end
```

### ⚠ The direction is the whole point

Every other posting from this service has the **selling team owing the warehouse**. This one is
reversed: the warehouse holds the goods, the selling team owns them (§Warehouse 4), so losing them is
a **debt**, not a discount. Getting it backwards would bill the team whose stock was destroyed.

### Two records of one event, and both are wanted

| | answers |
| --- | --- |
| `EXPENSE_KIND_STOCK_WRITE_OFF` | *what did our losses cost us* — the warehouse's own P&L |
| `LIABILITY_SOURCE_TYPE_STOCK_DAMAGE` | *who do we now have to pay* |

Neither replaces the other. Dropping either loses a real question's answer.

### The debt commits with the stock; the expense does not

The liability posting joins the adjust's **transaction**; the expense posting stays best-effort
after it. Same distinction `LiabilityPoster` already draws: an expense is a *derived* record and a
dropped one is a gap a report can find, while an obligation that fails to commit leaves the owning
team's goods gone with nothing recorded — the situation the ledger exists to prevent.

### What is NOT charged here

| | |
| --- | --- |
| **`FOUND`** | not an adjust any more — an approved found request's claims post `found` against the found transaction, never by deleting the entry that charged it (§ Found stock waiting for approval) |
| **`RECOUNT`** | books nothing, as before the cut-over — the open contradiction with `StockOpname` is [adjustment Q2](../../business/inventory/adjustment_clarify.md#question) |
| **the warehouse's own goods** | a team cannot owe itself |
| **damage at RECEIVING, and on returned orders** | **§Warehouse 6** — neither enters the warehouse's custody, and neither travels this RPC |

### Idempotency

`source_id` is the **adjustment transaction**. Every adjust writes exactly one, so a retried adjust is refused by the
ledger's unique index, and a damage and its later find can never collide.

### A count's shortfall reimburses too (owner, 2026-08-20)

A count is the warehouse checking its own custody, and §Warehouse 7 makes that its job. What a finalize finds broken or
lost is stock lost in the warehouse exactly as one filed as a `LOST` adjust is — so it posts the same `STOCK_DAMAGE`
obligation, keyed on the team's `problem` transaction (broken and lost are two entries of it, by their source types),
and a claim gives back the money of the loss it claims, keyed on the team's `found` transaction. (It was the one-rack
`StockOpname`'s rule until that was retired; § Stock count sessions.)

Before this, the same physical loss reimbursed the owner or did not **depending on which RPC noticed
it**, which is the worst kind of inconsistency: invisible, and only in the accounts.

| | |
| --- | --- |
| **one debt per owner** | keyed on that owner's `problem` transaction — one per owning team per count — so `source_id` means the same thing it means for an adjust and a re-run is refused by the ledger rather than charging twice |
| **a surplus claims first** | the count's surplus claims the oldest open loss back, and that claim reverses the loss's money (`found`); what is left is minted at the team's newest price here and moves no money |
| **the warehouse's own goods** | a team cannot owe itself |

The obligation joins the count's **transaction**; the expense stays best-effort after it — the same
split the single-adjust path draws, and for the same reason.

**`StockAdjust` with reason `RECOUNT` now does both** ([a-recount-shortfall-is-written-off-and-owed](../../business/inventory/adjustment_decision.md#a-recount-shortfall-is-written-off-and-owed),
2026-11-02): a shortfall's units leave the owner's batches oldest first, the warehouse owes the owner their value as
*lost* inside the transaction — keyed on the owner's adjustment transaction, none for the warehouse's own goods — and
one stock-loss expense follows the commit, under the recount's note. A surplus or an exact count moves no money. The
same loss now costs the same whichever screen records it.

## RestockRequestAccept — announces the accept

After the accept COMMITS, `RestockRequestAccept` publishes `RestockAccepted` — the restock, its two teams, its
supplier, the accept's Jakarta day and instant, and per line the ordered count, the total, the good units, the broken,
the missing and the line's supplier
([restock-accepted-carries-every-line](../../business/inventory/restock_decision.md#restock-accepted-carries-every-line)).
supplier_service folds it into a supplier's figures ([its doc](../supplier_service/rpc.md#the-figures--a-fold-of-restock-accepted)).
The restock's money events — *Restock Created*, *Updated* and *Cancelled* — are below.

## The restock's money events — for the account that paid

The selling team's account paid for the goods and the shipping when it raised the restock; three events tell whoever
posts that payment what happened to it
([a-created-restock-tells-the-financial-account](../../business/inventory/restock_decision.md#a-created-restock-tells-the-financial-account),
[an-edit-sends-the-difference](../../business/inventory/restock_decision.md#an-edit-sends-the-difference),
[an-edit-may-move-the-payment-to-another-account](../../business/inventory/restock_decision.md#an-edit-may-move-the-payment-to-another-account)).
Inventory announces and does not know who listens. ⚠ **No listener is built yet** — financial_account_service's
subscription is its own to add; until then the topics fill and nothing posts.

```mermaid
sequenceDiagram
  participant T as selling team
  participant INV as inventory_service
  participant PS as Pub/Sub
  T->>INV: RestockRequestCreate — account 7, goods 250.000, shipping 20.000
  INV->>INV: one transaction, COMMIT
  INV->>PS: RestockCreated — account 7, amount 270.000, restock-created N
  T->>INV: RestockRequestUpdate — 12 instead of 10
  INV->>INV: one transaction, COMMIT
  INV->>PS: RestockUpdated — account 7 to 7, 270.000 to 290.000, restock-updated N and the edit's trail row
  T->>INV: RestockRequestCancel — money returned
  INV->>INV: one transaction, COMMIT
  INV->>PS: RestockCancelled — account 7, 290.000, money returned, restock-cancelled N
  Note over INV,PS: a failed publish is logged with its event_id, never fails the request
```

| | |
| --- | --- |
| the amount | goods plus shipping — never the courier's charge, which the warehouse paid ([the-couriers-charge-stays-out-of-total](../../business/inventory/restock_decision.md#the-couriers-charge-stays-out-of-total)) |
| an edit | announced only when the amount or the paying account changed; a note or a tracking number moves no money |
| event ids | derived — `restock-created:N`, `restock-cancelled:N`, and `restock-updated:N:<trail row>` per edit — so a republish dedups |
| after, never inside | an event for a write that rolled back would move money that never moved |
| topics | read from the proto by `san pubsub ensure` — nothing to add |

```mermaid
sequenceDiagram
  participant W as warehouse member
  participant INV as inventory_service
  participant PS as Pub/Sub — restock-accepted
  W->>INV: RestockRequestAccept — the count, the placements, the courier's charge
  INV->>INV: one transaction — stock, batches, problem rows, the trail, the courier's debt
  INV-->>INV: COMMIT
  INV->>PS: RestockAccepted — event_id restock-accepted N
  Note over INV,PS: a failed publish is logged with its event_id, never fails the accept
  INV-->>W: the restock, accepted
```

| | |
| --- | --- |
| after, never inside | an event for an accept that rolled back would fold goods that never arrived |
| a failed publish | logged; the supplier's figures are short that restock until a replay or an adjustment — never wrong the other way (no-outbox-the-publish-is-trusted) |
| `RestockAcceptedEvent` | the pure builder, exported — `san supplier backfill-figures` builds the very same event for a restock accepted before it existed |

## The override stamp on the reads — the "by Root team" badge (built 2026-11-11)

[an-override-shows-a-platform-badge](../../business/user/context_decision.md#an-override-shows-a-platform-badge), accepted as
[the-override-badge-is-accepted-as-by-root-team](../../business/user/context_decision.md#the-override-badge-is-accepted-as-by-root-team):
every read a screen names a person from now carries the record's own `is_override` (stamped at the write by
`san_auth.IsOverride`, [an-override-is-stamped-in-every-service](../../business/user/context_decision.md#an-override-is-stamped-in-every-service)),
and the screen draws the shared `ActorName` / `RootTeamBadge` beside the person. Never sent by a caller; a row from
before the column reads false.

| read | field | read from | performance |
| --- | --- | --- | --- |
| `StockHistory`, `RackHistory` (and `StockAdjust`) | `StockMovement.is_override` (13) | `inventory_transactions.is_override` of the log row's `transaction_id` — a correlated primary-key probe in the select list, beside `refExpr`'s two | one PK probe per row the query walks: 300k placement logs / 100k transactions, a 50-row page 0.039 → 0.110 ms at offset 0, 0.84 → 6.05 ms at offset 5 000 (the probe runs for the skipped rows too, as `refExpr` already does) — under every audit threshold |
| `OwnerStockHistory` | `OwnerMovement.is_override` (13) | the same probe by `movement_id`, applied OUTSIDE the running-balance window on the page only (`SELECT p.*, … FROM (… LIMIT ? OFFSET ?) p`) | ≤ one PK probe per returned row |
| `RestockRequestDetail` (and the restock writes) | `RestockLog.is_override` (7) | `restock_logs.is_override`, the preloaded trail row | nil |
| `WarehouseTransferDetail` (and the transfer writes) | `WarehouseTransferLog.is_override` (7) | `warehouse_transfer_logs.is_override`, the preloaded trail row | nil |
| `RestockRequestList` | `RestockRequest.created_by_is_override` (40) — the lists' created-by cell; `arrived_by_is_override` (41) — the warehouse list's *Arrived* by-line; `accepted_by_is_override` (42) — the selling list's *Accepted* by-line (2026-11-12) | each step's own trail row's `restock_logs.is_override` (the restock row carries no flag): created = the trail's FIRST row (the create's); arrived = the row that moved it to arrived, or — counted straight from ongoing, when the accept also stamps `arrived_by` — the accept's; accepted = the row that moved it to accepted; an edit (status kept, `from = to`) is no step. ONE batched lookup per page: `SELECT restock_id, (array_agg(is_override ORDER BY created_at, id))[1], COALESCE(bool_or(…) FILTER (WHERE to_status = 'arrived' AND from_status <> to_status), bool_or(…) FILTER (… 'accepted' …), false), … WHERE restock_id IN (page ids) GROUP BY restock_id` | 3 → 4 statements whatever the page; GroupAggregate over an index scan on `restock_logs_restock_idx`. `TestPerf_RestockRequestList` (50 000 restocks, 200 000 trail rows, a Root step on 1 in 50 / 70 / 90): the per-step lookup executes in 0.08 ms for 20 rows, 0.52 ms for 200 (the created-only `DISTINCT ON` it replaced, EXPLAINed over the same pages as the control: 0.04 / 0.31 ms); the RPC's median wall 3.3 ms (20), 5.6 ms (200), 4.9 ms (page 100 of 20), 3.8 ms (a warehouse's page) — under every audit threshold, no audit file |
| `WarehouseTransferList` | `WarehouseTransfer.created_by_is_override` (33) — the list's created-by cell (2026-11-12) | the trail's FIRST row's `warehouse_transfer_logs.is_override` (the create's): ONE batched lookup per page, `DISTINCT ON (transfer_id) … ORDER BY transfer_id, id` | one statement more whatever the page (5 in the probe, whose transfers have no legs to read racks for); index scan on `warehouse_transfer_logs_transfer_idx`. `TestPerf_WarehouseTransferList` (20 000 transfers, 100 000 trail rows): 0.06 ms for 20 rows, 0.35 ms for 200; the RPC's median wall 3.1 ms (20), 5.0 ms (200), 3.6 ms (page 100 of 20), 4.0 ms (a warehouse's page) — no audit file |

A row with no actor (a take's release rows under the take's transaction) still reads its transaction's flag, but the screen draws no name and so no badge for actor 0.
