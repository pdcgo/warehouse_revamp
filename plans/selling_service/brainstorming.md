# Brainstorming — Selling + Order domain (#23)

> Planning doc for the **selling service and the order service** (#23 says the selling work
> *"includes order service"*). Nothing here is implemented, and **nothing is decided** — this
> maps the domain, the real forks, and a proposed break-up into smaller issues (as #23 asks:
> *"break this to many issues if too big"*).

> **Decisions so far**
> - **CREATE, not adapt** — the selling/order/revenue domains are designed from first principles,
>   no other repo read (§3.1 settled). (owner, 2026-07-15)
> - **Decomposed into sub-issues** — the §4 break-up was created as GitHub issues on the board
>   (owner: "create all of them"). Shop management is Ready; the rest are Backlog behind the
>   decisions/§1 dependency. (owner, 2026-07-15)
> - **§3.5 Shops SETTLED (#66)** — a new **`selling_service`** owns `shops` (team-scoped to a
>   SELLING team). Shape: `name` (required), `shop_code` (unique per team, like team_code),
>   `marketplace` (a typed **enum** → `MarketplaceSelect`: Shopee/Tokopedia/Lazada/TikTok/Blibli/
>   Bukalapak/Other), `description`. **No credentials/integration metadata** — "just save shop
>   info"; the marketplace-integration secret story waits for import (#73). Managed by team
>   owner/admin (+ root/admin). (owner, 2026-07-15)
> - **§3.2/§3.3/§3.4/§3.7 for #67 — provisionally DECIDED BY THE AGENT (owner delegated overnight
>   2026-07-15; please review at 06:00 and redirect if wrong).** Orders live in **`selling_service`**
>   (it "will grow to own orders"), a new `warehouse.selling.v1.OrderService`.
>   - **Statuses (§3.2):** selling-side only — `ORDER_STATUS_PLACED` / `CONFIRMED` / `CANCELLED`.
>     The fulfillment states (picking→packed→shipped→delivered) are deliberately absent until the
>     warehouse core (plan.md §1) is designed.
>   - **Stock (§3.3):** `OrderCreate` does **NOT** touch inventory — no reservation, no decrement.
>     Stock integration is its own issue (#69), so this decision stays reversible.
>   - **Intake (§3.4):** manual create only; no marketplace import / external ref yet (that is #73).
>   - **Money (§3.7):** stored as **int64 whole rupiah**. The order FREEZES `subtotal` +
>     `shipping_cost` + `total`; each line snapshots `product_id`/`sku`/`name`/`quantity`/`unit_price`.
>     COGS / margin / fees are the revenue side (#74), not here.
>   - **Shape:** `order` (team_id scope, shop_id, status, customer name/phone/address, shipping_code,
>     the three money totals) + `order_items` (the line snapshots). No FKs across services (shop_id,
>     product_id are opaque). #67 ships the backend (model + OrderCreate/List/Detail); the UI is #68.
> - **#68 + #90 order UI shipped (agent, overnight 2026-07-15).** Orders list + read-only detail
>   (#68), then the create form (#90): customer + shop + shipping + dynamic product lines, subtotal
>   auto-summed, total = subtotal + shipping. Two new shared pickers — `ShopSelect` (bounded
>   NativeSelect over the team's shops) and `ProductSelect` (searchable Combobox over the catalogue).
>   **Design finding:** a product has **no catalogue price** (sku/name/category/images only), so the
>   order line's `unit_price` is **typed by the CS person** — which is right anyway, since the
>   buyer-paid price on a marketplace varies by shop/promo and the order FREEZES whatever was agreed.
>   If a default/list price is ever wanted, it belongs on the product (a new field), not invented here.
> - Still **open** and need the owner: §3.6 (which warehouse fulfils — needs §1) and the whole
>   revenue side (#32 / §3.7 downstream).
> - **§6 DRAFT ORDERS (#162) — SETTLED (owner, 2026-07-22).** A draft is **an order half-typed**, and
>   the answer that reframed everything: **it is never typed in our UI — a third-party app pushes it
>   in**, and a person here finishes it and promotes it. It lives in a **separate `order_drafts`
>   table** (not a status on `orders`, which would make every reader responsible for excluding drafts
>   — that is how an unfinished scrape reaches a revenue report). It is **personal to the author**,
>   and the app **logs in as a user** rather than as a machine, so every draft has a human accountable
>   on it and the §3.3 machine-identity gap stays unopened. Lines arrive as **scraped text**, mapped
>   to real products on promote — the unmapped line *is* the incompleteness. A re-push **dedupes on
>   `(source, external_id)`** and **fills blanks only**, so a background re-scrape can never destroy
>   someone's work. **No expiry**, own page at `/order-drafts`. Decomposed into seven sub-issues
>   (§6.11).

---

## 1. What already exists (ground truth)

The pieces an order sits on top of are mostly built:

| Domain | Service | What it gives an order |
| --- | --- | --- |
| Catalogue | `product_service` | the products an order's lines reference |
| Stock | `inventory_service` | `StockReceive/List/History/Adjust/Transfer` — where an order decrements stock |
| Couriers | `shipping_service` | the shipping method an order ships with |
| Category | `category_service` | product taxonomy |
| Teams | `team_service` | selling teams **and** warehouse teams (a warehouse is a team of type WAREHOUSE) |
| Identity | `user_service` | who places / fulfils / manages orders |
| Files | `document_service` | proof images (payment, packing) |
| Events | `pkgs/event_source` | the bus an order lifecycle would publish onto |

**Missing, and in scope here:** *shops* (a selling team's marketplace storefronts), *orders* (the
lifecycle), and — downstream, #32 — *revenue*.

---

## 2. The shape of the domain (first principles)

A **selling team** sells goods that physically live as stock in a **warehouse**, through **shops**
(marketplace storefronts). The unit of work is the **order**:

```mermaid
flowchart LR
    C[Customer] -->|places| O[Order]
    O -->|lines reference| P[product_service]
    O -->|decrements| I[inventory_service]
    O -->|ships via| S[shipping_service]
    O -->|fulfilled by| W[a WAREHOUSE team]
    O -->|money| R[revenue_service · #32]
    subgraph selling side
      C
      O
    end
    subgraph "warehouse side — undesigned §1"
      W
    end
```

An order has **two halves**, and they pull in different directions:

- **Selling side** — placed, customer + address, payment, which shop, the money the buyer pays.
  This is designable now.
- **Warehouse side** — pick → pack → hand to courier. This is **fulfillment**, and it needs the
  warehouse operation, which is **[plans/plan.md](../plan.md) §1 — still empty.** We cannot design
  the fulfillment lifecycle until we know what a warehouse physically does.

> **This split is the single most important thing on this page.** The selling half can move; the
> fulfillment half is blocked on the warehouse-core design. A good decomposition (§4) puts them in
> different issues so the selling half is not held hostage.

---

## 3. The forks — decisions the owner must make

Presented as options, **not settled** (HARD RULE 8).

### 3.1 Create, or Adapt? ⭐ *answer this first*
#23/#32 say *"Create or Adapt."* Neither issue names a reference system, so by default (HARD
RULE 1) this is a **clean-slate design from first principles.** If instead you want to **adapt an
existing selling/order/revenue implementation**, say so explicitly — then I'd study it the way I
did for `user_service` / `team_service`, and this plan becomes a port-spec instead.

- [ ] **Create (clean slate)** — design from the warehouse and the people, as we've been doing.
- [ ] **Adapt** — name the source and I'll read it (needs your explicit go-ahead per HARD RULE 1).

### 3.2 What is the order lifecycle? ⚠ *depends on the warehouse core (§1)*
The status model is the spine of the order service. The forward path is roughly
`placed → confirmed → picking → packed → shipped → delivered`, plus the tails `cancel`,
`return`, `problem`. But the middle (`picking → packed → shipped`) **is** the warehouse operation.
Until §1 is designed, we can only fix the selling-side ends (`placed`, `confirmed`, `cancel`) and
leave the fulfillment states as a marked gap.

> **Implemented — the selling-side ends (#91).** `OrderConfirm` (PLACED→CONFIRMED) and `OrderCancel`
> (PLACED or CONFIRMED→CANCELLED, terminal) are built, with the row locked FOR UPDATE so a concurrent
> confirm/cancel can't race, and illegal moves rejected as `FailedPrecondition`. **No stock/money is
> reversed on cancel** — that is #70, once stock integration (#69) lands. The `picking→packed→shipped`
> fulfillment states are still absent, pending §1.
>
> ```mermaid
> stateDiagram-v2
>     [*] --> PLACED: OrderCreate
>     PLACED --> CONFIRMED: OrderConfirm
>     PLACED --> CANCELLED: OrderCancel
>     CONFIRMED --> CANCELLED: OrderCancel
>     CONFIRMED --> fulfillment: (§1 — undesigned)
>     CANCELLED --> [*]
> ```

### 3.3 When does an order take stock?
Three honest options, and it ties to the reservation question already open in
[plans/plan.md §4.4](../plan.md):

| Option | When stock leaves | Trade-off |
| --- | --- | --- |
| **Deduct at placement** ✅ | immediately | simplest; oversell impossible; but a cancel must return stock |
| **Reserve** at placement, deduct at pick | held, then taken | needs a reservation concept inventory doesn't have yet |
| Deduct at pick only | when the warehouse picks | stock looks available until picked → oversell risk |

**✅ DECIDED (owner, 2026-07-20): deduct at PLACEMENT.** Stock leaves the moment the order is placed
(#69), so **the number on screen is the number you have** — oversell is impossible by construction
rather than by luck. That is the same stance the warehouse side has taken throughout: never let a
number say something nobody observed.

**✅ And how the two services talk (owner, 2026-07-20): SYNCHRONOUS RPC, stock first, then the order.**
This is the **first service-to-service call in the system** — nothing called anything before it — so it
sets the pattern the next one inherits, and it was chosen deliberately rather than by default.

The decision only looks like plumbing. It is actually what makes "deduct at placement" *true*:

| | |
| --- | --- |
| **Sync RPC** ✅ | the deduct happens **before** the order exists. Not enough stock → no order. The guarantee holds. |
| Event (Pub/Sub) | the order is written, the deduct lands moments later — so two orders placed in the same second are both accepted, and **that is an oversell**. It would have quietly undone the decision above. |

The event path was tempting because `pkgs/event_source` already exists and it keeps the services more
independent. It was rejected for this call specifically, **not in general** — an event is right for
telling other services something *has happened*; it is wrong for asking permission, and a stock deduct
is asking permission.

**The cost, stated plainly:** two databases, no shared transaction. If the order write fails *after* a
successful deduct, stock is decremented for an order that does not exist. That is recoverable — the
movement is in the ledger with a reason, so it can be found and reversed — but it needs a compensating
reversal rather than a rollback, and #70's cancel path is the same machinery. This is the classic
distributed-write trade, taken with open eyes: a rare recoverable inconsistency beats a routine
oversell.

**Which shelf the stock comes off (owner, 2026-07-20): unplaced first, then shelves by label.** At
placement nobody has physically walked to a rack, but stock lives on specific shelves (#135), so
something has to be drawn down. The drain order is arbitrary *and documented*: what is **not** invented
is the record — the ledger names exactly which shelves were drawn, so a picker later sees the truth
rather than a guess. #70 puts it back the same way. When §1 says how picking actually works (#71), the
physical order can replace this one without changing what was recorded.

---

### 🚧 #69 IS BLOCKED, and on something nobody had named: **service-to-service authorization**

Everything above is decided and #72 has shipped, but #69 cannot be built, and the blocker is worth
stating precisely because it is not a missing decision about orders — it is a missing capability.

**The problem.** A CS person places the order. They hold a role in the **selling** team. The stock
belongs to the **warehouse** team. Any `StockPick` would carry `warehouse_id` as its `use_scope`
field — and the access interceptor's own test states the rule:

> *"A role in ANOTHER team must not authorize this one. This is the whole point of `use_scope`."*

So the call is **denied**, correctly, by the system working as designed. The selling team has no role
in the warehouse and should not be given one.

**What is actually missing.** The system has no way to express *"this selling team may draw stock from
that warehouse"*, and no notion of a call made **by a service** rather than by a person. Every policy
today answers "which human roles may call this"; nothing answers "may `selling_service`, acting for a
team that has an arrangement with this warehouse, do this on that team's behalf".

**Three shapes it could take — an OWNER/architecture call, deliberately not made here:**

| | | |
| --- | --- | --- |
| **A machine identity** | services authenticate as themselves; a policy admits a service the way it admits a role | the general answer; the biggest change |
| **A stored arrangement** | a `warehouse ↔ selling team` relationship the scope check consults, so a role in the selling team authorizes a draw from a warehouse it is linked to | models the real 3PL relationship; needs a new table and a scope-check change |
| **Flip who calls** | the warehouse consumes the order rather than the order consuming stock — as `RestockRequestFulfill` already does, where the warehouse acts | no new auth at all, but it makes the deduct *asynchronous*, which is exactly what "deduct at placement" rejected |

**Nothing was built against a guess.** The temptation — quietly widening `StockPick`'s policy, or
exempting service calls from the scope check — would have silently weakened the ACL that the entire
authorization model rests on, in a system whose stance everywhere else is *refuse, do not interpret*.

#### ✅ SUPERSEDED (owner, 2026-07-20): **any team may draw stock from any warehouse.**

**This replaces the arrangement decision below.** There is no per-warehouse permission: a selling team
does not need to be granted access to a warehouse's stock, because in this operation every warehouse
serves every selling team. The arrangement was built (#147) and then **reverted** once the owner saw
it — the right call, and cheap because it had shipped *inert* by design.

**What this changes technically, and it is the whole point:** without a per-warehouse permission there
is nothing for the scope check to consult, so **#148 disappears entirely** — the change to the access
interceptor, the most dangerous work in the chain, is simply not needed.

`StockPick` is then scoped to the **caller's own selling team**, not the warehouse: `team_id`
(`use_scope`) is the team placing the order, which the caller demonstrably has a role in, and
`warehouse_id` rides as an ordinary unscoped parameter. The authorization question becomes *"are you
a legitimate member of the team placing this order?"* — which is the question that actually matters —
rather than *"do you have rights inside that warehouse?"*, which nobody in the selling team ever will.

⚠ **Note the CLAUDE.md trap this avoids:** a team-level role on a message with **no** `use_scope` field
is evaluated against the root team and becomes a dead letter. Scoping to the selling team keeps the
policy live; making `StockPick` unscoped would have quietly authorized nobody.

**The cost, stated honestly:** any selling team can now draw down any warehouse's stock. That is a real
exposure, accepted deliberately because it matches how this business runs — the warehouses and the
selling teams are the same operation, not arms-length parties. If that ever stops being true, the
arrangement below is the shape to bring back, and it is in git (`434eadf`, reverted).

---

#### ~~DECIDED (owner, 2026-07-20): a stored warehouse ↔ selling-team arrangement.~~ *(superseded above — kept for the reasoning, which still holds if per-warehouse permission is ever wanted)*

A link saying *"selling team A may draw stock from warehouse B"*, which the scope check consults. The
ACL stays about **who may do what**; it just learns a fact it did not have.

Why this over the alternatives, since all three would have worked:

- **A machine identity** would solve every future cross-service call at once, which is its appeal —
  but it authorizes a call with **no human accountable on it**. In a system where every stock movement
  records an actor, that is a real loss, and it would have been taken for convenience rather than need.
- **Flipping who calls** (the warehouse consumes the order) needs no new auth at all and reuses a
  pattern that already works — but it makes the deduct **asynchronous**, which brings back exactly the
  oversell that "deduct at placement" was chosen to prevent. It would have quietly undone an earlier
  decision, which is the worst kind of change.
- The arrangement is a **real business fact** — a selling team genuinely does have a relationship with
  a warehouse — so it is **visible and revocable**, and it fails closed: no link, no draw.

**This is #134-shaped and is being decomposed into sub-issues rather than built in one pass.** It
touches the access interceptor, which is the most sensitive code in the repo: every RPC's authorization
runs through it, and a mistake there is silent. The order is deliberate — the model and the scope check
land and are proven *before* anything depends on them.

**One thing to get right when it is built:** the link must be consulted **in addition to** the existing
scope check, never instead of it. It widens who may draw stock from a warehouse; it must not widen
anything else about that warehouse, and a team with a link must still not be able to, say, edit the
warehouse's racks.

#### ✅ DECIDED (owner, 2026-07-20): `ProductByIds` stays as-is (§4).

Warehouse roles keep the by-ids lookup across teams. A by-ids lookup is not a browse — the caller must
already know the id, and what comes back is a catalogue label, not money or customers. Warehouses
physically hold other teams' goods, so reading the label on a box on their own shelf is unremarkable.
Moving the lookup behind `inventory_service` to enforce "only what it holds" was considered and **not**
taken: it is real machinery for a bound that is not currently worth its cost.

- The cost is real and accepted: **a cancel must put the stock back**, which is #70. It is a small
  cost, and unlike an oversell it is a thing the system can do correctly.
- **Reservation was rejected for now, not forever.** It is the truest model — goods sit on the shelf
  until someone picks them — but inventory has no reservation concept, so it means a new on-hand vs
  available split touching every stock read. Revisit it if picking (§1, #71) ever needs to know what
  is spoken for. Until then, "available" and "on hand" being the same number is a simplification the
  system is honest about rather than a thing it gets wrong.

### 3.4 Where do orders come from (intake)?
- Manual entry (a CS person types it in).
- Marketplace **import** (is the `bargawa` Chrome extension the intake path? it already speaks the
  Connect contract).
- A public order-create API.

Each implies different `OrderCreate` ergonomics and a different `source`/`ref_id` story.

**✅ DECIDED (owner, 2026-07-20): manual entry only, for now** (#73). A CS person types the order in,
which is exactly what `OrderCreate` + the #90 form already do — so **#73 needs no new code**, and its
value was in the decision rather than the build.

- **Marketplace import and a public API are NOT rejected, just not now.** Both remain in §3.4 as
  future paths, and the `source`/`ref_id` story stays unwritten until one is chosen — inventing it
  ahead of a real import would be guessing at a shape nobody has seen.
- Worth remembering when import does arrive: the implementation finding in §3.7 below says the server
  cannot safely assert `total == subtotal + shipping`, because a marketplace's buyer-paid total
  legitimately differs (vouchers, subsidies, coins). Manual entry is the case where that arithmetic
  *would* hold — so an import is what forces the `discount`/`fee` fields, not the other way round.

### 3.5 Shops — what is a shop, and does selling own it?
A selling team likely operates several marketplace shops. Minimum shape: name, marketplace type,
maybe credentials/metadata. Does `shop` belong to a new `selling_service`, or is it its own
service? Who can manage shops (team owner/admin)?

### 3.6 Which warehouse fulfils an order, and how does the crew see it?
Per-order choice? A shop default? Auto-pick by stock? And the warehouse crew's fulfillment
screen is **§1 territory** again.

**✅ DECIDED (owner, 2026-07-20): chosen PER ORDER** (#72). Whoever types the order picks the
warehouse, and the order stores it. Nothing is inferred.

This had to be settled before #69 could exist at all: "deduct at placement" is meaningless until an
order says *which warehouse to deduct from*, and an `Order` had no `warehouse_id` — the proto said so
explicitly, deferring it to §1.

- **A shop default was the tempting alternative** and was not taken: it is less typing, but it infers
  a physical fact from a configuration value, and a shop's default changing later would silently make
  old orders read as if they had shipped from somewhere they did not. Per-order is one more field and
  no inference.
- **Auto-by-stock was rejected as underspecified rather than wrong.** It needs rules nobody has: what
  if two warehouses qualify, what if none can fill the order alone, is a split across warehouses one
  order or two. Those are worth answering when volume demands it — and the per-order field is what an
  auto-picker would *fill in* later, so this decision does not block it.
- The warehouse crew's **fulfilment screen** is still §1 territory (#71) and untouched by this.

### 3.7 The money the order records (feeds #32)
What does an order freeze for the revenue side — buyer-paid total, COGS, shipping cost, warehouse
fee, marketplace fee? This is the seam between #23 and #32.

> **Implementation finding (#90).** `OrderCreate` currently **trusts** the client's `subtotal` /
> `shipping_cost` / `total` — it stores them verbatim, it does not recompute from the lines. The #90
> form always sends derived-consistent values (`subtotal = Σ qty·unit_price`, `total = subtotal +
> shipping`), so manual orders are safe today. But we deliberately did **not** add a server-side
> `total == subtotal + shipping` check, because on a marketplace the buyer-paid total legitimately
> **differs** from `Σ lines` (platform vouchers, free-shipping subsidies, coins). So the real fork for
> #74 is: **introduce explicit `discount` / `fee` fields** and then the server can enforce an
> invariant — until then there is no arithmetic the server can safely assert. Decide this before
> marketplace import (#73) starts feeding in real payout numbers.

---

## 4. Proposed decomposition into issues

#23 explicitly asks to break this up. A proposed set — **for the owner to confirm before any are
created** (I won't create issues unilaterally):

**Movable now (selling side, not blocked on §1):**
1. **Shop management** — `shop` model + CRUD RPCs + a selling-team Shops screen.
2. **Order data model + `OrderCreate`** — place an order (lines, customer, shop, shipping),
   selling-side statuses only.
3. **Order list + detail (selling view)** — the CS/selling screens.
4. **Stock integration on order** — decrement inventory per §3.3's chosen timing.
5. **Order cancel** — reverse stock + money.

**Blocked on the warehouse core (§1):**
6. **Order fulfillment (warehouse side)** — the pick → pack → ship lifecycle and the crew screen.
7. **Which-warehouse routing** — depends on how warehouses are operated.

**Downstream (#32):**
8. **Revenue recording** — what an order freezes and how it reconciles (its own epic).
9. **Order intake / marketplace import** — depends on §3.4.

---

## 5. The honest blocker

Half of "orders" is warehouse fulfillment, and **the warehouse operation has never been designed**
— [plans/plan.md §1](../plan.md) (who works there, the jobs, the devices, whether anything is
barcoded) is empty. The selling half (shops, order-create, order list/detail, cancel) can proceed
first; the fulfillment half cannot be planned well until §1 is filled in with the owner.

**So the two most useful next moves, in order:**
1. Answer §3.1 (Create vs Adapt) — it decides whether this is a clean-slate design or a port-spec.
2. Fill in [plans/plan.md §1](../plan.md) — the warehouse jobs — which unblocks the fulfillment
   half of every order issue, and #32.

---
## 6. Draft orders (#162) — ✅ DECIDED (owner, 2026-07-22)

> #162's body was one line — *"order can to be draft"* — so §6 was first written as seven open
> questions rather than a guess. **All seven are now answered**, and one of them reframed the whole
> feature: **a draft is never typed into our UI.** It is pushed in by a **third-party app**, and a
> person in this system finishes it and promotes it.
>
> That single answer dissolved one question outright (explicit-save vs autosave — there is no in-app
> editor to save from) and forced four new ones that the original §6 never thought to ask. Those are
> §6.3–§6.6 below.

### 6.0 What a draft is NOT

Naming these first, because each is a real thing that would be tempted onto the same table and would
then quietly change what a draft means:

| Not a… | Because |
| --- | --- |
| **Quotation** | A quote is shown to a buyer and has a validity period. A draft is private working state. |
| **Reservation** | A draft holds no stock. Nothing in this system reserves stock even at placement (§3.3) — picking is what moves it (#151) — so a draft reserving anything would be the *first* reservation in the design. |
| **Unpaid marketplace order** | That is a real order in a payment state, which belongs in `OrderStatus`. A draft was never placed by anybody. |
| **Template / repeat order** | A template is reused many times. A draft is consumed once, when it becomes an order. |

### 6.1 ✅ The job — **park a half-typed order**, pushed in from outside

A draft is **incomplete by definition**. The third-party app scrapes what it can see and pushes it;
what it could not resolve — which of our products a line actually is, the shop, the warehouse — is
left blank for a person to fill in.

The other three readings (§6.1's B/C/D — awaiting payment, import staging, repeat template) were
**not** chosen. Worth keeping straight: **"awaiting payment" would have been a new `OrderStatus`, not
a draft at all**, because nothing about such an order is missing. If that need ever arrives it is a
separate, much smaller change, and it must not be folded onto `order_drafts`.

> ⚠ **This is intake, but it is NOT §3.4's marketplace import.** §3.4 decided *manual entry only* and
> left `source`/`ref_id` unwritten, because inventing a shape for an import nobody had seen would be
> guessing. Drafts are the thing that finally makes those fields real — the shape is now driven by an
> app that actually exists, which is exactly the condition §3.4 set. An import that writes `orders`
> directly is still not built and still not decided.

### 6.2 ✅ Where a draft lives — **a separate `order_drafts` table**

| Option | ✅ | ❌ |
| --- | --- | --- |
| **A. `ORDER_STATUS_DRAFT` on `orders`** | One table, one id — a draft "becomes" an order without changing identity | **Every `NOT NULL` on `orders` relaxes permanently**, for real orders too. `shop_id`, `warehouse_id`, `customer_name` and "at least one item" are required today, and the schema would stop being able to say *a real order always has a warehouse* |
| **B. A separate `order_drafts` table** ✅ | `orders` keeps every constraint it has. A draft is a loose bag of nullable columns, which is what a draft *is*. Promoting runs the same validation `OrderCreate` does, so it lives in one place | Two id spaces — "draft #12" and "order #12" are different things |
| **C. Client-side only (`localStorage`)** | No backend at all | **Impossible here.** A draft arrives from another machine entirely, so there is no browser for it to live in |

**The reason is not tidiness.** Option A's real cost is that *every* reader of `orders` becomes
responsible for remembering to exclude drafts — the order list, the pick queue, the warehouse's view,
the revenue chain, every count. That is the shape of the bug #164 produced on the revenue screen (a
row that must be listed but not totalled), and a draft is the more dangerous version: a voided order
is a real order that stopped counting, while a draft **was never an order at all**. One forgotten
`AND status != DRAFT` puts an unfinished scrape into somebody's revenue report.

Option C stopped being viable the moment drafts came from outside — worth recording, because under
the original "CS types it in" reading it was a genuine contender.

⚠ **A draft must never publish `OrderCreatedEvent`.** Placement fires it (#153) and revenue consumes
it (#75). A draft that published would put an unfinished order into the month's margin.

```mermaid
stateDiagram-v2
    [*] --> Draft: the app pushes what it scraped
    Draft --> Draft: the app re-pushes, filling blanks only
    Draft --> Draft: a person maps lines and fixes the address
    Draft --> Placed: promote, and the OrderCreate validation runs
    Draft --> [*]: deleted by hand
    Placed --> Confirmed
    Placed --> Cancelled
    note right of Placed
        Only this transition publishes
        OrderCreatedEvent, so revenue
        never sees a draft
    end note
```

### 6.3 ✅ Whose draft, and how the app gets in — **personal, and the app logs in as a user**

**Personal to the author.** A draft is private working state. A colleague cannot pick it up, which is
the accepted cost — under the third-party design it matters less than it would have, because the app
can always re-push to whoever should own it.

**The app authenticates as a user**, holding a normal JWT. There is **no machine identity in this
system** — §3.3 named that gap and nothing has filled it — and this feature deliberately does not
fill it either:

| | ✅ | ❌ |
| --- | --- | --- |
| **Logs in as a user** ✅ | No new auth machinery at all. And it makes "personal" true *by construction* — the draft belongs to whoever's login the app runs under, so **every draft has a human accountable on it**, which is the stance every stock movement in this system already takes | The app must hold a user credential and handle expiry |
| A machine identity | The general answer — unblocks every future service-to-service call | Authorizes a call with **nobody accountable on it**. A big change to the access interceptor, the most sensitive code in the repo, taken for convenience rather than need |
| Key + acting-for-a-user | Both | Needs a delegation concept that does not exist |

> ⚠ **The CLAUDE.md trap this must avoid.** "Personal" is a **handler filter, not a scope.** Every
> draft request still carries `team_id` with `(use_scope) = true` and a team-role policy; the handler
> then additionally narrows to `author_user_id`. Dropping the scope to "make it personal" would leave
> a team-level policy evaluated against the root team — a **dead letter** that authorizes nobody.

### 6.4 ✅ What the app sends — **external text, mapped on promote**

A marketplace scraper knows the marketplace's product *title*. It does not know our `product_id`.

| Option | ✅ | ❌ |
| --- | --- | --- |
| **External text** ✅ | The draft stores what was scraped, verbatim. A person maps each line to a real product when promoting — and **the unmapped line IS the incompleteness that makes it a draft**, which is §6.1 exactly | Needs a mapping step in the UI |
| Our internal ids | Smallest build — `OrderDraftPush` becomes `OrderCreate` with everything nullable | Pushes the hard problem into a client we do not control. The app would have to search our catalogue and match titles **itself, and guess wrong silently** |
| Mixed | Shop/warehouse as ids (stable, few), products as text (many, volatile) | Two conventions in one message |

The line therefore carries **both**: the scraped `external_sku` / `external_name` (never overwritten —
it is the evidence of what was ordered) **and** a `product_id` that is `0` until a person maps it.
Same instinct as the order's frozen address and frozen money: keep what was actually said.

### 6.5 ✅ Re-pushes — **dedupe on an external ref, and human edits win**

**Dedupe.** The draft carries `source` + `external_id`, **unique per team**. A second push updates the
existing draft rather than adding one — so the RPC is **safely retryable**, which any external caller
needs and a flaky network guarantees it will use. Without this, one bad connection quietly fills the
list with near-identical drafts nobody can tell apart.

**The conflict this creates, and the rule for it.** A re-scrape can land on a draft a person has
already partly completed — two lines mapped, the address corrected.

| Option | ✅ | ❌ |
| --- | --- | --- |
| **Human edits win, app fills blanks only** ✅ | A background re-scrape **can never silently destroy someone's work**. The app still gets to supply everything nobody has touched | Needs a per-field "touched" notion on the draft |
| Latest push wins | Simplest, and defensible — the app knows what the buyer actually ordered | Wipes ten minutes of mapping with no warning and no undo |
| Refuse once touched | Nothing is ever lost | A genuine buyer address change can no longer reach the draft |

### 6.6 ✅ The RPC surface — **full create / update / list / delete for the app**

The external app is not fire-and-forget: it can read back what it pushed and withdraw it. Our own UI
needs list / detail / update / promote / delete regardless.

### 6.7 ✅ Expiry and placement — **never expire, and a page of their own**

**No expiry.** Nothing is deleted on a timer; deleting somebody's unfinished work automatically was
not worth the tidiness. **The accepted cost is real and worth stating**: an app pushing continuously
fills this list far faster than a human ever would, and nothing prunes it. That makes two things
non-optional rather than nice — the list **must** paginate (HARD RULE 9), and deleting must be easy
and bulk-friendly, because pruning is now entirely manual.

**`/order-drafts`, its own route.** Drafts are not orders, and the UI should say so the same way the
schema does. A tab on the orders list was cheaper but would have put not-orders inside the orders
screen — §6.2's concern in UI form.

### 6.8 The shape that falls out

```mermaid
erDiagram
    order_drafts ||--o{ order_draft_items : "has"
    order_drafts {
        uint64 id PK
        uint64 team_id "scope — carries use_scope"
        uint64 author_user_id "personal — only the author lists it"
        string source "which app pushed it"
        string external_id "the marketplace's own id, unique per team and source"
        jsonb touched_fields "field names a human has edited"
        string customer_name "nullable — everything here is"
        uint64 shop_id "0 until known"
        uint64 warehouse_id "0 until known"
    }
    order_draft_items {
        uint64 id PK
        uint64 draft_id FK
        string external_sku "what the app scraped, never overwritten"
        string external_name "what the app scraped, never overwritten"
        uint64 product_id "0 until a person maps it"
        uint32 quantity
        int64 unit_price
    }
```

Everything except the identity columns (`team_id`, `author_user_id`, `source`, `external_id`) is
nullable or zero-valued. That is the whole point of §6.2: `orders` keeps its constraints because this
table carries none.

### 6.9 The promote flow

```mermaid
sequenceDiagram
    participant App as third-party app
    participant D as OrderDraftService
    participant CS as CS person
    participant O as OrderService

    App->>D: OrderDraftPush — source, external_id, scraped text
    D-->>App: draft id, created or updated in place
    Note over D: blanks only — a field a human<br/>has touched is never overwritten
    CS->>D: OrderDraftList, then OrderDraftDetail
    CS->>D: OrderDraftUpdate — map lines to products, fix the address
    Note over D: every field written here<br/>is marked touched
    CS->>D: OrderDraftPromote
    D->>O: the same validation OrderCreate runs
    O-->>D: order created, and only now does OrderCreatedEvent fire
    Note over D: one transaction — same service,<br/>same database, so the draft is<br/>deleted as the order is written
```

### 6.10 Derived — what the answers forced, and one thing to review

These were not asked and not chosen. They fall out of the combination, and the first is worth a look
because it slightly reinterprets "update":

1. ⚠ **Two write paths, not one — and the RPC is what distinguishes them.** The app and the person
   authenticate as the **same user** (§6.3), so *identity cannot tell them apart* — but the merge
   rule (§6.5) requires exactly that. So the **RPC** carries the distinction:
   - **`OrderDraftPush`** — the app's create-or-update, keyed on `(team, source, external_id)`,
     writes **only untouched fields**.
   - **`OrderDraftUpdate`** — a person's edit in our UI, **always wins**, and marks each field it
     writes as touched.

   This is how the app gets "full update" (§6.6) *and* the human keeps their work (§6.5). If you
   meant the app's update to be a plain overwrite, this is the line to redirect.

2. ✅ **Promotion is ONE transaction, not two.** §6.2 listed "promotion is two writes and the gap
   between them needs a decision" as a cost of the separate table. **It dissolves**: `orders` and
   `order_drafts` are both owned by `selling_service`, in the same database — so writing the order
   and deleting the draft is a single transaction. That cost was real for a cross-service split and
   imaginary here.

3. ✅ **"The minimum a draft needs" is now derived rather than chosen.** The old §6.5 asked what a
   draft must have before it can be saved at all. Dedupe (§6.5) keys on `source` + `external_id`, so
   **the external ref is required by construction** and nothing else is. There is no "New draft"
   button to produce a blank, because there is no in-app creation — every draft traces to a real
   scrape.

4. ⚠ **How COARSE is "a field"? — settled while building #191, and the line to redirect.** §6.5 says
   the merge works per field, which leaves two things ambiguous, and both were resolved **coarse**:
   - **The address is ONE field, not ten columns.** Somebody who corrects a kecamatan has corrected
     the address; letting a re-scrape rewrite the nine columns around their fix would leave a hybrid
     address that was never true anywhere.
   - **`items` is ONE field, not one mark per line.** Once a person has edited any line, the app
     stops rewriting the lines altogether. Per-line merging would need a per-line touched mark, and
     the rule that actually matters — a re-scrape never destroys a mapping — holds without it. The
     accepted cost, stated plainly: after the first mapping, a genuine quantity change or a newly
     added line can no longer reach the draft from the app. Per-line merge is the alternative if that
     turns out to bite.

   While untouched, the lines are replaced **wholesale** rather than merged, so a line the app no
   longer sees disappears instead of lingering.

5. **"Untouched", not "empty".** The rule is about what a person has claimed, not about what happens
   to be blank: an untouched field the app has changed its mind about *is* updated. The app stays the
   authority on everything nobody here has touched.

6. **`product_id` is ignored on push.** §6.4 rejected internal ids from the app, so the push refuses
   them rather than merely not requiring them — otherwise an app could quietly start guessing, which
   is exactly the silently-wrong-mapping failure §6.4 was avoiding. Same instinct as `OrderCreate`
   ignoring a client-supplied `unit_cost`.

7. **Stale references still need handling, and are cheaper than feared.** A draft names shop,
   warehouse and mapped products by id with no FK (HARD RULE 3), so any can be deleted underneath it.
   Most line references are now *text*, which cannot go stale — but `shop_id` / `warehouse_id` / a
   mapped `product_id` can. Proposal: resolve on load **and** re-check on promote, and name *which*
   reference died rather than returning a bare validation error.

### 6.11 Decomposition — sub-issues under #162

Revised for the third-party-push design (the original §6.9 assumed a CS person typing into the #90
form, which is no longer what happens):

1. ✅ **`order_drafts` model + migration** (#190) — both tables, the unique
   `(team_id, source, external_id)`, `touched_fields`, and `docs/database-schema.md` in the same
   commit.
2. ✅ **`OrderDraftPush`** (#191) — the third-party intake. Idempotent on the external ref,
   blanks-only merge; the granularity questions it forced are §6.10.4–6.
3. ✅ **`OrderDraftList` + `OrderDraftDetail`** (#192) — paginated (HARD RULE 9), narrowed to the
   author *on top of* the team scope. The list carries `item_count` / `unmapped_item_count` instead
   of lines, which is what §6.7's list screen needs to say how much work is left.
4. ✅ **`OrderDraftUpdate` + `OrderDraftDelete`** (#193) — the human edit path, marking fields
   touched. Every field is `optional`, so PRESENCE decides what was edited: an unset field is
   neither written nor marked, and clearing one stays expressible. The lines are sent as the
   complete desired set — an omitted line is deleted, `id = 0` adds one, and the edit deliberately
   cannot carry the scraped text.
5. ✅ **`OrderDraftPromote`** (#194) — validate, create the order, delete the draft, in one
   transaction. `OrderCreate`'s body was extracted to a shared `placeOrder` so this genuinely runs
   the same code rather than a copy. Two things it forced: an order line's `sku`/`name` must come
   from the CATALOGUE (a draft line stores only an id, and promote's request names a draft, not a
   basket) — which is also the stale-product check, since an id that resolves to nothing is a dead
   reference. **The warehouse id is still unchecked**: `team_service` has no by-id existence RPC, and
   a deleted warehouse surfaces late, as the stock pick failing.
6. **`/order-drafts` list screen** — its own route, with pruning that is easy and bulk-friendly (§6.7).
7. **Draft detail screen** — the product-mapping UI and promote. The meatiest piece: this is where
   scraped text becomes a real `product_id`, so `ProductSelect` does the work it already does on the
   #90 order form.
