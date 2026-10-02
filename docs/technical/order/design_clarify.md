# Clarity — order `design.md`

The owner listed the fifteen figures the old system carried above its order list, and set the rule
for reading them: **by status first** — one status's figures when a status filter is on, a breakdown
per status when it is not.

This file is the response: which of the fifteen belong over a work queue, which move, and — the part
the owner asked for by name — **where the moved ones' facts live today**, so the next pass starts
from a map instead of from this conversation.

---

## Proposed Design

> **The SUMMARY strip is what this section designs.** The table's own columns are settled in
> [one-context-per-column-and-never-three-lines](../frontend/context_decision.md#one-context-per-column-and-never-three-lines),
> and the status vocabulary in
> [the-warehouse-steps-are-not-order-statuses](../../business/order/context_decision.md#the-warehouse-steps-are-not-order-statuses).
> Neither is repeated here.


### The split, and why it falls there

Everything on the left is frozen the moment the order is finalised
([a-lines-money-is-frozen-at-finalize](../../business/order/context_decision.md#a-lines-money-is-frozen-at-finalize)).
Everything on the right arrives weeks later, from the marketplace. **Two clocks, two screens.**

```mermaid
flowchart LR
  F["order finalised"] --> N["frozen now"]
  N --> N1["tx · items · UPT"]
  N --> N2["transaction value · ATV"]
  N --> N3["purchase value · gross margin"]
  N1 --> LIST["ORDER LIST — a work queue"]
  N2 --> LIST
  N3 --> LIST

  F --> W["weeks later"]
  W --> W1["warehouse fee"]
  W --> W2["withdrawal · adjustment"]
  W --> W3["return cost · net profit"]
  W1 --> REP["PER-PERIOD REPORT — a book"]
  W2 --> REP
  W3 --> REP
```

A margin standing beside a live queue is already the furthest this should go. Putting a figure
there that is not true yet invites reading an estimate as money in the bank.

### The shape

```mermaid
flowchart TB
  TAB["STATUS TABS — the filter"]
  TAB -->|"All Status"| STRIP["PILE CARDS — a total, then one card per status"]
  TAB -->|"one status"| MEAS["MEASURE CARDS — value, Tx, items, UPT, ATV, purchase value, margin"]
```

The strip sits **below the status filter** and is **not a control**: no card navigates, filters or
selects, and **none is highlighted**. Under **All Status** it compares the piles — a card is a headline:
what the pile is worth, how many orders, whether it is earning. Under **one status** the other piles are
gone and that status's own figures are the cards; there is no measure line under either
([the-summary-follows-the-tab](../frontend/order_list_decision.md#the-summary-follows-the-tab)).

⚠ **Three shapes were tried and rejected, and the reasons are worth keeping** (2026-09-24):

| tried | why it went |
| --- | --- |
| a **table**, one row per status | this screen already ends in a table — a second grid of rows above it reads as orders you can open, and it spent the top of a work screen on forty-two numbers |
| **cards for "All", tiles when filtered** | the two states were different layouts, heights and information, so changing tab redrew the top of the screen instead of updating it. ⚠ **Came back in a different form** (2026-09-30): both states are now the SAME card — only what the cards hold changes |
| **pressable cards** that selected a status | two controls doing one job, directly above each other — the tab strip already selects a status |
| a **highlight** on the active status's card | the active tab sits directly above the strip and already names the pile, so the mark said it twice — and a highlight on something unpressable reads as a control that is broken |

**→ The rules that survive:** a summary above a list must not repeat the list's own shape · nothing
appears or disappears when the filter changes, only the numbers · **a summary is read, not
operated** — and anything that makes it look operable, a press target or a highlight, is the same
mistake in a different costume.

The seven measures, and how far each one is real:

| measure | today |
| --- | --- |
| tx | ✅ `OrderStatusCount.count` |
| transaction value | ✅ `OrderStatusCount.value` — **already on the wire and never read** |
| ATV | ✅ value ÷ tx, client-side |
| items · UPT | ⚠ sample — nothing counts lines server-side |
| purchase value · gross margin · % | ⚠ sample — the census sums `total` and nothing else |

### The contract this derives

```proto
message OrderStatusCount {
  OrderStatus status = 1;
  int64 count = 2;
  int64 value = 3;          // exists, unconsumed — Σ total
  int64 goods_value = 4;    // NEW — Σ subtotal, OVER THE PRICED ORDERS ONLY
  int64 cogs = 5;           // NEW — Σ cogs, over the same orders as goods_value
  int64 cost_unknown = 6;   // NEW — how many of `count` have no cost recorded
  int64 item_count = 7;     // NEW — Σ quantity
}
```

Three things this shape is load-bearing about:

1. **`margin = goods_value − cogs`, never `value − cogs`.** `total` includes `shipping_cost`, which
   is the platform's money
   ([an-order-records-no-shipping-cost](../../business/order/context_decision.md#an-order-records-no-shipping-cost)),
   so taking the margin off it overstates by the whole postage bill.
2. **Both sums cover the SAME population — the orders that carry a cost.** Summing every order's
   goods against only the priced orders' cost inflates the result by an unpriced order's entire
   selling price. Built the wrong way round first, one unpriced order in nine moved a 36% margin to
   48% and printed a status reading **100%**.
3. **`cost_unknown` is `cost_known` coming back**, under a name that says which way it counts. A
   `cogs` of 0 means the goods were never restocked through this system —
   *unknown*, not *free* (`order.proto`). Without the counter the margin reads high and nothing on
   screen says so.

`item_count` follows the precedent the sibling message already set —
`order_draft.proto`'s `item_count`, computed on every read *because the list deliberately returns no
lines*.

### The status tabs — the owner's eight, not the build's six

Decided 2026-09-24: the tabs carry the set from
[superseded-the-order-has-eight-statuses](../../business/order/context_decision.md#superseded-the-order-has-eight-statuses),
and the warehouse's steps fold into `processed`
([the-warehouse-steps-are-not-order-statuses](../../business/order/context_decision.md#the-warehouse-steps-are-not-order-statuses)).
The alternative — mirroring the six enum values the build happens to have — would put a vocabulary on
screen that the owner's own clarify already records as stale, and the screen would be rebuilt when
the migration lands.

⚠ The owner has since added a ninth, `return_completed` — see
[the order screens count eight statuses, and the owner added a ninth](#the-order-screens-count-eight-statuses-and-the-owner-added-a-ninth).

| the owner's eight | what the contract has | on this screen |
| --- | --- | --- |
| `pending` | `PLACED` | a rename, costs nothing |
| `processed` | `CONFIRMED` + `PICKING` + `PACKED` (the fourth step, the handover, has no value) | **counts, cannot filter** — `OrderListFilter.status` takes one status. Selecting it offers the four steps as a filter |
| `shipped` | `SHIPPED` | ✅ |
| `cancel` | `CANCELLED` | a rename |
| `completed` · `problem` · `lost` · `return` | **nothing** | drawn, and every figure is unknown — never `0` |

⚠ **AN UNBACKED PILE IS UNKNOWN, NOT ZERO**, and that includes the COUNT. "0 orders are completed" is
a claim a contract with no `completed` in it cannot make — so those cards read `—` and say *not in the
contract yet*. Same rule as a `cogs` of 0, one level up.

One mark covers all of it (`statusSet`), because there is one cause: the enum has not migrated.

**`processed` gets a STEP FILTER under the tab**, because a count you cannot act on is half a feature:

```mermaid
flowchart TB
  T["tab: Diproses"] --> F["step filter — all · confirmed · picking · packed · handed over"]
  F --> L["the ORDER TABLE narrows"]
  T --> S["the SUMMARY — still the whole processed pile"]
```

| | |
| --- | --- |
| it appears only under `processed` | a "Packed" filter hanging over the Shipped tab filters something nobody is looking at |
| it carries **no counts** (owner) | a per-step count line was built and taken out — what a seller does with these is pick one, and the figures that matter about the pile are already the summary's |
| `confirmed` · `picking` · `packed` **really narrow the table** | each is a single enum value, so `OrderListFilter.status` can take it — unlike `processed` itself, which is three at once |
| `handed over` is **disabled** | it has no enum value at all: a control that provably cannot do its job should refuse, not sit there inert. ⚠ It is "handed over", not "ready to hand over" (owner) — the parcel has already changed hands |
| changing tab **forgets the step** | otherwise a filter stays set on a status it cannot apply to, invisibly |

⚠ **The summary does NOT follow the step filter**, and this is worth looking at rather than assuming:
narrowing to Picking leaves the card reading `4 tx` over a table of one row. The card describes the
PILE and the table shows ROWS — the same split the tab counts already have — but it is the kind of
thing a reader notices.

⚠ **The old eleven map onto the eight with three folds**, and the old system's own UI is evidence for
two of them:

| old | folds into |
| --- | --- |
| **diproses gudang** (an umbrella TAB over confirm · picking · packed · sudah diserahkan) | `processed` — the umbrella became the status, and its four steps became a filter under that tab |
| pengiriman | `shipped` — the transit itself belongs to the shipment |
| return processed · return accepted | `return` — the transit belongs to the return record |

---

## The measures that move — where each one's fact lives today

The note the owner asked for. **Four of the seven are not homeless; they are renamed.**

| measure | where the fact is today | state |
| --- | --- | --- |
| nilai penyesuaian | settlement's `marketplace_adjustment` + `system_adjustment`, and `SettlementMetric` aggregates both | ✅ **built**, on `/settlement/report` |
| *(the platform's own payout per order)* | settlement's `fund` — *"what actually arrived from the platform"* | ✅ **built** — ⚠ and **not** what the owner means by withdrawal, see below |
| *(take-rate)* | `OrderSettlementListResponse.total_initial_total` / `total_last_balance` | ✅ **built** |
| biaya gudang | a liability ledger row, `LIABILITY_SOURCE_TYPE_ORDER_FEE`, keyed `source_id = order id`. Rate = `LiabilityTerms.handling_fee` | ⚠ **recorded but unaskable** — `LiabilityLogListFilter` takes `counterparty_id` and nothing else, so no reader can fetch it per order ([balance Q9](../../business/balance/context_clarify.md#question)) |
| nilai withdrawal · % withdrawal | **nowhere.** Owner (2026-09-24): this is **wallet → bank**, a shop-level cash event naming no order — not settlement's `fund`. Settlement cannot hold it either: every entry there must name an order | ⛔ **no home** ([settlement Q1](../../business/settlement/context_clarify.md#question) · [architecture Q7](../architecture/context_clarify.md#question)) |
| nilai penyesuaian WD | nothing — there is no withdrawal entity to adjust | ⛔ follows the above |
| beban retur | nothing. `InventoryService.StockReturn` moves stock and carries no cost. `/returns` is sample data pending the return service | ⛔ **no home**, and the money of a return is already listed as owed in [order context clarify](../../business/order/context_clarify.md#question) |
| nilai profit | needs every row above it | ⛔ follows them |

⚠ **The on-screen note tracks this too** — `pages/orders/pending.ts`, so the screen says what it
cannot do without anybody reading this file.

---

# Contradiction

## statistics were deleted by decision, and are being resumed

**The example — two statements, and neither is wrong.**

> [revenue-service-is-removed-and-statistics-deferred](../../business/settlement/context_decision.md#revenue-service-is-removed-and-statistics-deferred)
> — Owner, 2026-08-28: *"can we remove revenue service ? for statistic, we develop later"*, then
> *"remove it now"*. `/revenue`, `/profit`, `revenueClient`, their nav items and two e2e specs were
> deleted.

> Owner, 2026-09-24: the order list carries purchase value, estimated margin and its percentage.

This is the owner changing their own mind, which is theirs to do. It is recorded because the
**deletion had costs that were accepted at the time and are now being paid back**, and the next
person should not rediscover them:

| given up then | what it costs now |
| --- | --- |
| `cost_known` | the marker separating a real zero cost from an unknown one — **re-proposed above as `cost_unknown`** |
| `expected_margin` frozen at order time | the margin is recomputed from `subtotal` and `cogs` on every read instead of frozen with the order |
| kept on purpose: `order_revenues` was **not dropped**, and `OrderPlacedEvent` still carries `revenue`, `cogs`, `shipping_cost`, `cost_known` | the history is still there to backfill from — this is what "we develop later" was protecting |

**→ Recommend:** resume, and take only the order list's half. The list needs three sums on a census
that already groups by status — not a service. The deferred thing was a *revenue service*, and
nothing here proposes bringing one back.

```mermaid
flowchart LR
  D["2026-08-28 · revenue_service deleted"] --> K["order_revenues KEPT"]
  D --> E["OrderPlacedEvent KEPT"]
  D --> L["cost_known LOST"]
  K --> R["2026-09-24 · the list asks for margin"]
  E --> R
  L --> R
  R --> P["re-propose cost_unknown on the census"]
```

## the total was defined twice, and the proto holds the older one

**The example — two statements, and the contract is the one that is wrong.**

> `order.proto`: *"The frozen money (whole rupiah). subtotal = sum(line quantity × unit_price); total
> includes shipping_cost."*

> Owner, 2026-09-28: *"subtotal + ongkir kurang tepat, pokok biaya yang dibutuhkan untuk 1 order
> entah dari produk + biaya lain seperti biaya gudang, ongkir harusnya yang set adalah gudang"*.

One decision, **four sites** — grouped by cause rather than listed as four findings:

| site | what it said | now |
| --- | --- | --- |
| `Order.total` | `subtotal + shipping_cost` | still the contract, and the row no longer reads it |
| `OrderCreateRequest.shipping_cost` | the seller supplies it | it is not the seller's to supply |
| order-create's `shippingCost` mark | *"nothing prices a shipment yet"* | the reason is stronger — not the seller's to set |
| the row's money cell | was going to print `total` | prints goods plus fulfilment fees |

**→ Recommend:** leave `Order.total` alone until the ledger question is settled, and keep the
divergence in ONE place — `TotalCell` — rather than recomputing it per screen. The moment two screens
compute "the total" from different fields, both are correct and they disagree.

⚠ **The margin does NOT ripple.** `margin = total − cogs − shipping_cost` with
`total = subtotal + shipping_cost` reduces to `subtotal − cogs`, which is what the row and the strip
already compute. Checked, not assumed.

```mermaid
flowchart TD
  O["owner — total is goods plus fulfilment"] --> A["Order.total — unchanged"]
  O --> B["OrderCreate.shipping_cost — now unowned"]
  O --> C["create screen's mark — reason upgraded"]
  O --> D["the row's Total cell — new sum"]
  A -.->|"reduces to subtotal minus cogs"| E["margin unaffected"]
```

## three decisions were recorded from a half-read instruction, and all three reversed

**The example — what was written, and what the owner actually said next.**

> Recorded 2026-09-28, from *"pokok biaya yang dibutuhkan untuk 1 order entah dari produk + biaya
> seperti biaya gudang"*: **`an-order-total-is-goods-plus-fulfilment`** — the row's total is the
> SELLING subtotal plus the warehouse fee.

> Owner, minutes later: *"ada total dan margin, bukan, aku jelaskan sistem lama dulu — total dari beli
> yang dimaksud adalah subtotal produk + biaya, dan total dari mp; margin adalah harga mp − total
> beli"*.

**One cause, three reversals.** *"Biaya yang dibutuhkan untuk 1 order"* was read as a NEW sum built on
our selling price, when it was the old system's **total beli** — the cost side. Everything derived from
that reading fell with it:

| reversed | was | is |
| --- | --- | --- |
| [the-row-shows-total-beli-and-total-mp](../frontend/order_list_decision.md#the-row-shows-total-beli-and-total-mp) | one total: `subtotal` + fee | **two**: beli (`cogs` + fee) and MP |
| [the-margin-is-mp-minus-total-beli](../frontend/order_list_decision.md#the-margin-is-mp-minus-total-beli) | `subtotal − cogs`, % of `subtotal` | `MP − beli`, % of MP |
| [one-context-per-column-and-never-three-lines](../frontend/context_decision.md#one-context-per-column-and-never-three-lines) | six paired cells | one context per column, never three lines |

**→ Recommend:** when an instruction names a figure from the old system, **ask which fields it is
made of before building on it** — the words *total*, *beli* and *margin* each name two different sums
here, and a plausible reading produced four screens of arithmetic that all had to come back out. The
cheap check is one line in the clarify file, not a rebuild.

⚠ **What it cost beyond the rewrite.** The wrong margin was *"goods minus cost"*, which happens to be
the proto's own `margin = total − cogs − shipping_cost` — so it looked CORROBORATED by the contract
while being the wrong question. Agreement with an existing field is not evidence that the field answers
what was asked.

⚠ **And it left a real bug behind, found by rendering rather than by reading.** The new margin needs
two facts, so the strip's `cost_unknown` marker no longer covered its own refusals: the summary claimed
**Rp 780.384** of margin where the rows beneath it summed to **Rp 599.980**, because it credited an
order (#108) with revenue the row itself refuses to guess. Renamed to `margin_unknown` and fixed.

```mermaid
flowchart TD
  I["read: biaya for 1 order = selling subtotal + fee"] --> T["one total"]
  I --> M["margin = subtotal − cogs"]
  I --> C["six paired cells"]
  M --> P["looked right — it matches order.proto"]
  M --> B["strip claimed 30% more margin than its rows"]
  O["owner: total beli is the COST side"] --> X["all three reversed"]
  T --> X
  C --> X
```


## the order detail's withdrawal section was replaced, and two earlier decisions still describe it

**The example.** [settlement-replaces-withdrawal-on-the-order](../frontend/order_detail_decision.md#settlement-replaces-withdrawal-on-the-order)
(2026-09-30) removed the withdrawal section. Two earlier entries in the same append-only file still
describe it as present:

| site | says | now |
| --- | --- | --- |
| [the-order-detail-is-one-page-of-sections](../frontend/order_detail_decision.md#the-order-detail-is-one-page-of-sections), layout diagram | main column ends with *Withdrawal* | ends with *Settlement* |
| same, navigation row | short label example *`Withdrawal`* | no such nav item |
| same, *Withdrawal* and *WD summary* rows | invented rows and a WD summary under them | removed; payouts are ledger rows |
| same, build-marks row | *"the withdrawal table's mark"* | the `withdrawal` ⚠ is on the Settlement title |
| [the-detail-preview-became-the-order-detail](../frontend/order_detail_decision.md#the-detail-preview-became-the-order-detail), diagram and settlement row | Settlement *"before Withdrawal"*, the question *"stays open"* | Settlement is the last section, and the question is answered |

The later decision is the right one. The two earlier entries are a record of what was decided at the time,
and the file is append-only, so they are not edited.

**→ Recommend** reading a `_decision.md` bottom-up for the order detail: a later entry that names an
earlier section supersedes it. What stops it recurring is the same thing as last time: a decision that
removes a section names every earlier entry that listed it, as the table above does.

```mermaid
flowchart LR
  N["settlement-replaces-withdrawal-on-the-order"] --> A["one-page-of-sections — 4 rows name Withdrawal"]
  N --> B["the-detail-preview-became-the-order-detail — Settlement placed before Withdrawal"]
  A --> R["superseded, left as written"]
  B --> R
```

## the order screens count eight statuses, and the owner added a ninth

**The example.** Found when `dev` was merged into the order design line (2026-10-02). On `dev`,
[the-accept-is-the-status-return-completed](../../business/order/context_decision.md#the-accept-is-the-status-return-completed)
(2026-09-21) added `return_completed` after `return` and renamed the eight-status decision
[superseded-the-order-has-eight-statuses](../../business/order/context_decision.md#superseded-the-order-has-eight-statuses).
The order screens were built on the other line and never saw it:

| site | says | now |
| --- | --- | --- |
| [The status tabs](#the-status-tabs--the-owners-eight-not-the-builds-six) above | *"the owner's eight"* | nine |
| `frontend/src/features/orders/stages.ts` — `ORDER_STAGES` | eight stages, `return` the only return pile | no `return_completed` |
| [the-warehouse-steps-are-not-order-statuses](../../business/order/context_decision.md#the-warehouse-steps-are-not-order-statuses) | *"the set of eight … one boundary applied consistently"* | the argument holds; the count does not |

Nothing on screen is wrong yet: the contract has neither `return` nor `return_completed`, so the Retur tab
already reads `—`. It becomes wrong the day the enum grows.

**→ Recommend** no ninth tab. **Retur** gets a step filter of its own, the way Diproses has one: *Diklaim*
(`return`) · *Diterima gudang* (`return_completed`). To a seller a return is one pile they are waiting on;
the warehouse's acceptance is its last step, the same shape as the handover closing Diproses. What stops it
recurring: a merge that brings a renamed decision greps the other line's references too — these four were
new on this line, so `dev`'s own grep could not see them.

```mermaid
flowchart LR
  D["the-accept-is-the-status-return-completed — 9 statuses"] --> T["status tabs section — says eight"]
  D --> S["stages.ts ORDER_STAGES — no return_completed"]
  D --> W["the-warehouse-steps-are-not-order-statuses — the set of eight"]
  T --> R["Retur tab + step filter — Diklaim, Diterima gudang"]
  S --> R
```

---

## Question

1. **Does the per-period report extend `/settlement/report`, or become a second screen?** That page
   ships today with the period grains, the shop/team/user groupings and four of the moved measures
   already on it.
   **→ Recommend extending it.** Two screens would compute "sales" from different sources — orders
   versus the settlement ledger — and both answers would be correct and different, which is a
   sentence somebody has to write on the screen forever.
   ⚠ Its three Analytic RPCs are already audited 🔴 HEAVY and the fix is not applied.

2. **Where does a wallet → bank withdrawal live?** Now that the sense is settled, the home is not.
   Already open in two files; this is a third screen waiting on it.
   **→ Recommend `order_service`** — the wallet is fed by that shop's orders and the withdrawal is
   reconciled against them. That is the standing recommendation in both other files, unchanged.

3. **Can one order's warehouse fee be read at all?** The fee is posted and attributable and no filter
   reaches it, so the list cannot show it even as a column.
   **→ Recommend one `order_id` filter on `LiabilityLogListFilter`** — never a second copy of the fee
   on the order. Same recommendation as [balance Q9](../../business/balance/context_clarify.md#question).

4. **Is "sudah diserahkan" a status, or the absence of one?** It is the step the owner folded into
   `processed`, and it is the step three of the row actions hang on — Jadikan Dikirim, Retur Barang,
   Selesaikan Order. It has no enum value, so the menu gates on `PACKED` instead and offers them one
   step early.
   **→ Recommend a `HANDED_OVER` value** in the same migration that adds the four missing statuses.
   It is the boundary between "we are still holding it" and "the courier is", which is the moment
   responsibility moves — the only reason the four steps of `processed` are distinguishable at all.
   ⚠ The alternative, gating on the presence of a tracking number, needs a field that also does not
   exist.

5. **Is "Edit Resi" the seller's or the warehouse's?** The ongkir is now the warehouse's to set, and
   a tracking number is issued at handover — by the building. But the old table put Edit Resi on
   `created` and `process`, where the parcel has not moved and a CS is the one pasting the number
   off the marketplace.
   **→ Recommend both, with different sources:** the seller pastes a marketplace-issued number before
   handover, the warehouse writes the courier's at handover. One field, two moments.
   ⚠ It is academic until there IS a field — `shipping_code` is the carrier and `OrderReceipt` is the
   attached file; the printed number is nowhere.

6. **Can a root reader see the list at all?** The owner decided the Team column appears for a reader
   above selling level — *"root bisa liat team"*. `scopedOrders` is `(team_id = ? OR warehouse_id = ?)`
   with no root bypass, so a reader in the root team matches neither and gets an empty table. The
   column is built and correct; there would be no rows under it.
   **→ Recommend the bypass live where every other one does** — ROOT/ADMIN in team 1 already skip
   scope checks in the access interceptor, so this is that same rule reaching the query, not a new
   policy. ⚠ It is a server change and nothing on the screen can stand in for it.

7. **Does a date on a row show the year, and whose clock formats it?** A filtered row now carries
   three timestamps in one cell, each rendered `formatUnixDateTime` — *"Sep 27, 2026, 03:18 PM"* on
   this machine. The format follows the VIEWER's operating system, so the same screen reads
   `27 Sep 2026, 15.18` for one person and `Sep 27, 2026, 03:18 PM` for another.
   **→ Recommend a fixed locale and a compact table form:** `27 Sep 15:18`, with the year only when
   it is not the current one. Three of those fit where three of the current form do not.
   ⚠ This is app-wide — `formatUnixDateTime` is shared — so it is asked rather than changed here.

8. **What is the revenue of an order the marketplace never priced?** The margin is measured against
   `harga MP`, and two kinds of order have none: a PHONE order (no storefront took anything) and a
   marketplace order nobody recorded a figure for (fixture 108). Both currently show an em-dash for
   beli, margin and percentage — so a real sale reads as unmeasured.
   **→ Recommend splitting them:** a phone order's revenue is our own `subtotal` (there is no platform
   in the middle, so our quote IS the sale), while an unrecorded marketplace figure stays UNKNOWN —
   guessing there would silently substitute our quote for the platform's payment, which is the one
   substitution settlement exists to prevent.
   ⚠ Today the code refuses both, which is honest and leaves phone orders out of every margin.

9. **Where do the deadline's urgency boundaries come from?** The column bands at 6 hours ("not for the
   next shift") and 24 hours ("today's problem"), and both are my guess.
   **→ Recommend they come from the CHANNEL, not from a constant:** a same-day courier and a regular
   one do not deserve the same amber. That needs a lead time on `ShipmentChannel`, which it has no
   field for either.
   ⚠ And the deadline itself has no field anywhere — see the `deadline` mark on the column.

10. **Does promoting a draft keep the marketplace's product title?** `OrderDraftItem` carries
    `external_name` + `external_sku` — *"never overwritten … the evidence of what the buyer actually
    ordered"* — and `OrderItem` has neither, so promote throws the evidence away at the moment the goods
    start being picked against the mapping. The detail preview shows it per line (invented).
    **→ Recommend** both fields on `OrderItem`, copied verbatim at promote and empty on a typed order.

11. **What is a return shipment?** A parcel can travel twice (owner: *"resi bisa 2 dan jejak pengiriman
    juga bisa 2, dari order dan return"*), each leg with its own courier, number and trail. Today there is
    no return record at all — no status, no number, no trail. The preview shows two legs, the return one
    invented for order 108.
    **→ Recommend** one shipment-leg shape used twice (`direction: outbound | return`), rather than a
    second set of `return_*` columns on the order — a third leg (a re-send after a lost parcel) then costs
    nothing.

12. **Who may edit a user note, and can one be deleted?** Notes are now a list with two kinds (owner:
    *"catatan … bisa lebih dari 1 dan … ada tipenya, dari sistem dan dari user"*), and user notes are
    editable. The preview lets anyone edit any user note and offers no delete.
    **→ Recommend** only the note's AUTHOR may edit it, every edit keeps the earlier text (an "edited"
    marker with the original one click away), and **no delete** — a note is an instruction somebody may
    already have acted on, so removing it removes the reason for what they did.
    ⚠ And are system notes the same stream as the status timeline? **→ Recommend no**: the timeline is
    status changes only; a system note is anything else the app wants a person to know (a remap, a label
    printed, a return received). Merging them buries the status history in chatter.
    ⚠ Contract: `Order.note` is one string; this needs an `order_notes` table (`kind`, `author_user_id`,
    `text`, `created_at`, `edited_at`) and create/update RPCs.

14. **What does a draft line map to?** A scraped row can now be mapped to a product, a bundle (with its slot fills),
    or several products ([a-draft-row-maps-to-a-product-a-bundle-or-a-split](../frontend/order_draft_decision.md#a-draft-row-maps-to-a-product-a-bundle-or-a-split)),
    but `OrderDraftItem` holds one `product_id` — so a bundle or split mapping is lost on save and blocks Promote.
    **→ Recommend** a mapping on the draft line with a kind: `product` (today's `product_id`), `bundle`
    (`bundle_id` + the slot fills), `split` (child lines of product + quantity per unit) — and the same grouping on
    `OrderItem`, which the create form's `bundle` mark already asks for, so Promote can carry it into the order.
    ⚠ Bundles need a contract of their own first; this question waits on that one.

15. **Should a draft carry a sell price from the start?** The app reads the order's total off the marketplace as well
    as each line's price, and the draft page lets the sell price be typed over (owner: *"bisa juga kita masuk di
    kontrak awal atau 0"*) — but `OrderDraft` has no field, so a typed one is lost (`sellPrice` ⚠).
    **→ Recommend** `marketplace_total` on `OrderDraft` and `OrderDraftPush` (0 = not read), editable through
    `OrderDraftUpdate` like any other field, and carried into the order by Promote. The rows' sum stays the seed
    when the app sends none.

16. **What must an order list carry to a WAREHOUSE reader?** The warehouse row
    ([the-warehouse-row-is-the-old-systems-columns](../frontend/warehouse_order_list_decision.md#the-warehouse-row-is-the-old-systems-columns))
    shows the seller's shop and marketplace, the units on the order and who created it — none of which a list result
    gives a warehouse: `ShopList` is scoped to the selling team, items are empty in a list, and `Order` has no creator.
    **→ Recommend** denormalised fields on the list row — `shop_name`, `marketplace`, `item_quantity`,
    `created_by_user_id` — written when the order is placed, rather than giving a warehouse read access to every
    seller's shops. The resi, the marketplace date and the deadline are the open fields already asked about above.

17. **What must the warehouse be able to filter by?** The warehouse list
    ([the-warehouse-filters-by-team-marketplace-and-courier](../frontend/warehouse_order_list_decision.md#the-warehouse-filters-by-team-marketplace-and-courier))
    offers a seller team, a marketplace, a courier and a shipment state — `OrderListFilter` has a status, a search, a
    shop and a date window, and none of those four. Its search also does not reach the MP order id or the resi, which
    is what a packer has in hand.
    **→ Recommend** `seller_team_id`, `marketplace` and `shipping_code` on `OrderListFilter` (all already on the order
    or on the denormalised row of Q16), and the search widened to `order_external_ref_id` and the tracking number.
    The shipment state waits on the shipment record; courier first, because parcels are batched by courier.

18. **What does the warehouse workbench need from the contract?** The warehouse list now changes steps by the old
    system's table, scans parcels to hand over, validates picks by scan, and prints labels in bulk
    ([a-warehouse-step-moves-by-the-old-systems-table](../frontend/warehouse_order_list_decision.md#a-warehouse-step-moves-by-the-old-systems-table),
    [scanning-is-the-crews-hands](../frontend/warehouse_order_list_decision.md#scanning-is-the-crews-hands)). Missing today:

    | need | → Recommend |
    | --- | --- |
    | statuses for **Sudah diambil** and **Sudah diserahkan** | `PICKED` and `HANDED_OVER` in one migration (Q4 already asks for the second) |
    | moves beyond one step forward | one `WarehouseStepChange(order_ids, to, reason)` with the transition table on the server, a reason required for a move back and written to the timeline |
    | finding an order by its label | a lookup by tracking number or MP order id, scoped to the warehouse — the same field Q17's search needs |
    | a real bulk handover | the step change above taking many ids, with a result per order |
    | a product barcode | `barcode` on the product (several per product, for different packs) |
    | labels printed together | the document service merging several receipts into one file |
    | export | the order list's export, shared with the seller's |

13. **Where does a draft's pushing app go on the row?** The draft list used to show `source` under the reference;
    [the-draft-list-is-the-drafts-tab](../frontend/order_draft_decision.md#the-draft-list-is-the-drafts-tab) gave that line to
    *what is left*, so the app's name is now on the detail only. Two apps can scrape the same marketplace, and
    the reference alone does not say whose it is.
    **→ Recommend** it takes the author's line in the *Dibuat* cell — `via <app>` instead of `oleh <name>`. Per
    [drafts-exist-only-for-the-third-party-app](../../business/order/context_decision.md#drafts-exist-only-for-the-third-party-app)
    the app IS the author, and the user id on the draft is only whoever owns the token it pushed with.
