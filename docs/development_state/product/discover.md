# Development state — product discover

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
