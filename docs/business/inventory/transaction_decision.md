# Decisions — `inventory/transaction.md`

What the owner settled, recorded before it is acted on. **Append-only** — a decision that is later reversed is renamed
and its references grepped (RULE 12), never quietly edited away. The open set is [transaction_clarify.md](./transaction_clarify.md).

| decision | says | from |
| --- | --- | --- |
| [a-transaction-lists-its-items](#a-transaction-lists-its-items) | `inventory_transaction_items` is back — a transaction lists its items, each with a quantity and a total | your transaction.md, 2026-10-09 — **reverses** the *no items table* row of [every-stock-change-belongs-to-a-transaction](./context_decision.md#every-stock-change-belongs-to-a-transaction) |
| [a-transaction-is-made-when-the-act-happens](#a-transaction-is-made-when-the-act-happens) | *Restock Accepted* and *Order Created* each call the API, which creates a new transaction then and there | your transaction.md, 2026-10-09 — answers context Q13b, as recommended |
| [an-undo-rolls-the-transaction-back-once](#an-undo-rolls-the-transaction-back-once) | an undo finds and locks the existing transaction, reverses it in both ledgers and sets `is_rollback`; a second undo does nothing | your transaction.md, 2026-10-09 — answers context Q13e, against my new reversing transaction |
| [a-sample-is-handed-over-at-the-warehouse](#a-sample-is-handed-over-at-the-warehouse) | a sample is goods going OUT: a person asks at the warehouse, staff pick the goods and hand them over | chat, 2026-10-12 — answers placement Q1a and the *what is it* half of Q6; my *asked ahead in the app* is withdrawn |
| [a-move-has-its-own-type](#a-move-has-its-own-type) | `move` joins the `tx_type` list: goods carried between racks, never typed `adjustment` | chat, 2026-10-12 — answers placement Q3a choice 1 and the `move` part of Q5, as recommended |

---

## a-transaction-lists-its-items

> Owner, in [transaction.md](./transaction.md) §General Table That Must Have *(2026-10-09)*: `inventory_transaction_items`
> with `id`, `warehouse_id`, `transaction_id`, `quantity`, `total`, `created_at` — and the flow creates them between the
> transaction and the two ledgers. ⚠ **It reverses** the spec row *"`inventory_transaction_items` — none"* in
> [every-stock-change-belongs-to-a-transaction](./context_decision.md#every-stock-change-belongs-to-a-transaction). That
> decision's name — every stock change belongs to a transaction — still holds; only its items row is overtaken.

**The verdict.** A transaction says, in its own rows, **what** it moved — a quantity and a total per item — before the
two ledgers say **where from**: which batches, which racks.

```mermaid
flowchart TB
  T["inventory_transactions - order 9001"] --> I["inventory_transaction_items - quantity 3, total Rp 30.000"]
  I --> BL["batch ledger - batch 7 -2, batch 9 -1"]
  I --> PL["placement ledger - Rak A -1, Rak B -2"]
```

**The spec.**

| | |
| --- | --- |
| `inventory_transaction_items` | `id` · `warehouse_id` · `transaction_id` · `quantity` · `total` · `created_at` |
| written | after the transaction row, before either ledger, in the same database transaction |

**What it does NOT settle** — [transaction_clarify Q2, Q3](./transaction_clarify.md#question): an item names no product ·
what reads the items · and that a rollback cannot reverse from them, since they do not say which batch or rack.

## a-transaction-is-made-when-the-act-happens

> Owner, in [transaction.md](./transaction.md) §Transaction Flow Related *(2026-10-09)*: *Restock Accepted* → *call* →
> *Api* → *New Transaction*; the same for *Order Created*. It answers [context Q13b](./context_clarify.md#question) — *is
> the transaction made at accept, or earlier?* — as recommended.

**The verdict.** A transaction is born when stock actually changes — the restock accepted, the order created — never when
a restock is merely planned. A restock cancelled or lost before it arrives leaves no transaction behind.

```mermaid
flowchart LR
  R["Restock Accepted"] -->|"call"| A["the API"]
  O["Order Created"] -->|"call"| A
  A --> N["New Transaction - the row, its items, both ledgers"]
```

**The spec.**

| | |
| --- | --- |
| created by | the call from *Restock Accepted* or *Order Created* |
| inside one database transaction | the transaction row, its items, the placement ledger, the batch ledger |
| `restocks.transaction_id` | set at accept, when the transaction exists |

## an-undo-rolls-the-transaction-back-once

> Owner, in [transaction.md](./transaction.md) *(2026-10-09)*: `is_rollback` and `description` on
> `inventory_transactions`; *Order Canceled* → *Api* → *Rollback Transaction* — *"find and lock existing Inventory
> Transaction"*, *if not rollback* get its items and post to both ledgers, then *"update field `is_rollback`"*; *if
> rollbacked*, *"Do Nothing"*. It answers [context Q13e](./context_clarify.md#question) — *how is a mistake undone?* —
> **against my recommendation** of a new transaction with `reverses_id`.

**The verdict.** An undo is the **same transaction, rolled back**: locked, reversed in both ledgers, and marked. Because
the mark is checked under the lock, an undo runs **once** — a cancel event delivered twice does nothing the second time,
which is exactly what [inventory-returns-stock-on-order-cancelled](../order/context_decision.md#inventory-returns-stock-on-order-cancelled)
asked for.

```mermaid
flowchart LR
  C["Order Canceled"] --> L["find and lock the transaction"]
  L --> Q{"is_rollback?"}
  Q -->|"yes"| N["do nothing"]
  Q -->|"no"| R["reverse it in the placement ledger and the batch ledger"]
  R --> F["set is_rollback"]
```

**The spec.**

| | |
| --- | --- |
| `inventory_transactions.is_rollback` | 🆕 set once, by the rollback |
| `inventory_transactions.description` | 🆕 |
| `updated_at` | kept — the rollback is what updates a transaction |
| triggered by | *Order Canceled* (and any later undo) |
| guard | the transaction row is locked, then `is_rollback` is checked — a second rollback does nothing |

**What it does NOT settle** — [transaction_clarify.md](./transaction_clarify.md): how *Order Canceled* finds the
transaction for order 9001 (Q1) · reversing from the log rows rather than the items (Q3) · a rollback that would take a
batch or a rack below zero (Q4).

## a-sample-is-handed-over-at-the-warehouse

> Owner, in chat *(2026-10-12)*, answering [placement Q1a](./placement_clarify.md#question): *"sometimes random person
> need request sample product from warehouse. so warehouse staff pick goods and give the person."* It answers the *what is
> it* half of [transaction Q6](./transaction_clarify.md#question). My recommendation, that the selling team asks ahead in
> the app and the system picks like an order, is **withdrawn**: the request is made in person, at the warehouse.

**The verdict.** A `sample` is the owning team's units going **out** of the warehouse with no sale. A person asks at the
warehouse, warehouse staff pick the goods from a rack, and they hand them over there and then.

```mermaid
flowchart LR
  P["a person asks at the warehouse"] --> S["staff pick from a rack"]
  S --> H["handed over there and then"]
  H --> T["one sample transaction - batch and shelf both go down"]
```

**The spec.**

| | |
| --- | --- |
| direction | out: the owning team's units leave the warehouse |
| who asks | a person at the warehouse |
| who picks | warehouse staff |
| how it leaves | by hand, there and then: no order, no marketplace, no courier |
| what follows | a free unit that **arrives** is not a `sample`; it stays a restock line at Rp 0, as built |

**What it does NOT settle**: which rack it is written against ([placement Q1](./placement_clarify.md#question)) · whether a
sample ever comes back (placement Q1) · who bears it, and whether the owning team has to agree first
([transaction Q6](./transaction_clarify.md#question)).

## a-move-has-its-own-type

> Owner, in chat *(2026-10-12)*: *"3a, use `move`, and choice 1"*, choosing the first of three choices offered for
> [placement Q3a](./placement_clarify.md#question): *a type of its own, `move`, or reuse `adjustment`?* It answers the
> `move` part of [transaction Q5](./transaction_clarify.md#question), as recommended.

**The verdict.** Carrying goods from one rack to another in the same warehouse is a transaction of its own type,
**`move`**. It is never written as an `adjustment`: a move changes where units sit and nothing else, and it never creates a
debt, while an adjustment says the count was wrong and can.

```mermaid
flowchart LR
  M["staff carry 4 Kaos Hitam - Rak A to Rak C"] --> T["tx_type move"]
  T --> H["the history reads - moved to Rak C"]
  M -.->|"never"| A["adjustment -4 - reads as a loss"]
```

**The spec.**

| | |
| --- | --- |
| `inventory_transactions.tx_type` | gains `move` |
| `product_placement_logs.change_type` | gains `move`, the transaction's type, as for every other operation |
| `batch_logs.change_type` | does not need it: a move writes no batch row ([a-move-writes-two-rack-rows-and-no-batch-row](./placement_decision.md#a-move-writes-two-rack-rows-and-no-batch-row)) |
| money | none: a move is never a debt |

**What it does NOT settle**: `revaluation` and `opname`, the rest of [transaction Q5](./transaction_clarify.md#question) ·
⚠ the lists in [transaction.md](./transaction.md) and [placement.md](./placement.md) are yours to add `move` to.
