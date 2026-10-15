# Decisions — the order drafts

The owner's decisions about **order drafts** — the drafts list (`/order-drafts`), once the order list's Drafts tab, and the draft opened in the order form (`/orders/new?draft=`), once a page of its own. **Append-only** (RULE 12): a reversed decision is renamed and its references grepped.

The rules every screen follows are in [context_decision.md](context_decision.md). These were recorded in
[technical/order/design_decision.md](../order/design_decision.md) first and moved here on 2026-10-02;
each old heading there now points here.

| decision | what it settles |
| --- | --- |
| [the-draft-list-is-the-drafts-tab](#the-draft-list-is-the-drafts-tab) | `/order-drafts` wears the seller list's shell and row grammar, with only the columns a draft can fill — ⚠ its heading and its tab strip are replaced by [the-drafts-are-a-list-of-their-own](#the-drafts-are-a-list-of-their-own) |
| [the-drafts-are-a-list-of-their-own](#the-drafts-are-a-list-of-their-own) | the drafts leave the order lists' tab strips and are a list of their own — its own title, Pesanan ▸ Daftar · Draf in the menu, its own stories; the row keeps the order list's grammar |
| [the-draft-summary-is-three-cards](#the-draft-summary-is-three-cards) | total and oldest are real; ready counts this page only, says so, and carries a ⚠ |
| [the-draft-cards-are-the-order-list-cards](#the-draft-cards-are-the-order-list-cards) | one `SummaryCard` and one grid for both tabs, so a card is the same shape and size on each |
| [the-draft-keeps-its-own-page](#the-draft-keeps-its-own-page) | `/order-drafts/:id` stays the separate draft page — opening the draft in the order form was tried and reverted — **reversed**, ⚠ replaced by [the-draft-opens-in-the-order-form](#the-draft-opens-in-the-order-form) |
| [the-draft-page-wears-the-order-form](#the-draft-page-wears-the-order-form) | the draft page uses the create form's cards and rail; save in any state, Promote as strict as Create — ⚠ replaced by [the-draft-opens-in-the-order-form](#the-draft-opens-in-the-order-form) |
| [a-draft-row-maps-to-a-product-a-bundle-or-a-split](#a-draft-row-maps-to-a-product-a-bundle-or-a-split) | each scraped row maps to one product, one bundle, or several products — a split suggests a bundle — ⚠ replaced by [the-draft-opens-in-the-order-form](#the-draft-opens-in-the-order-form) |
| [the-draft-sell-price-starts-from-the-rows](#the-draft-sell-price-starts-from-the-rows) | the sell price starts as Σ the rows' platform prices and can be typed over, down to 0 |
| [the-listing-is-information-the-mapping-sets-the-count](#the-listing-is-information-the-mapping-sets-the-count) | a row's scraped quantity and price are shown, not edited; the count is set on the mapping, and a different one is flagged — ⚠ replaced by [the-draft-opens-in-the-order-form](#the-draft-opens-in-the-order-form) |
| [the-draft-opens-in-the-order-form](#the-draft-opens-in-the-order-form) | a draft opens IN the order form — `/orders/new?draft=ID`, seeded from the draft; its scraped lines a text list above the products; Create places the order and deletes the draft |
| [the-draft-preview-became-the-draft-page](#the-draft-preview-became-the-draft-page) | `/order-drafts/:id` IS the draft page in the order form's clothes now — the built page is gone — ⚠ replaced by [the-draft-opens-in-the-order-form](#the-draft-opens-in-the-order-form) |

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

## the-draft-opens-in-the-order-form

> Owner, in chat (2026-10-15): *"aku ingin order draft detail page itu dilebur dengan order create, lalu untuk petunjuk produk
> yang harus dikirim kasih di atas produk berupa list teks saja"* — then *"kasih card dan warna yang beda sendiri, sarankan
> warnanya, tapi warna yang agak pudar saja"*, and of the violet proposed: *"jangan ungu, coba sarankan warna lain"*.

It is what the business already says (docs/business/order/context.md, *Order Draft Behavior* 3–5): the frontend finalizes a
draft by seeding the create form, the platform's items are shown as a reference, and creating the order deletes the draft.
The separate draft page — with its row mapping, Save and Promote — is gone.

```mermaid
flowchart LR
  L["/order-drafts — a row"] --> F["/orders/new?draft=ID — the order form, seeded"]
  O["/order-drafts/ID, an old link"] -->|"redirect"| F
  F -->|"Buat Pesanan"| C["OrderCreate, then OrderDraftDelete"]
  C --> D["/orders/ID"]
  F -->|"Hapus Draf, confirmed"| X["OrderDraftDelete, back to /order-drafts"]
  F -->|"leave, untouched"| L
```

```
Buat Pesanan  [Draf SP-2409-8841]                                   [🗑 Hapus Draf]
…
┌ 📋 Produk yang Harus Dikirim ───────────────────────────── a faded sand card ┐
│ Dari shopee-ext — pilih produknya di bawah                                    │
│  • 2 × Kopi Arabika Gayo 250gr Biji Sangrai · Rp 55.000                       │
│  • Teh Melati Wangi 100 gram · Rp 25.000                                      │
│  • Mug Keramik Motif Batik (bonus) · Rp 20.000                                │
└───────────────────────────────────────────────────────────────────────────────┘
┌ Produk ───────────────────────────────────────────── the products, picked here ┐
```

| | |
| --- | --- |
| the route | `/orders/new?draft=ID`. The drafts list's rows open it; `/order-drafts/:id` redirects to it |
| seeded, once | the shop; the marketplace's order id (a draft an app pushed — a form-saved draft's reference is ours, not copied); the warehouse, over the team's default; the buyer's name and phone; the address; the courier; the sell price from Σ scraped price × quantity ([the-draft-sell-price-starts-from-the-rows](#the-draft-sell-price-starts-from-the-rows), as a starting value); a line already mapped, as the product it names. After that the form is the person's |
| the hint | the scraped lines as **text** above the products — *2 × title · Rp price*; an unread title, quantity or price is said so. Nothing in it is copied into the order: a marketplace title names no product of ours, and the products are picked below while it is read |
| its card | a card of its own, in a **faded sand** (`draftHint.bg` / `.border` / `.fg` in theme.ts — #fbf7ef, #eadfc8, a #8a6d3b title; muted equivalents in dark) — a slip of paper from the marketplace. A warm neutral no role in the app speaks, browner than the warning amber, so it reads as the outside's words — not a warning, not a status, not our catalogue. A faded violet was proposed first and turned down. The list stays in the body ink. Titled *Produk yang Harus Dikirim* with where it came from; a draft saved on the form says so in words rather than as the raw source `manual` |
| Buat Pesanan | `OrderCreate` with everything the form holds — the receipt, the references, the note, the dates, which a draft could not store and Promote would have dropped — then `OrderDraftDelete`. A delete that fails leaves the order placed and says the draft is still on the list |
| Hapus Draf | in the header (an icon on a phone, [a-phone-header-action-is-an-icon](context_decision.md#a-phone-header-action-is-an-icon)), confirmed, back to the drafts list |
| no Save as Draft | on a draft — it is finished here, or left on the list as it is |
| leaving | an untouched draft asks nothing — the draft is still on the list; a changed one asks the usual "discard?" |
| gone | the draft page, its row mapping (a product, a bundle, a split), Promote, and the ⚠ for what a draft could not store |
| still open | `OrderCreate` takes no `order_draft_id` yet, so the delete is a second call rather than the same transaction — [the-build-lets-a-person-draft-and-promotes-on-the-server](../../business/order/context_clarify.md#the-build-lets-a-person-draft-and-promotes-on-the-server) |

## the-drafts-are-a-list-of-their-own

> Owner, in chat (2026-10-15): *"nah sekarang draft perlu dipisahkan dari list pesanan, dia jadi list sendiri"* — and *"jadi
> storynya ada sendiri juga"* — then *"storynya bagian dari order, tidak masalah"*.

The drafts were the order list's last tab ([the-draft-list-is-the-drafts-tab](#the-draft-list-is-the-drafts-tab)): the list's
heading, its stage strip with Drafts lit, and a Drafts tab on both order lists that left for `/order-drafts`. Now they are a
list of their own.

```mermaid
flowchart LR
  subgraph "before"
    O1["/orders — stage tabs … Drafts"] -->|"Drafts tab"| D1["/order-drafts — the Orders heading, the strip, Drafts lit"]
  end
  subgraph "now"
    M["menu: Pesanan ▸ Daftar · Draf"] --> O2["/orders — stage tabs only"]
    M --> D2["/order-drafts — Draf Pesanan, its own list"]
  end
```

```
Draf Pesanan  [Toko Melati]                                     [🗑 Hapus Terpilih (2)]
Pesanan yang belum selesai — dikirim aplikasi lain, atau disimpan dari form pesanan. Buka untuk melengkapinya …
┌ Total ┐ ┌ Tertua ┐ ┌ Siap ⚠1 ┐
☐ │ Referensi · yang tersisa │ Toko │ Dibuat │ Diperbarui │ Baris │ ⋯
```

| | |
| --- | --- |
| the order lists | no Drafts tab — the seller's stage strip and the warehouse's status strip are their statuses only, and neither reads a draft count any more |
| its page | its own title, *Draf Pesanan*, with the team and the subtitle under it; no stage strip, no New Order — a draft is finished in the order form it opens ([the-draft-opens-in-the-order-form](#the-draft-opens-in-the-order-form)). Delete Selected is its one header action |
| kept | the row (the order list's grammar, real fields only), the summary cards ([the-draft-summary-is-three-cards](#the-draft-summary-is-three-cards)), selection and bulk delete |
| the menu | **Pesanan ▸ Daftar · Draf** for a selling team — one group, so the sidebar does not grow ([the-sidebar-stays-short](context_decision.md#the-sidebar-stays-short)); standing on the drafts lights *Draf* |
| a phone | the bar keeps its one Orders tab, which lights on the drafts too (it claims `/order-drafts`); the drafts are in More's menu |
| the stories | their own file, kept in the Order group — `Pages/Order/OrderDraftsPage` (owner: *"storynya bagian dari order, tidak masalah"*) |
| a mark | the strip's ⚠ (`statusSet`) left with the strip; the summary's ⚠ is now the page's first |
