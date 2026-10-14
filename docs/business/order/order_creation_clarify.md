# Clarity — order `order_creation.md`

What [order_creation.md](./order_creation.md) leaves open. **That doc is yours — this one is mine.** Answered
points are deleted, so this file is always the current open set. Decisions land in
[context_decision.md](./context_decision.md).

> **Opened 2026-09-17**, re-examining the whole flow after the owner's correction: *"provision"* was the wrong
> word — **calling inventory takes the stock directly.** That withdraws two of my earlier recommendations (a
> confirm call, and an expiry on unconfirmed holds): a take has nothing to confirm and nothing to expire.

> ✅ **Answered 2026-09-17 and deleted:** what a take reduces ([a-take-reduces-stock-and-placement](./context_decision.md#a-take-reduces-stock-and-placement), its shelf half
> re-routed to inventory) · money as `double` ([rupiah-is-floating-point](./context_decision.md#rupiah-is-floating-point)) · retries ([the-take-is-never-retried](./context_decision.md#the-take-is-never-retried)) · who computes the markup ([inventory-computes-the-markup](./context_decision.md#inventory-computes-the-markup)).

> 🔄 **Re-examined 2026-10-12 — the owner added an idempotency key**
> ([the-frontend-mints-the-idempotency-key](./context_decision.md#the-frontend-mints-the-idempotency-key)) and then
> `orders.idempotency_id` ([the-order-stores-its-idempotency-key](./context_decision.md#the-order-stores-its-idempotency-key)).
> ✅ It answers `a-timed-out-take-cannot-be-named` — a timeout publishes the cancel by key. 🔄 It replaces my
> order-row-first proposal, and the owner's *"if we call inventory service and timeout, we can publish cancel inv
> transaction"* withdrew my own replay spec, which was what let a resend sell stock twice.
> ✅ **Answered the same day, all three as recommended, and deleted:**
> [the-idempotency-key-is-unique](./context_decision.md#the-idempotency-key-is-unique) ·
> [inventory-takes-a-key-once](./context_decision.md#inventory-takes-a-key-once) ·
> [a-key-is-spent-by-any-answer](./context_decision.md#a-key-is-spent-by-any-answer).
> ⛔ **Left for the owner's doc:** the table's column name and the form's loop — under Contradiction and Critique.
> 🆕 **Two more found on a second look the same day.** ✅ `the-cancel-finds-the-take-by-key` is answered as
> recommended and deleted — [every-release-goes-by-the-key](./context_decision.md#every-release-goes-by-the-key).
> Still open: [a-key-returns-only-its-own-teams-order](#a-key-returns-only-its-own-teams-order).

> ✅ **Answered and deleted (2026-10-12 16:38):** `does-the-order-keep-the-take-id` — the Order Cancel carries K
> ([every-release-goes-by-the-key](./context_decision.md#every-release-goes-by-the-key)), so the order needs no
> `transaction_id` from inventory; inventory stores K as `ORDER_TAKES.take_ref`
> ([take-ref-dari-idempotency-key](../stock_thoni/context_decision.md#take-ref-dari-idempotency-key)). Inventory's own flow
> still says Order Cancel sends `transaction_id` — reported there as a contradiction.

> 🔄 **Re-examined 2026-10-12 17:12** — lines 109 and 111: *Order Created* now carries `transaction_id` beside K, and
> the compensation carries it *"if exist"*. 🆕 `who-reads-the-transaction-id` (✅ [the-take-id-rides-only-the-compensation](./context_decision.md#the-take-id-rides-only-the-compensation)) and the
> critique `the-compensation-names-the-take-twice`. ✅ Closed — mine, left stale since 16:38:
> `the-key-reached-the-diagram-and-nothing-else`. The contract has carried `idempotency_key` since then (line 129), and
> both sentences it named are now marked amended in the decision log
> ([the-take-is-never-retried](./context_decision.md#the-take-is-never-retried) ·
> [every-release-goes-by-the-key](./context_decision.md#every-release-goes-by-the-key) §What it amends).

> ✅ **2026-10-12 17:22–17:26 — answered and deleted:** `who-reads-the-transaction-id`. Inventory's compensation webhook
> reads it beside K ([provide](../stock_thoni/order_creation_provide.md) lines 80–82), and line 109 dropped it from
> *Order Created* — [the-take-id-rides-only-the-compensation](./context_decision.md#the-take-id-rides-only-the-compensation).
> How the two are used together is the inventory doc's to say, so `the-compensation-names-the-take-twice` is re-routed
> there as [keduanya-dipakai-bagaimana](../stock_thoni/order_creation_provide_clarify.md#critique).

> 🔄 **Re-examined 2026-10-13 16:04** — line 129: `team_id` on the take request, the ordering team
> ([the-take-request-carries-the-ordering-team](./context_decision.md#the-take-request-carries-the-ordering-team)) — the
> request half of `team-id-is-ambiguous`, as recommended, and the answer to inventory's
> `sendiri-atau-silang-diketahui-dari-mana`. Left: `TransactionItem.team_id` (line 137) — now the **same name** for a
> **different team** in one contract, which makes `which-team-is-team-id` sharper, not smaller.

> ✅ **2026-10-13 16:58 — answered and deleted:** `which-team-is-team-id` and `team-id-is-ambiguous`. Line 137 now reads
> *"item owner team_id"* — the owner, as recommended; the name stays, the comment says which team ([the-line-team-is-the-owner](./context_decision.md#the-line-team-is-the-owner)).

Siblings: [order context](./context_clarify.md) · [event_context](./event_context.md) ·
[warehouse](../warehouse/context_clarify.md) · [inventory](../inventory/context_clarify.md).

---

## Proposed Design

### The key, end to end — as decided

```mermaid
sequenceDiagram
  participant F as frontend
  participant O as order_service
  participant I as inventory_service
  F->>F: open the form, mint K
  F->>O: OrderCreate with K
  O->>O: an order already has idempotency_key K? return it, take nothing
  O->>O: before the transaction — duplicate ref, platform_total present, credit check
  O->>I: take stock with K — ordering team, lines
  I-->>O: per line — owner, cost, where it was taken from
  O->>O: fee, insert orders with K, order_items, order_addresses, delete the draft, commit
  O-->>F: the order, and K is spent
  Note over O,I: on failure or timeout — publish the compensation with K, inventory releases the take under K
  Note over O,I: later, Order Cancel carries K too — the same release
```

| | |
| --- | --- |
| format | a UUID from `crypto.randomUUID()` — **required** on the request and checked by `protovalidate`. The server never invents one: a create with no key has nothing to name its take by |
| on the order | `orders.idempotency_key`, UNIQUE — [the-order-stores-its-idempotency-key](./context_decision.md#the-order-stores-its-idempotency-key), [the-idempotency-key-is-unique](./context_decision.md#the-idempotency-key-is-unique) |
| the take | one take per K, ever — [inventory-takes-a-key-once](./context_decision.md#inventory-takes-a-key-once) |
| spent | by any answer — [a-key-is-spent-by-any-answer](./context_decision.md#a-key-is-spent-by-any-answer) |
| the release | one path, by K, for the compensation and the Order Cancel — [every-release-goes-by-the-key](./context_decision.md#every-release-goes-by-the-key) |
| the resend shortcut | ⚠ open — matched on K alone today: [a-key-returns-only-its-own-teams-order](#a-key-returns-only-its-own-teams-order) |
| `transaction_id` | on the compensation only, when the take answered — [the-take-id-rides-only-the-compensation](./context_decision.md#the-take-id-rides-only-the-compensation) |

### What a take reduces — moved to inventory

Decided: a take **reduces stock and placement**, and shelves, counts and available-versus-on-hand are **inventory's** to
design ([a-take-reduces-stock-and-placement](./context_decision.md#a-take-reduces-stock-and-placement)). The shelf-count
hazard is re-routed to [inventory Q11](../inventory/context_clarify.md#question).

---

## Critique

| | Problem | → Recommend |
| --- | --- | --- |
| **one-line-many-batches** | FIFO can draw one line from two batches at different costs, so a single `unit_cost` × `qty` only approximates `total` | `total` is authoritative; `unit_cost` is informational |
| **the-checks-are-not-drawn** | nothing checks the duplicate ref, a present `platform_total` or the debt threshold before stock is taken | a pre-transaction block — see the sequence |
| **the-draft-delete-is-outside-the-transaction** | *"Delete Draft Order"* hangs off `if success`, after the commit | delete inside the transaction — same service, same database |
| **the-fee-call-is-inside-the-transaction** | `WarehouseFeeCalculate` holds the order's transaction open across a network call | acceptable, since its basis only exists after the take — but it is a pure calculation, so reading the rate before the transaction and computing locally removes the call |
| **the-form-loop-is-not-drawn** | the frontend box ends at *Create Order*, so the decided [a-key-is-spent-by-any-answer](./context_decision.md#a-key-is-spent-by-any-answer) is nowhere in the doc | draw it — no answer: resend with K · an error: mint a new K, back to the form |

---

## Question

### a-key-returns-only-its-own-teams-order
The resend shortcut — *"an order already has K? return it"* — looks up K alone. The key comes from the browser, so a
bug or a hostile caller sending another team's K would be handed **another team's order**. The access check passes,
because it checks the request's `team_id`, not the order found.
**→ Match K and the request's team.** A K found under another team is refused as a used key, never returned.

---

# Contradiction

## the-table-still-says-idempotency-id

*"`idempotency_id`"* ([context.md](./context.md) §Table That Must Have, line 28) — while
[the-idempotency-key-is-unique](./context_decision.md#the-idempotency-key-is-unique) names the column
`idempotency_key`, UNIQUE, and this doc's own diagram says *"idempotency key"* at every step.
**Which is wrong:** the table — the decision is newer. **→ Recommend** `idempotency_key`, its uniqueness written
beside it the way `order_external_ref_id` carries *"for order uniqueness"*.

```mermaid
flowchart LR
  D["the-idempotency-key-is-unique"] --> T["context.md table: idempotency_id — stale"]
  D --> G["order_creation.md diagram: idempotency key — agrees"]
```

## the-diagram-still-names-the-old-totals

*"Subtotal info Product"* and *"bring total & subtotal"* (lines 42, 48, 54) — while §Table That Must Have in
[context.md](./context.md) replaced both with `goods_cost` and `total_cost`
([the-warehouse-fee-is-a-percentage-of-the-goods](./context_decision.md#the-warehouse-fee-is-a-percentage-of-the-goods)).
**Which is wrong:** the diagram. **→ Recommend** the take returns lines, the order sums `goods_cost`, the fee is
taken on it, and `total_cost = goods_cost + warehouse_fee`.

## the-compensation-event-has-two-names

*"Inventory Tx Cancel Compensate Event"* (line 106) and `InventoryTxCancel` in
[event_context.md](./event_context.md). It now also carries the key, so it is an event inventory will match on.
**→ Recommend** one name, as a fact — the take was **returned** because the order was never created.

## settlement-subscribes-here-and-is-called-in-its-own-doc

Settlement is a push subscriber of *Order Created Event* here (lines 92–101), while
[settlement/context.md](../settlement/context.md) §Type `initial_total` says *"`order_service` calling -->
`settlement_service`"*. **→ Recommend** the settlement doc changes, and its reversal is recorded there.

```mermaid
flowchart LR
  D["order_creation.md — revised"] --> A["its own diagram: subtotal and total — stale"]
  D --> B["event_context.md: a second name for the compensation"]
  D --> C["settlement/context.md: order calls settlement — stale"]
  D --> F["context.md table: idempotency_id — stale"]
```
