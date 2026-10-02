# Decisions — order `design.md`

> ➡ **Every decision in this file has moved to [docs/technical/frontend/](../frontend)** (owner,
> 2026-10-02): the rules every screen follows to `context_decision.md`, each screen's own to its `<page>_decision.md`.
> The headings below stay as pointers so old links still land.

> ⚠ **EVERY DECISION BELOW IS ABOUT THE SELLING TEAM'S ORDER LIST AND ORDER DETAIL.** The warehouse reads `/orders`
> from the other end and keeps the screen it had — see
> [the-two-ends-are-two-screens](#the-two-ends-are-two-screens). Nothing here has been applied to it,
> and the owner has not designed it yet.

| decision | what it settles |
| --- | --- |
| [status-colours-are-carried-over-verbatim](../frontend/order_list_decision.md#status-colours-are-carried-over-verbatim) | every status keeps the hue it had, collisions included |
| [one-context-per-column-and-never-three-lines](../frontend/context_decision.md#one-context-per-column-and-never-three-lines) | pairing is only for one fact read twice — it REPLACES the six-paired-cells decision |
| [the-row-shows-total-beli-and-total-mp](../frontend/order_list_decision.md#the-row-shows-total-beli-and-total-mp) | two totals: what it cost us, and what the platform paid — it REPLACES an-order-total-is-goods-plus-fulfilment |
| [the-margin-is-mp-minus-total-beli](../frontend/order_list_decision.md#the-margin-is-mp-minus-total-beli) | margin and its percentage are both measured against the MARKETPLACE price |
| [the-ongkir-is-the-warehouses-to-set](../frontend/order_create_decision.md#the-ongkir-is-the-warehouses-to-set) | shipping is priced by the building that ships it, so it is absent from the create screen |
| [every-date-gets-its-own-column](../frontend/order_list_decision.md#every-date-gets-its-own-column) | three dates, three columns — it REPLACES two-dates-and-two-totals-with-ours-leading |
| [a-filtered-status-shows-its-own-date](../frontend/order_list_decision.md#a-filtered-status-shows-its-own-date) | the third date appears only under the tab it answers |
| [harga-beli-team-and-gudang-are-on-the-row](../frontend/order_list_decision.md#harga-beli-team-and-gudang-are-on-the-row) | all three earn a place, none of them a column of its own |
| [the-action-menu-is-a-table-keyed-by-status](../frontend/order_list_decision.md#the-action-menu-is-a-table-keyed-by-status) | what you can do to an order, per state, in one place |
| [a-deadline-is-loud-or-it-is-nothing](../frontend/order_list_decision.md#a-deadline-is-loud-or-it-is-nothing) | four urgency bands, and an overdue order tints its whole row |
| [the-preview-became-the-order-list](../frontend/order_list_decision.md#the-preview-became-the-order-list) | a seller's `/orders` IS this screen now — the preview page is gone |
| [the-two-ends-are-two-screens](../frontend/warehouse_order_list_decision.md#the-two-ends-are-two-screens) | the warehouse keeps its old list — almost nothing on the seller's row is a fact a picker acts on |
| [the-order-detail-is-one-page-of-sections](../frontend/order_detail_decision.md#the-order-detail-is-one-page-of-sections) | the detail is one page of sections with a scrolling left nav — not three tabs |
| [the-order-detail-lines-are-priced-at-harga-beli](../frontend/order_detail_decision.md#the-order-detail-lines-are-priced-at-harga-beli) | the item table shows what we PAID, so the perincian adds up to the list's figures |
| [the-detail-margin-is-mp-minus-system](../frontend/order_detail_decision.md#the-detail-margin-is-mp-minus-system) | margin = total MP − total sistem, the list's formula read from the detail |
| [the-detail-preview-became-the-order-detail](../frontend/order_detail_decision.md#the-detail-preview-became-the-order-detail) | a seller's `/orders/:id` IS the approved page now — and it keeps the two wired features the preview lacked |
| [settlement-replaces-withdrawal-on-the-order](../frontend/order_detail_decision.md#settlement-replaces-withdrawal-on-the-order) | the order's money-back section IS the settlement ledger; withdrawals stay a shop-level question |
| [the-phone-header-is-one-row](../frontend/context_decision.md#the-phone-header-is-one-row) | on a phone the sticky block is the number, the stage and `⋯` — plus the section chips |
| [a-phone-reads-each-line-as-a-block](../frontend/context_decision.md#a-phone-reads-each-line-as-a-block) | the item table becomes one block per line below `md` |
| [the-draft-list-is-the-drafts-tab](../frontend/order_draft_decision.md#the-draft-list-is-the-drafts-tab) | `/order-drafts` wears the seller list's shell and row grammar, with only the columns a draft can fill |
| [the-draft-summary-is-three-cards](../frontend/order_draft_decision.md#the-draft-summary-is-three-cards) | total and oldest are real; ready counts this page only, says so, and carries a ⚠ |
| [the-draft-cards-are-the-order-list-cards](../frontend/order_draft_decision.md#the-draft-cards-are-the-order-list-cards) | one `SummaryCard` and one grid for both tabs, so a card is the same shape and size on each |
| [the-summary-follows-the-tab](../frontend/order_list_decision.md#the-summary-follows-the-tab) | All Status shows the piles; a status tab shows its own figures as cards; the measure line is gone. The cards fill the row again |
| [a-summary-card-is-at-most-a-fifth](../frontend/context_decision.md#a-summary-card-is-at-most-a-fifth) | cards fill the row but never exceed 1/5 of it on a large screen — 1/4, 1/3, 1/2 as it narrows |
| [a-phone-filters-from-a-sheet](../frontend/context_decision.md#a-phone-filters-from-a-sheet) | on a phone the search stays in the row; every other filter is in a bottom sheet behind a counted Filter button |
| [the-draft-keeps-its-own-page](../frontend/order_draft_decision.md#the-draft-keeps-its-own-page) | `/order-drafts/:id` stays the separate draft page — opening the draft in the order form was tried and reverted |
| [the-draft-page-wears-the-order-form](../frontend/order_draft_decision.md#the-draft-page-wears-the-order-form) | the draft page uses the create form's cards and rail; save in any state, Promote as strict as Create |
| [a-draft-row-maps-to-a-product-a-bundle-or-a-split](../frontend/order_draft_decision.md#a-draft-row-maps-to-a-product-a-bundle-or-a-split) | each scraped row maps to one product, one bundle, or several products — a split suggests a bundle |
| [the-draft-sell-price-starts-from-the-rows](../frontend/order_draft_decision.md#the-draft-sell-price-starts-from-the-rows) | the sell price starts as Σ the rows' platform prices and can be typed over, down to 0 |
| [the-listing-is-information-the-mapping-sets-the-count](../frontend/order_draft_decision.md#the-listing-is-information-the-mapping-sets-the-count) | a row's scraped quantity and price are shown, not edited; the count is set on the mapping, and a different one is flagged |
| [the-draft-preview-became-the-draft-page](../frontend/order_draft_decision.md#the-draft-preview-became-the-draft-page) | `/order-drafts/:id` IS the draft page in the order form's clothes now — the built page is gone |
| [the-warehouse-row-is-the-old-systems-columns](../frontend/warehouse_order_list_decision.md#the-warehouse-row-is-the-old-systems-columns) | the warehouse list's row: created by, marketplace shop, AWB, qty, status, date, MP date — the deadline replaces the MP date's "ago" when there is one |
| [the-warehouse-tabs-are-the-processed-steps](../frontend/warehouse_order_list_decision.md#the-warehouse-tabs-are-the-processed-steps) | the warehouse's tabs are Perlu konfirmasi, the four steps of Diproses and Semua — not the order's statuses; a row's badge says its tab's word |
| [the-confirmed-step-reads-dikonfirmasi](../frontend/warehouse_order_list_decision.md#the-confirmed-step-reads-dikonfirmasi) | the CONFIRMED step is named "Dikonfirmasi", not "Perlu konfirmasi" |
| [the-warehouse-filters-by-team-marketplace-and-courier](../frontend/warehouse_order_list_decision.md#the-warehouse-filters-by-team-marketplace-and-courier) | search, date, seller team, marketplace, courier — and the shipment state only where parcels have been handed over |
| [a-warehouse-step-moves-by-the-old-systems-table](../frontend/warehouse_order_list_decision.md#a-warehouse-step-moves-by-the-old-systems-table) | the old system's transition table: skips forward allowed, back only to Dikonfirmasi and with a reason |
| [scanning-is-the-crews-hands](../frontend/warehouse_order_list_decision.md#scanning-is-the-crews-hands) | three scans — handover, find a parcel, validate the items — plus selection, bulk actions, labels and export |
| [the-bulk-actions-are-always-on-screen](../frontend/warehouse_order_list_decision.md#the-bulk-actions-are-always-on-screen) | the action bar shows from the start; tick-only actions are off until a tick, and Export takes the filtered list when nothing is ticked |

---

## status-colours-are-carried-over-verbatim

➡ **Moved** to [frontend/order_list_decision.md](../frontend/order_list_decision.md#status-colours-are-carried-over-verbatim) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## one-context-per-column-and-never-three-lines

➡ **Moved** to [frontend/context_decision.md](../frontend/context_decision.md#one-context-per-column-and-never-three-lines) — a rule for every screen (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-row-shows-total-beli-and-total-mp

➡ **Moved** to [frontend/order_list_decision.md](../frontend/order_list_decision.md#the-row-shows-total-beli-and-total-mp) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-margin-is-mp-minus-total-beli

➡ **Moved** to [frontend/order_list_decision.md](../frontend/order_list_decision.md#the-margin-is-mp-minus-total-beli) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-ongkir-is-the-warehouses-to-set

➡ **Moved** to [frontend/order_create_decision.md](../frontend/order_create_decision.md#the-ongkir-is-the-warehouses-to-set) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## every-date-gets-its-own-column

➡ **Moved** to [frontend/order_list_decision.md](../frontend/order_list_decision.md#every-date-gets-its-own-column) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## a-filtered-status-shows-its-own-date

➡ **Moved** to [frontend/order_list_decision.md](../frontend/order_list_decision.md#a-filtered-status-shows-its-own-date) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## harga-beli-team-and-gudang-are-on-the-row

➡ **Moved** to [frontend/order_list_decision.md](../frontend/order_list_decision.md#harga-beli-team-and-gudang-are-on-the-row) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-action-menu-is-a-table-keyed-by-status

➡ **Moved** to [frontend/order_list_decision.md](../frontend/order_list_decision.md#the-action-menu-is-a-table-keyed-by-status) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## a-deadline-is-loud-or-it-is-nothing

➡ **Moved** to [frontend/order_list_decision.md](../frontend/order_list_decision.md#a-deadline-is-loud-or-it-is-nothing) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-preview-became-the-order-list

➡ **Moved** to [frontend/order_list_decision.md](../frontend/order_list_decision.md#the-preview-became-the-order-list) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-two-ends-are-two-screens

➡ **Moved** to [frontend/warehouse_order_list_decision.md](../frontend/warehouse_order_list_decision.md#the-two-ends-are-two-screens) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-order-detail-is-one-page-of-sections

➡ **Moved** to [frontend/order_detail_decision.md](../frontend/order_detail_decision.md#the-order-detail-is-one-page-of-sections) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-order-detail-lines-are-priced-at-harga-beli

➡ **Moved** to [frontend/order_detail_decision.md](../frontend/order_detail_decision.md#the-order-detail-lines-are-priced-at-harga-beli) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-detail-margin-is-mp-minus-system

➡ **Moved** to [frontend/order_detail_decision.md](../frontend/order_detail_decision.md#the-detail-margin-is-mp-minus-system) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-detail-preview-became-the-order-detail

➡ **Moved** to [frontend/order_detail_decision.md](../frontend/order_detail_decision.md#the-detail-preview-became-the-order-detail) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## settlement-replaces-withdrawal-on-the-order

➡ **Moved** to [frontend/order_detail_decision.md](../frontend/order_detail_decision.md#settlement-replaces-withdrawal-on-the-order) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-phone-header-is-one-row

➡ **Moved** to [frontend/context_decision.md](../frontend/context_decision.md#the-phone-header-is-one-row) — a rule for every screen (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## a-phone-reads-each-line-as-a-block

➡ **Moved** to [frontend/context_decision.md](../frontend/context_decision.md#a-phone-reads-each-line-as-a-block) — a rule for every screen (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-draft-list-is-the-drafts-tab

➡ **Moved** to [frontend/order_draft_decision.md](../frontend/order_draft_decision.md#the-draft-list-is-the-drafts-tab) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-draft-summary-is-three-cards

➡ **Moved** to [frontend/order_draft_decision.md](../frontend/order_draft_decision.md#the-draft-summary-is-three-cards) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-draft-cards-are-the-order-list-cards

➡ **Moved** to [frontend/order_draft_decision.md](../frontend/order_draft_decision.md#the-draft-cards-are-the-order-list-cards) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-summary-follows-the-tab

➡ **Moved** to [frontend/order_list_decision.md](../frontend/order_list_decision.md#the-summary-follows-the-tab) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## a-summary-card-is-at-most-a-fifth

➡ **Moved** to [frontend/context_decision.md](../frontend/context_decision.md#a-summary-card-is-at-most-a-fifth) — a rule for every screen (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## a-phone-filters-from-a-sheet

➡ **Moved** to [frontend/context_decision.md](../frontend/context_decision.md#a-phone-filters-from-a-sheet) — a rule for every screen (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-draft-keeps-its-own-page

➡ **Moved** to [frontend/order_draft_decision.md](../frontend/order_draft_decision.md#the-draft-keeps-its-own-page) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-draft-page-wears-the-order-form

➡ **Moved** to [frontend/order_draft_decision.md](../frontend/order_draft_decision.md#the-draft-page-wears-the-order-form) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## a-draft-row-maps-to-a-product-a-bundle-or-a-split

➡ **Moved** to [frontend/order_draft_decision.md](../frontend/order_draft_decision.md#a-draft-row-maps-to-a-product-a-bundle-or-a-split) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-draft-sell-price-starts-from-the-rows

➡ **Moved** to [frontend/order_draft_decision.md](../frontend/order_draft_decision.md#the-draft-sell-price-starts-from-the-rows) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-listing-is-information-the-mapping-sets-the-count

➡ **Moved** to [frontend/order_draft_decision.md](../frontend/order_draft_decision.md#the-listing-is-information-the-mapping-sets-the-count) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-draft-preview-became-the-draft-page

➡ **Moved** to [frontend/order_draft_decision.md](../frontend/order_draft_decision.md#the-draft-preview-became-the-draft-page) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-warehouse-row-is-the-old-systems-columns

➡ **Moved** to [frontend/warehouse_order_list_decision.md](../frontend/warehouse_order_list_decision.md#the-warehouse-row-is-the-old-systems-columns) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-warehouse-tabs-are-the-processed-steps

➡ **Moved** to [frontend/warehouse_order_list_decision.md](../frontend/warehouse_order_list_decision.md#the-warehouse-tabs-are-the-processed-steps) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-confirmed-step-reads-dikonfirmasi

➡ **Moved** to [frontend/warehouse_order_list_decision.md](../frontend/warehouse_order_list_decision.md#the-confirmed-step-reads-dikonfirmasi) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-warehouse-filters-by-team-marketplace-and-courier

➡ **Moved** to [frontend/warehouse_order_list_decision.md](../frontend/warehouse_order_list_decision.md#the-warehouse-filters-by-team-marketplace-and-courier) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## a-warehouse-step-moves-by-the-old-systems-table

➡ **Moved** to [frontend/warehouse_order_list_decision.md](../frontend/warehouse_order_list_decision.md#a-warehouse-step-moves-by-the-old-systems-table) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## scanning-is-the-crews-hands

➡ **Moved** to [frontend/warehouse_order_list_decision.md](../frontend/warehouse_order_list_decision.md#scanning-is-the-crews-hands) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

## the-bulk-actions-are-always-on-screen

➡ **Moved** to [frontend/warehouse_order_list_decision.md](../frontend/warehouse_order_list_decision.md#the-bulk-actions-are-always-on-screen) — a screen decision (owner, 2026-10-02: screen decisions live in `docs/technical/frontend/`).

