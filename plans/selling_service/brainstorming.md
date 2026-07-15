# Brainstorming — Selling + Order domain (#23)

> Planning doc for the **selling service and the order service** (#23 says the selling work
> *"includes order service"*). Nothing here is implemented, and **nothing is decided** — this
> maps the domain, the real forks, and a proposed break-up into smaller issues (as #23 asks:
> *"break this to many issues if too big"*).

> **Decisions so far**
> - This is planning only. Every fork in §3 is **open** and needs the owner. (2026-07-15)
> - _(nothing else settled)_

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
    subgraph warehouse side — undesigned §1
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

### 3.3 When does an order take stock?
Three honest options, and it ties to the reservation question already open in
[plans/plan.md §4.4](../plan.md):

| Option | When stock leaves | Trade-off |
| --- | --- | --- |
| Deduct at placement | immediately | simplest; oversell impossible; but a cancel must return stock |
| **Reserve** at placement, deduct at pick | held, then taken | needs a reservation concept inventory doesn't have yet |
| Deduct at pick only | when the warehouse picks | stock looks available until picked → oversell risk |

### 3.4 Where do orders come from (intake)?
- Manual entry (a CS person types it in).
- Marketplace **import** (is the `bargawa` Chrome extension the intake path? it already speaks the
  Connect contract).
- A public order-create API.

Each implies different `OrderCreate` ergonomics and a different `source`/`ref_id` story.

### 3.5 Shops — what is a shop, and does selling own it?
A selling team likely operates several marketplace shops. Minimum shape: name, marketplace type,
maybe credentials/metadata. Does `shop` belong to a new `selling_service`, or is it its own
service? Who can manage shops (team owner/admin)?

### 3.6 Which warehouse fulfils an order, and how does the crew see it?
Per-order choice? A shop default? Auto-pick by stock? And the warehouse crew's fulfillment
screen is **§1 territory** again.

### 3.7 The money the order records (feeds #32)
What does an order freeze for the revenue side — buyer-paid total, COGS, shipping cost, warehouse
fee, marketplace fee? This is the seam between #23 and #32.

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
