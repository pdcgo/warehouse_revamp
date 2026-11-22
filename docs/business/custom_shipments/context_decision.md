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
| [missing-goods-leave-a-note-on-the-custom-shipment](#missing-goods-leave-a-note-on-the-custom-shipment) | the warehouse notes goods missing on the shipment; it stays Diminta and the team decides |
| [missing-reship-units-are-not-offered-again](#missing-reship-units-are-not-offered-again) | a reship's broken units a goods-missing note names are not offered again after a cancel |
| [the-goods-missing-badge-is-on-both-lists](#the-goods-missing-badge-is-on-both-lists) | the goods-missing badge shows on the team list and the warehouse queue |
| [the-goods-missing-prototype-is-accepted](#the-goods-missing-prototype-is-accepted) | the goods-missing control, dialog, trail row and badges, as drawn |
| [the-reship-line-counts-the-units-not-found](#the-reship-line-counts-the-units-not-found) | the reship line's sentence adds the units not found |
| [a-suppliers-reshipping-comes-in-as-a-custom-shipment](#a-suppliers-reshipping-comes-in-as-a-custom-shipment) | a supplier's reshipping comes in as an inbound custom shipment; restock_custom_shipments joins a restock, its resolution, the parcel and the stock movement; it arrives Tiba → Terima, or Hilang; units at the seller's price; the restock's door charge; created with the reshipping resolution (🔄 A, B, A, A); the stock-in is linked, the price moves no money and is editable until Terima (🔄 A, A, A) |

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

✅ Built 2026-11-19 (P1, backend) — the two kinds as one parcel (`custom_shipments`, migration 00057): `CustomShipmentCreate` makes a SAMPLE or a RESTOCK RESHIP, `CustomShipmentDetail` reads it; the other six RPCs are declared and answer Unimplemented until P2–P3; no screen yet (P5). Tests `custom_shipment_create_test.go`, `custom_shipment_detail_test.go`.

✅ Built 2026-11-19 (P2, backend) — both kinds are listed: `CustomShipmentList` (every side, paged, filtered by status, kind, warehouse and free text) and `CustomShipmentReshipOptions` (what a reship can send). Tests `custom_shipment_list_test.go`, `custom_shipment_reship_options_test.go`.

✅ Built 2026-11-19 (P5, screens) — both kinds on one list and one form: *Sampel* and *Kirim balik ke supplier* on the selling team's *Kirim Paket* (`/inventories/custom-shipments`), the kind a filter beside the status tabs; the in-person sample stays on Rack detail. Stories `pages/custom-shipments/*.stories.tsx`, `pages/custom-shipment-form/index.stories.tsx`.

🔄 *(2026-11-20)* **The word.** In the restock's resolutions, sending a problem restock's goods back to the supplier is a **`return`**, and `reshipping` is the supplier sending them again ([a-restock-problem-is-settled-by-resolution-rows](../inventory/restock_decision.md#a-restock-problem-is-settled-by-resolution-rows), owner *"A"*). The *restock reship* kind above is that `return`; the draft's *"Reshipping Restock back to supplier"* is read the same way.

🔄 *(2026-11-20)* **Both ways now.** A supplier's reshipping comes **in** as a custom shipment — [a-suppliers-reshipping-comes-in-as-a-custom-shipment](#a-suppliers-reshipping-comes-in-as-a-custom-shipment). *A parcel the warehouse sends out* above is the outbound kinds only.

---

## the-selling-team-asks-the-warehouse-ships

> Owner (Heri), in chat (2026-11-18): *"A"*, as recommended — to Q2, *who asks for a custom shipment?* A: the owning selling team creates it in the app — the items, the recipient (or the restock's supplier), the courier and who pays — and the warehouse picks, packs and hands it to the courier, as with an order; the goods, the supplier and the cost are all the team's ([business_level.md](../business_level.md): *ownership of stock is by selling team*); B: the warehouse creates it, as it records an in-person sample today; C: the selling team creates a reship, either side a sample.

**The verdict.** The **owning selling team creates** a custom shipment in the app — what goes, to whom, by which courier; the **warehouse** it ships from **picks, packs and hands it to the courier**. A sample handed over in person at the warehouse stays as it is ([a-sample-is-handed-over-at-the-warehouse](../inventory/transaction_decision.md#a-sample-is-handed-over-at-the-warehouse)).

*(Not decided yet: who pays the shipping and from which account; whether a sample by parcel needs anyone's OK beyond the creator's role. Which roles of the team may create one is the build's default until asked — the roles that create an order.)* ⛔ Not built.

🔄 *(2026-11-19)* The *Not decided yet* above is settled: who pays and from which account — [the-courier-is-paid-by-the-team-or-by-the-warehouse](#the-courier-is-paid-by-the-team-or-by-the-warehouse); a parcel sample needs no OK beyond the creator's role — a sample is a stock-out with no agreement step ([a-sample-is-a-stock-out-at-batch-value](../inventory/transaction_decision.md#a-sample-is-a-stock-out-at-batch-value)) and the accepted design has none ([the-custom-shipments-prototype-is-accepted](#the-custom-shipments-prototype-is-accepted)).

✅ Built 2026-11-19 (P1, backend) — only the owning selling team creates (the order-create roles: Owner, Admin, CS, plus Root / the Administrator); the warehouse it ships from reads it without the seller's money; picking and the handover are P3. Test `custom_shipment_later_test.go` (the policies).

✅ Built 2026-11-19 (P3, backend) — the warehouse it ships from marks it picked (`CustomShipmentPicked`, Diminta → picked) and hands it to the courier (`CustomShipmentHandover`, picked → handed over, resi optional): the warehouse roles that act on a transfer (Owner, Admin, Staff, plus Root / the Administrator — the build's default); the owning team cannot, another warehouse reads NotFound. Tests `custom_shipment_picked_test.go`, `custom_shipment_handover_test.go`.

✅ Built 2026-11-19 (P5, screens) — one path, two screens, by team type (as the transfer's): a selling team reads its own parcels and asks for one on *Paket Baru* (`/inventories/custom-shipments/new`, its writing roles only); a warehouse reads the queue it ships (*Paket untuk Dikirim*) and a parcel opens its pick page — the item scans then *Tandai Sudah Diambil*, then *Serahkan ke Kurir*. Another team's parcel reads as not found. Stories `pages/custom-shipment-pick/index.stories.tsx`, `pages/custom-shipment-detail/index.stories.tsx`.

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

✅ Built 2026-11-19 (P1, backend) — the team picks the way at create: *Kami bayar* names one of its ACTIVE accounts (operational or not) and an optional cost, *Gudang bayar* names neither; `CustomShipmentCreated` carries the team's account and cost. The cost edit, the handover's cost and both postings (expense, Team Balance) are P3–P4.

✅ Built 2026-11-19 (P3, backend) — *Ubah Ongkir* (`CustomShipmentCostSet`): the team's account and cost while Diminta or picked, a changed account must be one of its active accounts, each edit that moves money announced with both sides (`CustomShipmentCostUpdated`); a *Gudang bayar* parcel refuses it, and so does one handed over (an edit racing the handover lands before it or is refused — race-tested). At the handover the warehouse's cost is required when it pays (0 allowed, an empty field refused) and refused when the team pays; `CustomShipmentHandedOver` carries it. The warehouse reads that the team edited its cost, never the figures. The postings themselves (the expense, Team Balance) are P4.

✅ Built 2026-11-19 (P4, backend) — both ways now post. *Kami bayar*: the team's courier cost leaves its account as an **expense** row, as a transfer's shipping — *"Custom shipment #N shipping"* at create, the difference (or the move between its accounts) on each *Ubah Ongkir*, the refund on cancel (financial_account's custom-shipment listener; not on the Expenses screen). *Gudang bayar*: at the handover the selling team owes the warehouse the cost it typed, on Team Balance under its own type `custom_shipment_fee` (`LIABILITY_SOURCE_TYPE_CUSTOM_SHIPMENT_FEE`, keyed by the parcel, as [a-transfer-charge-is-a-transfer-fee](../balance/context_decision.md#a-transfer-charge-is-a-transfer-fee) asks), 0 posting nothing; a *Kami bayar* parcel's handover posts nothing there, so the warehouse's books never carry the team's courier money, and a *Gudang bayar* parcel never touches the team's account. The same event delivered twice posts once (race-tested). The cause label on Team Balance and the daily statement's courier column are the screens' (P5). Tests `custom_shipment_shipping_listener_test.go`, `custom_shipment_courier_charge_test.go`, `push_handler_custom_shipment_test.go`.

✅ Built 2026-11-19 (P5, screens) — the form asks who pays: *Gudang bayar* first, sending no account and no cost; *Kami bayar* asks one of the team's accounts (the server refuses an archived one) and an optional cost. *Ubah Ongkir* on the list's ⋯ and the detail's header until the handover; the handover dialog takes the warehouse's cost only when it pays (required, 0 allowed) and none when the team does. Team Balance names the charge *Courier on a custom shipment · parcel #N* / *Biaya kurir kirim paket · paket #N*, and the warehouse's daily statement counts it in its one courier column beside the restock's, the return's and the transfer's. Stories `LiabilityLedgerTable.stories.tsx`, `StatementWords.stories.tsx`.

---

## custom-shipments-sit-in-inventories-after-transfer

> Owner (Heri), in chat (2026-11-19): *"A"*, as recommended — to Q1 of the #88 Storybook prototype (`pages/custom-shipments`, `custom-shipment-form`, `custom-shipment-pick`, `custom-shipment-detail`; screenshots of the seller's list, both create forms, the warehouse queue, pick, handover with cost, the detail's timeline and phone, and today's Record Sample dialog on the rack page as BEFORE): where does the custom-shipments menu line go? **A** the Inventories group right after Transfer, on both sides; **B** the selling team's Orders group and beside the warehouse's Orders; **C** its own top-level line. Asked after he checked that *Kirim Paket* is the custom shipments of [a-custom-shipment-is-a-parcel-that-is-not-an-order](#a-custom-shipment-is-a-parcel-that-is-not-an-order).

**The verdict.** Custom shipments (*Custom Shipments* / *Kirim Paket*) is one menu line in the **Inventories** group, **right after Transfer**, on the selling team's side and on the warehouse's side.

*(Not asked — the prototype's wording:)* the Indonesian name *Kirim Paket*; the owner may still rename it.

⚠ Not built — the prototype only (backlog #88).

✅ Built 2026-11-19 (P5) — *Custom Shipments* / *Kirim Paket* sits in Inventories right after Transfer for a selling team and for a warehouse, and stays lit on a parcel's page and on the form (`layouts/nav.ts`; pinned by `layouts/nav.test.ts`).

---

## a-custom-shipment-is-cancelled-only-while-requested

> Owner (Heri), in chat (2026-11-19): *"A"*, as recommended — to Q2 of the #88 Storybook prototype: until when may the selling team cancel a custom shipment? **A** only while *Diminta* (requested), as an order ([no-cancel-after-the-warehouse-confirms](../inventory/order_decision.md#no-cancel-after-the-warehouse-confirms)) and a transfer ([cancel-before-processed-lost-only-in-transit](../inventory/warehouse_transfer_decision.md#cancel-before-processed-lost-only-in-transit)) — a sample's units go back on their racks, a reship's broken units are free again; **B** until it is handed to the courier — a picked sample's units put back on a rack by hand. (B was the agent's build brief, not the owner's draft, which says nothing on cancelling — the question named it his draft by mistake.)

**The verdict.** Only the owning selling team cancels ([only-the-selling-team-cancels](../order/context_decision.md#only-the-selling-team-cancels)), and only while the custom shipment is **Diminta**; once the warehouse picks it, there is no cancel. A cancelled sample's units go back on the racks they were taken from; a cancelled reship's broken units can be put on another reship.

⚠ Not built — the prototype only (backlog #88).

✅ Built 2026-11-19 (P2, backend) — a cancelled reship's broken units are offered again by `CustomShipmentReshipOptions` (a reship that is picked or handed over keeps them). The cancel itself is P3.

✅ Built 2026-11-19 (P3, backend) — `CustomShipmentCancel`: only the owning selling team (the warehouse reads NotFound), only while Diminta — picked or later is refused, and a cancel racing the warehouse's pick of the same parcel: exactly one wins (race-tested). A sample's take is undone in the same step — every unit back on the batch and the rack it left (`RollbackParcelSample`; a rack a stock count holds refuses until the count ends); a reship's broken units are free for another reship; `CustomShipmentCancelled` gives a team payer's posted cost back (P4 posts it). Tests `custom_shipment_cancel_test.go`, `custom_shipment_moves_race_test.go`.

✅ Built 2026-11-19 (P4, backend) — a cancelled *Kami bayar* parcel's posted courier cost comes back to the account that paid it, once (*"Custom shipment #N shipping cancelled — money returned"*); a *Gudang bayar* parcel had nothing posted, so nothing comes back. Test `custom_shipment_shipping_listener_test.go`.

✅ Built 2026-11-19 (P5, screens) — *Batalkan* on the list's ⋯ and the detail's header only while Diminta (the owning team's writing roles, never the warehouse's pages); confirmed, the parcel reads Dibatalkan; a refusal (the warehouse picked it meanwhile) says the server's sentence and the page re-reads it.

🔄 *(2026-11-19)* Narrowed by [missing-reship-units-are-not-offered-again](#missing-reship-units-are-not-offered-again): a cancelled reship's broken units that a *goods missing* note names are not freed for another reship.

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

✅ Built 2026-11-19 (P1, backend) — a sample's units leave stock at create, oldest batch first, racks the system picks (the transfer out-leg's take, typed `sample`, the recipient on it), valued at the batch value the team reads; a reship sends only an accepted restock's broken units, at most broken − units on live reships (under the restock row's lock, race-tested), one supplier per parcel, no stock moved; the warehouse receives no seller money in any field (pinned by a walk of the whole response). Screens P5.

✅ Built 2026-11-19 (P2, backend) — the list screen's reads: the selling team lists its own parcels, the warehouse the ones it ships with no seller money in any row (pinned by a walk of the whole list response; each row is the detail without its trail), the root team every one; the reship's choices are the team's received restocks whose broken units are not all on a live reship, only the lines with units left, each line's supplier and store as ids the form resolves for the prefill — exactly what the create accepts (pinned). Two list indexes and a search index added on measurement (`00058`). Screens P5.

✅ Built 2026-11-19 (P5, screens) — the five accepted screens are live on `CustomShipmentService` (`features/customShipment/queries.ts`; the prototype's in-memory server now plays the API in Storybook, `.storybook/customShipmentStub.ts`), layout unchanged: the list paged and filtered by the server (status, kind, warehouse, free text from one letter); the reship's supplier prefilled from supplier_service's record (and its store named); a sample's racks on the pick page read from its take (`StockPickLocations`); the warehouse draws only what it is sent — no seller money, and a cost edit as *that* it changed, without the amounts.

---

## missing-goods-leave-a-note-on-the-custom-shipment

> Owner (Heri), in chat (2026-11-19): *"A"*, as recommended — to: when the warehouse cannot find a custom shipment's goods (a sample's units not on the rack the system picked, or a reship's broken units already thrown away), what does it do? **A** as an order ([missing-goods-send-the-order-back-to-pending](../inventory/order_decision.md#missing-goods-send-the-order-back-to-pending)): the warehouse writes *goods missing* (what, which rack) on the shipment's trail, it stays *Diminta*, the selling team sees the note and decides — its cancel puts the take back and a count finds the shortfall ([a-missing-unit-is-found-by-opname](../inventory/order_decision.md#a-missing-unit-is-found-by-opname)); **B** the warehouse may cancel it itself; **C** nothing in the app — they talk and the team cancels.

**The verdict.** The warehouse records **goods missing** on the custom shipment — what is missing and from which rack — as a row on its trail. The shipment **stays *Diminta***; the owning selling team sees the note on its list and detail and decides (cancel, or wait). The warehouse never cancels it ([a-custom-shipment-is-cancelled-only-while-requested](#a-custom-shipment-is-cancelled-only-while-requested), [only-the-selling-team-cancels](../order/context_decision.md#only-the-selling-team-cancels)); the shortfall itself is found by a stock count.

*(Not asked — the build's step:)* the warehouse's control on the pick page is a new control, so it is drawn as a small Storybook prototype for the owner's accept before it goes live (backlog #88 P6).

⚠ Not built (backlog #88 P6).

✅ Built 2026-11-19 (P6) — `CustomShipmentMissingReport` (the shipping warehouse's picking roles, only while *Diminta*): one trail row of its own kind (`custom_shipment_logs.kind = goods_missing`, its lines in `custom_shipment_missing_lines`, migration 00059) — no status, no stock, nothing posts; the open note is `goods_missing` on Detail and List. The pick page's *Barang Tidak Ketemu*, live. Tests `custom_shipment_missing_report_test.go`, race `custom_shipment_missing_race_test.go`; stories `pages/custom-shipment-pick/stories/GoodsMissing.stories.tsx`.

---

## missing-reship-units-are-not-offered-again

> Owner (Heri), in chat (2026-11-19): *"A"*, as recommended — to Q1 of the #88 P6 Storybook prototype (the warehouse's *Barang Tidak Ketemu* on the pick page, its dialog, the trail row, the team's badge and notice; screenshots of the pick control and dialog (two racks; a reship), the team's list and detail, phone, and today's pick page as BEFORE): when the team cancels a reship after the warehouse noted its broken units are gone (already thrown away), does the reship form offer those units again? **A** no — the units the note names are not offered again: broken units are on no rack, no stock count can find them, the note is the only record they are gone; **B** yes, as [a-custom-shipment-is-cancelled-only-while-requested](#a-custom-shipment-is-cancelled-only-while-requested) says today — the team reads the note.

**The verdict.** A reship's broken units that a *goods missing* note names are **not offered again** for another reship once that reship is cancelled — they count as gone. The other units of a cancelled reship (not named by a note) are free again as before.

⚠ Not built (backlog #88 P6).

✅ Built 2026-11-19 (P6) — a cancelled reship's noted units (per line, the most one note named) count as gone in the create's cap and the reship choices, one sum (`reshipItemHeld`, under the restock row's lock); `ReshipLine.not_found`. Tests `TestCustomShipmentMissingReport_NamedReshipUnitsAreNotOfferedAgain`, race `TestRace_CustomShipmentMissing_CancelThenReshipOfTheNamedUnits`.

---

## the-goods-missing-badge-is-on-both-lists

> Owner (Heri), in chat (2026-11-19): *"A"*, as recommended — to Q2 of the #88 P6 Storybook prototype: does the warehouse's queue carry the same *goods missing* badge as the team's list? **A** yes, both lists — a second picker does not walk for goods already reported; **B** the team's list only.

**The verdict.** A custom shipment with a *goods missing* note carries the badge on **both** lists — the selling team's list and the warehouse's queue — while it is *Diminta*.

⚠ Not built (backlog #88 P6).

✅ Built 2026-11-19 (P6) — every List row of a *Diminta* parcel carries its open note (`goods_missing`), the team's and the warehouse's alike, no money; the badge on both lists. Test `TestCustomShipmentMissingReport_RecordedAgainTheLatestIsOpen`; stories `pages/custom-shipments/stories/GoodsMissing.stories.tsx`.

---

## the-goods-missing-prototype-is-accepted

> Owner (Heri), in chat (2026-11-19): *"A"* to both questions of the #88 P6 Storybook prototype (`pages/custom-shipment-pick|custom-shipment-detail|custom-shipments/stories/GoodsMissing.stories.tsx`; screenshots: the pick control and its dialog (two racks; a reship), the warehouse's view after recording, the team's list badge and detail notice, the warehouse queue badge, phone, and today's pick page as BEFORE) — [missing-reship-units-are-not-offered-again](#missing-reship-units-are-not-offered-again), then [the-goods-missing-badge-is-on-both-lists](#the-goods-missing-badge-is-on-both-lists) — after being told the design would be recorded as accepted with the second answer.

**The verdict.** The *goods missing* note of [missing-goods-leave-a-note-on-the-custom-shipment](#missing-goods-leave-a-note-on-the-custom-shipment) is drawn as accepted:

| | as drawn |
| --- | --- |
| the control | **Barang Tidak Ketemu** — on the warehouse's pick page only, only while *Diminta*, for the warehouse roles that pick (a header button on desktop, an icon in the title row on a phone) |
| the dialog | one row per rack the sample's take used, prefilled, each with its own maximum; a reship's rows name no rack; how many are missing; an optional note (≤ 200 characters) |
| after recording | the shipment stays *Diminta*; nothing moves (no status, no stock write, nothing posts); the scan still works if the goods turn up |
| the trail | a row of its own kind, worded for the warehouse and for the team (never read as a cost edit) |
| the team | a badge beside the status on its list (its own line on a phone) and a notice on the detail, only while *Diminta*; *Batalkan* stays; a cancel removes the notice, the trail keeps the row |

*(Not asked — the prototype's defaults:)* the warehouse may record again while *Diminta*; a unit found on another rack is simply taken ([a-wrong-rack-pick-waits-for-the-count](../inventory/context_decision.md#a-wrong-rack-pick-waits-for-the-count)); the wording *Barang Tidak Ketemu* (not *Hilang*, the Lost status, nor *Barang kurang*, the restock's short-at-the-door) — the owner may rename it.

⚠ Not built — the prototype only (backlog #88 P6).

✅ Built 2026-11-19 (P6) — live as drawn: the prototype's gate dropped (`features/customShipment/GoodsMissing.tsx`), the control, dialog, trail row, badges and notices on `CustomShipmentMissingReport` and the parcel's `goods_missing` / GOODS_MISSING trail rows; the 22 prototype stories now run the live screens against the stub.

---

## the-reship-line-counts-the-units-not-found

> Owner (Heri), in chat (2026-11-19): *"C"*, as recommended — to: the reship form's helper sentence under a broken line reads *"{left} left · {broken} broken, {sent} already on a parcel"*; on a line whose units are both on a live reship and named by a goods-missing note ([missing-reship-units-are-not-offered-again](#missing-reship-units-are-not-offered-again)) it no longer adds up (the numbers — what is left, the input's max, the cap — are already right). **A** leave it; **B** a separate muted line *"{gone} not found"*; **C** extend the sentence: *"… {sent} on a parcel, {gone} not found"*.

**The verdict.** The reship form's line sentence names the units a goods-missing note took out: *"{left} left · {broken} broken, {sent} on a parcel, {gone} not found"* — the *not found* part only when {gone} > 0, so the sentence always adds up.

⚠ Not built (backlog #88 P6 follow-up).

✅ Built 2026-11-19 (P6 follow-up) — the reship form's broken line reads *"{left} left · {broken} broken, {sent} on a parcel, {gone} not found"* from `ReshipLine.not_found` (no proto change); without a gone unit the sentence is unchanged, and with gone units but none on a parcel it reads *"{left} left · {broken} broken, {gone} not found"* *(Not asked — the build's default: each part only when it holds a unit, as the sentence always did)*. en/id `customShipment.form.brokenLeftAfterSentGone` / `brokenLeftAfterGone`; stories `pages/custom-shipment-form/index.stories.tsx` (*A reship line counts the units not found*, *A reship line, not found only*).

---

## a-suppliers-reshipping-comes-in-as-a-custom-shipment

> Owner (Heri), in chat (2026-11-20): *"B, and we have table `restock_custom_shipments` to connect restock and custom shipment. that contain restock_id, resolution_id, custom_shipment_id, and inventory_transaction_id"* — after asking *"is custom shipping is support to track supplier send to warehouse ? its important for reshipping type"* (no: custom shipments only go out; an inbound parcel from a supplier is a restock — courier, resi, label photo, Tiba / Terima / Hilang). The options: how should a supplier's `reshipping` come in? A as a new restock linked to the problem restock (recommended); B an **inbound kind on custom shipments** (supplier → warehouse), with arrival steps of its own. **B, against my recommendation**, plus the link table in his own words.

**The verdict.** Custom shipments now go **both ways**: besides the two outbound kinds ([a-custom-shipment-is-a-parcel-that-is-not-an-order](#a-custom-shipment-is-a-parcel-that-is-not-an-order) — a sample; a problem restock's goods sent back, the `return`), a **supplier's reshipping** comes **in** as a custom shipment to the warehouse. A restock and its custom shipments are joined by **`restock_custom_shipments`**:

| field | |
| --- | --- |
| `restock_id` | the problem restock |
| `resolution_id` | its resolution row ([a-restock-problem-is-settled-by-resolution-rows](../inventory/restock_decision.md#a-restock-problem-is-settled-by-resolution-rows)) the parcel carries out |
| `custom_shipment_id` | the parcel — a `return` going out, or a `reshipping` coming in |
| `inventory_transaction_id` | the stock movement the parcel made |

⚠ My reading of the last column — the owner may correct it: for a `reshipping`, the stock-in when the supplier's goods are counted in; for a `return`, the movement of the units sent back if one is written (the broken units are on no rack today, so a `return` may write none).

*(Not decided yet, asked one at a time: how the inbound parcel arrives — its steps at the warehouse; what the received units are worth and whether any money moves; who creates the inbound parcel and when.)* ⛔ Not built — custom shipments are outbound only today.

🔄 *(2026-11-20)* **Settled in chat — how the inbound parcel arrives.** Owner: *"A"*, as recommended — A: a restock box's steps: **Tiba** (the warehouse signs for it at the door), **Terima** (it counts the box in — good units go on racks as stock; units that arrive broken or short are written down, so they stay open on the problem restock), **Hilang** if the parcel never comes; B: Terima only; C: no count, the seller marks it received. So an inbound reshipping parcel arrives through **Tiba → Terima**, or ends **Hilang**, worked by the crew as a restock box is ([lost-is-set-only-before-the-box-arrives](../inventory/restock_decision.md#lost-is-set-only-before-the-box-arrives) and the Tiba / Terima rules apply alike).

🔄 *(2026-11-20)* **Settled in chat — what the received units are worth.** Owner: *"B"* — **against my recommendation** (A: no new money, the units at the problem restock's unit price — `the-problem-price-is-filled-by-the-system`) — B: **the seller types a price** for the received units, e.g. when the supplier sends a different product or value; C: value 0. So the inbound parcel's units enter stock at **the price the seller types**, and the parcel may carry a product other than the problem restock's. ⚠ My reading — the owner may correct it: typing the price **moves no money** (the goods were paid for in the problem restock; the price only values the stock), and the seller types it with the parcel's lines, editable until Terima.

🔄 *(2026-11-20)* **Settled in chat — the inbound parcel's courier charge.** Owner: *"A"*, as recommended — A: as a restock box: a charge the courier asks at the door is paid by the warehouse, noted at Tiba and final at Terima, and the team owes it back through Team Balance ([the-courier-charge-is-noted-at-tiba-and-final-at-terima](../inventory/restock_decision.md#the-courier-charge-is-noted-at-tiba-and-final-at-terima), [the-warehouse-cost-is-the-couriers-charge-at-the-door](../inventory/restock_decision.md#the-warehouse-cost-is-the-couriers-charge-at-the-door)) — usually 0 when the supplier pays the shipping; B: the outbound two ways chosen at create; C: none recorded. So the inbound parcel takes **the restock's door charge**, not the outbound parcels' two ways.

🔄 *(2026-11-20)* **Settled in chat — who creates the inbound parcel, and when.** Owner: *"A"*, as recommended — A: the selling team, while it records the `reshipping` resolution on the problem restock: the lines (product, count, price), the courier and resi if it has them (the resi editable until Tiba, as a restock's), the warehouse it comes to (opening on the problem restock's warehouse); the warehouse then sees it in its incoming list like a restock on its way; B: the team creates the parcel on its own and links it after; C: the warehouse creates it when the box shows up. So **recording a `reshipping` resolution creates its inbound parcel**, by the selling team, in the same step.

🔄 *(2026-11-20)* **Confirmed in chat — `inventory_transaction_id`.** Owner: *"A"*, as recommended — A: a `reshipping` row links the stock-in made at its Terima; a `return` links none — the broken units sent back are on no rack; B: a `return` also writes a stock movement typed `return` and links it. So the ⚠ reading of that column above **is his rule**: the stock-in of the reshipped goods, and empty for a `return`.

🔄 *(2026-11-20)* **Confirmed in chat — the typed price moves no money.** Owner: *"A"*, as recommended — A: no; the goods were paid for in the problem restock, so the price the seller types only values the new stock and no account changes; B: the difference from the problem restock's price posts to the account. So the ⚠ reading *typing the price moves no money* above **is his rule**.

🔄 *(2026-11-20)* **Confirmed in chat — the price is editable until Terima.** Owner: *"A"*, as recommended — A: until Terima — once the warehouse counts the box in, the units are stock at that price, as a restock's lines stay editable until it is accepted ([the-lines-stay-editable-until-accepted](../inventory/restock_decision.md#the-lines-stay-editable-until-accepted)); B: until Tiba; C: never — fixed at the resolution. So the seller may change the inbound parcel's prices **until Terima**; the ⚠ reading above **is his rule**.

✅ Built (phase 1, backend) 2026-11-20 — backlog #101: kind `supplier_reshipping` (INBOUND), statuses `on_the_way` → `arrived` (Tiba) → `received` (Terima), or `lost`; created by `RestockResolutionCreate` with its `reshipping` row and the `restock_custom_shipments` link in one transaction; `CustomShipmentResiSet` (until Tiba), `CustomShipmentPricesSet` (until Terima, no money), `CustomShipmentMarkLost` (while on its way), `CustomShipmentArrive` (the door charge noted), `CustomShipmentReceive` (good units on a rack as a stock-in at the seller's price, its transaction linked; broken / short written on the line; the charge final and posted to Team Balance by liability from `CustomShipmentReceived`, event 414, as a `custom_shipment_fee`). A `return` row rides an outbound reship — made with it (`CustomShipmentCreate.resolution`) or linked. The warehouse reads no seller price. Migration `00060`; docs [rpc.md](../../services/inventory_service/rpc.md#restock-resolutions-and-the-inbound-parcel-backlog-101-p1--backend-built-2026-11-20). The screens are phase 2.
