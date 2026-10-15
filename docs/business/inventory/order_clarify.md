# Clarify — `inventory/order.md`

[order.md](./order.md) is yours — this one is mine. An answered point is deleted; what you settle is recorded in
[order_decision.md](./order_decision.md).

> ✅ **Answered in chat (2026-10-15, last):** Q10 — no special inventory write; the staff count the product while they
> talk it over ([a-missing-unit-is-found-by-opname](./order_decision.md#a-missing-unit-is-found-by-opname)). Open here: Q5.

> ✅ **Answered in chat (2026-10-15, later):** Q2 — goods on no rack send the order back to `pending` with a note on
> its timeline, and the selling team decides ([missing-goods-send-the-order-back-to-pending](./order_decision.md#missing-goods-send-the-order-back-to-pending)).
> 🆕 [Q10](#question): a cancel then releases a unit that was never there. Open here: Q5, Q10.

> ✅ **Answered in chat (2026-10-15, last):** Q8 — the placement page asks by `orders.transaction_id`
> ([the-placement-page-reads-racks-by-transaction-id](./order_decision.md#the-placement-page-reads-racks-by-transaction-id)).
> Open here: Q2, Q5.

> ⚠ **Corrected (2026-10-15), on your word:** I read *"print receipt"* as a pick list carrying the racks. The receipt
> (`receipt`, `receipt_file`) is the **shipping label** customer service uploads, printed and attached to the parcel; the
> racks are on the warehouse's **order placement page** (`pick-order`), which reads them from inventory. Fixed in the flow
> table, the basket story, the critique and Q2 — and [Q8](#question) is re-asked: the page asks inventory by
> `order:<id>`, which no take is filed under any more.

> ✅ **Answered in chat (2026-10-15, later):** Q7 — one error, three reasons, every refused line named
> ([a-refusal-names-its-reason-and-every-line](./order_decision.md#a-refusal-names-its-reason-and-every-line)); the third reason
> is not drawn yet ([the-flow-has-no-stock-refusal](#the-flow-has-no-stock-refusal)). Open here: Q2, Q5, Q8.

> ✅ **Answered in chat (2026-10-15, after the commit):** Q6 — the reserve stays before the take, on a plain read of the
> total stock ([the-reserve-is-read-before-the-take](./order_decision.md#the-reserve-is-read-before-the-take)), against my
> under-the-lock; the race example moved into that decision. Open here: Q2, Q5, Q7, Q8.

> ✅ **Answered in chat (2026-10-15, last):** own or borrowed — the request carries the ordering `team_id`, each line
> `owner_team_id` ([the-take-names-the-orderer-and-each-owner](../order/context_decision.md#the-take-names-the-orderer-and-each-owner)),
> so the private and reserve checks have something to compare. The critique row `the-check-cannot-tell-own-from-borrowed` is deleted.

> ✅ **Re-examined after your third edit of §Flow and your answer in chat (2026-10-15, later still).** A hit is now
> *"Refuse Because its Already Created"* — [a-used-key-is-refused-first](./order_decision.md#a-used-key-is-refused-first),
> answering [Q9](#question) as recommended; `the-take-replays-a-used-key` is resolved and deleted. And every submit mints
> a new key ([every-submit-mints-a-new-key](../order/context_decision.md#every-submit-mints-a-new-key)), so no two
> attempts share a take — `a-refused-take-sends-no-cancel` is answered by removing its case. Open here: Q2, Q5, Q6, Q7, Q8.

> 🔄 **Re-examined after your second edit of §Flow (2026-10-15, later).** The key is now looked up **first** — the
> position I asked for in [Q7](#question). ⛔ But a hit **returns** the existing transaction, which is the replay
> [inventory-takes-a-key-once](../order/context_decision.md#inventory-takes-a-key-once) ruled out:
> `the-take-replays-a-used-key`, asked as 🆕 [Q9](#question). Following it found a hole on
> the order's side too — a refused take still sends the cancel — asked where it can be answered:
> `a-refused-take-sends-no-cancel`. The private and
> reserve checks are now two steps; [Q6](#question) is unchanged — both still run before the transaction.

> 🔄 **Re-examined after your new §Inventory Service Flow When Order Created Called Our `OrderTransactionCreate`
> (2026-10-15).** ✅ Recorded: [the-take-checks-the-product-first](./order_decision.md#the-take-checks-the-product-first) —
> product configuration is read before the transaction, and private and the reserve are the take's to check. 🆕 Three
> opened: [Q6](#question) a reserve compared before the lock lets two borrowers past it · [Q7](#question) the take's
> refusals · [Q8](#question) where the receipt's racks come from. ⛔ One contradiction:
> [the-take-draws-the-ledgers-side-by-side](#the-take-draws-the-ledgers-side-by-side). ➡ Two points belong to other docs,
> so only a pointer is left here: the ordering team on the request, and whether *private* is the shared lock
> ([Critique](#critique)).

> **Re-examined after opname.md (2026-10-08).** ➡ [Q4](#question) re-routed to [opname_clarify Q5](./opname_clarify.md#question).
>
> **Re-examined after your Q4 answer (2026-10-08).** ⏸ [Q4](#question): a count **locks its rack**, to be designed in
> [opname.md](./opname.md) ([a-count-locks-its-rack](./order_decision.md#a-count-locks-its-rack)). It stays open until then — the
> units already in a basket when a lock starts are still unanswered.
>
> **Q4 elaborated (2026-10-08)**, on request — [the basket gap, worked](#the-basket-gap-worked). A count needs to know
> **printed** as well as **picked**: a unit sold but not printed is certainly on the rack, one printed but not scanned may be in
> a basket. So inventory also hears *Order Processed*, and a count waits for the printed-but-unscanned.
>
> **Re-examined after your answers in chat (2026-10-08).** ✅ [Q1](#question): the verify scan tells inventory *picked*
> ([the-verify-scan-tells-inventory-picked](./order_decision.md#the-verify-scan-tells-inventory-picked)) · ✅ [Q3](#question):
> no cancel after the warehouse confirms ([no-cancel-after-the-warehouse-confirms](./order_decision.md#no-cancel-after-the-warehouse-confirms)),
> instead of my put-back task. 🆕 [Q4](#question): the minutes a unit spends in a basket · [Q5](#question): a marketplace
> that cancels the order itself after the warehouse confirmed.

> **First pass (2026-10-08)**, after your §How Warehouse Process The Order. Its *"Staff Scan Goods for verify"* is the
> moment a unit has left the rack — the signal [context Q11c](./context_clarify.md#question) was missing — so that
> question is **re-routed here** as [Q1](#question). Two gaps in the flow are [Q2, Q3](#question), and the journey disagrees
> with the order context's ([Contradiction](#two-journeys-for-one-order)).

Siblings: [context_clarify](./context_clarify.md) · [restock_clarify](./restock_clarify.md) ·
[transaction_clarify](./transaction_clarify.md) · [order_creation_clarify](../order/order_creation_clarify.md).

---

## Proposed Design

### OrderTransactionCreate, with the decisions placed

Your flow, with every step the decisions have already fixed. Three steps are mine and marked *proposed*.

```mermaid
sequenceDiagram
  participant O as order_service
  participant I as OrderTransactionCreate
  participant P as product_service
  participant D as inventory database
  O->>I: K, ordering team B, warehouse, lines
  I->>D: a transaction under K already? refused - key used, never returned
  I->>P: configuration by ids - owner, private, reserve, markup
  Note over I: a borrowed line - private, or the total stock short of the reserve - Product Not Allowed, stop
  I->>D: open the transaction
  I->>D: insert the order transaction under K - UNIQUE stops a same-second twin
  I->>D: lock the products' batches by id, then their racks by id
  I->>D: enough units on the racks
  I->>D: choose batches oldest first, racks fewest first
  I->>D: write the items, batch_logs, placement_logs
  I->>D: commit
  I-->>O: transaction_id, per line owner, cost, markup, total
```

| step | from |
| --- | --- |
| the product read, before the transaction · private refused there | [the-take-checks-the-product-first](./order_decision.md#the-take-checks-the-product-first) |
| the key looked up first, a hit refused | [a-used-key-is-refused-first](./order_decision.md#a-used-key-is-refused-first) |
| the order transaction under K, inserted first inside the transaction | ⚠ **proposed** — the lookup is a read, and two same-second takes both find nothing; the UNIQUE insert stops the second ([transaction Q1](./transaction_clarify.md#question), option a) |
| batches, then racks, each by id | [batches-lock-before-shelves-by-id](./context_decision.md#batches-lock-before-shelves-by-id) |
| the reserve, before the transaction, plain read | [the-reserve-is-read-before-the-take](./order_decision.md#the-reserve-is-read-before-the-take) |
| batches oldest first · racks fewest first, unlocked first | [an-order-takes-from-the-lowest-shelf-first](./context_decision.md#an-order-takes-from-the-lowest-shelf-first) · [an-order-line-may-be-taken-from-several-racks](./placement_decision.md#an-order-line-may-be-taken-from-several-racks) |
| an item equals its batch rows · both ledgers move the same units | [an-item-equals-its-batch-rows](./transaction_decision.md#an-item-equals-its-batch-rows) · [both-ledgers-count-the-same-units](./context_decision.md#both-ledgers-count-the-same-units) |
| one transaction per order | [an-order-is-one-inventory-transaction](../order/context_decision.md#an-order-is-one-inventory-transaction) |
| the markup on the answer | [inventory-computes-the-markup](../order/context_decision.md#inventory-computes-the-markup) — it rides the same product read |

### the flow, with what inventory hears

Your steps, plus what is decided and the one branch still missing.

```mermaid
flowchart LR
  N["New Order - PostOrder lowers the rack"] --> C["Order Processed - the label is printed, the placement page shows the racks"]
  C --> P["Staff Picking Goods"]
  P --> S["Staff Scan Goods for verify"]
  S -->|"decided - tells inventory, order 9001 picked"| K["Order Packing Completed"]
  K --> SH["Order Shipped - scanned at the courier"]
  P -.->|"decided - on no rack"| NF["back to pending with a note - selling decides"]
  C -.->|"decided - no cancel from here on"| CX["refused"]
```

| step | what inventory needs from it |
| --- | --- |
| New Order | `PostOrder` — the take, at the lowest racks first ([an-order-takes-from-the-lowest-shelf-first](./context_decision.md#an-order-takes-from-the-lowest-shelf-first)) |
| Order Processed | the receipt — the shipping label customer service uploaded (`receipt_file`) — is printed, to go on the parcel later. The racks are on the warehouse's **order placement page** (`pick-order`), read from inventory — *"Rak A × 1, Rak B × 2"* ([Q8](#question)) — and 🆕 inventory hears **printed**: from here the unit may be in a basket ([Q4](#question)) |
| Staff Scan Goods for verify | ✅ **picked** — from here on, the unit is no longer on the rack ([decided](./order_decision.md#the-verify-scan-tells-inventory-picked)) |
| the rest | nothing — packing and shipping move no stock |


### the basket gap, worked

[Q4](#question), told from the floor. Kaos Hitam, Rak A holds 2.

| time | what happens | the rack | the system | waiting to be picked |
| --- | --- | --- | --- | --- |
| 09:00 | order 9001 comes in | 2 | 2 → 1 | order 9001 |
| 13:00 | staff confirm it and print its label; the placement page shows *"Rak A × 1"* | 2 | 1 | order 9001 |
| 13:05 | the picker lifts the unit into a basket | **1** | 1 | order 9001 — **not scanned yet** |
| 13:07 | a count of Rak A: 1 counted − 1 waiting = 0, the system says 1 | 1 | **−1: a warehouse debt** | |
| 13:10 | the verify scan at the packing table | 1 | 0 | — |
| later | the next count finds 1 on a rack the system says is empty | 1 | +1 found | |

Nothing was lost — the unit was in a basket for five minutes. The count subtracted it as *waiting* while it was no longer
on the rack.

**The fix is to know where a sold unit can be.** Nobody picks before the receipt is printed, so the printing is the line:

```mermaid
stateDiagram-v2
  direction LR
  state "on the rack - sold, receipt not printed" as A
  state "on the rack or in a basket - printed, not scanned" as B
  state "gone - scanned" as C
  [*] --> A: PostOrder
  A --> B: Order Processed
  B --> C: Staff Scan Goods for verify
```

| a sold unit is | so it is | the count |
| --- | --- | --- |
| sold, receipt not printed | certainly on the rack | subtracts it |
| printed, not scanned | on the rack **or** in a basket — nobody knows | **waits** for the scan |
| scanned | gone | ignores it |

So a count of Kaos Hitam starts once no Kaos Hitam receipt is printed-and-unscanned, and while it runs no new Kaos Hitam
receipt prints. Both waits are minutes. The count screen shows what it is waiting for — *"order 9001, printed 13:00,
not yet scanned"*.

---

## Critique

| | Problem | → Recommend |
| --- | --- | --- |
| **private-or-shared-lock** | §What We Should Check says *private*; [product.md](../product/context.md) §Cross/Shared Products Rule says *shared lock* | ➡ asked in [product Q10](../product/context_clarify.md#question). Your check reads as *one switch*, which is what I recommend there |
| **the-marketplace-cancels-on-its-own** | No cancel after the warehouse confirms ([no-cancel-after-the-warehouse-confirms](./order_decision.md#no-cancel-after-the-warehouse-confirms)) — except where the **marketplace** cancels on its own | [Q5](#question) |

---

## Question

1. ✅ *(2026-10-08)* **Answered: yes** — [the-verify-scan-tells-inventory-picked](./order_decision.md#the-verify-scan-tells-inventory-picked).
2. ✅ *(2026-10-15)* **Answered: on another rack, take it; on none, the order goes back to `pending` with a note, and the selling team decides** — [missing-goods-send-the-order-back-to-pending](./order_decision.md#missing-goods-send-the-order-back-to-pending). What a cancel then releases is [Q10](#question).
3. ✅ *(2026-10-08)* **Answered: it cannot be cancelled** — [no-cancel-after-the-warehouse-confirms](./order_decision.md#no-cancel-after-the-warehouse-confirms).
4. ➡ *(2026-10-08)* **Re-routed to [opname_clarify Q5](./opname_clarify.md#question)** — opname.md now has the lock
   ([a-count-locks-its-rack](./order_decision.md#a-count-locks-its-rack)); what is left is the units already in a basket when
   it starts. The worked story stays in [the basket gap, worked](#the-basket-gap-worked).
5. 🆕 **The marketplace cancels the order itself after the warehouse confirmed** — the buyer's request accepted on the
   platform, or a ship-by deadline missed. Our system refuses the cancel, but the courier will not take a parcel the
   platform has cancelled, so the goods are packed and going nowhere.
   **→ Recommend:** the order goes to `problem` (already in [order/context.md](../order/context.md)'s journey), and a staff
   member **unpacks it back onto a rack**, which reverses the take. It is rare, and it is the one case a put-back has to
   exist for. Put back on a different rack, the count fixes it.
6. ✅ *(2026-10-15)* **Answered: no — before the take, on a plain read of the total stock** — [the-reserve-is-read-before-the-take](./order_decision.md#the-reserve-is-read-before-the-take), against my under-the-lock. Which total, and the boundary, are [product Q3](../product/context_clarify.md#question).
7. ✅ *(2026-10-15)* **Answered: one error, three reasons, every refused line named** — [a-refusal-names-its-reason-and-every-line](./order_decision.md#a-refusal-names-its-reason-and-every-line). ⚠ *not enough stock* is not drawn yet — [the-flow-has-no-stock-refusal](#the-flow-has-no-stock-refusal).
8. ✅ *(2026-10-15)* **Answered: by `orders.transaction_id`** — [the-placement-page-reads-racks-by-transaction-id](./order_decision.md#the-placement-page-reads-racks-by-transaction-id). ⚠ `StockPickLocations` still asks by `order:<id>`.
9. ✅ *(2026-10-15)* **Answered: refused** — [a-used-key-is-refused-first](./order_decision.md#a-used-key-is-refused-first).
10. ✅ *(2026-10-15)* **Answered: the staff count it** — no special inventory write; the count records the loss ([a-missing-unit-is-found-by-opname](./order_decision.md#a-missing-unit-is-found-by-opname)). A count before the cancel sees nothing — the next one does, an accepted cost.

---

# Contradiction

## the-flow-has-no-stock-refusal

*(2026-10-15)* Your §Flow against [a-refusal-names-its-reason-and-every-line](./order_decision.md#a-refusal-names-its-reason-and-every-line):

| [order.md](./order.md) §Flow | decided |
| --- | --- |
| two exits — *Refuse Because its Already Created*, *Product Not Allowed* | three — the third is **not enough stock**, when this warehouse's racks hold fewer than a line wants |
| the transaction box always reaches its end | it can fail after the lock, write nothing, and return the lines it could not fill |

**Which is wrong:** the flow — it predates the decision. **→ Recommend** one more exit from the transaction box:
*"Not Enough Stock — rollback, return the short lines"*.

```mermaid
flowchart LR
  T["Database Transaction - lock, choose racks"] -->|"enough"| OK["taken"]
  T -.->|"missing in the flow"| N["Not Enough Stock - rollback, the short lines returned"]
```

## the-take-draws-the-ledgers-side-by-side

*(2026-10-15)* Your new flow's transaction box — carried over unchanged from the first sketch — against three decisions
made since:

| [order.md](./order.md) §Flow | decided |
| --- | --- |
| *"create transaction"*, then *"post in batch ledger"* and *"post in placement ledger"* side by side | batches are locked before racks, and racks are chosen only once locked — [batches-lock-before-shelves-by-id](./context_decision.md#batches-lock-before-shelves-by-id) |
| no items | a transaction lists its items, one per product — [a-transaction-lists-its-items](./transaction_decision.md#a-transaction-lists-its-items), [an-item-names-its-product](./transaction_decision.md#an-item-names-its-product) |
| the ledgers written with nothing chosen first | an item's total is what its chosen batches give up, so the choice comes before the item — [an-item-equals-its-batch-rows](./transaction_decision.md#an-item-equals-its-batch-rows) |

**Which is wrong:** the box — it predates all three. **→ Recommend** redrawing it as the sequence in
[Proposed Design](#ordertransactioncreate-with-the-decisions-placed). [transaction.md](./transaction.md) §Transaction Flow
Related draws its ledgers side by side too (it has the items), so one redraw serves both.
🔄 *(2026-10-15, later)* Your second edit removed the box's *"Open Database Transaction"* and *"Close Database Transaction"*
states but kept their arrows, so the diagram now draws two bare boxes named `otx` and `ctx`, and the box has no start.

```mermaid
flowchart LR
  B["order.md transaction box - the first sketch"] -.->|"ledgers side by side"| L["batches-lock-before-shelves-by-id"]
  B -.->|"no items"| I["a-transaction-lists-its-items"]
  B -.->|"writes before choosing"| C["an-item-equals-its-batch-rows"]
  T["transaction.md - ledgers side by side too"] -.-> L
```

## two-journeys-for-one-order

*(2026-10-08)* The same order's warehouse steps are drawn twice, and they disagree:

| | [order/context.md](../order/context.md) §Complete Journey Of The Orders | [order.md](./order.md) §How Warehouse Process The Order |
| --- | --- | --- |
| first step | *"Warehouse Accept Order"* | *"Order Processed"* — confirm, change status, print the receipt |
| the work | *"Warehouse Process Order (Packing/Picking)"* — one step | picking · scan to verify · packing — three |
| when the warehouse is done | *"set status warehouse process `completed`"* — **after** *"Give to Shipping Channel"* | *"Order Packing Completed"* — **before** the courier comes |
| shipped | set after the warehouse is done | *"staff scan to change shipped"*, at the handover |

So while a parcel waits for the courier, one doc says the warehouse is done and the other says it is not.

**→ Recommend** one journey, kept where the statuses belong — [order/context.md](../order/context.md), since they are the
order's statuses — and this doc links it and adds only what inventory hears (the table above). Two copies of a status list
drift every time one is edited.

```mermaid
flowchart LR
  subgraph oc["order/context.md"]
    a1["Accept"] --> a2["Process - picking and packing"] --> a3["Give to courier"] --> a4["warehouse completed"] --> a5["shipped"]
  end
  subgraph io["inventory/order.md"]
    b1["Processed"] --> b2["Picking"] --> b3["Scan verify"] --> b4["Packing completed"] --> b5["Shipped at the handover"]
  end
  a4 -.->|"after the courier"| X["which is it"]
  b4 -.->|"before the courier"| X
```
