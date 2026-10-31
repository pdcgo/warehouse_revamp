# Development state — product discover

> 🔀 **2026-10-31, last** — [the-order-and-restock-start-on-the-page](../../technical/frontend/products_decision.md#the-order-and-restock-start-on-the-page):
> Buat Pesanan / Restok open `features/products/StartFormDialog` (warehouse with ready stock, quantity) before the form;
> the link carries `&qty=`, and both forms seed the line at it.

> 🔀 **2026-10-31, later** — [a-product-page-opens-the-order-and-restock-forms](../../technical/frontend/products_decision.md#a-product-page-opens-the-order-and-restock-forms):
> product page Buat Pesanan + Restok, discover detail Buat Pesanan (disabled with reason when locked / minimum in force /
> archived). They open `/orders/new` and `/inventories/restock/new` with `?product=` (+ `&warehouse=`) — both forms read
> it via `features/products/presetProduct.ts` and return via `cameFrom`. Story helper: `markerWithSearch` (pageStory).
> [the-product-history-names-the-transaction](../../technical/frontend/products_decision.md#the-product-history-names-the-transaction):
> `MovementTable wording="transaction"` + `transactionLabel` on both product pages' Riwayat Stok. Discover's Riwayat Stok
> has no Batch column ([the-discover-history-names-no-batch](../../technical/frontend/products_decision.md#the-discover-history-names-no-batch)).

> 🔀 **2026-10-31** — [the-overview-says-the-cross-range](../../technical/frontend/products_decision.md#the-overview-says-the-cross-range):
> the detail's Per Gudang Overview is Siap · Dikirim · Harga cross (lens); Umur stok, the `age` mark and
> `sampleStockAgeDays` are gone.

> 🔀 **2026-10-30, after that** — [the-lock-is-the-title-badge](../../technical/frontend/products_decision.md#the-lock-is-the-title-badge):
> the detail has NO Penjualan Tim Lain card; `DiscoverBadges` takes `totalReady` and a minimum in force reads
> *Terkunci · Min N pcs*. [stock-history-is-everyones](../../technical/frontend/products_decision.md#stock-history-is-everyones):
> another team's Riwayat Stok shows `SampleHistorySection` rows (`historySample.ts`, ending at the real shelf), ⚠ `history`
> now `sample`. Sections: Info · Produk Turunan · Harga per Gudang · Per Gudang.

> 🔀 **2026-10-30, latest — the detail gets the product page's Per Gudang card**
> ([the-discover-detail-has-the-warehouse-zone](../../technical/frontend/products_decision.md#the-discover-detail-has-the-warehouse-zone),
> [the-supplier-tab-names-the-store](../../technical/frontend/products_decision.md#the-supplier-tab-names-the-store)).
> Sections: Info · Penjualan Tim Lain · Produk Turunan · **Harga per Gudang** (the per-warehouse table, its own section,
> never lensed) · **Per Gudang** (picker + tabs Overview · Pemasok · Keluar Masuk Harian · Riwayat Stok, no Harga Modal).
> Pemasok is ONE shared tab on both product pages (`features/products/SuppliersSection` + `supplierSample.ts` — real
> suppliers/stores/links, invented link to the product and figures): Toko pemasok = name (opens `uri` in a new tab) with
> the marketplace badge under it; Modal terakhir only on the owner's page. Moved to `features/products/`: `WarehouseLens`,
> `DailySection` + `dailySample.ts`, `HistorySection`. Deleted: `product-detail/sampleMock.ts`,
> `product-discover-detail/sampleSuppliers.ts`, `SuppliersList`. Marks: division, gallery, ongoing, crossPrice, derived,
> age, suppliers, daily (sample), history (missing — another team's ledger).

> 🔀 **2026-10-30, last — Per Gudang says ready and price** ([each-warehouse-says-ready-and-its-price](../../technical/frontend/products_decision.md#each-warehouse-says-ready-and-its-price)):
> columns Gudang · **Siap** · **Harga cross** (own product: + cost under it, real via `useOwnerStockByWarehouse`; another
> team's: ⚠ `sampleWarehouseCross`). *Bisa Anda ambil* and the `canTake` mark are GONE. Stub: `stockAvailability` answers
> team 15's catalogue from its batches (`shelfSample`).

> 🔀 **2026-10-30, later — the owner's review of the detail** ([the-discover-detail-shows-no-markup](../../technical/frontend/products_decision.md#the-discover-detail-shows-no-markup)):
> no markup percentage (Penjualan Tim Lain = the lock alone); the owner row is **Tim** + the name; the pictures are the
> shared `ProductGallery` (cover only, ⚠ `gallery`); **Produk Turunan** (`DerivedSection` + `derivedSample.ts`, moved to
> `features/products/`) beside Penjualan Tim Lain, ⚠ `derived`. The detail row below is read with these changes.

> 🔀 **2026-10-30 — the DETAIL takes the product page's shape** ([the-discover-detail-is-the-product-page](../../technical/frontend/products_decision.md#the-discover-detail-is-the-product-page)):
> title row + sticky bar, nav beside Info · Penjualan Tim Lain · Per Gudang · Pemasok ⚠; the card's badges and cross
> price on it. Frontend only. The product page's title row, sticky logic, `FigureRows` and `StockHighlight` moved to
> `features/products/` (+ `lib/useStickyTitle.ts`) and the product page reads them; the discover page's `division.ts`,
> `sampleMock.ts` (→ `discoverSample.ts`, + `discoverPriceOf`) and `DiscoverBadges` moved there too. The rows below
> marked *(2026-10-06)* describe the detail BEFORE this pass where they disagree.

> 🔀 **2026-10-30 — a locked product shows on Discover** ([a-locked-product-shows-on-discover](../../technical/frontend/products_decision.md#a-locked-product-shows-on-discover),
> on merging `frada`): `ProductDiscover.include_locked`, asked by the page alone; the `locked` mark is gone, `lockFilter`
> stays.

**Pass (2026-10-26):** the LIST was reworked — filters in a side panel, the division chips, the cross price on every
card. Frontend only; no RPC, proto or migration changed. Decisions:
[discover-filters-in-a-side-panel](../../technical/frontend/products_decision.md#discover-filters-in-a-side-panel),
[discover-opens-on-priority](../../technical/frontend/products_decision.md#discover-opens-on-priority),
[discover-shows-the-cross-price](../../technical/frontend/products_decision.md#discover-shows-the-cross-price).

| | |
| --- | --- |
| layout | `lg`+: shared `FilterPanel` (new, `components/chrome`) beside a width-filling grid; below `lg`: `FilterBar sheetBelow="lg"` (new prop) with the same `DiscoverFilterGroups` |
| real | search (debounced), `owner_team_id`, `exclude_own_team`, sort (newest / name / SKU) — `useDiscoverProducts` now spreads `listQuery` and batches `OwnerStockByIds` for the caller's OWN ids |
| pending (`pages/product-discover/pending.ts`) | `warehouse`, `division`, `category`, `stock`, `crossRange`, `lockFilter` — dropped; `crossPrice`, `cardStock`, `divisionBadge` — sample (`sampleMock.ts`); `locked` — missing |
| ⚠ contradiction | the owner's division is per product with three values; the proto's priority partition is a TEAM flag with two — the chips are NOT wired to `owner_team_ids` on purpose |
| shared helpers | `withMarkup` (lib/markup.ts), `formatRupiahRange` (lib/money.ts) replaced copies in ProductsTable, the product page and PriceSection; `readyStatus` (features/products/stockAge.ts) is the product page's and Discover's one stock rule |
| later the same pass | the card's stock, price, division and lock badges; stock and price as picked bands with **Atur sendiri**; the **Kunci** filter; the panel never past the window's foot and above the grid; a minimum closes AT the minimum (≤, `lockedByMinimumNow`) — every decision from `a-discover-price-is-red-and-unlabelled` to `the-card-states-are-pinned-on-the-page` in products_decision.md |
| stories | `Pages/Products/DiscoverProducts` (the Default story carries a locked product — `patchProduct`; this stub's ProductDiscover does not leave locked products out), `Components/Chrome/FilterPanel`, `FilterChips/WithoutAll`·`WithIcons` |

## Next — backend (owner, 2026-10-30: *"iy"* to recording it)

What the screen is built ahead of, in the order a seller would feel it. Each is a server change, so none was made here.

| # | what | why it is the server's |
| --- | --- | --- |
| 1 | **ProductDiscover answers locked products** (owner's ask), with `cross_locked` and `reserved_stock` on the row so the card says **Dikunci** / **Min N pcs** | `product_discover.go` filters `cross_locked = false`. ⚠ The order form's product picker reads the SAME RPC and must keep leaving them out — so a request flag, e.g. `include_locked`, default false; Discover sets it, the picker does not |
| 2 | **Stock on a card, and the Stok / Gudang / Kunci filters** | ready and on-its-way stock per product is inventory_service's, and OwnerStockByIds answers only the caller's own goods; a PAGED list narrowed by stock needs ONE read joining product and stock (HARD RULE 3: an RPC, not a shared model) |
| 3 | **Another team's cross price**, and the Harga cross filter | another team's unit cost is not readable across teams — and who may see it is open in [product clarify](../../business/product/context_clarify.md) (*Awaiting*); the card shows the cross price only, never the cost |
| 4 | **Kategori filter** | ProductDiscover takes no category filter (product context_decision: a subquery, not a join, or the page count breaks) |
| 5 | **Prioritas · Riset · Umum** stored per product | not in the business context yet; replaces or sits beside the team-level `priority_product` — the business context decides |
| 7 | **A product's stock history for any team** (the detail's Riwayat Stok) | every team may read it ([stock-history-is-everyones](../../technical/frontend/products_decision.md#stock-history-is-everyones)), but `OwnerStockHistory` filters by the caller's team — another team's product reads nothing, so the tab shows samples |
| 8 | **Who supplies a product** (the Pemasok tab, both pages) | `metrics/suppliers` takes no product filter, and `supplier_channel_products` is not written yet — the tab's rows are samples |
| 6 | **The reserve check on an order at exactly the minimum** | the screens close a product AT its minimum (≤); the business context opens it there (`<`) — [product clarify Q13](../../business/product/context_clarify.md#question). Whatever enforces the reserve on an order follows the answer |

**Pass (2026-10-06):** the discover page got its Storybook, and a separate **discover product detail**
(`/products/discover/:productId`): another team's product, read by a selling team deciding whether to sell
it. Frontend only — no RPC, proto or migration changed. Nothing here is in a `_clarify.md` or a
`_decision.md` yet; the two undecided figures point at questions already open in
[product/context_clarify.md](../../business/product/context_clarify.md).

## What exists

| | |
| --- | --- |
| list | `pages/product-discover` — a grid of `ProductCard`; **each card is now a link** to the discover detail (`discover-open-<sku>`) |
| detail | `pages/product-discover-detail` — the product page's shape: `ProductTitleRow` (name, the card's `DiscoverBadges`, Arsip, SKU; **Buka di Produk Saya** on an own product) + `ProductStickyStrip`; `SectionNav` beside `Section`s from `sections.ts` — **Info** (cover, `StockHighlight` = every shelf summed, `FigureRows`: owner · category · cross price · cost on an own product, description; a locked/archived warning in the highlight's place), **Penjualan Tim Lain** (markup, read-only `ProductLockControl`), **Per Gudang** (`WarehouseStock`: on shelf, you can take; blocks on a phone; *not offered* when locked/archived), **Pemasok** (`SuppliersList`, blocks on a phone) |
| reads | `useDiscoverProduct` (`ProductByIds` + `CategoryList`) · `useTeamsByIds` (`TeamByIds`, referenceQuery) · `useAvailabilityByWarehouse` (`StockAvailability`, **one call per warehouse**) · `useProductActivity` on the caller's OWN product only (real cost and on-its-way) |
| shared | `features/products/`: `ProductTitleRow`, `FigureRows`, `StockHighlight`, `DiscoverBadges`, `division.ts`, `discoverSample.ts`; `lib/useStickyTitle.ts`. `RecordField` (`Field`, `Stat`) was DELETED with its story — the discover detail was its last reader |
| stories | `Pages/Products/DiscoverProducts` · `Pages/Products/DiscoverProductDetail` (19 — `TheOwnersPageShape`, `TheCrossPriceIsTheCards`, `TheCardsBadgesAreOnTheTitle`, `TheReadyFigureIsTheShelvesSummed`, … and `Mobile`) |
| e2e | `e2e/products.spec.ts` "Discover" test clicks through to the detail and finds its Per Gudang section (`dd-section-warehouse`) |
| stub | `stockAvailability` now answers per warehouse — only `WAREHOUSE_ID` (11) holds the fixture stock |

## Why ProductByIds, not ProductDetail

`ProductDetail` filters `team_id = caller` (`product_detail.go:37`), so any other team's product is
NotFound. `ProductByIds` resolves an id whoever owns it — at the cost of the **gallery** (a by-ids row
carries only the cover).

## Pending on the screen (`pages/product-discover-detail/pending.ts`)

| id | kind | blocked on |
| --- | --- | --- |
| `division` | sample | the division is stored nowhere — the card's `sampleDivision` |
| `gallery` | missing | the image list comes only from the owner-scoped `ProductDetail` |
| `ongoing` | sample | another team's on-its-way stock is not readable across teams — the card's `sampleStock` |
| `crossPrice` | sample | another team's cost is not readable, and who may see it is "Awaiting" in product clarify — the card's `discoverPriceOf`. It REPLACED `unitCost` (missing) |
| `derived` | sample | the link a return to another team makes is recorded nowhere — the product page's `sampleDerived` |
| `suppliers` | sample | `supplier_channel_products` read backwards — waits on [linking-products-is-deferred](../../business/supplier/context_decision.md#linking-products-is-deferred), and no cross-team supplier read exists; rows are picked from the supplier discover sample |

## Not built / worth a decision

- **No action on the detail** for another team's product — nothing like *Use in an Order*; the only action is *Buka di
  Produk Saya* on the caller's own. What a borrower does next is not specified.
- ⚠ **Stub limit**: `stockAvailability` holds stock for products 71–74 only, so a story's own product with real costs
  (team 15's catalogue) would read *0 pcs siap* beside real figures — the `YourOwnProduct` story uses Beras (74), whose
  cost was never recorded, so its prices read "—".
- **The per-warehouse fan-out** is N `StockAvailability` calls (N = warehouses). Fine at a handful; a
  product-across-warehouses read would make it one.
- The **reserve applies to the owner's own product** on this page too — consistent with the owner detail's
  "never offered for sale", not settled for cross lines.
- ⚠ **`sampleSuppliers.ts` imports `features/suppliers/discover.ts`** — the supplier discover sample, written by
  the supplier pass. When that sample becomes a real read, the product side needs its own read (product →
  channels), not the supplier search.
