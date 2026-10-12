# Clarify — `inventory/transaction.md`

[transaction.md](./transaction.md) is yours — this one is mine. An answered point is deleted; what you settle is recorded
in [transaction_decision.md](./transaction_decision.md).

> ✅ **Answered 2026-10-12, in chat:** Q6, who bears a sample — nobody pays anybody: a sample is a stock-out at batch value
> from the owning team's stock, with no agreement asked
> ([a-sample-is-a-stock-out-at-batch-value](./transaction_decision.md#a-sample-is-a-stock-out-at-batch-value)), against my
> *named member, else the warehouse*. 🆕 **Opened:** Q9, where the sample's recipient is kept — the team is to see it, and no
> decided column holds it.
>
> 🆕 **Opened 2026-10-12:** Q8, where *picked* is stored, from [placement Q4](./placement_clarify.md#question).
>
> 🔄 **Narrowed 2026-10-12:** Q5. `move` was added in chat ([a-move-has-its-own-type](./transaction_decision.md#a-move-has-its-own-type)), so only `revaluation` and
> `opname` are left.
>
> 🔄 **Narrowed 2026-10-12:** Q6. What a sample is was answered in chat
> ([a-sample-is-handed-over-at-the-warehouse](./transaction_decision.md#a-sample-is-handed-over-at-the-warehouse)), so
> only who bears it is left.
>
> **First pass (2026-10-09)**, after you moved the transaction table here from context.md and added items and a rollback.
> Recorded: [a-transaction-lists-its-items](./transaction_decision.md#a-transaction-lists-its-items) (reverses the old
> *no items table*) · [a-transaction-is-made-when-the-act-happens](./transaction_decision.md#a-transaction-is-made-when-the-act-happens)
> (context Q13b) · [an-undo-rolls-the-transaction-back-once](./transaction_decision.md#an-undo-rolls-the-transaction-back-once)
> (context Q13e). ➡ **Re-routed here** from [context Q13](./context_clarify.md#question): 13a, 13c, 13d, 13f — and the
> [Contradiction](#the-two-type-lists-do-not-line-up) over `tx_type`. 🔄 **Withdrawn:** my 13g (*record the person on the
> transaction only*) — your rollback is the reason to keep `actor_id` on the log rows: under the original transaction, the
> log rows are what say **who** rolled it back and **when**.

Siblings: [context_clarify](./context_clarify.md) · [order_clarify](./order_clarify.md) · [opname_clarify](./opname_clarify.md) ·
[restock_clarify](./restock_clarify.md).

---

## Proposed Design

### the tables, with what I would add

```mermaid
erDiagram
  inventory_transactions ||--|{ inventory_transaction_items : lists
  inventory_transactions ||--|{ batch_logs : moves
  inventory_transactions ||--|{ product_placement_logs : moves
  inventory_transactions {
    uint id PK
    uint warehouse_id
    uint team_id
    string tx_type
    uint ref_id "NEW - the order, restock, return or transfer it is for"
    string recipient "NEW - Q9, who received a sample, null otherwise"
    uint create_by_user_id
    bool is_rollback
    string description
    datetime updated_at
    datetime created_at
  }
  inventory_transaction_items {
    uint id PK
    uint transaction_id
    uint product_id "NEW - what the item is"
    int quantity
    float total "the value moved - the sum of its batch rows"
    datetime created_at
  }
```

### the rollback, reversing the log rows

Your flow, with one change: the reversal reads the **log rows**, which say which batch and which rack, instead of the
items, which do not.

```mermaid
flowchart LR
  C["Order Canceled - order 9001"] --> F["find by ref_id and lock"]
  F --> Q{"is_rollback?"}
  Q -->|"yes"| N["do nothing"]
  Q -->|"no"| Z{"would a batch or a rack go below zero?"}
  Z -->|"yes"| X["refused - correct it with an adjustment"]
  Z -->|"no"| R["each batch_logs and product_placement_logs row, sign flipped"]
  R --> M["set is_rollback"]
```

---

## Critique

| | Problem | → Recommend |
| --- | --- | --- |
| **1** | **The rollback cannot find its transaction.** *Order Canceled* says *order 9001*; nothing in `inventory_transactions` says which order a row is for. `restocks.transaction_id` covers a restock, but the order lives in another service | `ref_id` on the transaction — [Q1](#question) |
| **2** | **An item names no product.** `quantity 3, total Rp 32.000` — of what? It also repeats the transaction's `warehouse_id` | `product_id` — [Q2](#question) |
| **3** | **The rollback reverses from the items, and the items cannot say where the units came from.** An order of 3 took 2 from batch 7 and 1 from batch 9, 1 from Rak A and 2 from Rak B. Re-deriving that today, FIFO and fewest-first pick whatever is oldest and lowest **now** — a different batch at a different price, a different rack | reverse the **log rows** — [Q3](#question) |
| **4** | **A rollback can take stock below zero.** A restock of 10 is accepted, 6 are sold, then the restock is rolled back: the batch goes from 4 to −6 | refuse it — [Q4](#question) |

---

## Question

1. **How does a rollback find its transaction?** ➡ Was [context Q13a](./context_clarify.md#question).
   **→ Recommend: `ref_id`** on `inventory_transactions` — the order's, restock's, return's or transfer's id; `tx_type`
   already says which kind. *Order Canceled* then finds `tx_type = order, ref_id = 9001`. An order holding two owners' goods
   has two transactions ([Q7](#question)), and `ref_id` finds both.
2. **What is an item, and what reads it?** ([Critique 2](#critique))
   **→ Recommend:** one item per product moved, with **`product_id`**; `total` is the value moved — the sum of its batch
   rows' `change_valuation`. It reads as the transaction's summary: *"3 Kaos Hitam, Rp 32.000"*. *What else did you mean it
   for?*
3. **Does a rollback reverse the items, or the log rows?** ([Critique 3](#critique))
   **→ Recommend: the log rows** — each `batch_logs` and `product_placement_logs` row of the transaction, sign flipped. The
   units go back to batch 7 and batch 9 at their own prices, to Rak A and Rak B, exactly as they left. The items are then
   only checked against them.
4. **What if a rollback would take a batch or a rack below zero?** ([Critique 4](#critique)) 🔄 *(2026-10-10)* **The rack
   half is forced now** — [a-shelf-never-goes-below-zero](./placement_decision.md#a-shelf-never-goes-below-zero) puts a
   database check on `stock_count`, so a rollback that would go below zero on a rack fails. What is left is the batch.
   **→ Recommend: refuse it**, and correct with an `adjustment` instead. An order's rollback never hits this — it puts units
   back, and [no-cancel-after-the-warehouse-confirms](./order_decision.md#no-cancel-after-the-warehouse-confirms) means they
   were never picked.
5. 🔄 *(2026-10-12)* **Operations with no `tx_type`.** ✅ `move` is added ([a-move-has-its-own-type](./transaction_decision.md#a-move-has-its-own-type)). ➡ Was
   [context Q13c](./context_clarify.md#question). A revaluation and a count each write ledger rows and have no type.
   **→ Recommend:** add **`revaluation`** and **`opname`**, not `adjustment` for both: a revaluation moves no units, and a
   count can create a debt that a reader must be able to tell from a broken or lost unit.
6. ✅ *(2026-10-12)* **Answered** — [a-sample-is-a-stock-out-at-batch-value](./transaction_decision.md#a-sample-is-a-stock-out-at-batch-value).
7. **Whose `team_id` when team B sells team A's goods?** ➡ Was [context Q13f](./context_clarify.md#question).
   **→ Recommend: the stock's owner, A** — both ledgers are keyed by the owning team; the seller is on the order. An order
   holding two owners' goods writes two transactions.

8. 🆕 *(2026-10-12, from [placement Q4](./placement_clarify.md#question))* **Where is *picked* stored?**
   [the-verify-scan-tells-inventory-picked](./order_decision.md#the-verify-scan-tells-inventory-picked) says a unit waits
   on the rack while *"an order's take has no picked yet"*, and no table holds *picked*. A count needs it to know what
   is still physically on a rack ([opname Q10b](./opname_clarify.md#question)); the rack screen does not, for now
   ([a-rack-shows-its-stock-count-for-now](./placement_decision.md#a-rack-shows-its-stock-count-for-now)). A transfer out waits the same way, until Warehouse A processes it.
   **→ Recommend: `picked_at`** on `inventory_transactions`, null while the units are still on the rack. The verify scan
   sets it for an order, and `process` for a transfer out. Every other take is at the shelf, so it is set at create.
   Waiting on a rack is then that transaction's log rows on the rack, not rolled back, with `picked_at` null.

   ```mermaid
   flowchart LR
     O["order 9001 - PostOrder"] -->|"picked_at null - waiting"| S["verify scan"]
     S -->|"picked_at 13:40"| D["off the rack"]
     T["transfer out"] -->|"picked_at null - waiting"| P["Warehouse A processes"]
     P -->|"picked_at set"| D
   ```

9. 🆕 *(2026-10-12, from [a-sample-is-a-stock-out-at-batch-value](./transaction_decision.md#a-sample-is-a-stock-out-at-batch-value))*
   **Where is a sample's recipient kept?** The team is to see who received each sample of its goods, and
   `RackSample.recipient` is required on the request — but `inventory_transactions` has no column for it, so today it would
   be dropped at the ledger.

   | | where | + | − |
   | --- | --- | --- | --- |
   | **a** | 🆕 `recipient`, nullable, on `inventory_transactions`; set by a sample only | the team's history shows it as its own fact; the staff's note stays the note | a column most rows leave empty |
   | **b** | written into `description` | no new column | `RackSample` already has both a recipient and a note, so one of them is squeezed into the other, and the history cannot show *who received it* on its own |

   **→ Recommend a.** Who received the goods is the one fact the team checks a sample by — it is what makes the decision's
   guard ("the team sees it") a guard.

   ```mermaid
   flowchart LR
     D["Record Sample - recipient Budi, note for a review video"] --> T["inventory_transactions - sample"]
     T -->|"a"| R["recipient Budi - description for a review video"]
     T -.->|"b"| X["description - Budi, for a review video"]
     R --> H["Melati's history - to Budi"]
   ```

---

# Contradiction

## the-two-type-lists-do-not-line-up

➡ *(2026-10-09)* **Moved here** from [context_clarify](./context_clarify.md#the-two-type-lists-do-not-line-up), because
`tx_type` now lives in this doc.

| | `tx_type` — [transaction.md](./transaction.md) | `change_type` — [placement.md](./placement.md) | `change_type` — [batch.md](./batch.md) |
| --- | --- | --- | --- |
| `order` · `restock` · `return` · `adjustment` | ✅ | ✅ | ✅ |
| `sample` · `transfer_in` · `transfer_out` | ✅ | ✅ | ❌ — a sample's or a transfer's batch row has no valid type. 🔄 *(2026-10-10)* More pressing now: batch.md mints a batch on transfer in, and that batch's first row has no type |
| `revaluation` | ❌ — no transaction type | ❌ | ✅ |
| `broken` · `lost` | — | — | ✅ — reasons inside an `adjustment`, fine |

**→ Recommend** one list, kept here, that both ledger docs point at: every `tx_type`, plus the reasons an `adjustment`
carries (`broken`, `lost`, `found`). A log row writes its transaction's type — or, inside an adjustment, its reason. The
placement side already does exactly this.

```mermaid
flowchart LR
  T["tx_type - transaction.md"] -->|"the same list"| P["placement change_type"]
  T -.->|"sample, transfers missing"| B["batch change_type"]
  B -.->|"revaluation has no tx_type"| T
```
