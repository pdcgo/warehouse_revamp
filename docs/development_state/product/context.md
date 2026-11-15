# Development state — product

Decisions: [context_decision.md](../../business/product/context_decision.md). Bundles and discovery have their own
reports ([bundle.md](bundle.md), [discover.md](discover.md)).

## 2026-11-15 — goods in transit on the product screens

| | |
| --- | --- |
| [in-transit-is-its-own-figure-beside-siap-and-dikirim](../../technical/frontend/products_decision.md#in-transit-is-its-own-figure-beside-siap-and-dikirim) | **built** — the figure is live from `OwnerStockByIds` / `OwnerStockStat`'s `in_transit_qty` + `in_transit_value` ([rpc.md](../../services/inventory_service/rpc.md#in-transit)): the list's *Dalam transfer* column after Dikirim (`ProductsTable` `InTransitCell`, value on hover), the phone block's fact beside Dikirim (value inline), the stat tile after Dikirim (`ProductStats`, testid `products-in-transit-stock`), the product page's highlight *+N pcs dalam transfer* and the Per Gudang Overview row `pd-overview-row-inTransit` (*menuju <gudang>* under a lens). Under a lens: the RECEIVING warehouse's |
| [the-in-transit-column-shows-while-any-is-in-transit](../../technical/frontend/products_decision.md#the-in-transit-column-shows-while-any-is-in-transit) | **built** — `ProductsTable inTransitColumn` = the strip's units for the same team + lens `> 0` (`pages/products/index.tsx`); at zero the list is today's eight columns. Tile, phone fact and product page always show (0 pcs). The archive has no strip and keeps today's columns (build default). The Storybook switch `features/products/inTransitPrototype.tsx` is deleted |
| stub | `.storybook/productStub.ts` `IN_TRANSIT_SAMPLE` (team 15: 700 3 pcs Pusat → Cabang, 702 8 pcs Cabang → Pusat) and `transfersInTransitForStory(...lines)` — none = nothing in transit; reset per story |
| tests | stories `pages/products/stories/InTransit.stories.tsx` (7: the column, no column, tile, phone, phone at 0, the receiver's lens, the sender's lens without a column), `pages/product-detail/stories/InTransit.stories.tsx` (3), `Header.stories.tsx` *Card strip* now six tiles; e2e `the_goods_in_transit.spec.ts` (own team, two warehouses: no transfer → no column, 0 pcs; shipped → column, tile, 390 px fact, product page; receiver's lens yes, sender's no; accepted → 0, column gone) |

## 2026-11-14 — the product list's Kunci and Umur stok filters

| | |
| --- | --- |
| [lock-and-stock-age-filter-ahead-of-the-contract](../../technical/frontend/products_decision.md#lock-and-stock-age-filter-ahead-of-the-contract) | **built** — `ProductListFilter.lock` (enum `ProductLockFilter`: MODE_OPEN / MODE_MINIMUM / MODE_ALWAYS / LOCKED_NOW), `stock_age_min_days`, `ProductListRequest.stock_warehouse_id` (the lens the age reads). `ProductList` narrows before its count and page; `ProductDiscover` refuses both (InvalidArgument). Flow, semantics and perf: [rpc.md](../../services/product_service/rpc.md#the-lists-kunci-and-umur-stok--narrowed-through-inventory-built-2026-11-14) |
| the seam | `product_v1.StockNarrower` (4th `NewService` dep) ← `cmd/app_development/product_stock_narrower.go` ← inventory plain functions `ClosedByMinimum` (candidates of any teams — reusable by Discover's lock filter) and `ProductIDsAgedSince` |
| [a-minimum-closes-only-under-it](../../technical/frontend/products_decision.md#a-minimum-closes-only-under-it) | LOCKED_NOW applies the same `<` on the server, over every warehouse; at exactly the minimum a product is not listed |
| [the-dates-read-as-ages](../../technical/frontend/products_decision.md#the-dates-read-as-ages) | the age filter reads the column's own oldest READY batch, in the lens; nothing on a shelf never matches |
| the screen | `pages/products` sends both picks; its ⚠ marks, `pending.ts` and `NotImplementedSummary` are gone (i18n `products.pending.*` removed); stub `productStub.ts` narrows the same way, requests recorded in `.storybook/productListScenario.ts` |
| tests | Go: `inventory_v1/closed_by_minimum_test.go`, `aged_product_ids_test.go`, `product_v1/product_list_test.go` (+6), `product_discover_test.go` (+1), `cmd/app_development/product_stock_narrower_test.go` (every pick, q/status/lens combinations, at-minimum, empty shelf, two teams); perf `product_list_filters_perf_test.go`; stories `pages/products/stories/Filters.stories.tsx` (5 new); e2e `the_product_list_filters.spec.ts` (each lock way; the age on its edge — no RPC back-dates a batch) |
| still open | Discover's filters (Gudang, Stok siap, Harga cross, Kunci, Kategori) — scoping phases B4/B5/F2 |

## 2026-11-02 — archive, delete, and the product code

| | |
| --- | --- |
| [a-used-product-is-archived-never-deleted](../../business/product/context_decision.md#a-used-product-is-archived-never-deleted) | `ProductArchive` / `ProductUnarchive` / `ProductDelete` (product `00007`, `archived`). Delete asks first whether anything used the product (`ProductHistory` — inventory's ledgers and selling's orders, through `cmd/app_development/product_history.go`) and whether a bundle holds it; a used product is archived instead. The list's Archived tab and the detail's actions; the writes stay the selling team's (`product_writes_selling_only_test`) |
| [the-field-is-product-code-composed-on-write](../../business/product/context_decision.md#the-field-is-product-code-composed-on-write) | product `00008`, selling `00032`, inventory `00033`: `sku` → `product_code`, composed `<team_code>-<part>` on write (`product_code.go`, the team code asked of team_service — `product_team_codes.go`); `san product recompose-codes` rewrites them after a team code changes ([san.md](../../tools/san.md)). About 110 TypeScript files renamed |
| [the-code-is-composed-from-the-team-code](../../business/product/context_decision.md#the-code-is-composed-from-the-team-code) | the same build |

```sh
go test ./backend/services/product_service/... ./backend/cmd/app_development/...
```
