# Decisions — the order drafts

The owner's decisions about **order drafts** — the Drafts tab (`/order-drafts`) and the draft page (`/order-drafts/:id`). **Append-only** (RULE 12): a reversed decision is renamed and its references grepped.

The rules every screen follows are in [context_decision.md](context_decision.md). These were recorded in
[technical/order/design_decision.md](../order/design_decision.md) first and moved here on 2026-10-02;
each old heading there now points here.

| decision | what it settles |
| --- | --- |
| [the-draft-list-is-the-drafts-tab](#the-draft-list-is-the-drafts-tab) | `/order-drafts` wears the seller list's shell and row grammar, with only the columns a draft can fill |
| [the-draft-summary-is-three-cards](#the-draft-summary-is-three-cards) | total and oldest are real; ready counts this page only, says so, and carries a ⚠ |
| [the-draft-cards-are-the-order-list-cards](#the-draft-cards-are-the-order-list-cards) | one `SummaryCard` and one grid for both tabs, so a card is the same shape and size on each |
| [the-draft-keeps-its-own-page](#the-draft-keeps-its-own-page) | `/order-drafts/:id` stays the separate draft page — opening the draft in the order form was tried and reverted |
| [the-draft-page-wears-the-order-form](#the-draft-page-wears-the-order-form) | the draft page uses the create form's cards and rail; save in any state, Promote as strict as Create |
| [a-draft-row-maps-to-a-product-a-bundle-or-a-split](#a-draft-row-maps-to-a-product-a-bundle-or-a-split) | each scraped row maps to one product, one bundle, or several products — a split suggests a bundle |
| [the-draft-sell-price-starts-from-the-rows](#the-draft-sell-price-starts-from-the-rows) | the sell price starts as Σ the rows' platform prices and can be typed over, down to 0 |
| [the-listing-is-information-the-mapping-sets-the-count](#the-listing-is-information-the-mapping-sets-the-count) | a row's scraped quantity and price are shown, not edited; the count is set on the mapping, and a different one is flagged |
| [the-draft-preview-became-the-draft-page](#the-draft-preview-became-the-draft-page) | `/order-drafts/:id` IS the draft page in the order form's clothes now — the built page is gone |
| [the-draft-price-is-platform-total](#the-draft-price-is-platform-total) | the draft's price is the pushed `platform_total`; a typed-over price goes onto the order at create, never back to the draft |
| [a-draft-stores-no-mapping](#a-draft-stores-no-mapping) | a draft's rows are a reference; the create form maps each to a product, a bundle or a split, in one sitting, straight into `order_items` |
| [the-draft-row-names-the-person-and-the-app](#the-draft-row-names-the-person-and-the-app) | the *Dibuat* cell's second line is `oleh <name> via <app>`, one line, truncated with the whole on hover |

## the-draft-list-is-the-drafts-tab

> Owner, in chat (2026-09-30): *"sekarang draft sesuaikan dengan all, tapi jelas tidak selengkap di sana"* —
> the analysis was approved before building.

`/order-drafts` keeps its own route but reads as the **Drafts tab of the seller's order list**: the same heading,
the same stage strip with Drafts active, the same row grammar. It had been the old six-status strip, so clicking
Drafts swapped the whole strip under the reader.

```mermaid
flowchart LR
  L["/orders — StageTabs"] -->|"Drafts tab"| D["/order-drafts — StageTabs, Drafts active"]
  D -->|"any stage tab, ?status="| L
  D -->|"row click"| E["/order-drafts/:id"]
```

| order list column | on a draft | from |
| --- | --- | --- |
| ID Order + stage under it | reference (copyable) + **what is left** under it: `Ready` or the first gap, `+n` for the rest, all on the title | `external_id`, `draftGaps` |
| Resi | — | no field |
| Toko, badge under | Toko | `shop_id` |
| Dipesan + oleh | **Dibuat** + oleh, with a real author | `created_at_unix`, `author_user_id` |
| Tgl MP + deadline | **Diubah** | `updated_at_unix` |
| Beli · Total MP · Margin | — | a draft has no cost or MP figure, and the list returns no lines |
| *(draft only)* | Baris: `2`, or `1 of 3 unmapped` | `item_count`, `unmapped_item_count` |
| Aksi | kebab: Open · Delete (confirms) | Promote stays on the detail, which checks readiness |

- **Kept, draft only:** the checkbox and bulk delete — pruning is half this screen's job.
- **Dropped:** summary tiles, filter bar, Export and Import, the overdue tint. None has data on a draft.
- **No ⚠ on the row.** Every cell is a real field. The one mark on the page is the strip's `statusSet`.
- **The whole row opens the draft**; the checkbox, the copy button and the kebab stop the click.
- **A warehouse keeps the old strip here too**, matching its own unredesigned list.
- `listQuery` + `RefreshOverlay`, which the page had neither of.
- Moved to shared homes now that two pages use them: `CopyText` → `components/chrome/` (with a story), and
  `OrderRowCells`, `StageTabs`, `deadlineMock`, `rowMock` → `features/orders/`. `StageTabs` takes its ⚠ from the
  calling screen.

⚠ **Dropped from the row: the pushing app's name** (`source`), which sat under the reference. The readiness took
that line. See [design_clarify.md](../order/design_clarify.md#question).

⚠ Found while analysing: the build lets a person draft and promotes on the server, against two business
decisions — recorded in
[the-build-lets-a-person-draft-and-promotes-on-the-server](../../business/order/context_clarify.md#the-build-lets-a-person-draft-and-promotes-on-the-server).

## the-draft-summary-is-three-cards

> Owner, in chat (2026-09-30): asked which statistics the existing data can carry, then *"3 teratas saja"*.

Three cards under the drafts page's tab strip, drawn like the order list's summary and, like it, controlling
nothing.

| card | value | source | real? |
| --- | --- | --- | --- |
| Draft | `2` | `page_info.total_items` | ✅ |
| Tertua | `2 hari` + the date | one row of `OrderDraftList` sorted `id` ASC — ids are issued in order | ✅ |
| Siap (halaman ini) | `1 dari 2` | `draftGaps` over the drafts on screen | ⚠ `readyCount` — the right rule, the wrong scope |

```mermaid
flowchart LR
  L["OrderDraftList, page"] --> T["Draft — total_items"]
  L --> R["Siap — this page only ⚠"]
  O["OrderDraftList, id ASC, limit 1"] --> A["Tertua — age of the first draft"]
  X["OrderDraftStat — does not exist"] -.->|"would replace"| R
```

- **Not built, and why:** unmapped totals, missing shop/warehouse/customer counts and per-app counts — each needs a
  server aggregate, and a page-only count on a screen whose whole point is the backlog would read as the backlog.
- The stub transport now honours the list's sort, and the fixtures' draft ids follow their creation dates, so
  the oldest card is correct in Storybook as it is on the server.

## the-draft-cards-are-the-order-list-cards

> Owner, in chat (2026-09-30): *"gunakan referensi statistik dari list secara bentuk dan ukuran, biar kelihatan
> seragam"*.

The card and the strip are now ONE component, `features/orders/SummaryCard.tsx` (`SummaryCard` + `SUMMARY_GRID`),
drawn by both the order list's summary and the drafts page's. At 1440px a card is 145px wide on both.

| | before | after |
| --- | --- | --- |
| draft card | own copy: muted label, `lg` figure, cards stretched to fill the row | the list's card: bold `fg.label` label, `md` figure, quiet line |
| grid | draft `minChildWidth 10rem`, list `8.5rem`, both `auto-fit` | one grid, `auto-fill` of `8.5rem` |
| "this page" on Siap | in the label | on the card's own line, under `1 of 2` |

```mermaid
flowchart LR
  C["SummaryCard + SUMMARY_GRID"] --> O["order list summary — 9 cards"]
  C --> D["drafts summary — 3 cards"]
```

⚠ **`auto-fill`, not `auto-fit`, and it touches the order list too.** auto-fit collapses empty tracks and
stretches the cards, which is why three draft cards filled the width. With auto-fill the order list's nine
cards are unchanged at 1440px, but on a screen wide enough for more than nine tracks they no longer stretch
to the edge.

## the-draft-keeps-its-own-page

> Owner, in chat (2026-09-30): *"kembalikan, tetap /:id"* — asked which part, answered **the old draft page**.

The draft was opened IN the order create form for one round (draft mode: seeded form, a picker per scraped row,
Save as Draft updating the draft, Create consuming it). The owner reverted it: `/order-drafts/:id` is the separate
draft page again — mapping table, Save, Promote — and the order create form is as it was.

```mermaid
flowchart LR
  L["/order-drafts"] -->|"row"| D["/order-drafts/:id — the draft page, Save + Promote"]
  N["/orders/new?draft=ID"] --> F["the order form, with the scraped text read-only beside it"]
```

- Kept from that round: the order form's phone grid is `minmax(0, 1fr)`, so a wide lines table scrolls in its
  own box instead of pushing the page past the screen.
- The business contradiction (a person drafts, Promote finalizes on the server) stands, with a note that the
  form route was tried —
  [the-build-lets-a-person-draft-and-promotes-on-the-server](../../business/order/context_clarify.md#the-build-lets-a-person-draft-and-promotes-on-the-server).

## the-draft-page-wears-the-order-form

> Owner, in chat (2026-09-30): *"yang aku maksudkan sesuaikan itu secara ui dan form"* — then, while brainstorming:
> *"draft boleh saja tidak lengkap … tapi pasti error atau dibatasi sebelum promote to order"*, *"seperti biasa warning
> saja"*, *"aman, tidak masalah tidak disimpan"*, and the two-price columns.

The draft keeps its own page ([the-draft-keeps-its-own-page](#the-draft-keeps-its-own-page)), drawn with the order
create form's parts. Preview: `Pages/Order/OrderDraftNextPage` (`pages/order-draft-next/`), not routed yet.

```mermaid
flowchart TB
  H["header — Draft ref · source · Delete"] --> W["warehouse band"]
  W --> L["left: receipt card · order information · items (scraped rows) · return mapping · customer · extras"]
  W --> R["rail: credit · profit (real) · totals & invoice · note + Save / Promote + what is missing"]
```

| | rule |
| --- | --- |
| layout | the create form's cards, in its order, and its sticky money rail |
| what a draft does not store | on screen with a ⚠ as usual — receipt, references, tracking number, note, dates, username (`draftKeeps`); the owner accepted they are not kept |
| Save | any state; only the changed fields are sent (each one becomes touched) |
| Promote | refused until the order could be placed — shop, warehouse, customer, every row mapped, stock, saved — then the create form's own checks: an error stops it, a warning can be overruled |
| 🔄 *(2026-10-29)* | Promote is `OrderCreate` with the draft's id and sends what is on screen ([a-draft-becomes-an-order-through-order-create](../../business/order/context_decision.md#a-draft-becomes-an-order-through-order-create)): *saved* is no longer required, a bundle or split row no longer refuses it, the sell price is the one on screen, and the marketplace ref is required. Receipt, tracking number and note reach the order |
| prices | per row: HPP (from the warehouse, as on create) **and** the marketplace price (the draft's own, editable); the sell price is their sum and the profit estimate reads it — real, not typed |

- The create form's cards moved to `features/orders/form/` (with its `pending`, `checks`, `bundles` and samples), so both
  screens draw the same parts. Its invoice and credit rows are `form/money.ts`, used by both.

## a-draft-row-maps-to-a-product-a-bundle-or-a-split

> Owner, in chat (2026-09-30): *"items draft sebenarnya bisa antara produk atau bundle dan tiap bundle juga bisa
> dimapping"* — then: split allowed but suggest a bundle, bundle quantity like create, the package's price stays on
> the package row, and mappings are not remembered.

```mermaid
flowchart LR
  S["scraped row — Paket Hemat × 2, MP 80.000"] --> M{"map as"}
  M -->|"Produk"| P["one product × 2"]
  M -->|"Bundle"| B["template slots — cap = rule × 2"]
  M -->|"Pecah"| X["products per unit × 2"] -.->|"suggested"| NB["Make It a Bundle ⚠"]
```

| | rule |
| --- | --- |
| three ways | a product; a bundle (its slots filled, each capped at rule × the row's quantity); a split into several products at a quantity per listing unit |
| split | allowed, because a bundle is optional; the row offers **Make It a Bundle** (⚠ `makeBundle` — templates are samples) |
| price | the marketplace price stays on the package row; HPP is the sum of what fills it |
| memory | a mapping is NOT remembered for the next draft |
| storing | only a product mapping is stored — a draft line holds one `product_id`. A bundle or split row is shown and counted, saved unmapped, and blocks Promote (⚠ `rowBundle`, `rowSplit`) until the contract can hold it ([design_clarify.md](../order/design_clarify.md#question)) |

## the-draft-sell-price-starts-from-the-rows

> Owner, in chat (2026-09-30): *"sell price masih mungkin untuk diganti, bisa juga kita masuk di kontrak awal atau 0"*.

The draft page's sell price is a field again, as on the create form — not a read-only sum.

```mermaid
stateDiagram-v2
  [*] --> Follows: seeded as the sum of the rows' marketplace prices, or empty
  Follows --> Typed: somebody types
  Typed --> Typed: an empty box is 0, it does not snap back
  Typed --> Follows: Use the Rows' Prices
```

- It follows the rows while untouched; typing takes it over, down to 0; **Use the Rows' Prices** hands it back.
- ⚠ `sellPrice` — a draft has no sell price, so a typed one is not kept. It could arrive with the draft from the
  start ([design_clarify.md](../order/design_clarify.md#question)).
- Refines [the-draft-page-wears-the-order-form](#the-draft-page-wears-the-order-form), whose price row said the sell
  price is the rows' sum.
- The split row's product picker keeps a product row's width instead of stretching across the row.

## the-listing-is-information-the-mapping-sets-the-count

> Owner, in chat (2026-09-30): *"harga cuma info, jumlah pun cuma info, tapi bisa jadi indicator warning jika
> jumlahnya tidak sesuai, di split, qty per satuannya luruskan dengan pilih produk"*.

```mermaid
flowchart LR
  L["Listing: 2 × Rp 55.000 — information"] --> M["mapping: product × count, or count bundles"]
  M -->|"count = 2"| OK["no flag"]
  M -->|"count ≠ 2"| W["Sending 1, the listing says 2 — a warning, never a refusal"]
```

| | rule |
| --- | --- |
| the listing's quantity and price | shown under the scraped text, like the text itself; not editable |
| the count | set beside the product picker, or as the number of bundles; starts at the listing's quantity |
| a different count | flagged on the row, never refused — the buyer may have changed it, or the scrape misread it |
| split | parts are per listing unit × the listing's quantity, so a split has no count to differ; each part's picker and quantity sit on one line under column names given once |
| price | only the sell price is corrected, at the order level ([the-draft-sell-price-starts-from-the-rows](#the-draft-sell-price-starts-from-the-rows)) |

- ⚠ `listingQty` — a draft line holds one quantity, so a different count replaces the listing's on save, and the
  warning is gone the next time the draft opens. Refines
  [the-draft-page-wears-the-order-form](#the-draft-page-wears-the-order-form), whose price row had the marketplace
  price editable per row.

## the-draft-preview-became-the-draft-page

> Owner, in chat (2026-09-30): *"oke, sudah bagus"*, then *"pasang sekarang"*.

The preview replaced the built draft page at `/order-drafts/:id`; the route and its export name did not change.

```mermaid
flowchart LR
  P["pages/order-draft-next — the preview"] -->|"moved into"| D["pages/order-draft-detail — /order-drafts/:id"]
  O["the built page: mapping table, typed price, OrderTotals"] -->|"deleted"| X["gone"]
```

- `pages/order-draft-detail/` now holds the page, `rows.ts`, `pending.ts` and `components/DraftRowsCard.tsx`; its story is
  `Pages/Order/OrderDraftDetailPage` with the preview's stories.
- `features/orders/OrderTotals.tsx` is deleted — the built page was its only user.
- The e2e's draft-detail test needed no change: `draft-detail-page`, `draft-line-scraped-N`, `draft-line-unmapped-N`,
  `draft-promote`, `draft-gaps`, `draft-customer-name` and `draft-save` all carried over.

---

## the-draft-price-is-platform-total

> Owner, in chat (2026-10-22): **"yes"** to *"close Q15?"* — [technical order Q15](../order/design_clarify.md#question),
> *"should a draft carry a sell price from the start?"*, which I read as answered by order context §Table That Must Have
> (`order_drafts.platform_total`) and §Order Draft Behavior point 3 (finalizing is done in the frontend). As recommended.

**The verdict.** A draft's price is its **`platform_total`** — the buyer-paid total the app pushes with it. The create
form is seeded from it and the CS may type over it; whatever the form holds is saved as the **order's** `platform_total`
at create. Nothing is saved back to the draft, which is deleted.

```mermaid
flowchart LR
  A["the app's push"] -->|"platform_total"| D["the draft"]
  D -->|"seeds"| F["the create form - the CS may type over it"]
  F -->|"at create"| O["orders.platform_total - required"]
  F --> X["the draft is deleted"]
```

**The spec.**

| | |
| --- | --- |
| the seed | `order_drafts.platform_total`. When the app sends none, the rows' platform prices summed, as [the-draft-sell-price-starts-from-the-rows](#the-draft-sell-price-starts-from-the-rows) has it |
| a typed price | kept — on the order, not the draft |
| the mark | `sellPrice` on the draft page goes |

---

## a-draft-stores-no-mapping

> Owner, in chat (2026-10-22): **"yes"** to *"close Q14?"* — [technical order Q14](../order/design_clarify.md#question),
> *"what does a draft line map to?"*, which I read as answered by order context §Table That Must Have
> (`order_draft_platform_items` carries no product) and §Order Draft Behavior points 3–5. As recommended.

**The verdict.** A draft stores **no mapping**. Its rows (`order_draft_platform_items`) are a reference. The CS maps each
row in the **create form** — to a product, a bundle, or a split, as
[a-draft-row-maps-to-a-product-a-bundle-or-a-split](#a-draft-row-maps-to-a-product-a-bundle-or-a-split) describes — and
the result goes straight into `order_items` when the order is created. The draft is then deleted.

```mermaid
flowchart LR
  R["order_draft_platform_items - title, price, qty, total"] -->|"seed, reference only"| F["the create form - map each row"]
  F -->|"product, bundle or split"| O["order_items"]
  F --> X["the draft is deleted"]
```

**The spec.**

| | |
| --- | --- |
| the draft | keeps no `product_id` and no bundle or split on its rows |
| one sitting | a mapping half done and abandoned is lost — accepted with this decision |
| the draft page | its mapping Save goes, and with it the marks `rowBundle`, `rowSplit`, `listingQty` |
| ⚠ supersedes | the *storing* row of [a-draft-row-maps-to-a-product-a-bundle-or-a-split](#a-draft-row-maps-to-a-product-a-bundle-or-a-split) — the three ways to map stand, storing them does not |
| a bundle on the order | how a bundle lands on `order_items` is the bundle design's ([product_bundle.md](../../business/product/product_bundle.md)), not this |
| the build | still saves and promotes on the server — [the-build-lets-a-person-draft-and-promotes-on-the-server](../../business/order/context_clarify.md#the-build-lets-a-person-draft-and-promotes-on-the-server) |
| 🔄 *(2026-10-29)* | the promote half is done: Promote is `OrderCreate` with the draft's id, built from the page, so the mapping on screen goes straight into `order_items` ([a-draft-becomes-an-order-through-order-create](../../business/order/context_decision.md#a-draft-becomes-an-order-through-order-create)). The draft page's Save still stores a row's product mapping |

---

## the-draft-row-names-the-person-and-the-app

> Owner, in chat (2026-10-29): *"or oleh and via ?"*, then *"yes, follow your recomendation"* — to
> [design_clarify.md](../order/design_clarify.md#question) question 13, *"where does a draft's pushing app go on the
> row?"*. My first answer was `via <app>` replacing `oleh <name>`. The owner's counter was to show both, and the
> recommendation became both on **one** line.

**The verdict.** The draft list's *Dibuat* cell keeps two lines: the date, then **`oleh <name> via <app>`**. `<name>` is
the draft's `author_user_id`, the login the app pushed with, and `<app>` is the draft's `source`. Both answer one question,
who made this draft, so they share a line, and the cell stays within
[one-context-per-column-and-never-three-lines](context_decision.md#one-context-per-column-and-never-three-lines).

```
Dibuat
29 Okt 13:05
oleh Ani via ScraperX
```

```mermaid
flowchart LR
  d["a draft"] --> a["author_user_id - Ani"]
  d --> s["source - ScraperX"]
  a --> l["line 2 - oleh Ani via ScraperX"]
  s --> l
  l -.->|"too long"| h["truncated, the whole line on hover"]
```

**The spec.**

| | |
| --- | --- |
| both known | `oleh Ani via ScraperX` (en: `by Ani via ScraperX`) |
| no author name | `via ScraperX` |
| `source` = `manual` | `oleh Ani` only. A form-made draft is the build's, not an app's ([the-build-lets-a-person-draft-and-promotes-on-the-server](../../business/order/context_clarify.md#the-build-lets-a-person-draft-and-promotes-on-the-server)), so it names no app |
| too long | one line, clamped, the whole line in its hover title |
| how the app logs in | not answered: per person, `oleh` says who ran the scrape; one token per team, it repeats on every row. The line holds either way |
| the order list | unchanged: an order has no `source`, so its *Dibuat* cell stays `oleh <name>` |
| ✅ built *(2026-10-29)* | `CreatedCell`'s `via` in [OrderRowCells.tsx](../../../frontend/src/features/orders/OrderRowCells.tsx), passed by [pages/order-drafts](../../../frontend/src/pages/order-drafts/index.tsx). Pinned by story `TheRowIsRealFieldsOnly`; draft 201's fixture source is now `ScraperX` |
