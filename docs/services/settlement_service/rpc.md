# settlement_service — the ledger of what teams owe each other

Design: [plans/settlement_service/brainstorming.md](../../../plans/settlement_service/brainstorming.md).
Tables: [database-schema.md](../../database-schema.md#settlement_service).

## The first writer — a COD restock (#184)

An obligation this system already creates and never recorded: a warehouse **accepts** a restock that
arrived COD, paying the courier at the door for goods it does not own.

```mermaid
sequenceDiagram
    participant W as warehouse crew
    participant I as inventory_service
    participant S as settlement_service

    W->>I: RestockRequestFulfill — counts, placements, cod_shipping_fee
    rect rgb(240, 240, 240)
        Note over I,S: ONE transaction
        I->>I: record what arrived, and what arrived damaged
        I->>I: move stock onto the named shelves
        I->>I: status FULFILLED, cod_shipping_fee onto the request
        I->>S: PostEntry — the selling team owes the warehouse
        S->>S: two legs, one group id, both balances moved
    end
    I-->>W: the fulfilled request
```

**Why in the transaction and not after it.** If the stock movement commits and the obligation does
not, the warehouse is out of pocket with no record — which is *exactly* the situation this service
was built to fix, reproduced by the code meant to fix it. A test rolls the posting back and asserts
the goods never reach a shelf.

⚠ **This does not change what COD does today.** The fee still flows into HPP and into the order's
COGS (#155) — that is *costing*, and it stays. Settlement adds the missing half: who is owed it, and
has it been repaid. The same rupiah answers two different questions, and there is a test asserting
the costing column still holds the number, because a change like this is exactly where one of the two
quietly disappears.

**A fee of 0 posts nothing.** Most deliveries are not COD, and an entry of zero would be a ledger row
saying nothing happened — worse than no row, because it reads as a debt of nothing rather than the
absence of one.

## How the two services are joined

`inventory_service` declares `SettlementPoster` in its own terms and imports nothing from settlement;
the adapter lives in
[cmd/app_development/settlement_poster.go](../../../backend/cmd/app_development/settlement_poster.go).
Same shape as `StockPicker` and `ProductCatalog`, with **one deliberate difference**:

| | Atomic? | Failure handling |
| --- | --- | --- |
| selling → inventory (`StockPicker`) | ❌ another service's commit | takes the stock, **compensates** if the order then fails |
| inventory → settlement (`SettlementPoster`) | ✅ same database | one transaction, **nothing to compensate** |

The cost is named rather than buried: passing a transaction across a service boundary means the two
are not independently deployable while this call is in-process. The day settlement moves to its own
database this becomes an event, the atomicity argument has to be re-made, and the reconciliation
report (#187) is what covers the gap.

## The write path has no wire surface

`PostEntry` is a **domain function, not an RPC**, and deliberately so: nothing outside this system may
assert that one team owes another. Every posting originates from a real event inside it — a restock
accepted, an order placed, a payment confirmed. The proto's RPCs are reads plus the payment flow;
there is no "post an entry" endpoint and there should not be one.

It is also **policy-free**. It records; it never refuses. The credit check (#189) is an explicit
pre-check in the order flow, never a guard inside the posting path — a ledger that sometimes declines
to record reality is how books stop matching the world.

## Idempotency, and why a duplicate is a normal answer

`ErrAlreadyPosted` is returned when the movement is already on the books, and callers **swallow it**.

The order fees (#186) arrive on Pub/Sub, which delivers **at least once**: a redelivered order is
expected, not an error. A consumer that NACKed a duplicate would make Pub/Sub redeliver a message
that can never succeed — a poison loop built entirely out of correct behaviour. The unique index
`(team_id, counterparty_id, source_type, source_id, reversal)` is what makes ACKing safe.

`reversal` is in that key because a compensating entry shares the other four columns with the entry
it undoes; without it, a cancellation would be swallowed as a duplicate of the fee it was cancelling.

## The order-driven fees, on order events (#186)

Two more obligations, both driven by `OrderPlacedEvent` and both reversed by `OrderCancelledEvent`.

```mermaid
sequenceDiagram
    participant S as selling_service
    participant P as product_service
    participant R as revenue_service
    participant T as settlement_service

    Note over S: the order has COMMITTED
    S->>P: ProductByIds — who owns these products?
    P-->>S: the owning team per product
    S->>S: publish OrderPlacedEvent, carrying the lines
    par one topic, two subscriptions
        S-->>R: revenue-order-placed
    and
        S-->>T: settlement-order-placed
    end
    T->>T: handling fee to the warehouse
    T->>T: product fee to each owning team
```

**The owner is resolved AT PLACEMENT and rides on the event.** Same choice the money already makes,
and for the same reason: a product moved to another team next month must not rewrite who was owed for
a sale that happened today. A consumer reading the catalogue at consume time would do exactly that.
A failed lookup does not fail the order — the order is already committed, the owner rides as `0`, and
settlement reads that as "nobody to pay".

**Two subscriptions on one topic.** `revenue-order-placed` and `settlement-order-placed` are separate
subscriptions, each with its own delivery state, so settlement falling behind never delays a revenue
row. The dev-server loopback models this fan-out explicitly — it delivered to one subscription per
topic until settlement became a second consumer.

### The two fees default differently, and that is deliberate

| | Default with no configuration | Because |
| --- | --- | --- |
| **Handling fee** | **charge nothing** | It is a **price** the warehouse sets. A warehouse that has configured nothing must not be silently billing anybody. |
| **Product fee** | **charge cost, markup 0** | It is a **cost transfer**. The goods left the owner's stock and do not come back (§2.2 — "money from the first moment"), so the owner is owed what they cost whether or not anybody configured anything. The **markup** is the optional part. |

Defaulting the product fee to zero as well would mean one team's goods walk out of another team's
warehouse free, which is the one outcome §2.2 explicitly rejects.

**The anchor is the frozen `unit_cost`, never the buyer-paid price.** A markup on what the buyer paid
is a commission model wearing a sale's clothes: on goods that cost 60.000 and sold for 100.000 at
20%, cost+markup owes the owner 72.000 while buyer-paid+markup owes 20.000 — the owner loses 40.000
on their own stock.

**One fee per owning team, not per line.** Two lines of the same team's goods are one debt, and the
idempotency key is `(source_type, source_id, counterparty)` — per-line postings would collide and the
second line would silently vanish.

⚠ **An unknown cost charges nothing and is not refused** (Q10). A product received straight into
stock has no recorded cost, so cost+markup computes zero. The sale is not blocked over a bookkeeping
gap. Nothing is written, because a zero-amount entry would consume that pair's idempotency key for
that order and block the real fee forever — so the gap is visible as a **missing** entry, which is
exactly what the reconciliation report (#187) looks for.

### Cancelling reads back what was charged

`ReverseOrder` does not recompute fees — it reads its own entries for that order and posts their
opposites. The cancel event carries only ids and needs no more: **the ledger already knows what it
charged.** Re-deriving from rates would disagree with the original the moment a rate changed between
placement and cancellation.

It reverses only `handling_fee` and `product_fee`. ⚠ **The COD obligation is left alone** — that debt
is for goods the warehouse paid for at the door, and an order falling through does not give the
warehouse its money back.

Only the **debtor's legs** are read. Both sides of every movement are stored, so reading every row
for the order would find each fee twice and reverse it twice — refused as a duplicate, but by luck
rather than by intent.

---

## `SettlementDaily` — a warehouse's income half of the daily statement

A selling team earns the **margin on its orders**, and revenue_service holds one row per order. A
warehouse has no orders at all — `order_revenues.team_id` is always the *selling* team — so pointing a
warehouse at revenue_service returns nothing.

What a warehouse earns is the **fees it charges the teams it fulfils for**, and those exist only here.
Without this RPC its daily statement would put real expenses against a margin of zero and report every
single day as a pure loss (owner, 2026-08-14).

```mermaid
flowchart LR
    O["orders placed"] --> M["expected margin — selling"]
    F["orders fulfilled"] --> H["handling fees charged — warehouse"]
    M --> P["income − expenses = profit"]
    H --> P
    E["its own expenses — payroll, rent, stock written off"] --> P
```

### It reports the ledger — it does not decide what "income" means

Every source type comes back in `by_source`, and the **caller** picks. The four are not the same kind of
thing, and summing them would double-count:

| source | what it is | the statement treats it as |
| --- | --- | --- |
| `HANDLING_FEE` | the warehouse fulfilled an order and is owed for the work | **income** |
| `COD_FEE` | it paid a courier at the door for goods it does not own | shown, **not** income — a reimbursement |
| `PRODUCT_FEE` | one selling team owes another for its product | not a warehouse's at all |
| `PAYMENT` | a confirmed payment settling an existing balance | cash moving — already earned when charged |

COD is the subtle one. The warehouse is genuinely owed it, so it gets its own column — but the cash that
went out was never recorded as an expense, so counting the repayment as income would inflate the bottom
line against nothing. The screen says so in a banner rather than silently dropping a number the reader
can also see on the Liability screen.

Naming that judgement inside the RPC would bake one screen's opinion into the ledger's contract, so it
returns the enum whole.

### Sign, reversals and the aggregate

**One sign convention (§4.11), unchanged by aggregation:** from the scoped team's point of view a
receivable is **positive** and a payable is **negative**. The two legs of one movement are exact
negatives, so the same fee reads `+20.000` on the warehouse's series and `−20.000` on the selling team's.

**Reversals are INCLUDED, never filtered.** A cancelled order's fee is undone by an equal-and-opposite leg
and both stay. A plain `SUM` therefore nets the pair to zero, which is the honest figure — excluding
reversals would report income the ledger has already taken back, which on a statement reads as a good day
that never happened. The day still appears, with two entry legs and a net of zero.

### The period IS the pagination

No page cursor, and that does not breach HARD RULE 9 — the rule guards a `repeated` whose length grows
**with the data**, and this one grows with `to − from`, which the caller states.

| | |
| --- | --- |
| Both bounds **required** | an open end is the unbounded read the rule is about |
| Span **capped at 366 days** | `InvalidArgument` beyond it — refused, never clamped |
| Result | a ten-year-old ledger and a one-year-old ledger return the same 366 rows |

The cap must equal revenue's and expense's. All three are read side by side, and a cap that differed would
let the statement load part of a period and still look complete. It lives in **four** places:
`maxPeriodDays` in settlement, revenue and expense, and `MAX_PERIOD_DAYS` in
[frontend/src/lib/period.ts](../../../frontend/src/lib/period.ts).

### Sparse series, one calendar

A day the ledger did not move is **absent**, not a zero row — the same contract the other two daily series
follow. The client owns the date spine because it must build one to line three services up, and a server
that also emitted empty days would be a second calendar free to disagree about what February contains.

A quiet day is still **rendered**, dimmed. A missing row cannot tell a reader "nothing was charged" apart
from "that day did not load".

### Bucketing

`created_at` is a `TIMESTAMPTZ`, cast with an explicit `AT TIME ZONE 'UTC'` — a bare `::date` converts
using the session's TimeZone, which nothing sets. The upper bound is **half-open** (`< to + 1 day`) for
the same reason revenue's is: `<= to` means `<= midnight` and would silently drop almost the whole final
day of every period.

> ⚠ The business is UTC+7, so an entry posted before 07:00 local lands on the previous day here. It is
> deliberate *consistency* rather than a fresh decision — see
> [revenue_service/rpc.md](../revenue_service/rpc.md) for the full note.

### The totals are built in the fold, not by a second query

The one place this differs from the revenue and expense handlers. They each had an existing period-totals
query to reuse, and reusing it keeps their footer identical to their list screen's. There is no such query
here, so a second one would be a second definition of the same sum — free to drift from the days above it,
which is exactly the failure the other two reuse their query to avoid.
