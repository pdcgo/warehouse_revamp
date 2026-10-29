# Progress — Heri

For the **product manager**. One entry per finished slice, newest first
([a-report-fires-per-slice](../business/project/member_decision.md#a-report-fires-per-slice)).
Scope: [member.md](../business/project/member.md) — Order, Order Settlements, Team Balance,
Users & Role System, Documents, region, shipping, expense.

---

## 2026-10-29 · order — drafts, tracking number, warehouse fee

**The order context has no open question left**, apart from the product barcode you parked.

| What shipped | What it means for a person |
| --- | --- |
| **Promote places a draft exactly like the order form** | a draft becomes an order through the same create, with the same checks. Promote sends what is on screen, so an unsaved edit is not lost, and the receipt, tracking number and note now reach the order. A draft can only be promoted once |
| **The marketplace order number is required** | on the form, on the draft page and on the server. The form no longer has Save as Draft; drafts arrive from the marketplace app |
| **Every time is Jakarta time** | dates show in WIB wherever they are read, and table cells use the short form (`29 Okt 13:05`) |
| **Edit Resi works** | the selling team changes the tracking number, the label file or both until the parcel is handed to the courier. Each change is a note on the order naming the old and the new |
| **The warehouse fee is what gets charged** | the balance now charges each order the fee the warehouse priced it at, not the old flat fee from Credit Terms |
| **Credit Terms is the limit only** | the old flat fee field is gone from Credit Terms and from the pair's terms tab — the warehouse fee rollout is finished. Past changes to the flat fee stay in the change log |

**Checked:** unit tests, two people editing at once and an edit racing the handover (one result each time), 1 545 of
1 546 component stories (the one is a known slow-machine flake), and the orders e2e.

**Next:** the order figures on the analytic screen.
The order import waits on one export file from each marketplace you use.
<sub>agent detail: [order/context.md](order/context.md) · [teams/warehouse/context.md](teams/warehouse/context.md)</sub>

## 2026-10-21 · order lifecycle

**Orders now move through the eleven statuses the business uses**, from *pending* to *completed*, *problem*, *lost* or
*return*, instead of the old six. Every plain move is one action for any number of orders: a crew scanning 30 parcels
at the van moves the 28 that are ready and is told why the other two did not move.

| What shipped | What it means for a person |
| --- | --- |
| **One status move** for the warehouse and customer service | confirm, pick, hand over, hand back with a reason, shipped, completed, problem, lost and forced return are all one action. Each order says whether it moved and, if not, why |
| **One tab per status** on the order lists | an order is found under the status it is actually in |
| **Root sees every team's orders** | the platform owner can look across all teams without switching |
| **Settlement opens from the order event** | an order's settlement account appears a moment after the order. The order no longer waits on settlement to be created |
| **Return warehouse setting** (Settings → Return Warehouse) | a selling team names where its returns are received. Nothing requires it yet |

**Checked:** unit tests, all 1 405 component stories, and the orders, statement and settlement e2e. Two people moving
the same order at once was tested: exactly one move lands.

**Waiting on you:**
1. ✅ *Decided and built the same day:* moving many orders now saves them together — 200 orders in 11 ms instead of
   a quarter of a second ([audit](../../audits/services/selling_service/performances/OrderStatusChange.md)).
2. ✅ *Decided the same day:* picked is sky, shipping cyan, return red, and return completed takes your pink of *Retur Diterima*.
3. ✅ *Decided the same day:* every selling team sets its own return warehouse on Settings — nothing is filled in for
   them. Orders start requiring one once every team has set it, and the Teams list badges the teams still missing one.

**Later the same day:** the order lists lost six of their 'not implemented' marks.

| What shipped | What it means for a person |
| --- | --- |
| **Export** on both order lists | the list downloads as a spreadsheet, exactly the rows on screen (or the ticked ones on the warehouse list) |
| **Marketplace, seller and courier filters** | they now narrow the list. They were on screen before but did nothing |
| **The warehouse row's shop and unit count** | real now; before they were sample values |
| **Each timeline step says which side did it** | Warehouse or Seller, on every row of an order's timeline |

The seller list has 10 parts still waiting and the warehouse list 6; each needs a decision or a bigger piece (the fee).

**And then:** files download under their real names (an export is `orders-….xlsx`, not a storage code), and the **warehouse fee** got its first of five steps — each warehouse can now set what it charges per order (a percent with a floor and an optional cap) on its Settings. Nothing charges from it yet; orders keep paying the old flat fee until step 4. Detail: [teams/warehouse/context.md](teams/warehouse/context.md).

**2026-10-22:** six more marks gone from the seller's order list — it is down to 4.

| What shipped | What it means for a person |
| --- | --- |
| **The tracking number is kept** | the number typed on the order form is saved, shows on both order lists, the order page and the export, and the search finds an order by it |
| **The warehouse filter works** | picking a warehouse on the seller list narrows the rows and the counts |
| **The status date is real** | under a status tab, each row says when the order got there |
| **The warehouse fee is real** | each new order is priced by its warehouse and keeps that fee; the order form shows it before you save. A warehouse that never set its fee cannot take orders, and the form says so |
| **The summary's figures are real** | items, units per order, purchase value and margin come from the server |

Behind it, steps 2 and 3 of the warehouse fee: each warehouse's old flat fee became its rate (the same amount), and orders now freeze the fee. The ledger still charges the old flat fee until step 4. ⚠ In the dev database only Dev Warehouse had a flat fee, so the other warehouses there refuse orders until they set one.

Still waiting on the seller list: the import's file, the marketplace's order date and the ship-by deadline (you added both fields today), and the withdrawal figure.

**Later the same day:** the marketplace's two dates are real, so the seller list is down to **2** marks — the import (Q19) and the withdrawal (Q20), both waiting on your answer.

| What shipped | What it means for a person |
| --- | --- |
| **The marketplace order date** | every new order must have it — the order form will not create without it, and a draft cannot be promoted without it. It shows on both lists, the order page and the export |
| **The ship-by deadline** | the marketplace's own "kirim sebelum", optional. When set it colours the row: overdue, under 6 hours, under 24 hours |
| **The date filter switch** | the order list's date filter reads either *Dibuat* (the default) or *Tgl MP* |

Orders placed before today have neither date, so they show nothing there and never match a *Tgl MP* filter.

Detail: [order/context.md](order/context.md).

---

## 2026-08-31 · baseline

**The first entry is a baseline, not a slice.** Scopes were assigned today, and the work predates
them — **all 389 commits in this repository are from this machine**, so everything below was built
here, including the parts now assigned to Toni. This entry states where the whole system stands;
every entry after it covers one finished slice.

### Where each area stands

| Area | State | What a person can do with it today |
| --- | --- | --- |
| **Team Balance** | ⚠ **built, waiting on you** | Two teams can owe each other and settle up: every pair has two mirrored balances, six kinds of event move them, and a debt above the limit stops the debtor ordering. A payment carries **proof the creditor can open**, and is confirmed, rejected or reversed. Credit limits have a change log — who moved a limit, when, and why |
| **Order Settlement** | ✅ **done, design accepted** | What a marketplace order *actually* paid out — the fees, the deductions, the next-day adjustments — recorded per order, typed in by hand or posted by an external service |
| **Orders** | ⚠ built, never design-reviewed | Record an order, keep it as a draft and promote it, then confirm → pick → pack → ship. Shops and shop members are managed |
| **Users & Roles** | ⚠ built, never design-reviewed | Log in, reset a password by OTP, hold a different role in each team. The permission rule for every screen is declared on the request itself, so it cannot drift from the code |
| **Support** — documents, regions, courier catalogue, expenses | ⚠ built, never design-reviewed | Upload and share a document, resolve an address or postcode, pick a courier, record a cost like electricity or ads |

```mermaid
flowchart LR
  s["Order Settlement"] -->|"✅ accepted"| done["done"]
  b["Team Balance"] -->|"⚠ built, unreviewed screens"| gate["waiting on the PM"]
  o["Orders · Users · Support"] -->|"⚠ built before it was designed"| gate2["no design pass yet"]
```

### ⛔ The one thing waiting on you

**Nobody has looked at the balance screens.** The lifecycle's `design_accept` gate blocks everything
after it, and it is the only thing between Team Balance and finished. Fifteen minutes with the
running app closes it — the steps are in
[balance/context.md](balance/context.md#the-next-agents-first-move).

### What is honest about the rest

**Most of this was built before it was designed** — that is recorded, not hidden, in
[the balance state report](balance/context.md). It is why *Orders* carries **13 open questions**, the
most of any area, and why the top of [biggest_question.md](../biggest_question.md) is about orders and
money rather than about screens.

### Evidence

The last recorded run had the **e2e suite green** (`6ae4d55`, 2026-08-31), with unit, integration and
end-to-end passing together for the first time. Two concurrency audits are written up in
[audits/](../../audits/). Detail per area is in the context files beside this one —
[balance](balance/context.md), [settlement](settlement/context.md).

### Next

1. **Get the balance screens previewed** — it is the only blocked gate in this lane.
2. **Wire settlement into order creation** — the one piece settlement is missing.
3. **Decide who owns the ledger** — it is the last unowned area, and both lanes touch it
   ([member_clarify.md Q1](../business/project/member_clarify.md#question)).
