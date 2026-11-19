# Decisions — custom shipments `context.md`

What the owner settled, recorded before it is acted on. **Append-only** — a decision that is later
reversed is renamed and its references grepped (RULE 12), never quietly edited away.

| decision | what it decided |
| --- | --- |
| [a-custom-shipment-is-a-parcel-that-is-not-an-order](#a-custom-shipment-is-a-parcel-that-is-not-an-order) | a custom shipment is a parcel the warehouse sends that is not a marketplace order: a sample to someone, or a problem restock's goods back to its supplier |
| [the-selling-team-asks-the-warehouse-ships](#the-selling-team-asks-the-warehouse-ships) | the owning selling team creates a custom shipment in the app; the warehouse picks, packs and hands it to the courier |
| [the-courier-is-paid-by-the-team-or-by-the-warehouse](#the-courier-is-paid-by-the-team-or-by-the-warehouse) | a custom shipment's courier is paid either by the selling team directly (an expense on its account) or by the warehouse at handover (owed back through Team Balance); the team picks the way when it creates it (🔄 A, as recommended) |
| [custom-shipments-sit-in-inventories-after-transfer](#custom-shipments-sit-in-inventories-after-transfer) | the custom-shipments menu line sits in Inventories, right after Transfer, on both sides |
| [a-custom-shipment-is-cancelled-only-while-requested](#a-custom-shipment-is-cancelled-only-while-requested) | the selling team cancels a custom shipment only while Diminta |
| [the-custom-shipments-prototype-is-accepted](#the-custom-shipments-prototype-is-accepted) | the five custom-shipment screens accepted as drawn |

---

## a-custom-shipment-is-a-parcel-that-is-not-an-order

> Owner (Heri), in his draft [context.md](./context.md) (2026-11-18, edited 17:21): *"Its cover Accidental Packet Shipments like: Send Sample to someone. Reshipping Restock back to supplier if a problem happen."* — written after the agent read his first line (*"Send Sample. Reshipping Restock."*) as a parcel the warehouse sends that is not a marketplace order, and asked what *Reshipping Restock* means: A the warehouse sends a problem restock's goods back to the supplier (as recommended); B the supplier sends missing goods again; C the warehouse forwards a restock's goods elsewhere. His edit is A, in his own words.

**The verdict.** A **custom shipment** is a parcel the warehouse sends out that is **not a marketplace order**. Two kinds so far:

| kind | what goes | to |
| --- | --- | --- |
| **sample** | the owning team's units, sent as a sample — the parcel form of [a-sample-is-handed-over-at-the-warehouse](../inventory/transaction_decision.md#a-sample-is-handed-over-at-the-warehouse), which stays as it is for a sample handed over in person | someone |
| **restock reship** | goods of a restock that had a problem ([a-restock-problem-is-a-system-tag](../inventory/restock_decision.md#a-restock-problem-is-a-system-tag)) | back to its supplier |

**What it does NOT settle:** who asks for a custom shipment; who pays its shipping, from which account; whether a sample by parcel needs the owning team's OK; what comes back for a reship (the checklist's *goods resent — arrive as a new restock*) and when a problem tag comes off. ⛔ Not built — nothing exists for an outbound parcel that is not an order.

🔄 *(2026-11-19)* Who asks, who pays and whether it needs an OK are settled ([the-selling-team-asks-the-warehouse-ships](#the-selling-team-asks-the-warehouse-ships), [the-courier-is-paid-by-the-team-or-by-the-warehouse](#the-courier-is-paid-by-the-team-or-by-the-warehouse), [the-custom-shipments-prototype-is-accepted](#the-custom-shipments-prototype-is-accepted)). Still open, parked with the owner's restock-problem context: what comes back for a reship and when the *Barang rusak* tag comes off.

---

## the-selling-team-asks-the-warehouse-ships

> Owner (Heri), in chat (2026-11-18): *"A"*, as recommended — to Q2, *who asks for a custom shipment?* A: the owning selling team creates it in the app — the items, the recipient (or the restock's supplier), the courier and who pays — and the warehouse picks, packs and hands it to the courier, as with an order; the goods, the supplier and the cost are all the team's ([business_level.md](../business_level.md): *ownership of stock is by selling team*); B: the warehouse creates it, as it records an in-person sample today; C: the selling team creates a reship, either side a sample.

**The verdict.** The **owning selling team creates** a custom shipment in the app — what goes, to whom, by which courier; the **warehouse** it ships from **picks, packs and hands it to the courier**. A sample handed over in person at the warehouse stays as it is ([a-sample-is-handed-over-at-the-warehouse](../inventory/transaction_decision.md#a-sample-is-handed-over-at-the-warehouse)).

*(Not decided yet: who pays the shipping and from which account; whether a sample by parcel needs anyone's OK beyond the creator's role. Which roles of the team may create one is the build's default until asked — the roles that create an order.)* ⛔ Not built.

🔄 *(2026-11-19)* The *Not decided yet* above is settled: who pays and from which account — [the-courier-is-paid-by-the-team-or-by-the-warehouse](#the-courier-is-paid-by-the-team-or-by-the-warehouse); a parcel sample needs no OK beyond the creator's role — a sample is a stock-out with no agreement step ([a-sample-is-a-stock-out-at-batch-value](../inventory/transaction_decision.md#a-sample-is-a-stock-out-at-batch-value)) and the accepted design has none ([the-custom-shipments-prototype-is-accepted](#the-custom-shipments-prototype-is-accepted)).

---

## the-courier-is-paid-by-the-team-or-by-the-warehouse

> Owner (Heri), in chat (2026-11-18): *"can two way, selling pay directly, or A"* — to Q3, *who pays the courier, and how is it recorded?* A (recommended): the warehouse pays the courier on the spot and types the real cost at handover; the selling team pays the warehouse back through Team Balance, as [the-warehouse-cost-is-the-couriers-charge-at-the-door](../inventory/restock_decision.md#the-warehouse-cost-is-the-couriers-charge-at-the-door); the cost may be 0. B: the team pays from one of its own accounts, posted as an expense, as [a-transfers-shipping-posts-as-an-expense](../financial_account/context_decision.md#a-transfers-shipping-posts-as-an-expense). C: the receiver pays, no cost recorded. His answer: **both A and B**, his own rule.

**The verdict.** A custom shipment's courier is paid **one of two ways**:

| way | who pays the courier | how it is recorded |
| --- | --- | --- |
| **the selling team pays directly** | the owning team, from one of its own accounts | an **expense** on that account, as a warehouse transfer's shipping |
| **the warehouse pays** | the warehouse, on the spot, typing the real cost at handover (0 allowed) | the selling team **owes the warehouse** through Team Balance, as a restock's courier charge at the door |

*(Not decided yet: who picks the way, and when — asked next.)* ⛔ Not built.

🔄 *(2026-11-18)* **Settled in chat — who picks the way, and when.** Owner: *"A"*, as recommended — A: the selling team picks it when it creates the shipment (*we pay* — it picks its account and types the cost, editable until the handover, and the warehouse sees it must not pay; *warehouse pays* — the warehouse types the real cost at handover); B: the warehouse picks at handover; C: the team picks a default, the warehouse may switch it at handover. So **the selling team picks the way when it creates the shipment**: *we pay* carries the team's account and its cost (editable until the handover); *warehouse pays* leaves the cost for the warehouse to type at the handover.

🔄 *(2026-11-19)* The *Not decided yet* above (who picks the way, and when) is settled by the 🔄 line under it: the team, when it creates the shipment — drawn so in [the-custom-shipments-prototype-is-accepted](#the-custom-shipments-prototype-is-accepted).

---

## custom-shipments-sit-in-inventories-after-transfer

> Owner (Heri), in chat (2026-11-19): *"A"*, as recommended — to Q1 of the #88 Storybook prototype (`pages/custom-shipments`, `custom-shipment-form`, `custom-shipment-pick`, `custom-shipment-detail`; screenshots of the seller's list, both create forms, the warehouse queue, pick, handover with cost, the detail's timeline and phone, and today's Record Sample dialog on the rack page as BEFORE): where does the custom-shipments menu line go? **A** the Inventories group right after Transfer, on both sides; **B** the selling team's Orders group and beside the warehouse's Orders; **C** its own top-level line. Asked after he checked that *Kirim Paket* is the custom shipments of [a-custom-shipment-is-a-parcel-that-is-not-an-order](#a-custom-shipment-is-a-parcel-that-is-not-an-order).

**The verdict.** Custom shipments (*Custom Shipments* / *Kirim Paket*) is one menu line in the **Inventories** group, **right after Transfer**, on the selling team's side and on the warehouse's side.

*(Not asked — the prototype's wording:)* the Indonesian name *Kirim Paket*; the owner may still rename it.

⚠ Not built — the prototype only (backlog #88).

---

## a-custom-shipment-is-cancelled-only-while-requested

> Owner (Heri), in chat (2026-11-19): *"A"*, as recommended — to Q2 of the #88 Storybook prototype: until when may the selling team cancel a custom shipment? **A** only while *Diminta* (requested), as an order ([no-cancel-after-the-warehouse-confirms](../inventory/order_decision.md#no-cancel-after-the-warehouse-confirms)) and a transfer ([cancel-before-processed-lost-only-in-transit](../inventory/warehouse_transfer_decision.md#cancel-before-processed-lost-only-in-transit)) — a sample's units go back on their racks, a reship's broken units are free again; **B** until it is handed to the courier — a picked sample's units put back on a rack by hand. (B was the agent's build brief, not the owner's draft, which says nothing on cancelling — the question named it his draft by mistake.)

**The verdict.** Only the owning selling team cancels ([only-the-selling-team-cancels](../order/context_decision.md#only-the-selling-team-cancels)), and only while the custom shipment is **Diminta**; once the warehouse picks it, there is no cancel. A cancelled sample's units go back on the racks they were taken from; a cancelled reship's broken units can be put on another reship.

⚠ Not built — the prototype only (backlog #88).

---

## the-custom-shipments-prototype-is-accepted

> Owner (Heri), in chat (2026-11-19): *"A"*, as recommended — to *approve the Custom Shipments design as drawn?* (the #88 Storybook prototype: `pages/custom-shipments` (the seller's list and the warehouse queue), `custom-shipment-form`, `custom-shipment-pick`, `custom-shipment-detail`; screenshots of each, desktop and phone, and today's Record Sample dialog on the rack page as BEFORE), after [custom-shipments-sit-in-inventories-after-transfer](#custom-shipments-sit-in-inventories-after-transfer) and [a-custom-shipment-is-cancelled-only-while-requested](#a-custom-shipment-is-cancelled-only-while-requested). The question listed what *as drawn* holds.

**The verdict.** The five screens are accepted as drawn, with what the question listed:

| | as drawn |
| --- | --- |
| a sample | its units leave stock at create, oldest batch first, from racks the system picks; valued at the batch value, which the team sees |
| a reship | only the broken units of a received restock tagged *Barang rusak*, at most the broken count minus the units already on another live reship; one parcel goes to one supplier; it takes no rack stock |
| the recipient | filled in from the supplier (name, contact, address — as far as the supplier's data goes); every field stays editable |
| who pays | *Gudang bayar* picked first — the warehouse types the courier cost at handover; *Kami bayar* needs the paying account, its cost optional and editable until the handover ([the-courier-is-paid-by-the-team-or-by-the-warehouse](#the-courier-is-paid-by-the-team-or-by-the-warehouse)) |
| the warehouse | sees no seller money on any of these screens, nor in the data it receives |

⚠ Not built — the prototype only (backlog #88); the build follows the scoping pass.
