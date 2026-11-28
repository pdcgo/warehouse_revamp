# Decisions — `product_context.md`

What the owner decided about [context.md](./context.md), recorded before it is acted on.
**Append-only** — the opposite lifecycle to [context_clarify.md](./context_clarify.md), which holds only
what is still open. Each entry carries what it decided, why, and the spec that makes it buildable
(RULE 8b.11).

Siblings: [balance](../balance/context_decision.md) · [analytic](../analytic/context_decision.md) ·
[project/member](../project/member_decision.md).

---

## only-a-selling-team-owns-a-catalogue

> *"warehouse cannot have own product"* (owner, 2026-09-12)

`## General.` 1 stands exactly as written: **a product belongs to a selling team, and to no other kind
of team.** A warehouse team holds stock — it never owns the catalogue entry that stock is counted
against.

```mermaid
flowchart TB
  S["selling team"] -->|"OWNS the catalogue entry"| C["product"]
  W["warehouse team"] -->|"HOLDS the units"| K["stock of that product"]
  K --> C
  W -.->|"may not own"| C
```

**Why it matters beyond the ACL.** §Pricing Behavior splits every line into *the ordering team owns this
product* → `COGS = UnitPrice`, or *another selling team owns it* → `COGS = UnitPrice + fee`. A
warehouse-owned product would be a third case, and a warehouse team places no orders — so it could never
be the *own team* of anything it owned. This decision makes that split total: every product has an owner
that can also be a buyer.

### The spec

**1. Four WRITE requests lose the two warehouse roles** — [product.proto](../../../proto/warehouse/product/v1/product.proto):

| request | roles today | roles after |
| --- | --- | --- |
| `ProductCreateRequest` | ROOT, ADMIN, TEAM_OWNER, TEAM_ADMIN, **WAREHOUSE_OWNER, WAREHOUSE_ADMIN** | ROOT, ADMIN, TEAM_OWNER, TEAM_ADMIN |
| `ProductUpdateRequest` | same | same |
| `ProductDeleteRequest` | same | same |
| `ProductRestoreRequest` | same | same |

**2. Every READ keeps them.** `ProductList`, `ProductByIds` and `ProductDetail` stay open to
`WAREHOUSE_OWNER`/`ADMIN`/`STAFF` — a packer holding a physical unit must be able to read its name. Not
owning a catalogue is not the same as not being allowed to look at one.

**3. `product.proto`'s service comment is corrected.** It currently reads *"a selling/warehouse team owns
its own catalogue"*, which is now wrong on the second word.

**4. ⚠ The ACL narrowing does NOT enforce this on its own — the handler must check the TEAM TYPE.**
Roles are granted per team and **nothing forbids granting `ROLE_TEAM_OWNER` inside a warehouse team**
(no grant path validates a role against `teams.type`). So after the four edits above, a `TEAM_OWNER` of a
warehouse team still passes the policy and still creates a product there.

```mermaid
flowchart LR
  A["drop the warehouse roles<br/>from the four write policies"] --> B{"is the rule enforced?"}
  B -->|"no"| C["ROLE_TEAM_OWNER can be held<br/>INSIDE a warehouse team"]
  C --> D["ProductCreate must check teams.type = selling"]
  D --> E["team type is team_service's data —<br/>a contract question, HARD RULE 3"]
```

**What is decided** is the business rule. **What is not decided** is how product_service learns a team's
type — it has no read path to `team_service` today, and HARD RULE 3 makes that an RPC rather than a
shared model. That successor question is open in
[context_clarify.md](./context_clarify.md#question).

---

## superseded-a-product-files-under-many-categories

> ⚠ **Superseded 2026-10-31** by [a-product-has-one-category](#a-product-has-one-category): a product has exactly one
> category. Kept as written below.

> *"categories is plural"* (owner, 2026-09-12)

`## Attribute / Field That Product Must Have` 4 is right and the schema is wrong: **a product is filed
under SEVERAL taxonomy nodes, not one.** `products.category_id` — a single `BIGINT` — becomes a link
table owned by product_service.

```mermaid
flowchart LR
  P["products — product_service"] --> L["product_categories<br/>product_id, category_id, position"]
  L -.->|"opaque id, no FK — HARD RULE 3"| C["categories — category_service"]
```

⚠ **I had recommended one node and was wrong about the direction of the risk.** My argument was that
one → many is additive later — true of the *schema* and false of the *contract*, because `buf breaking`
now runs in CI and the proto change is breaking whenever it happens. The cheap moment is therefore now,
not later, which is the opposite of what I said.

### The spec

**1. A new table, in product_service's own migrations** (HARD RULE 3):

| column | | |
| --- | --- | --- |
| `product_id` | `BIGINT NOT NULL` | |
| `category_id` | `BIGINT NOT NULL` | opaque id from category_service — **no FK** |
| `position` | `INT NOT NULL DEFAULT 0` | the order they were filed, first = primary (see the open question) |
| | `UNIQUE (product_id, category_id)` | a product files under a node once |
| | `INDEX (category_id)` | *"what is in this node"* is the read that needs it |

**Backfill and drop in the SAME migration** — one row per product with `category_id > 0`, then
`products.category_id` goes. Leaving both is two sources of truth for one fact, which is the drift the
model comment already says this project exists to avoid.

**2. Four proto sites, and the change is BREAKING** — field 7 is reserved and a `repeated` one added
beside it, rather than changing 7's cardinality in place (a singular `uint64` is a varint on the wire and
a `repeated` one is length-delimited — same number, different encoding):

| message | today | after |
| --- | --- | --- |
| `Product` | `uint64 category_id = 7` | `reserved 7` · `repeated uint64 category_ids = 14` |
| `ProductCreateRequest` | `uint64 category_id = 5`, `gt = 0` | `repeated uint64 category_ids`, `min_items: 1` |
| `ProductRowItem` | `uint64 category_id = 6` | `repeated uint64 category_ids` |
| `ProductUpdateRequest` | `optional uint64 category_id = 6` | a **`ProductCategories` wrapper**, exactly like `ProductImages` — a message field has presence, so nil = *leave alone* and present = *replace with exactly these* |

⚠ `buf breaking` fires on that commit. That is the accepted situation, not a surprise — same shape as
[breaking-the-old-protos-is-accepted](../../technical/event_architecture/context_decision.md#breaking-the-old-protos-is-accepted).

**3. ✅ Nothing FILTERS by category today**, which is most of why this is cheap: `category_id` is carried
on the row and read by nobody. `ProductList` and `ProductDiscover` have no category filter to rewrite as
an `EXISTS`. When one is added it is a subquery, not a join — a join multiplies rows per category and
silently breaks the page count.

**4. ⚠ The list read must not become N+1.** One `WHERE product_id IN (…)` for the whole page, grouped in
memory — not a lookup per row. `ProductDetail` may read its own.

**5. The picker stays SINGLE, and is not forked.** `CategorySelect` has four callers and **three of them
pick a parent node**, not a product's categories (`CreateCategoryDialog`, `EditCategoryDialog`,
`AddressPicker`). Only [product-edit](../../../frontend/src/pages/product-edit/index.tsx) files a product. So the multi-value control is a
**chips wrapper that composes `CategorySelect`** for adding and renders removable tags — the tree logic
stays in one place.

---

## the-code-is-composed-from-the-team-code

> *"composed"* (owner, 2026-09-12)

`product_code` is **globally unique** (`### Whats is \`product_code\`` 2) and the stored string is
**composed on write** from the owning team's code and the team's own part:

```
product_code = <team_code>-<the team's own code>
```

```mermaid
flowchart LR
  T["team_code — team_service"] --> C["ABC"]
  U["what the user types"] --> P["SHOE-42"]
  C --> S["stored: ABC-SHOE-42<br/>globally unique by construction"]
  P --> S
  S --> K["a scan at a rack resolves to ONE product<br/>without asking whose it is"]
```

**What it buys.** Global uniqueness stops being a namespace two teams compete for. Two teams selling one
supplier's item can both carry that supplier's code as their own part, no create is ever refused because
of another team's row, and no refusal can leak that another team holds a code.

### The spec

**1. The user types their part only.** The prefix is a static adornment in the form, not an editable
field — a user who can type the prefix can collide with another team again.

**2. The prefix is FROZEN at write time, not recomputed on read.** ⚠ Teams can be renamed
(`TeamInfoUpdate`), and a prefix recomputed from the current `team_code` would silently rewrite every
printed label a team ever produced. The composed string is stored whole, exactly as it was composed.
*(→ Recommended, not stated by the owner — say so if it should follow the team instead.)*

**3. ⚠ It needs the same cross-service read as
[only-a-selling-team-owns-a-catalogue](#only-a-selling-team-owns-a-catalogue), and that is a reason to build ONE.** Composing the code needs
`teams.team_code`, and enforcing the ownership rule needs `teams.type` — both team_service's, neither
reachable from product_service today (HARD RULE 3). One cached team read at write time serves both.
Open as [Q8](./context_clarify.md#question).

**4. The uniqueness constraint is on the composed string**, one index over `product_code`. Whether it
excludes soft-deleted rows is the still-open [Q11](./context_clarify.md#question).

🔄 *(2026-11-27, owner "A")* A team's code can now be edited, and its existing products take the new code, tagged `need_reprint_code` — the frozen prefix and the immutable team code above no longer hold: [a-team-code-change-recomposes-its-product-codes](#a-team-code-change-recomposes-its-product-codes).

---

## a-deleted-product-is-unfindable

> *"deleted product is cannot search anywhere"* (owner, 2026-09-12)

A deleted product **leaves every search surface**. It is not in `ProductList`, not in `ProductDiscover`,
not in a typeahead, and not reachable by its code.

⚠ **Recorded with its boundary, because the rule and the shipped code disagree about one case.**
`ProductByIds` — a lookup by an id the caller ALREADY HOLDS, not a search — deliberately **does** return
soft-deleted products, and its comment says why: *"stock outlives a catalogue entry, and a shelf holding a
deleted product should name it rather than show a blank."* Whether this decision overrides that is the
open [Q11](./context_clarify.md#question); the contradiction is written up in
[context_clarify.md](./context_clarify.md#a-deleted-product-is-unfindable-and-a-shelf-of-its-units-still-needs-its-name).

```mermaid
flowchart TB
  D["product deleted"] --> S["gone from every SEARCH — decided"]
  D --> I{"still resolvable by a KNOWN id?"}
  I -->|"shipped: yes"| N["a rack can still name the units it holds"]
  I -->|"the strong reading: no"| B["a rack holding those units shows a blank"]
```

---

## superseded-deleting-a-product-requires-zero-stock

> ⚠ **Superseded 2026-10-31** by [a-used-product-is-archived-never-deleted](#a-used-product-is-archived-never-deleted): a
> product that ever had stock is archived, never deleted. Kept as written below.

> *"for \"Can a product be deleted while it still has stock?\" no"* (owner, 2026-09-12)

A product **cannot be deleted while it still has stock.** `ProductDelete` checks the quantity first and
refuses — today it checks nothing, so this is a new guard, not a restatement.

```mermaid
flowchart TB
  D["delete a product"] --> Q{"any stock left?"}
  Q -->|"yes"| R["refused — and the error must say WHERE"]
  Q -->|"no"| S["deleted — and no sticker for it survives on any shelf"]
  S --> C["so re-typing its code is SAFE"]
  R --> W["the way out is a write-off or a transfer,<br/>which is inventory_service's job, not this one"]
```

**It resolves the contradiction with `ProductByIds`** — there is no longer a shelf holding a deleted
product's units, so *unfindable anywhere* and *a rack should name what it holds* stop competing
([the contradiction](./context_clarify.md#a-deleted-product-is-unfindable-and-a-shelf-of-its-units-still-needs-its-name)).

### The spec

**1. The check is cross-service and must NOT be cached.** Stock is inventory_service's, so this is an RPC
(HARD RULE 3) — and unlike the team read that
[the-code-is-composed-from-the-team-code](#the-code-is-composed-from-the-team-code) needs, a quantity served from a cache would wave
through the very delete it exists to stop.

**2. ⚠ The refusal must NAME the stock, not just refuse.** *"This product still has stock"* leaves an
operator with nowhere to go. The error carries the warehouses and quantities holding it, because the way
out — a write-off or a transfer — happens somewhere else and the person needs to know where to go.

**3. ⚠ It makes delete BLOCKABLE, and that is the accepted cost.** A product with units nobody can find
can never be archived until those units are written off. That is the correct trade — the alternative is
archiving a catalogue entry while the warehouse still physically holds it — but it means the write-off
path has to exist and be reachable, or this rule turns into a permanently stuck row.

**4. ✅ It makes code reuse SAFE, and that retires my own argument against it.** I had recommended burning
a deleted code because a re-typed one would make an old sticker scan as a new product. With zero stock
required, no sticker for a deleted product survives, so the argument falls with it. Recorded rather than
quietly dropped.

**5. ⚠ The `[code]_deleted_ts` rename is still not needed for that.** A partial unique index
(`WHERE deleted = FALSE`) frees the code without mutating a string somebody printed — and the rename
collides with itself when a code is created and deleted twice inside one `ts` tick, which fails the
**delete**. If a rename is wanted anyway, suffix the row **id**.

---

## the-couriers-ask-is-in-the-unit-price

> Owner, in chat *(2026-10-07)*: *"for 2, yes"*, confirmed as the literal question: *"should the courier's tip at the
> door be part of a batch's unit price?"* It answers [Q6](./context_clarify.md#question) **against my recommendation**
> (tip out, freight in). It was #4 of [biggest_question.md](../../biggest_question.md).

**The verdict.** §Unit Price Components stands as written. What the warehouse hands the courier at the door
(`AdditionalWarehouseFee`, the incidental ask of
[cod-fee-is-the-couriers-incidental-ask](../balance/context_decision.md#cod-fee-is-the-couriers-incidental-ask)) is
spread over the units with the freight and frozen into the batch's unit price. It is **also** still owed by the selling team, in full.

```mermaid
flowchart LR
  G["goods - the line total"] --> P["price_unit - frozen for the batch"]
  F["freight - paid by the selling team"] --> P
  T["the courier's ask - fronted by the warehouse"] --> P
  T --> D["the selling team owes the warehouse - in full"]
```

**The spec.**

| | |
| --- | --- |
| the formula | §Unit Price Components, unchanged — the same as [technical stock §COGS](../../technical/stock/design.md#cogs-price-of-stock) |
| when | at accept, inside its transaction ([accept-is-one-transaction-then-an-event](../inventory/restock_decision.md#accept-is-one-transaction-then-an-event)) — so the ask is entered at accept, before the price is computed |
| the balance | unchanged — a warehouse receivable ([the-warehouse-receivable-is-order-fee-cod-fee-and-found](../balance/context_decision.md#the-warehouse-receivable-is-order-fee-cod-fee-and-found)) |
| the arithmetic | floating point ([rupiah-is-floating-point](../order/context_decision.md#rupiah-is-floating-point)) |
| a mistyped ask | corrected by revaluing the batch — [batch.md §Change Price Flow](../inventory/batch.md#change-price-flow-example) |
| the build | already includes it — `freight := rr.ShippingCost + costLineTotal` (`restock_request_fulfill.go:206` then; ✅ *(2026-11-02)* now [restock_request_accept.go:165](../../../backend/services/inventory_service/inventory_v1/restock_request_accept.go#L165), `freight := rr.ShipmentCost + courierCharge`, and money is `float64`, so the integer division below is gone). ⚠ But `freightPerUnit` is **integer** division, so a Rp 5.000 ask over 1.000 units adds **0** — against the arithmetic row |

**What it does NOT settle:** whether the divisor is the ordered or the arrived quantity ([Q2](./context_clarify.md#question)),
and how freight and the ask split across a restock's lines — by quantity or by value
([stock Q3](../../technical/stock/design_clarify.md#question)).

---

## the-reserve-stops-other-teams-at-low-stock

> Owner, in chat (2026-10-15): *"for 1., simple stock >= reserve, for 2., it only stops other teams, and that reserved mainly
> used for. to prevent other team create order with our stock if we have few stock left"* — answering
> [Q3](./context_clarify.md#question), *what is the reserve, and does it bind the owner's own orders?* Binding only other
> teams is as recommended; the boundary is **against** my `stock − wanted ≥ reserve`. Earlier the same day: the stock is
> the total across every warehouse, checked by inventory before its take
> ([the-reserve-is-read-before-the-take](../inventory/order_decision.md#the-reserve-is-read-before-the-take)).

**The verdict.** The reserve is a **low-stock line**, not a floor. While the product's total stock is at or above it,
another team may borrow; once it is below, only the owner may sell. The quantity wanted is not part of the test, and the
owner's own orders are never stopped by it. It exists so that when the owner is down to its last few units, those units
go to its own orders.

```mermaid
flowchart LR
  L["a line on another team's product"] --> Q{"owner's total stock at or above the reserve?"}
  Q -->|"yes"| A["allowed - whatever the quantity"]
  Q -->|"no"| N["Product Not Allowed"]
  O["a line on the team's own product"] --> Y["allowed - the reserve never applies"]
```

**The spec.**

| | |
| --- | --- |
| the test | `total stock ≥ reserve` — allowed; below it, refused |
| total stock | the product's stock in every warehouse ([the-reserve-is-read-before-the-take](../inventory/order_decision.md#the-reserve-is-read-before-the-take)) |
| the quantity wanted | not counted — stock 11, reserve 10, a borrowed 5 is allowed and leaves 6 |
| who it stops | other teams only; the owner sells its own stock to zero |
| who sets it | the selling Owner and Admin ([the-selling-owner-and-admin-set-markup-reserve-and-lock](../user/context_decision.md#the-selling-owner-and-admin-set-markup-reserve-and-lock)) |
| where it is checked | inventory's take, before its transaction ([the-take-checks-the-product-first](../inventory/order_decision.md#the-take-checks-the-product-first)) |

**What it costs — accepted.** A borrowed order can end below the reserve — by its own quantity, or by another borrower's in
the same moment. The line stops the **next** borrower, not this one.

## exactly-the-reserve-stays-open

> Owner, in chat (2026-10-31): *"follow your recomendation"* — answering [Q13](./context_clarify.md#question), *at
> exactly the minimum, may another team still order?* Yes, as recommended — which reversed my own earlier ≤ in the clarify.

**The verdict.** A product whose total stock is **exactly** its reserve is still **open** to other teams; it closes only
**under** it. This keeps [the-reserve-stops-other-teams-at-low-stock](#the-reserve-stops-other-teams-at-low-stock)'s
`total stock ≥ reserve` and [context.md](./context.md) §Cross/Shared Products Rule 1 (*"when stock < several, its cannot
be shared"*) as written, and the screens follow them.

**Why.** The reserve is a low-stock **line**, not a floor — the quantity wanted is not counted, so a borrower at 20 against
20 may take 15 and leave 5 either way. *"The minimum is what the owner keeps"* was the floor argument again, and it is the
one the line already refused.

```
reserve 20      total 19 → closed      total 20 → OPEN      total 21 → open
```

| | |
| --- | --- |
| the test | `total stock ≥ reserve` — open; `<` — closed. Unchanged |
| the order take | already `>=` ([order_transaction_create.go](../../../backend/services/inventory_service/inventory_v1/order_transaction_create.go)) — unchanged |
| the screens | `lockedByMinimumNow` ([ProductLock.tsx](../../../frontend/src/features/products/ProductLock.tsx)) goes from `<=` back to `<` — the **Terkunci** badge on the product list and the product's page, and Discover's **Kunci** filter, which reads the same comparison |
| what it replaces | the screens' [superseded-the-minimum-closes-at-the-minimum](../../technical/frontend/products_decision.md#superseded-the-minimum-closes-at-the-minimum) (≤, 2026-10-30) |

**What it resolved** (HARD RULE 11): the clarify's contradiction *the screens close a product at its minimum, the business
rule opens it there* — the badge said *Terkunci* on a product the take still let another team order.

```mermaid
flowchart LR
  R["exactly-the-reserve-stays-open - at the reserve, open"] --> T["the take, total at or above the reserve - already so"]
  R --> S["the badge and the Kunci filter, closed only under it - changed"]
  R -.->|"left for its own pass"| C["Discover detail Bisa Anda ambil - the shelf less the reserve, a floor reading, still pending"]
```

⚠ **Left standing:** Discover detail's *can take* column subtracts the reserve from each shelf
([product-discover-detail/index.tsx](../../../frontend/src/pages/product-discover-detail/index.tsx), pending `canTake`) —
a floor reading of what is a line. It was already marked an unsettled rule and is not changed by this.

## superseded-a-delete-waits-until-nothing-needs-the-product

> ⚠ **Superseded the same day** by [a-used-product-is-archived-never-deleted](#a-used-product-is-archived-never-deleted) —
> the owner: *"im rethink its lead to over enginered"*. Kept as written below.

> Owner, in chat (2026-10-31): *"yes, i follow your recomendation"* — answering [Q11](./context_clarify.md#question),
> *does "zero stock" mean zero on hand, or no references at all?* As recommended.

**The verdict.** [deleting-a-product-requires-zero-stock](#superseded-deleting-a-product-requires-zero-stock)'s *"zero stock"*
means **nothing on hand AND nothing on the way**: a product is deleted only when no shelf holds it, no restock is still
bringing it, and no order that carries it is unfinished. A shelf can be empty while units are still coming to it, and
those units need the product exactly as much as a full shelf does.

| SKU-1, 0 on the shelf, and… | the delete |
| --- | --- |
| a restock of 50 arriving tomorrow | **refused** — *"restock #812 is still coming"* |
| 2 units shipped, the order not finished | **refused** — *"order #5521 is still open"* |
| nothing on the way | deleted |

```mermaid
flowchart LR
  D["delete SKU-1"] --> S{"on any shelf?"}
  S -->|"yes"| R1["refused - where it is"]
  S -->|"no"| T{"a restock still coming?"}
  T -->|"yes"| R2["refused - which restock"]
  T -->|"no"| O{"an unfinished order carries it?"}
  O -->|"yes"| R3["refused - which order"]
  O -->|"no"| OK["deleted"]
```

**The spec.**

| | |
| --- | --- |
| on hand | any unit of it on any shelf, every warehouse — inventory's count |
| a restock still coming | a restock with a line of it, still `ONGOING` or `ARRIVED` — on its way, or in the building and not yet counted |
| an unfinished order | an order with a line of it, of **any** team — a borrowed line names the owner's product — whose status is not finished |
| finished | `CANCEL`, `LOST`, `RETURN_COMPLETED` are terminal. ⚠ **`COMPLETED` is open** — it can still become a `RETURN` ([order_transition.go](../../../backend/services/selling_service/selling_v1/order_transition.go)), asked in [Q14](./context_clarify.md#question) |
| the reads | inventory (stock, restocks) and the order side (open orders) — RPCs, **never cached**, as [deleting-a-product-requires-zero-stock](#superseded-deleting-a-product-requires-zero-stock) already says |
| the refusal | names every blocker — where the stock is, which restock, which order — so the person knows what to finish first |
| a bundle | never blocks — a deleted product leaves its bundle line unavailable ([a-borrowed-product-never-blocks-its-owner](./product_bundle_decision.md#a-borrowed-product-never-blocks-its-owner)) |

⛔ **Not built.** [product_delete.go](../../../backend/services/product_service/product_v1/product_delete.go) checks nothing
today.

## a-used-product-is-archived-never-deleted

> Owner, in chat (2026-10-31): *"im rethink its lead to over enginered, what about product just can be deleted if there is
> no stock, order and other ops before. and if its happen, product only can be archived and unarchived"*, then *"yes"*
> to *"can a product be archived while it still has stock on a shelf?"*. The owner's own design, against my
> [superseded-a-delete-waits-until-nothing-needs-the-product](#superseded-a-delete-waits-until-nothing-needs-the-product).

**The verdict.** Two actions, split by whether the product has a **history**:

```
never used — a typo, a duplicate   → Delete     gone for good; its code is free again
has any history                    → Archive    out of lists and pickers; Unarchive brings it back, same id and code
```

**Delete** strands nothing, because nothing ever pointed at the product. **Archive** needs no guard, because it can be
undone: it stops anything NEW from using the product, while everything already on its way still lands. This replaces
both earlier delete rules — there is no "is that order finished yet" to answer, and no [Q14](./context_clarify.md#question).

```mermaid
flowchart LR
  P["a product"] --> H{"ever in a stock movement, an order line or a restock line?"}
  H -->|"never"| D["Delete - the row is gone, the code is free"]
  H -->|"yes"| R["Delete refused - archive it instead"]
  P --> A["Archive - any time, even with stock on a shelf"]
  A --> U["Unarchive - same id, same code"]
```

**The spec.**

| | |
| --- | --- |
| history | any stock movement of it (restock, transfer, count, adjustment, order take), any order line of it in any team's order — a borrowed line names the owner's product — and any restock line of it, ever. Read from inventory and the order side at delete time |
| Delete | only with no history; the product's row and its own data go. Refused otherwise, the refusal pointing at Archive |
| Archive | any time, **even with stock on a shelf** — out of the product list and every picker, so no new order, restock or transfer takes it |
| what is on its way | still lands: an open order ships, a restock is accepted, a return comes back — on the archived product |
| an archived product, read by id | resolves, with its name and an archived mark — a shelf, an old order and a report all still name it ([Q12](./context_clarify.md#question)) |
| the archive page | lists and searches archived products, and offers **Unarchive** ([the-archive-is-a-page-of-its-own](../../technical/frontend/products_decision.md#the-archive-is-a-page-of-its-own)) |
| the code | an archived product **keeps** its code, so Unarchive needs nothing; a deleted one frees it. No `[code]_deleted_ts` rename |
| a bundle | an archived or deleted product leaves its bundle line unavailable, as before ([a-borrowed-product-never-blocks-its-owner](./product_bundle_decision.md#a-borrowed-product-never-blocks-its-owner)) |

**What it replaces** (HARD RULE 11):

| was | now |
| --- | --- |
| [superseded-deleting-a-product-requires-zero-stock](#superseded-deleting-a-product-requires-zero-stock) — no delete while stock is left | a product that ever had stock has history, so it is archived, never deleted |
| [superseded-a-delete-waits-until-nothing-needs-the-product](#superseded-a-delete-waits-until-nothing-needs-the-product) — on hand, restocks, unfinished orders | one question, *ever used?* |
| [a-deleted-product-is-unfindable](#a-deleted-product-is-unfindable) — *"not in ProductList"* | an ARCHIVED product is out of the list and the pickers, and on the archive page; a deleted one is gone |
| [context.md](./context.md) line 26 — *"the code is updated to `[code]_deleted_ts`"* | stale — reported in the clarify's [the-doc-renames-the-code-of-a-product-it-only-archives](./context_clarify.md#the-doc-renames-the-code-of-a-product-it-only-archives) |

**Built today, and what changes.** Today's **Delete** is already a soft delete (`deleted = true`) and the archive page
already has **Restore** — that IS archive under another name. ✅ **Built 2026-11-02:**

| | |
| --- | --- |
| the contract | `ProductArchive` / `ProductUnarchive` (yesterday's Delete / Restore) and a new `ProductDelete`; `Product.archived`, was `deleted`, same field numbers |
| the column | `products.archived`, renamed from `deleted` (product migration `00007`) — a row that is merely archived no longer says "deleted" |
| the history | asked at the delete, under the product row's lock: inventory's restock lines and problem units, batches, placements and their log, stock transactions, transfer lines and problem units, warehouse registrations; selling's order lines (any team's), draft lines, return maps. Each service answers for its own rows through a plain function; the composition root joins them (`product_history.go`) |
| ⚠ my build detail — a bundle | a product a bundle still names is refused too: the line holds it by a foreign key, and taking it out of the bundle is the owner's choice, never a side effect |
| ⚠ my build detail — where Delete is | the Archived view (beside Unarchive) and an archived product's own page — a typo is archived, then deleted. The active list keeps its two inline actions |
| the code | unchanged by this build; [the-field-is-product-code-composed-on-write](#the-field-is-product-code-composed-on-write), built the same day, made it `product_code`, unique over every row |
| tests | delete of a never-used product (active or archived) and its code freed; a used one, a bundled one and another team's refused; the real history adapter against inventory's and selling's tables; the `DeleteRemovesOnlyANeverUsedProduct` story |

## a-product-has-one-category

> Owner, in chat (2026-10-31): *"product just have 1 category"* — to [Q9](./context_clarify.md#question), *with several
> categories, which is the primary, and how many may a product have?* It reverses the owner's own *"categories is
> plural"* (2026-09-12), [superseded-a-product-files-under-many-categories](#superseded-a-product-files-under-many-categories).

**The verdict.** A product is filed under **exactly one** category — a node anywhere in the category tree. There is no
primary to choose and no cap to set: the one category IS the breadcrumb, the card's label and the report's group.

```
SKU-1   Fashion › Kaos      ← its one category: the breadcrumb, the card, the report group
```

```mermaid
flowchart LR
  P["products - category_id, one"] -.->|"opaque id, no FK - HARD RULE 3"| C["categories - category_service"]
  L["product_categories - a link table"] -.->|"not built, now not wanted"| X["dropped"]
```

| | |
| --- | --- |
| the column | `products.category_id`, one `BIGINT` — as built today |
| required | yes, on create and update, as today (`category_id` > 0 in the proto) |
| the link table | `product_categories` is **not** built — the decided migration is cancelled |
| the proto | unchanged — `category_id` stays singular; no `repeated` |
| the category screen's product count | a count of products by their one `category_id`; whether a branch includes its sub-categories stays the screen's question |
| ✅ built | nothing to build — this is what runs today |

**What it replaces** (HARD RULE 11): [superseded-a-product-files-under-many-categories](#superseded-a-product-files-under-many-categories);
and [context.md](./context.md) line 16, *"4. `categories`"*, is now stale — reported in the clarify's
[the-field-list-says-categories](./context_clarify.md#the-field-list-says-categories).

## the-product-writes-drop-the-warehouse-roles

> Owner, in chat (2026-10-31): *"yes"* — to [Q8](./context_clarify.md#question), *how does product_service make sure only a
> selling team owns products?*, on my recommendation to build the narrowing [only-a-selling-team-owns-a-catalogue](#only-a-selling-team-owns-a-catalogue)
> already decided, and nothing more. Against my first recommendation, a team-type read at write time.

**The verdict.** No warehouse role may write a product. `ProductCreate`, `ProductUpdate`, `ProductDelete` and
`ProductRestore` drop `ROLE_WAREHOUSE_OWNER` and `ROLE_WAREHOUSE_ADMIN`. That is the whole enforcement: a selling role is
held only inside a selling team, so a team-scoped product write can only land in a selling team. No team-type read is
added.

| who | may write a product into… |
| --- | --- |
| a selling owner / admin | their selling team — the only kind of team a selling role exists in ([member_rules.go](../../../backend/services/user_service/user_v1/member_rules.go)) |
| a warehouse owner / admin | nothing — refused by the policy |
| root / administrator | any team — the bypass every team-scoped write has |

```mermaid
flowchart LR
  W["a warehouse owner"] -.->|"refused - the policy has no warehouse role"| P["ProductCreate"]
  S["a selling owner"] -->|"scope is always a selling team"| P
  R["root"] -->|"bypasses the scope, as everywhere"| P
```

| | |
| --- | --- |
| the writes | Create, Update, Delete, Restore: `ROOT`, `ADMINISTRATOR`, `SELLING_OWNER`, `SELLING_ADMIN` |
| the reads | List, Detail, ByIds keep the warehouse roles — a warehouse sees the products it stocks |
| the screen | unchanged — the products page already gives a warehouse no create, archive or figures |
| accepted | root may still file a product under a warehouse team; it is trusted, as for every other write |
| ✅ built *(2026-10-31)* | [product.proto](../../../proto/warehouse/product/v1/product.proto); pinned by `TestProductWrites_AreTheSellingTeamsAlone` ([product_writes_selling_only_test.go](../../../backend/services/user_service/access_interceptors/product_writes_selling_only_test.go)), which fails eight ways on the old policy |

## a-lock-stops-new-orders-only

> Owner, in chat (2026-10-31): *"i follow your recomendation"* — to [Q4](./context_clarify.md#question), *does turning the
> shared lock on affect orders already placed?* As recommended.

**The verdict.** A lock — the owner's *always locked*, or a minimum it falls under — stops **new** orders from other
teams. An order another team placed before the lock goes on: its units were taken when it was placed. A lock says *do
not sell me any more*, never *take back what is sold*.

```
Mon 10:00  Team B orders 5 of SKU-1 → stock taken
Mon 14:00  the owner locks SKU-1
           → Team B's order goes on; Team C's new order is refused
```

| | |
| --- | --- |
| where the lock is read | at the take, when an order is placed ([order_transaction_create.go](../../../backend/services/inventory_service/inventory_v1/order_transaction_create.go)) |
| an order already placed | untouched — picked, shipped and finished as usual |
| ✅ built | nothing changes — this is what runs |

## the-field-is-product-code-composed-on-write

> Owner, in chat (2026-10-31): *"yes"* — to [Q7](./context_clarify.md#question), *should `sku` become `product_code`,
> composed on write as `ABC-SHOE-42`, as your doc says?* As recommended — the second time; I had first recommended
> keeping `sku` beside it.

**The verdict.** A product has **one** code, named **`product_code`**, as [context.md](./context.md) names it. It is
**composed on write** ([the-code-is-composed-from-the-team-code](#the-code-is-composed-from-the-team-code)): the team
types its own part, and what is stored — on the sticker, at the scan, everywhere — is `<team_code>-<that part>`.
`sku` goes, from the wire, the database and the code.

```
team ABC types   SHOE-42
stored           product_code = ABC-SHOE-42      globally unique, one code everywhere
```

```mermaid
flowchart LR
  T["team_code ABC - team_service, immutable"] --> C["product_code ABC-SHOE-42"]
  U["what the team types - SHOE-42"] --> C
  C --> S["the sticker, the scan, every screen"]
```

| | |
| --- | --- |
| the field | `product_code`, replacing `sku` in the proto, the `products` table, Go and TypeScript |
| composed | `<team_code>-<the team's part>`, on create, by product_service — `team_code` read from team_service; it is immutable, so a composed code never goes stale |
| unique | **globally**, every row — an archived product keeps its code ([a-used-product-is-archived-never-deleted](#a-used-product-is-archived-never-deleted)), so today's partial index (`WHERE deleted = FALSE`, per team) becomes one unique index over all rows |
| freed | only by a Delete, which removes a never-used product's row |
| the form | the team prefix shown fixed, the team typing the rest |
| ⚠ my spec — editing it | the team's part may be corrected only while the product has no history, the same line Delete uses — once a sticker can exist, the code is fixed |
| ⚠ my spec — today's rows | dev data only: re-entered, or recomposed once by a `san` command that reads each team's code through team_service — no migration reads another service's table (HARD RULE 3) |
| the screen | already says *Product code* ([the-screen-says-product-code](../../technical/frontend/products_decision.md#the-screen-says-product-code)) |

✅ **Built 2026-11-02:**

| | |
| --- | --- |
| the contract | `product_code` replaces `sku` on `Product`, `ProductRowItem`, the order, restock, transfer, batch and opname lines (same field numbers); `ProductCreateRequest.product_code_part` and `ProductUpdateRequest.product_code_part` carry the team's part; the sort is `PRODUCT_ROW_SORT_PRODUCT_CODE`; `ProductUnarchiveRequest` lost its code (field 3 reserved) |
| the columns | `products.product_code` (product `00008`), `order_items.product_code` (selling `00032`), `restock_items.product_code` and `warehouse_transfer_items.product_code` (inventory `00033`) — each renamed in its own service |
| unique | `products_product_code_unique`, over every row, replacing `(team_id, sku) WHERE archived = FALSE` |
| composed | by ProductCreate: `<team_code>-<part>`, the team code read from team_service through `product_v1.TeamCodes` — TeamByIds asked as the caller ([product_team_codes.go](../../../backend/cmd/app_development/product_team_codes.go)) |
| a correction | ProductUpdate re-composes the part under the row's lock, only when the history reader says there is none; FailedPrecondition otherwise |
| Unarchive | takes no code and cannot collide — the restore-conflict dialog is gone |
| the form | the team code an addon in front of the field, the box takes the part; an untouched part is not sent |
| today's rows | [`san product recompose-codes`](../../tools/san.md#product-recompose-codes), the team codes read through team_service's TeamByIds handler; `dev setup` runs it |
| ⚠ my build detail — the part is trimmed | `" SHOE-42 "` composes as `ABC-SHOE-42`; a part of only spaces is InvalidArgument |
| ⚠ my build detail — the same part is no correction | ProductUpdate with the part the product already has changes nothing and is not refused, so a form that always sends it can still save a used product's name |
| ⚠ my build detail — shared codes before the index | `00008` suffixes `-<id>` onto every row but the oldest of a code two rows shared (an active and an archived product of one team, or two teams), so the global index can be built on any dev database |
| ⚠ my build detail — line limits | an order line's and a restock line's `product_code` take up to 75 characters — a team code (10), the dash, the part (64) |
| ⚠ my build detail — dev setup | runs the recompose after the supplier steps; it changes nothing on a database already recomposed |
| ⚠ my build detail — a team code with a dash | `AB` + `C-1` and `AB-C` + `1` compose alike; the index refuses the second as AlreadyExists, and the recompose refuses it with both named |
| tests | create composes, trims, refuses a blank part, a team with no code and a missing reader; an archived product's code stays taken; the same part in two teams is two codes; a correction of a never-used product lands, of a used one is refused with nothing else landing, the same part is no correction, a taken one is AlreadyExists; Unarchive keeps the code; the recompose (once, idempotent, a collision writes nothing) in `product_v1` and through team_service in `tools/san`; the stories `TheTeamsCodeStandsInFront`, `AUsedProductsCodeIsFixed`, `ATakenCodeIsSaidUnderTheCode`, `UnarchiveComesBackUnderTheCodeItKept` |

🔄 *(2026-11-27, owner "A")* A team's code can now be edited, and its existing products take the new code, tagged `need_reprint_code` — the frozen prefix and the immutable team code above no longer hold: [a-team-code-change-recomposes-its-product-codes](#a-team-code-change-recomposes-its-product-codes).

## the-shared-lock-is-cross-locked

> Owner, in chat (2026-11-02): *"i follow your recomendation"* — confirming the overtaken list, which named [Q10](./context_clarify.md#question), *is `is_private`
> the shared lock, or a second switch?*

**The verdict.** There is no `is_private`. The one switch that keeps a product from other teams is **`cross_locked`**,
one setting with three ways ([one-lock-three-ways](../../technical/frontend/products_decision.md#one-lock-three-ways)).
Nothing in the proto, the services or the screens carries `is_private`.

```
is_private      nowhere — not in the proto, the schema or the screens
cross_locked    the product's one sharing lock
```

| | |
| --- | --- |
| ✅ built | nothing changes |

---

## produk-turunan-is-the-return-map

> Owner (Heri), in `revamp_dev`'s desktop chat (2026-11-27): *"A"*, **as recommended** — to: is *Produk Turunan* the return map? On the product page and the Discover detail the section still shows sample rows (`features/products/derivedSample.ts`). The owner had written *"produk turunan (retur)"* ([the-warehouse-picker-splits-the-page](../../technical/frontend/products_decision.md#the-warehouse-picker-splits-the-page)) and *"barang yang retur ke team beda team, tapi masalah lain bisa jadi yang sekarang itu juga turunan"*. A: yes — build it from the return maps, both ways, as the accepted section draws it: *Turunan dari* the product this one was mapped from, *Turunannya* every team's own product mapped from this one, with team, SKU and ready stock — one new read across teams, because today's read hides other teams' maps; B: the owner defines *turunan* differently first, and both sections stay samples until then.

**The verdict.** *Produk Turunan* is the **return map** ([a-return-map-is-written-once](../order/context_decision.md#a-return-map-is-written-once), `product_return_maps`): when team A sells team B's product and it comes back, A's map names the own product it lands on. A product's derived products are read from those maps, in both directions, across teams.

| | |
| --- | --- |
| *Turunan dari* | the product(s) this product was mapped FROM — the maps whose `own_product_id` is this product (its owner team's maps): the other team's product, its team and SKU |
| *Turunannya* | every team's own product mapped from this one — the maps whose `shared_product_id` is this product, **any team's**: that team, the product's SKU and its **ready stock** (pcs, as [the-warehouse-zone-is-tabs](../../technical/frontend/products_decision.md#the-warehouse-zone-is-tabs) draws it — the count, the first three, *Lihat Semua (N)*) |
| who sees it | where the accepted design draws the section: the product's own page (its owner team) and the Discover detail ([the-discover-detail-shows-no-markup](../../technical/frontend/products_decision.md#the-discover-detail-shows-no-markup): *"produk turunan juga ditampilkan"*) — a warehouse role is refused, as Discover is |
| what stays | the order form's read (`ProductReturnMapByIds`) stays team-scoped — *"another team's map of the same product is never seen"* is still true THERE; the new read is a separate one. A map is still written once, at the confirmed pick |
| the screens | no new design: real rows go into the slots the accepted section already draws, and the `derived` sample marks go with `derivedSample.ts` |

⛔ Not built — backlog #140.

✅ Built 2026-11-27 (#140) — `TeamReturnConfigurationService.ProductDerivedList` (selling; Discover's policy, a warehouse role refused; `NO_SIDE_EFFECTS`) reads one product's maps both ways across teams — the newest 200 a direction, with its total — and the product page and the Discover detail name them with the reads they already make: ProductByIds, TeamByIds, DiscoverStockByIds (`useProductDerived`, asked from the address beside the product's own read). *Turunan dari* draws one line per map: the write lets a team land several borrowed products on one own product (the map is unique on its source only), so each is its own line in the same style. `derivedSample.ts`, both `derived` marks and the product page's now-empty pending list are gone; `ProductReturnMapByIds` is unchanged. Both directions seek an index — selling `00056` adds `(shared_product_id)` and `(own_product_id)` under [a-pure-index-is-added-without-asking](../../technical/architecture/context_decision.md#a-pure-index-is-added-without-asking) (≈7.9 → 1.0 ms at 50 000 maps, [the audit](../../../audits/services/selling_service/performances/ProductDerivedList.md)).

---

## a-team-code-change-recomposes-its-product-codes

> Owner (Heri), in `default`'s desktop chat (2026-11-27): *"A"*, **as recommended** — to: when a team's code changes from ABC to XYZ, what happens to its old products' codes? A: the code follows the new team code (ABC-SHOE-42 → XYZ-SHOE-42), and the product is tagged `need_reprint_code` until its sticker is reprinted; B: old products keep ABC-SHOE-42 and only get the tag, new products get XYZ; C: something else. Asked while recording his new acceptance scenarios — *"edit team code"* (root, on the root team) and *"edit team code in setting"* (the selling owner or admin, on their own team), each with the thens *"team code edited succesfully"* and *"old product have tag "need_reprint_code""*.

**The verdict.** A team's code **can be edited**, and the team's existing products **take the new code**: `<old team code>-<part>` becomes `<new team code>-<part>`, and each of them is tagged **`need_reprint_code`**, since its printed sticker no longer matches its code.

```
team code      ABC  →  XYZ
its product    ABC-SHOE-42  →  XYZ-SHOE-42   tagged need_reprint_code
```

| | |
| --- | --- |
| reverses | the team code being fixed after create — [the-code-is-composed-from-the-team-code](#the-code-is-composed-from-the-team-code) spec 2 (*the prefix is frozen at write time*, my recommendation, never the owner's words) and [the-field-is-product-code-composed-on-write](#the-field-is-product-code-composed-on-write) (*"it is immutable, so a composed code never goes stale"*) |
| who edits it | as his acceptance rows for *edit team code* name it (being written, `docs/acceptances/`) |
| *(Not asked)* | an archived product; the codes already copied onto order, restock and transfer lines; scanning an old sticker before it is reprinted; what clears the tag; a new code another team already holds |

⛔ Not built — backlog #141.

🔄 *(2026-11-27, minutes later)* **Settled in chat — past lines keep their code.** Owner: *"A"*, as recommended — to: when a team code changes, what do past order and restock lines show? A: they keep the code they were written with — a past line records what was sold or received — and the product page shows the new code; B: they show the new code too. So the codes copied onto order, restock and transfer lines are **not** rewritten; only the product itself takes the new code.

🔄 *(2026-11-27)* **Settled in chat — an old sticker scanned before the reprint.** Owner (Heri), `revamp_dev`'s desktop chat: *"A"*, as recommended — to: Toko ABC becomes XYZ at 10:00, Gudang Pusat has not reprinted, and at 11:00 a new order for XYZ-SHOE-42 is picked from a unit still wearing the ABC-SHOE-42 sticker. A: the old sticker still counts as the product until it is reprinted — scanning and the product search also know a product's former codes, so picking never stops; the old team code stays taken (Create Team and a later edit refuse ABC as *already exists*), so ABC-… can only ever mean this team's product; B: the old sticker is refused from the change, picking stops until the reprint, ABC free at once; C: it counts only on orders placed before the change. **The verdict:** a product's **former codes** still find it — the pick page's scan (ItemScan, the custom-shipment pick too) and the product search match the line's code, the live code and every former code of the same product — and a team code once used is **never given to another team** (a former code stays taken). Built with backlog #149 (the former codes kept) and #152 (the scan and search).

✅ Built 2026-11-27 (#149, the backend) — team_service `TeamCodeUpdate` (its own RPC: Root, Administrator, the team's Selling Owner and Admin; a selling team only, else FailedPrecondition): a code another team holds or EVER held is refused AlreadyExists with a `TeamCodeTaken` detail naming that team (TeamCreate refuses a former code too); the team's own former code may be taken back; the old code is kept in team_service `00011` `team_former_codes`. In the SAME transaction, handed across the seam, product_service recomposes every product under `<old>-` — archived ones too — set-based under the team's product-code advisory lock (ProductCreate and a code correction take it first now), writes each one's `code_changed` line to product `00011` `product_logs` (read by the new `ProductLogList`, paged, the owning team's roles + Root / Administrator), and tags `need_reprint_code` only the products some warehouse holds units of on a shelf now, with one `product_reprint_waits` row per such warehouse (inventory's new `StockSitsAmong`, read in the same transaction); a product on no shelf takes the new code untagged. Past order, restock and transfer lines are untouched. `san product recompose-codes` leaves a code under a former team code alone; `san seed` finds a team by a code it held once. Team rpc.md *TeamCodeUpdate*, product rpc.md *The team code change*, database-schema.md. Race tests green (`product_code_recomposer_race_test.go`); 🟡 heavy at volume — 50 000 products 6.3–8.1 s, over the 1 s target ([the audit](../../../audits/services/product_service/performances/TeamCodeUpdate.md)). The screens are #150; the scan by former codes #152.

✅ Built 2026-11-27 (#150, the screens) — the team code edit is live on screen: Settings' **Kode tim** card (a selling team only; editable by the selling Owner / Admin, Root and the Administrator; read-only for CS and a monitor; no card for a warehouse or admin team) and root's **Edit Team** code field for a selling team (an untouched code is never sent; a warehouse / admin team keeps the fixed line), both through the four-line confirm, whose figures come from the new `NO_SIDE_EFFECTS` read team_service `TeamCodePreview` (TeamCodeUpdate's policy and scope) read when Save opens it, never on a page load: SAME for the team's own code, TAKEN / FORMER naming the team that holds or held it, else how many products take the new code (archived too), one example old → new (an active product first) and the names of the warehouses holding their stock on a shelf — product_service's `PreviewTeamRecompose` through the #149 seam (`ProductCodeRecomposer.PreviewTeamCodes`) and inventory's `StockSitsAmong`. A code another team takes between the preview and Change Code is refused from the write's `TeamCodeTaken` detail. A save re-reads the team's reads and the products' (`key.teams`, `key.products`, `key.inventory`). The product page's **Riwayat Produk** card reads `ProductLogList`. Team rpc.md *TeamCodePreview*; 🟡 heavy by the audit's thresholds — 50 000 products 220–250 ms, 6 statements ([the audit](../../../audits/services/team_service/performances/TeamCodePreview.md)). The reprint (*Cetak ulang kode*, its page, the tag coming off) is #151; scanning former codes #152.

✅ Built 2026-11-27 (#151) — the tag lasts until the sticker is reprinted: each warehouse holding the product prints its new labels on **Cetak Ulang Kode**, and `need_reprint_code` comes off after the last (products-have-their-own-tag-list, its ✅ #151 line). A restock's **Cetak Label** now prints the product's LIVE code — the restock line keeps the code it was written with (past lines keep their code), the label reads the product's code now (`RestockRequestLabels` through the product reader).

✅ Built 2026-11-27 (#152) — a former code still finds the product: `ProductService.ProductCodesByIds` (the live code and the former codes from `product_logs`, newest first; ids the caller may not see left out — the `ProductTagsByIds` rule); the pick scan (ItemScan — the order pick page and the custom-shipment pick) matches a scanned code, trimmed, any case, WHOLE, against the line's code, the product's live code and every former code, read once per page beside `StockPickLocations`; the seller's and the warehouse's product search find a product by a former code typed exactly. Product `00012` adds the pure index `product_logs (lower(old_code))` ([a-pure-index-is-added-without-asking](../../technical/architecture/context_decision.md#a-pure-index-is-added-without-asking): the list count 53 → 18 ms at 50 000 history lines). Other scans (labels, handover, find parcel, return receive) take no product code and are unchanged; the line-copy searches (custom shipments, opname, restock and transfer lists) keep matching the code on the line.

---

## products-have-their-own-tag-list

> Owner (Heri), in `default`'s desktop chat (2026-11-27): *"A"*, **as recommended** — to: the `need_reprint_code` tag of [a-team-code-change-recomposes-its-product-codes](#a-team-code-change-recomposes-its-product-codes) needs tags on products, which do not exist; A: product tags work as the order and restock tags do — system tags plus custom tags any user can make, and the Products list filters by tag; B: only system tags for now (just `need_reprint_code`), custom product tags later. He had put it as *"build product tag feature"*.

**The verdict.** Products get **a tag list of their own**, as orders and restocks have theirs ([orders-have-their-own-tag-list](../order/context_decision.md#orders-have-their-own-tag-list)), under the same rules ([custom-tags-are-shared-system-tags-are-the-admins-and-the-apps](../inventory/restock_decision.md#custom-tags-are-shared-system-tags-are-the-admins-and-the-apps)): a tag is `system` or `custom`, a custom tag is made and used by any user who may write on the product, system tags and renaming or deleting a tag are the admins', and the **Products list filters by tag**. The first app-owned system tag is **`need_reprint_code`**, put on by the team code change.

*(Not asked — who sees a product's tags beyond its own team (the warehouse, other teams on Discover Product), and what takes `need_reprint_code` off.)* ⛔ Not built — backlog #141.

🔄 *(2026-11-27)* **Settled in chat — who sees a product's tags.** Owner: *"A"*, as recommended — A: the team that owns the product and every warehouse holding its stock (the warehouse prints and sticks the labels — *Cetak Label*, one per placement), as order tags are seen by the selling team and the warehouse that ships ([orders-have-their-own-tag-list](../order/context_decision.md#orders-have-their-own-tag-list)); other teams on Discover Product see no tags; B: the owning team only; C: everyone, Discover included.

🔄 *(2026-11-27)* **Settled in chat — what takes `need_reprint_code` off.** Owner: *"A"* (the same one-letter answer as above, read as A for both questions), as recommended — A: the app, once the new labels are printed — with stock in several warehouses, the tag stays until each of them has printed; this needs a NEW print, of the tagged products' placements, opened from the warehouse's Products list (labels print per restock only today), as the order label's *Cetak ulang label* clears on the recorded print ([a-changed-label-asks-the-warehouse-to-reprint](../inventory/order_decision.md#a-changed-label-asks-the-warehouse-to-reprint)); B: the owning team's owner or admin removes it by hand; C: the app removes it once no stock is left anywhere.

✅ Built 2026-11-27 (#147, the backend) — product_service migration `00010`: `product_tags` (the products' own list — unique on `lower(name)`, trimmed and space-folded, `system` / `custom`, `app_task` on a system tag only; `need_reprint_code` seeded, `app_task` `product.code.reprint`, locked for everyone) and `product_tag_links` (product, tag, who / when; `product_tag_links_tag_idx`), database-schema.md. `product_tag.proto` + eleven RPCs on `ProductService` — the order tags' ten (`ProductTagList` / `ManageList` / `Create` / `SystemCreate` / `Rename` / `Delete` / `Add` / `Remove`, `ProductSystemTagAdd` / `Remove`: custom tags by the product's writers — ProductUpdate's roles — on the owning team's products, archived or not; system tags, rename and delete by Root and the Administrator; the app's tag by nobody) and `ProductTagsByIds` (the warehouse product page: the team's own products and, for a warehouse, the ones it holds — through the new `StockNarrower.HeldAmong` over inventory's batches; anything else absent). `Product.tags` on ProductDetail, `ProductRowItem.tags` on ProductList, `tag_ids` (ANY of) on ProductList — Discover refuses it and carries no tags; the warehouse's Products list (`WarehouseStockList`) carries each row's tags and the same filter through `ProductReader.Search` → `SearchAmong`, the picker neither. Product rpc.md *Product tags*, inventory rpc.md. Policy, race (`product_tags_race_test.go`) and perf (`product_tags_perf_test.go`, `product_tags_seam_perf_test.go`) tests green; no screen live — #148.

✅ Built 2026-11-27 (#149) — the app puts `need_reprint_code` on: the team code change tags the recomposed products some warehouse holds units of on a shelf (added by user 0, the app), with a `product_reprint_waits` row per such warehouse — what #151's reprint will clear, the tag coming off with the last row; a second change before a reprint re-sets the rows to the warehouses holding stock then. The take-off is #151.

✅ Built 2026-11-27 (#148, the screens) — the product page's **Tag** card (`features/products/tags/ProductTagsBox.tsx`, its chips from `Product.tags`): `need_reprint_code` first and locked for everyone, a custom tag with its × and *Tambah tag…* for the product's writers (ProductUpdate's roles), an admin's system tags for Root and the Administrator, **Kelola tag produk** (`ProductTagManageList`, read while the dialog is open) for them; the warehouse product page's read-only chips under the code (one `ProductTagsByIds`, as `ProductByIds` carries none); the Tag column and the Tag filter on the seller's list (`ProductRowItem.tags`, `tag_ids`) and the warehouse's (`WarehouseStockList`'s rows, `tag_ids`), `?tag=` in the address, cleared by Hapus Filter, in the phone's Filter sheet; the filter's list is one `ProductTagList` per screen. Hooks `features/products/tags/tagQueries.ts` (keyed `key.products`); stories `Products/Tags`, `Products/WarehouseTags`, `ProductDetail/Tags`, `WarehouseProduct/Tags` on the real RPCs' stub (`.storybook/productTagStub.ts`).

✅ Built 2026-11-27 (#151) — the app takes `need_reprint_code` off: the warehouse's **Cetak Ulang Kode** (opened from its Products list's *Cetak ulang kode (N)*) prints one label per shelf spot of the products still waiting for THIS warehouse (`InventoryService.ProductReprintList`, paged), and its Cetak is the recorded print (`ProductReprintRecord`, one transaction, as the order label's recorded print clears its badge): this warehouse's wait is cleared for each product printed with its LIVE code (one whose code changed again since the read is not — the page re-reads it), and the tag comes off a product once no warehouse waits for it — with stock in several warehouses it stays until each has printed. A transfer accepted while a product is tagged adds the receiving warehouse's wait (only for lines that shelved units). The code change, the record and the arrival take the team's product-code lock, so they serialize. No migration; docs/services/inventory_service/rpc.md § Cetak Ulang Kode.

⚠ *(2026-11-27, `revamp_dev` — my build details for #151, not asked)* **Two cases the reprint leaves alone.** (1) A RETURN of the team's own product accepted into a warehouse that has already printed adds no wait: its unit may still wear the old sticker, but a former code still finds the product ([a-team-code-change-recomposes-its-product-codes](#a-team-code-change-recomposes-its-product-codes), Q1 *"A"*, built in #152), as a unit shelved during the change itself (#149). Only a TRANSFER adds the receiving warehouse (⚠6). A borrowed unit is relabelled at the return accept with the live code already ([a-returned-borrowed-unit-is-relabelled-at-the-accept](../order/context_decision.md#a-returned-borrowed-unit-is-relabelled-at-the-accept)). (2) A product with more labels at one warehouse than the device's run limit (Cetak Label settings, 100 by default, 1 000 at most) cannot be printed whole in one run, so it stays on that warehouse's list until the limit is raised.

---

## the-team-code-and-product-tags-prototype-is-accepted

> Owner (Heri), in `revamp_dev`'s desktop chat (2026-11-27): *"A"*, **as recommended** — to the design accept of backlog #141 P0 (Storybook `TeamCodePrototype` stories; screenshots `01_proposed_settings_team_code_desktop.png` … `24_proposed_history_card_phone.png`, mocks 25–27, today's Settings and Edit Team as 28–29, in `D:/hermes/profiles/revamp_dev/accepts/141/`): *"accept as drawn, with its three recommended choices — the history line its own Riwayat Produk card, the tag shown as `need_reprint_code`, the four-line confirm"*.

**The verdict.** The prototype is the design to build:

| part | as accepted |
| --- | --- |
| Settings | a **Kode tim** card for a SELLING team: the code, what it prefixes, 1–10 characters; edited by the selling owner / admin (root and the administrator too), read-only for CS and a monitor; a warehouse or admin team has no card |
| the confirm | before anything is sent, four lines: how many products take the new code with an example (SL-03-ANG-001 → ANGR-ANG-001); which warehouses must reprint and the tag until they do; past orders, restocks and transfers keep their code; the old code stays the team's |
| refused | a code another team holds or EVER held, naming that team (*SL-01 sudah ada — dipakai Toko Melati*) — [a-team-code-change-recomposes-its-product-codes](#a-team-code-change-recomposes-its-product-codes), Q1 |
| Teams → Edit Team (root) | a code field in place of *"type and code cannot be changed"* for a selling team; an untouched code is never sent; a warehouse / admin team keeps the fixed line |
| the product page | a **Tag** card: `need_reprint_code` first, locked for everyone (no ×, admins included), custom tags with ×, *Tambah tag…*; the warehouse's product page shows the tags as read-only chips under the code; Discover shows none |
| both Products lists | a **Tag** column right after the product (two chips + `+N`, two lines at most); the **Tag filter** — several tags, ANY of them, in the address (`?tag=801,803`), cleared by Hapus Filter, in the Filter sheet on a phone. ⚠ The seller's list must FIT at 1440 px with the sidebar open in both languages (today 56 px over in Indonesian; the column adds 184 px) — the build makes it fit (backlog #148) |
| admins | **Kelola tag produk** — rename, delete; the app tag with neither (*Dipasang aplikasi*) |
| the reprint | **Cetak ulang kode (N)** on the warehouse's Products list (N = products still waiting at THIS warehouse; a monitor reads, no Cetak) → the **Cetak Ulang Kode** page: one label per shelf spot (new code QR + SKU, the spot, its quantity, the old code beside the product), the device's Cetak Label setup; Cetak counts as this warehouse's print; the tag comes off once every warehouse holding stock has printed |
| the history | the old → new code line as its own **Riwayat Produk** card after Produk Turunan, with a *Riwayat* nav entry (who, when) — not a row in Info |
| the tag's name | `need_reprint_code`, as written — one string for the screen, the filter, search and the API |
| a product with nothing on a shelf | takes the new code, never tagged, not on any reprint |

**What it does NOT settle:** nothing open for the screens. The backend steps are backlog #147 (tags), #149 (the code edit and recompose), #151 (the reprint), #152 (scanning former codes); the screens go live in #148, #150, #151. ⛔ Not built.

✅ Built 2026-11-27 (#148) — the tag parts are live: the product page's Tag card, the warehouse product page's chips, both Products lists' Tag column and Tag filter, Kelola tag produk — the accepted stories run on the live components. ⚠ The width is NOT fitted: the seller's list at 1440 px with the sidebar open scrolls inside its box — en 1,265 / id 1,381 px in 1,141 px while In transit shows (≈ 1,194 / 1,273 without that column); a fit needs the owner's pick (#148's report). The Kode tim card and its confirm, root's Edit Team code field, the Riwayat Produk card (#150) and the Cetak ulang kode entry and page (#151) stay behind the prototype gate (`features/products/tags/teamCodePrototype.tsx`).

✅ Built 2026-11-27 (#150) — the team code parts are live, the accepted stories running on the live components (`Pages/Settings/SettingsPage/TeamCode`, `Pages/Teams/TeamsPage/EditTeamCode`, `Pages/Products/ProductDetail/History` on `.storybook/teamCodeStub.ts`): *Settings*' Kode tim card, *the confirm* (its four lines from `TeamCodePreview`, read when Save opens it), *refused* (in place, naming the team; a code taken in between from the write's `TeamCodeTaken`), *Teams → Edit Team (root)*'s code field (for a SELLING team the *"type and code cannot be changed"* line goes — the field and *"the type is fixed after creation"* take its place; a warehouse / admin team keeps it), and *the history*'s Riwayat Produk card after Produk Turunan with its *Riwayat* nav entry (`ProductLogList`, paged, who in one `UserByIDs`, an override badged; the owning team's roles, Root and the Administrator). Two drawn details follow the live reads: the card's lead says `SL-03-…` (no product is read on the page's load to give an example), and the warehouses in the confirm are listed by name (as served). The *Cetak ulang kode (N)* entry and the reprint page (#151) stay behind the prototype gate (`features/products/tags/teamCodePrototype.tsx`).

✅ Built 2026-11-27 (#151) — *the reprint* is live, and the prototype gate is gone (`features/products/tags/teamCodePrototype.tsx`, `.storybook/teamCode141Stub.ts`, `.storybook/teamCode141Story.tsx` deleted): **Cetak ulang kode (N)** on the warehouse's Products list, N riding on the list's own read (`WarehouseStockList` `reprint_waiting`), hidden at 0 and for a monitor; the **Cetak Ulang Kode** page (`/products/reprint-labels`) — one label per shelf spot with the new code's QR and SKU, the spot and its quantity, the old code beside the product, on the device's Cetak Label setup; Cetak records the print for the products the run printed whole; a monitor reads with no Cetak. The accepted stories run on the live page (`Pages/Products/ProductReprintLabels`, `Pages/Products/Products/WarehouseReprint` on `.storybook/productReprintStub.ts`).
