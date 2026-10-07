# Decisions — `inventory/restock.md`

What the owner settled, recorded before it is acted on. **Append-only** — a decision that is later reversed is renamed
and its references grepped (RULE 12), never quietly edited away. The open set is [restock_clarify.md](./restock_clarify.md).

| decision | says | from |
| --- | --- | --- |
| [a-line-names-the-channel-it-was-bought-from](#a-line-names-the-channel-it-was-bought-from) | each restock line names the supplier channel it was bought from, optionally — not one supplier per restock | your §Table Should We Have edit, 2026-10-06 — answers *restock-has-no-supplier*, against my *one `supplier_id` per restock* |
| [accept-is-one-transaction-then-an-event](#accept-is-one-transaction-then-an-event) | accept writes the problem rows, the batch with its price and the placements in ONE transaction; after commit it publishes *Restock Accepted*, heard by `supplier_service` | your §Restock Accepted Flow, 2026-10-06 — settles the shelf half of *two-drawings-of-receiving* |
| [any-warehouse-member-counts-what-arrived](#any-warehouse-member-counts-what-arrived) | any member of the warehouse team counts and accepts; per line they type what arrived and how many of those are broken — the short units are the difference | chat, 2026-10-07 — answers Q6a, as recommended |
| [a-product-appears-once-per-restock](#a-product-appears-once-per-restock) | one restock lists each product once, the store chosen per product | chat, 2026-10-07 — answers Q12, as recommended |

## a-line-names-the-channel-it-was-bought-from

> Owner, in [restock.md](./restock.md) §Table Should We Have *(2026-10-06)*: `restock_items` and
> `restock_problem_items` gain *"`supplier_channel_id`, its optionals"*; [batch_ledger.md](./batch_ledger.md) gives
> `batches` the same. It answers the clarify's contradiction *restock-has-no-supplier*, **against my recommendation** of
> one `restocks.supplier_id`, *"because one parcel has one sender"*.

**The verdict.** Where goods were bought is a fact of the **line**, not of the restock: each line may name the store —
a supplier's channel — it came from, and one restock may mix stores. The batch minted from the line carries the
channel on.

```mermaid
flowchart LR
  R["a restock"] --> L1["line - product A"]
  R --> L2["line - product B"]
  L1 -->|"supplier_channel_id, optional"| C1["Toko Melati on Shopee"]
  L2 -->|"supplier_channel_id, optional"| C2["another store"]
  C1 --> S1["its supplier"]
  L1 -->|"accept mints"| B1["a batch - same supplier_channel_id"]
```

**The spec.**

| | |
| --- | --- |
| `restock_items.supplier_channel_id` | optional · an opaque id into `supplier_service` ([the-supplier-gets-its-own-service](../supplier/context_decision.md#the-supplier-gets-its-own-service)) |
| `restock_problem_items.supplier_channel_id` | as written — ⚠ [Q6b](./restock_clarify.md#question) recommends the problem row point at its line instead |
| `batches.supplier_channel_id` | copied from the line at accept |
| the supplier | reached through the channel — `channel → supplier_id` |

**What it does NOT settle:** a supplier with no channel — a physical vendor
([Q3](./restock_clarify.md#question)); what a line shows once the channel is hard-deleted ([Q1](./restock_clarify.md#question));
and whether one restock may span parcels that arrive separately ([Q4](./restock_clarify.md#question)).

## accept-is-one-transaction-then-an-event

> Owner, in [restock.md](./restock.md) §Restock Accepted Flow *(2026-10-06)*: *"Accept RPC called"* → *"Open Database
> Transaction"* — *"If Any Step Fails, Rollback Transaction and Return Error"* — holding `restock_problem_items`,
> *"calculate price_unit and post in batch_ledger"* and *"post in placement ledger"*; then *"Send Restock Accepted
> Event"* *"if success"*, received by `supplier_service`'s *"Inventory Webhook"* *"by push subscribe"*. It settles the
> shelf half of the clarify's *two-drawings-of-receiving*.

**The verdict.** Accepting a restock is **all or nothing**: the problems found, the batch the good units become — its
unit price computed then — and the shelves they go to are written together, or not at all. Only once that has
committed does the rest of the system hear of it, through one event.

```mermaid
flowchart LR
  A["Accept RPC"] --> T["one transaction - problem rows, batch with its price_unit, placement ledger"]
  T -->|"any step fails"| X["rollback, return the error"]
  T -->|"commit"| E["Restock Accepted event"]
  E -->|"push subscription"| S["supplier_service - processes it"]
```

**The spec.**

| | |
| --- | --- |
| inside the transaction | `restock_problem_items` · `batches` + `batch_logs` (+ `batch_price_logs`, per [batch_ledger.md](./batch_ledger.md)) · `product_placements` + `product_placement_logs` |
| the price | computed at accept — consistent with [staff-accepts-the-restock](../user/context_decision.md#staff-accepts-the-restock) (*"the quantity, the losses, the unit price"*); the formula is still product Q2, Q6 |
| the event | published after commit, no outbox — [no-outbox-the-publish-is-trusted](../../technical/event_architecture/context_decision.md#no-outbox-the-publish-is-trusted) |
| who hears it | `supplier_service`, by push. What it does is [Q10a](./restock_clarify.md#question) |

**What it does NOT settle:** the courier's ask — neither its cost lines nor what the selling team owes for them is in
the transaction ([Q10b](./restock_clarify.md#question)); how many batches, and whether the log rows name the restock
([Q11](./restock_clarify.md#question)); the status change and its trail ([Q9](./restock_clarify.md#question)).

## any-warehouse-member-counts-what-arrived

> Owner, in chat *(2026-10-07)*: *"for 3, all warehouse staff can"*. The question was *"what does Staff type at the door?"*,
> and the owner confirmed it as **who + the recommendation**. It answers [Q6a](./restock_clarify.md#question), as recommended,
> and widens [staff-accepts-the-restock](../user/context_decision.md#staff-accepts-the-restock) from Staff to the whole team.

**The verdict.** Whoever in the warehouse team opens the box counts what is in it and accepts it, in one act. Per line
they type two numbers: **how many arrived**, and **how many of those are broken**. Nobody counts what is not there; the
short units are the difference.

```mermaid
flowchart LR
  BOX["the box"] --> M["any warehouse team member"]
  M --> R["per line - received_count"]
  M --> K["per line - broken, out of received"]
  R --> S["short = count - received_count"]
  R --> G["good = received_count - broken"]
  K --> G
  G --> B["the batch"]
```

**The spec.**

| | |
| --- | --- |
| who | the warehouse team's Owner, Admin and Staff, plus Root and the Administrator. The build's `RestockRequestFulfillRequest` already allows all five |
| `restock_items.received_count` | 🆕 typed at accept, `>= 0` |
| broken | typed per line, `0 <= broken <= received_count`, written as a `restock_problem_items` row |
| short | derived, `count - received_count`, written as a problem row when above 0. Its type name is [Q6c](./restock_clarify.md#question) |
| good units | `received_count - broken`. They become stock ([restock.md](./restock.md): *"accept the rest of good stock"*) |

**What it does NOT settle:** more arriving than was ordered ([Q6d](./restock_clarify.md#question)), whether the short row
is named `lost` or `missing` ([Q6c](./restock_clarify.md#question)), and the problem row's price being copied rather than typed
([Q6b](./restock_clarify.md#question)).

## a-product-appears-once-per-restock

> Owner, in chat *(2026-10-07)*, in the same answer: the recommendation for #3 included it. It answers
> [Q12](./restock_clarify.md#question), as recommended. supplier.md §Supplier Rule 2 had said *"its choose per product in restock"*.

**The verdict.** A restock lists each product **once**, and the store it was bought from is chosen per product. The
same shirt bought from two stores is two restocks, or one restock under one store.

```mermaid
flowchart LR
  R["a restock"] --> A["Kaos Polos Hitam - 15, from Melati"]
  R --> B["Celana Chino - 8, from Toko Sinar"]
  R -.->|"refused"| C["Kaos Polos Hitam again - from Toko Sinar"]
```

**The spec.**

| | |
| --- | --- |
| `restock_items` | unique (`restock_id`, `product_id`) |
| `restock_problem_items` | its `product_id` finds its line, so no `restock_item_id` is needed and [Critique 6](./restock_clarify.md#critique)'s case cannot happen |
| the batch | one line is one product, one store and one price, which matches one batch per line ([Q11a](./restock_clarify.md#question)) |

**What it costs:** a forwarder's box holding one product from two stores is entered as two restocks, or under one store.
