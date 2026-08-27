# Clarity — `mutation_and_ledger.md`

Critique, questions and warnings about [mutation_and_ledger.md](./mutation_and_ledger.md). That doc is
yours; this one is mine. Answered points are **deleted**, so this is always the current open set.

> **Full re-examination.** Rewritten tight — the previous version had grown past the doc it tracks.
> Nothing still-open was dropped.

---

# Contradiction

## The doc says it relies on `event_library`, then re-specifies idempotency differently

`# Statistic Design.` item 1: *"we rely [event_library](../event/library.md) for processing event."*
Then `## Idempotency Layer.` and its two subsections specify their own — and it disagrees with the
library **and with the code already shipped in `pkgs/san_event`**:

| this doc | `event_library.md` / `san_event` |
| --- | --- |
| `sub->>idem: check duplication event` — a read, then insert | `Claim(ctx, tx, e)` — dedup **is** the insert, `ON CONFLICT`, rows-affected is the answer. A prior read is a check-then-act race, because redelivery happens while the first attempt is still running |
| `event_logs.message_id uint64` as the key | the broker's message id changes on republish, so it dedups nothing. Pub/Sub message ids are also **strings** |
| `Insert Fails → Nack Event` | a duplicate is `Duplicate` → **Ack** (`receive.go:38`). Only a transient error nacks. This doc contradicts *itself* here too — the flow above says `duplicate → ack` |
| `idem` inserts, **then** hands to `pipe` | `Claim` takes the caller's `tx` so the marker and the work commit together. Committing the marker first means a processing failure nacks, the redelivery sees a duplicate, acks, and **the work never runs** |

**→ Delete `## Idempotency Layer.`, `### Schema.` and `### Idempotency Flow.`** Item 1 already says where
this lives, and the library's version is both more correct and already built. That is ~44 lines out and
the contradiction goes with them.

⚠ This was the last section both docs described. Everything else that overlapped — the two subscriber
flows, the pipeline placeholders — has already been removed.

## The worked example still teaches the lifecycle stock rejected

`## Flow Mutation and Ledger.` names its actor **`Restock Create Mutation`** and has it writing the
ledger. [stock_design.md](../stock/design.md) has since put `StockMutation` in **Accept** and named that
participant `Restock Accept Mutation` — Create records an intention, Accept moves the count.

This is the doc every other service copies. **→ Rename it.** `## What is mutation ?` already lists both
`RestockCreateMutation` and `RestockAcceptMutation`, so only the diagram is wrong.

## The template lags its own first instance on three settled points

Stock has decided these by building them; the template still shows the older shape, so the next service
gets the older guidance:

| settled in `stock_design.md` | the template still says |
| --- | --- |
| one `change` / `after` pair **per measure** (four columns for two measures) | a single `change` / `after_balance`, no mention of measures |
| scope columns carry a **composite unique** (`places`, `product_placements`) | *"scope is unique"* as prose, with `any scope` and no constraint |
| reversal is an **append-only compensating entry** (`## Inventory Transaction Cancelation.`) | nothing — the log's mutability is undefined, and `## Ledger Log.`'s rule depends on it |

**→ Promote all three.** Each is a line, and each is the difference between the next service inheriting a
decision and re-deriving it.

---

# Critique

| | Problem | → Recommend |
| --- | --- | --- |
| **1** | **`float64` in the template reaches the Payment ledger, where the stock argument does not apply.** `## Implementation Plan.` item 3 is a *"Payment and Balance Ledger"*. Stock justified float by COGS division (`(fee) / qty`) — payments have no such division: an amount owed is an exact number of rupiah. Inheriting float there is a money ledger that cannot reconcile to a bank statement, for a reason that was never about payments. | Integer minor-units in the template. If stock keeps float for valuation, that is a stock-local exception and should be stated as one — not the default every future ledger copies. |
| **2** | **Lock ordering is undefined → deadlock.** `mut` locks its business rows, then `lg` locks state rows, and the change list is applied in a `loop` in list order. Two mutations touching the same two scopes in opposite order deadlock — and this system's normal case is two people on one shelf. | **Sort the change list by scope key inside the write session.** Invisible to callers, impossible to get wrong at a call site, and it exists once. Then `audit-sql` on the first mutation that uses it. |
| **3** | **`lock states` and `update atomic balance + change` are redundant.** If the update is `UPDATE … SET balance = balance + ? RETURNING balance`, the row lock is implicit and the explicit lock does nothing. If the explicit lock is what protects it, "atomic" is doing nothing. | Drop the `lg->>st: lock states` step. `UPDATE … RETURNING` **is** the protocol, and a guard becomes `WHERE balance + ? >= 0` with zero-rows-affected as the rejection. |
| **4** | **Get-or-create races.** `alt Exist / else create` — two concurrent transactions both miss, both insert, one dies on the unique violation and takes the whole business transaction with it. The same check-then-act shape the event library rejects for dedup. | Collapse the `alt` **and** the `loop` into one statement: `INSERT … ON CONFLICT (scope…) DO UPDATE SET balance = ledger_state.balance + EXCLUDED.change RETURNING balance`. The race disappears rather than being handled. |
| **5** | **`rpc->>pub` publishes after the mutation returns, outside the transaction.** Crash in between and the event is gone: the stock moved, the stat never hears, nothing detects it. This is the template for three flows in `stock_design.md` that all do the same. | An **outbox** — event row written in the mutation's transaction, a relay publishes. Or state plainly that the midnight reconcile is the recovery path, which makes it load-bearing rather than a safety net. Currently neither is written down. |
| **6** | **`Preloading Data if Needed` breaks reconcilability.** If the pipeline enriches an event with a live read from another service at processing time, replaying it at midnight gets a *different* answer because that service's data moved. Reconcile would then "correct" a right number to a wrong one. | Freeze preloaded values into the event **at publish time** — the event library's own *"an event carries CHANGE, never a level"* is the same instinct. If a value genuinely cannot be frozen, that metric is not reconcilable and must be excluded from the midnight pass. |

---

# Question

1. **Does `## Idempotency Layer.` survive at all**, now that item 1 defers to `event_library`? I recommend
   deleting it.
2. **Is `float64` a stock-local exception or the template's default?** It decides what the Payment ledger
   inherits.
3. **Is `ledger_logs` append-only?** Stock has answered it; the template has not, and `## Ledger Log.`'s
   source-of-truth rule rests on the answer.

---

# Awaiting

Nothing — the doc has no empty headings left.

**Sibling docs:** [stock_design.md](../stock/design.md) and [event_library.md](../event/library.md) have their
own clarity files. A *stock* decision belongs in one, an *event delivery* decision in the other.

**Clean:** every mermaid diagram parses (`npm run lint:mermaid`).
