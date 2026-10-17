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
> 🆕 **Two more found on a second look the same day.** ✅ `the-cancel-finds-the-take-by-key` is answered as
> recommended and deleted — [every-release-goes-by-the-key](./context_decision.md#every-release-goes-by-the-key).

> 🔄 **Re-examined 2026-10-15 — the owner edited both docs.** ✅ Three contradictions resolved and deleted:
> `the-table-still-says-idempotency-id` (the column is `idempotency_key` now) · `the-key-reached-the-diagram-and-nothing-else`
> (`OrderTransactionCreateRequest` carries `idempotency_key`; the two decision sentences were already amended by the later
> decisions' *What it amends*) · `the-compensation-event-has-two-names` — decided as
> [the-compensation-event-is-inventory-tx-cancel](./context_decision.md#the-compensation-event-is-inventory-tx-cancel).
> 🆕 The form's loop was proposed — and drawn by the owner the same day: [the-form-locks-until-it-is-answered](./context_decision.md#the-form-locks-until-it-is-answered).
> ⛔ **Found while summarising the key:** two decisions of 2026-10-12 disagree about two submits in the same second —
> [Contradiction](./context_decision.md#the-order-refuses-a-used-key).
> ⚠ **Corrected:** this file's key table was headed *"as decided"* while its format row — a UUID — and *"the server never
> invents one"* were only ever my proposal. Both are now marked as proposals.
> ✅ **And later still:** the order keeps ONE `transaction_id`
> ([an-order-is-one-inventory-transaction](./context_decision.md#an-order-is-one-inventory-transaction)) — against my
> one-per-line. [which-team-is-team-id](#which-team-is-team-id) keeps its two team parts; inventory's Q1 and Q7 move with it.
> ✅ **Answered later the same day and deleted:** the owner drew the loop into the frontend box as proposed —
> [the-form-locks-until-it-is-answered](./context_decision.md#the-form-locks-until-it-is-answered). One part did not make
> the diagram: [key-already-used-gets-its-own-message](#key-already-used-gets-its-own-message).
> 🔄 **Re-examined 2026-10-15, last — every submit mints a new key**
> ([every-submit-mints-a-new-key](./context_decision.md#every-submit-mints-a-new-key)), the owner's answer to inventory's
> *twin* case. ✅ `a-refused-take-sends-no-cancel` and its contradiction `a-refusal-fires-the-compensation` — found from
> inventory's side an hour earlier — are **answered by removing the case** and deleted: no two submits share a key, so a
> *key used* refusal never comes from the form, and a cancel for any other refusal releases nothing. 🔄 Two questions move
> with it: [a-key-returns-only-its-own-teams-order](./context_decision.md#the-order-refuses-a-used-key) — the shortcut has no honest
> caller now — and [key-already-used-gets-its-own-message](#key-already-used-gets-its-own-message), which becomes the
> message for a *Try Again* that meets its own order. ⛔ Your diagram still mints once and resends the same key:
> [the-form-diagram-still-reuses-the-key](#the-form-diagram-still-reuses-the-key).
> 🔄 **And later: a duplicate ref is warned, not refused**
> ([a-duplicate-ref-is-warned-not-refused](./context_decision.md#a-duplicate-ref-is-warned-not-refused)). The *Try Again*
> design and [key-already-used-gets-its-own-message](#key-already-used-gets-its-own-message) are rewritten around a
> warning: it sees only a committed order, so a *Try Again* should always warn. ✅ **Answered in chat, as recommended**
> — [a-try-again-always-warns](./context_decision.md#a-try-again-always-warns); the question is a stub and its design
> moved into the decision.
> ✅ **And:** [which-team-is-team-id](#which-team-is-team-id) — both teams, named apart
> ([the-take-names-the-orderer-and-each-owner](./context_decision.md#the-take-names-the-orderer-and-each-owner)); the
> request's field is not drawn yet ([the-request-still-names-no-orderer](#the-request-still-names-no-orderer)).

> ✅ **Answered 2026-10-15, last, and deleted:** `a-key-returns-only-its-own-teams-order` — the shortcut is dropped
> ([the-order-refuses-a-used-key](./context_decision.md#the-order-refuses-a-used-key)), which also resolves the contradiction
> `a-same-key-resend-never-reaches-the-unique-index`: a unique violation is an error, never an order. **No question is open
> here now** — what is left is your doc: the contradictions below, and the debt-check box
> ([the drawing](./context_clarify.md#proposed--the-debt-check-as-decided)).

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

### The key, end to end

Decided except where a row says *proposed*.

```mermaid
sequenceDiagram
  participant F as frontend
  participant O as order_service
  participant I as inventory_service
  F->>F: Create pressed - mint K, a new one for every submit
  F->>O: OrderCreate with K
  O->>O: an order already has idempotency_key K? refused - proposed
  O->>O: before the transaction — platform_total present, credit check. A duplicate ref is the form's warning, not a check here
  O->>I: take stock with K — ordering team, lines
  I-->>O: per line — owner, cost, where it was taken from
  O->>O: fee, insert orders with K, order_items, order_addresses, delete the draft, commit
  O-->>F: the order, and K is spent
  Note over O,I: on failure or timeout — publish InventoryTxCancel with K, inventory releases the take under K
  Note over O,I: later, Order Cancel carries K too — the same release
```

| | |
| --- | --- |
| format | ⚠ **proposed, never decided** — a UUID from `crypto.randomUUID()`, **required** on the request and checked by `protovalidate`, so the server never invents one: a create with no key has nothing to name its take by |
| on the order | `orders.idempotency_key`, UNIQUE — [the-order-stores-its-idempotency-key](./context_decision.md#the-order-stores-its-idempotency-key), [the-idempotency-key-is-unique](./context_decision.md#the-idempotency-key-is-unique) |
| the take | one take per K, ever — [inventory-takes-a-key-once](./context_decision.md#inventory-takes-a-key-once) |
| spent | by its one submit — [every-submit-mints-a-new-key](./context_decision.md#every-submit-mints-a-new-key) |
| the release | one path, by K, for `InventoryTxCancel` and the Order Cancel — [every-release-goes-by-the-key](./context_decision.md#every-release-goes-by-the-key) |
| the pre-transaction checks | ⚠ **proposed** — [the-checks-are-not-drawn](#critique) |
| the resend shortcut | ✅ **gone** — a used key is refused, never answered with an order: [the-order-refuses-a-used-key](./context_decision.md#the-order-refuses-a-used-key) |
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
| **the-checks-are-not-drawn** | nothing checks a present `platform_total` before stock is taken. 🔄 The duplicate ref left this list — it is the form's warning now ([a-duplicate-ref-is-warned-not-refused](./context_decision.md#a-duplicate-ref-is-warned-not-refused)). ✅ *(2026-10-15)* The debt threshold is drawn — [the-debt-check-runs-before-the-take](./context_decision.md#the-debt-check-runs-before-the-take) | `platform_total` present ([platform-total-is-required-at-finalize](./context_decision.md#platform-total-is-required-at-finalize)) — beside the debt check, before the transaction |
| **the-draft-delete-is-outside-the-transaction** | *"Delete Draft Order"* hangs off `if success`, after the commit | delete inside the transaction — same service, same database |
| **the-fee-call-is-inside-the-transaction** | `WarehouseFeeCalculate` holds the order's transaction open across a network call | acceptable, since its basis only exists after the take — but it is a pure calculation, so reading the rate before the transaction and computing locally removes the call |

---

## Question

### which-team-is-team-id
✅ *(2026-10-15)* **Answered: both, named apart** — the request carries the ordering `team_id`, each line `owner_team_id`: [the-take-names-the-orderer-and-each-owner](./context_decision.md#the-take-names-the-orderer-and-each-owner). The inventory transaction carries the orderer too ([an-order-transaction-is-the-ordering-teams](../inventory/transaction_decision.md#an-order-transaction-is-the-ordering-teams)). ⚠ The request's field is not drawn yet — [the-request-still-names-no-orderer](#the-request-still-names-no-orderer).

### key-already-used-gets-its-own-message
✅ *(2026-10-15)* **Answered: yes, a *Try Again* always warns** — [a-try-again-always-warns](./context_decision.md#a-try-again-always-warns). Kept as a heading so the links into it hold.

---

# Contradiction

## the-request-still-names-no-orderer

*(2026-10-15)* Your §How We Call Inventory Service to Take Stock against your answer the same day:

| [order_creation.md](./order_creation.md) | [the-take-names-the-orderer-and-each-owner](./context_decision.md#the-take-names-the-orderer-and-each-owner) |
| --- | --- |
| `TransactionItem.owner_team_id` | ✅ agrees |
| `OrderTransactionCreateRequest { idempotency_key, warehouse_id, items }` | the request carries `team_id`, the ordering team |

**Which is wrong:** the proto — the rename landed, its other half did not. **→ Recommend** one line in the request,
`uint64 team_id // the ordering team`, beside `idempotency_key`. Without it inventory cannot tell own from borrowed, so the
private and reserve checks of [inventory order.md](../inventory/order.md) have nothing to compare against.

```mermaid
flowchart LR
  R["OrderTransactionCreateRequest - no team_id"] -.->|"own or borrowed?"| X["inventory cannot tell"]
  R2["with team_id B"] --> Y["Kaos Hitam own - Kemeja Putih borrowed, checked"]
```

## the-form-diagram-still-reuses-the-key

*(2026-10-15)* Your frontend box in [order_creation.md](./order_creation.md) against your answer in chat the same day:

| order_creation.md, the frontend box | [every-submit-mints-a-new-key](./context_decision.md#every-submit-mints-a-new-key) |
| --- | --- |
| *"Order Need Created"* → *"Create Idempotency Key"* → *"Filling Order Form"* — minted once, before filling | minted at each submit |
| *"no answer, Try Again with the same key"* | *Try Again* under a new key |
| *"an error, new key, the form keeps what was typed"* | ✅ agrees |

**Which is wrong:** the diagram — the chat answer is newer, and it is what closes the twin case.
**→ Recommend** minting inside the loop, right before *Create Order*, so every arrow back into *Create* passes through it:

```mermaid
stateDiagram-v2
  direction LR
  state "Filling Order Form" as fill
  state "Create Idempotency Key" as idem
  state "Create Order" as cre
  state "Waiting for the Answer, Form Locked" as wait
  state answer <<choice>>
  state "Open the Created Order" as done
  [*] --> fill
  fill --> idem
  idem --> cre
  cre --> wait
  wait --> answer
  answer --> done: the order
  answer --> fill: an error, the form keeps what was typed
  answer --> idem: no answer, Try Again under a new key
```

## the-diagram-still-names-the-old-totals

*"Subtotal info Product"* and *"bring total & subtotal"* (lines 42, 48, 54) — while §Table That Must Have in
[context.md](./context.md) replaced both with `goods_cost` and `total_cost`
([the-warehouse-fee-is-a-percentage-of-the-goods](./context_decision.md#the-warehouse-fee-is-a-percentage-of-the-goods)).
**Which is wrong:** the diagram. **→ Recommend** the take returns lines, the order sums `goods_cost`, the fee is
taken on it, and `total_cost = goods_cost + warehouse_fee`.

## settlement-subscribes-here-and-is-called-in-its-own-doc

Settlement is a push subscriber of *Order Created Event* here (lines 92–101), while
[settlement/context.md](../settlement/context.md) §Type `initial_total` says *"`order_service` calling -->
`settlement_service`"*. **→ Recommend** the settlement doc changes, and its reversal is recorded there.

```mermaid
flowchart LR
  D["order_creation.md — revised"] --> A["its own diagram: subtotal and total — stale"]
  D --> C["settlement/context.md: order calls settlement — stale"]
```
