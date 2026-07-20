# Brainstorming — Revenue domain (#32)

> Planning doc for the **revenue service**. Nothing implemented, **nothing decided**. #32 asks to
> *"break this to many issues if too big"* — so this frames the domain and a proposed break-up.

> **Decisions so far**
> - Planning only; every fork is open and needs the owner. (2026-07-15)

---

## 1. What revenue is (first principles)

Revenue is the **money truth of an order**: what the business actually earned once every cost is
subtracted. It is a **reconciliation layer on top of orders** — it does not create orders, it
records and settles their money. So it sits **downstream of the order service** ([#23](../selling_service/brainstorming.md))
and cannot be shaped before the order's money model is.

For one order, revenue is roughly:

```
buyer_paid  −  COGS (cost of the goods that left stock)
            −  shipping cost
            −  warehouse fee
            −  marketplace / payment fees
            =  margin  (what the business kept)
```

The interesting part is **timing and settlement**, not the arithmetic: money is *promised* at
order time and *realised* later (the marketplace pays out days/weeks after delivery), so revenue
has to track *expected* vs *actual* and reconcile the gap.

---

## 2. The forks (open)

- [ ] **2.1 Create vs Adapt** — same fork as [#23 §3.1](../selling_service/brainstorming.md).
      Clean-slate by default; "Adapt" needs an explicit source and your go-ahead (HARD RULE 1).
- [ ] **2.2 What does an order hand revenue?** — the seam with #23 §3.7. Revenue can only be
      designed once we know what an order freezes (buyer total, COGS, fees).
- [ ] **2.3 Expected vs actual** — does revenue record an *estimate* at order time and reconcile
      against the real marketplace payout later? Almost certainly yes — but that's a ledger with a
      settlement lifecycle, which is the bulk of the work.
- [ ] **2.4 Is there a ledger / balance model?** — per-team receivable/payable, payouts,
      withdrawals? Or just per-order margin rows? This decides whether revenue is a small reporting
      service or a full accounting subsystem.
- [ ] **2.5 Team-to-team fees** — when one team's product sells through another team, or a
      warehouse charges a fulfillment fee, money moves between teams. Is that in scope for revenue,
      or a separate concern?

---

## ✅ DECIDED (owner, 2026-07-20): an order freezes **COGS**, and nothing else new (#74)

The order already freezes `subtotal`, `shipping_cost` and `total`. It gains **what the goods cost us**,
and margin is then computable without any data the system does not have:

```
margin = total − COGS − shipping_cost
```

That answers *"did we make money on this order"* today, which is the question actually being asked.

**The full breakdown was considered and deferred**, not rejected: explicit `discount`, `marketplace_fee`,
`payment_fee` and `warehouse_fee` fields are what #76 (settlement — expected vs actual) will eventually
need, and they are what would let the server enforce an arithmetic invariant. They were not taken now
because **nothing can populate them yet**: intake is manual-only (#73), so every one would sit at zero
while pretending to model something. Add them when marketplace import arrives — which is exactly when
`total ≠ subtotal + shipping` starts happening for real (§3.7 of the selling doc).

### ⚠ One sub-choice this leaves open, flagged rather than buried

**Which cost?** A product can arrive on several restocks at different prices, so "what the goods cost
us" is not a single number the system already holds. The options are the usual ones:

| | |
| --- | --- |
| **Latest restock price** | simplest; wrong when prices move and old stock is still on the shelf |
| **Weighted average** | truer; needs a running average maintained per product per warehouse |
| **FIFO layers** | truest; needs cost layers on stock, which is a real model |

**Implemented as the latest restock price for now**, because it needs nothing new and is right whenever
prices are stable — and it is recorded on the order line, so changing the *rule* later does not rewrite
what past orders already froze. If restock prices for the same product vary much, this wants revisiting
before the margin numbers are trusted. **Owner input welcome, but it does not block #74.**

---

## 3. Proposed decomposition (confirm before creating issues)

1. **Order money model** — settle what an order freezes for revenue (jointly with #23 §3.7).
2. **Per-order revenue record** — the margin row (expected).
3. **Settlement / reconciliation** — realise actuals against expected when the payout lands.
4. **Team balance / ledger** — if §2.4 says a ledger; its own epic.
5. **Revenue reporting frontend** — the screens that read all this.

---

## 4. Blocker

Revenue is downstream of **two** undesigned things: the **order money model** (#23 §3.7) and, under
it, the **warehouse core** ([plans/plan.md §1](../plan.md)) that the order lifecycle needs. So #32
is best **parked until #23's order shape is decided** — planning it in detail now would be building
on a foundation that isn't poured. The one thing to settle early is §2.1 (Create vs Adapt).
