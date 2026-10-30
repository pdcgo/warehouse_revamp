# Development state — product discover

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
| detail | `pages/product-discover-detail` — cover · owner (`TeamItem`) · category · cross markup · reserved stock · description · a **Stock by Warehouse** table (on shelf, you can take) · a **Suppliers** table (supplier + its team, the store with its marketplace badge; a supplier opens `/inventories/suppliers/discover/:id`) · an "own product" pointer to `/products/:id` · archived / locked banners that hide the stock |
| reads | `useDiscoverProduct` (`ProductByIds` + `CategoryList`) · `useTeamsByIds` (`TeamByIds`, referenceQuery) · `useAvailabilityByWarehouse` (`StockAvailability`, **one call per warehouse**) |
| shared | `features/products/RecordField` (`Field`, `Stat`) — moved out of `pages/product-detail/components/parts.tsx` once a second page needed it |
| stories | `Pages/Products/DiscoverProducts` (9) · `Pages/Products/DiscoverProductDetail` (15) · `Features/Products/RecordField` (2) |
| e2e | `e2e/products.spec.ts` "Discover" test clicks through to the detail |
| stub | `stockAvailability` now answers per warehouse — only `WAREHOUSE_ID` (11) holds the fixture stock |

## Why ProductByIds, not ProductDetail

`ProductDetail` filters `team_id = caller` (`product_detail.go:37`), so any other team's product is
NotFound. `ProductByIds` resolves an id whoever owns it — at the cost of the **gallery** (a by-ids row
carries only the cover).

## Pending on the screen (`pages/product-discover-detail/pending.ts`)

| id | kind | blocked on |
| --- | --- | --- |
| `canTake` | derived | shelf − owner's reserve, floored at 0 — the reserve's scope and boundary are point 5 of product clarify |
| `unitCost` | missing | who may see the owner's unit price — "Awaiting" in product clarify |
| `gallery` | missing | the image list comes only from the owner-scoped `ProductDetail` |
| `suppliers` | sample | `supplier_channel_products` read backwards — waits on [linking-products-is-deferred](../../business/supplier/context_decision.md#linking-products-is-deferred), and no cross-team supplier read exists; rows are picked from the supplier discover sample |

## Not built / worth a decision

- **No action on the detail** — nothing like *Use in an Order*. What a borrower does next is not specified.
- **The per-warehouse fan-out** is N `StockAvailability` calls (N = warehouses). Fine at a handful; a
  product-across-warehouses read would make it one.
- The **reserve applies to the owner's own product** on this page too — consistent with the owner detail's
  "never offered for sale", not settled for cross lines.
- ⚠ **`sampleSuppliers.ts` imports `features/suppliers/discover.ts`** — the supplier discover sample, written by
  the supplier pass. When that sample becomes a real read, the product side needs its own read (product →
  channels), not the supplier search.
