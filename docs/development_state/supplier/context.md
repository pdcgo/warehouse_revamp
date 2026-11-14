# Development state — supplier

> 🔄 **2026-10-30 — the Supplier Report's search is back** ([the-supplier-report-keeps-its-search](../../business/analytic/rpc_provide_decision.md#the-supplier-report-keeps-its-search),
> on merging `frada`): a typed `FILTER_TYPE_SUPPLIER_KEYWORD` on `metrics/suppliers`, matched as the supplier list's `q`
> is, the headline what it found. `metrics/suppliers` filters by the window, the restocking team, one supplier and the
> keyword; the report offers all but the one supplier. (It had been dropped on 2026-10-28 —
> [superseded-the-supplier-report-drops-its-search](../../business/analytic/rpc_provide_decision.md#superseded-the-supplier-report-drops-its-search).)

> 🔄 **2026-10-27 — the figures moved onto the analytic pattern.** The four reads (`AnalyticTimeSearch`,
> `AnalyticProductSearch`, `AnalyticGroupSearch`, `AnalyticGroupMetric`) are GONE, replaced by one metric,
> `metrics/suppliers`, read by `MetricSearch` / `MetricData` ([the-pattern-replaces-the-shipped-analytics](../../business/analytic/rpc_provide_decision.md#the-pattern-replaces-the-shipped-analytics)).
> Where this report still names them, read the rows below as of 2026-10-07; the current shape is in
> [rpc.md §The reads](../../services/supplier_service/rpc.md#the-reads) and [analytic/rpc_provide.md](../analytic/rpc_provide.md).
>
> | | now |
> | --- | --- |
> | contract | `SupplierMetric` carries the `metric` option and a sortable `broken_rate` (`rank_min_sample: 50` — `rate_min_units` is gone from the wire, the screen reads the option) · `SupplierMetricByID` / `SupplierMetricByDay` · `MetricSearchRequest/Response`, `MetricDataRequest/Response`, `MetricData` |
> | handlers | `metric_search.go`, `metric_data.go`, `metric_shared.go` (filters, groups, the sort); `analytic_shared.go` keeps `window()`, `figureSums()`, `metricToProto()` (now with the rate) |
> | tests | `metric_search_test.go` (9 + the startup check), `metric_data_test.go` (4) — green on Postgres · perf `-tags perfaudit` rewritten to the two RPCs: [MetricSearch.md](../../../audits/services/supplier_service/performances/MetricSearch.md), [MetricData.md](../../../audits/services/supplier_service/performances/MetricData.md) — 🟡 a year-long window only (Q19) |
> | frontend | `analytics.ts`: `useSupplierHeadline` (SUMMARY, keyed without the page), the series (periods listed in the browser, filled by MetricData), by product and the ranking (MetricSearch → MetricData). The Supplier Report pages with `GrowingPager` (no total); the Statistics tab reads the series only on its own view |
> | changed for a person | the report's pager is the growing pager · by broken rate, suppliers under 50 units follow in KEY order, newest first, no longer by their rate ([a-rate-ranks-only-above-its-minimum-sample](../../business/analytic/rpc_provide_decision.md#a-rate-ranks-only-above-its-minimum-sample)) · the series has no span cap any more (see Q19) |
> | Storybook | `supplierStub.ts` serves `metricSearch` / `metricData` over the same fixtures — all 110 supplier stories green |

**As of 2026-10-07: the supplier context is BUILT, figures included.** The CRUD service, Discover, the move, and — this
pass — a supplier's figures end to end: inventory's accept publishes *Restock Accepted*, `supplier_service` folds it, the
Statistics tab and the Supplier Report read it, and `san supplier backfill-figures` folds the accepts from before the
event. Open: [Q19](../../business/supplier/context_clarify.md#question) — the report's window (recommend a 366-day cap). Decisions:
[context_decision.md](../../business/supplier/context_decision.md) — forty-one. Nothing committed — the owner commits on
request.

The passes of 2026-10-07, in order: `supplier_service` CRUD built · the figures prototyped (Q17, Q18 raised) · a search
and a team picker on the report and the tab, a Team filter on Discover (Q16 answered) · the figures accepted and built
for real (Q17, Q18 answered) · the menu's **Suppliers** group.

## What exists

| | |
| --- | --- |
| service | `backend/services/supplier_service/` — `supplier_v1/`: 10 CRUD RPCs + 6 figures RPCs + the fold, one file each, a test file each · `supplier_service_models/` (5 models) · `db_migrations/00001_create_suppliers.sql`, `00002_supplier_figures.sql` · `register.go` (4 Connect services + the push route `/event/supplier-fold/push`, `FoldSubscription = "supplier-fold"`; since 2026-11-13 `/event/supplier-count-corrected/push`, `CountCorrectedSubscription` — a received-count correction into the same fold on its own day) |
| contract | `proto/warehouse/supplier/v1/` — `SupplierService`, `SupplierChannelService` (`supplier.proto`, `supplier_channel.proto`; `SupplierListFilter.owner_team_id` is Discover's Team filter) · `SupplierAnalyticService` (`AnalyticTimeSearch`, `AnalyticProductSearch`, `AnalyticGroupSearch`, `AnalyticGroupMetric`) and `SupplierAnalyticMaintenanceService` (`AnalyticReplayCompute`, `AnalyticMaintenanceRun`) in `supplier_analytic.proto` · `warehouse.events.v1.RestockAccepted` (variant 400, topic `restock-accepted`) |
| the fold | `analytic_fold.go` — settlement's shape: one transaction = lock FOR SHARE → claim `supplier_event_logs` by event id → one upsert of every line on (day, supplier, product, team), ADDING (no later-day shift — no balance) → an accept's links (since 2026-11-14) → live only: lower `figures_live_since`. Value = units × total ÷ ordered. Since 2026-11-14 each line credits its OWN supplier; an event whose every line names none folds nothing, acked |
| the reads | `analytic_*.go` — `window()` + `figureSums()` in `analytic_shared.go`; time buckets per grain with settlement's caps (366 d / 60 m / 20 y); the ranking joins `suppliers` + live stores for `q`, includes deleted suppliers, and orders by rate with `rateMinUnits = 50` first (`rate_min_units` on the response — the screen never keeps its own copy) |
| replay / maintenance | `AnalyticReplayCompute` — settlement's, plus: refused unless `start_date` is AFTER `figures_live_since`'s Jakarta day (the backfilled past was never on the broker) · `AnalyticMaintenanceRun` — prunes `supplier_event_logs` > 45 days by `created_at` |
| inventory_service | `RestockRequestFulfill` publishes `RestockAccepted` AFTER the commit (`restock_accepted_event.go`: `publishAccepted`, the pure `RestockAcceptedEvent`, `AcceptedRestocks` for the backfill). A 5th `NewService` arg, `events event_source.EventSender` (nil → `EmptySender`). A failed publish is logged, never fails the accept · earlier: `00023` renamed the legacy tables; `SupplierChecker` asked before any transaction |
| `san` | `supplier move` · **`supplier backfill-figures`** (`tools/san/supplier_backfill.go`) — `NewSupplierFigures` in the CLI's Wire set; reads `inventory_v1.AcceptedRestocks` in batches of 500, folds via `FoldBackfill`; skips accepts at/after `figures_live_since`; `figures_backfilled` makes a second run fold nothing · `dev setup` step 6 · `pubsub ensure` declares `supplier-fold` on `restock-accepted` |
| dev server | `cmd/app_development/replay_broker.go` — one `replayBroker` per subscription: `NewReplayBroker` (settlement), `NewSupplierReplayBroker`; inventory gets the existing `EventSender` through Wire |
| frontend | `features/suppliers/analytics.ts` — the three hooks on the real RPCs (`listQuery`; names via `ProductByIds`, `SupplierByIds` — a deleted supplier marked — and `teamsByIdsQuery`) · `figures.ts` (the record + rates) · `FigureParts.tsx` (tiles, cells with a muted rate, phone block, `RestockTeamFilter`) · `SupplierStatistics.tsx` (props: `supplierId` only) · `pages/supplier-report/` (search, team picker, rank by value or rate, the 50-unit note, a deleted supplier marked and opening nothing) · Discover's Team filter · the menu's **Suppliers** group (`SUPPLIERS_GROUP` in `nav.ts`) — routes unchanged under `/inventories/suppliers/…` |
| Storybook | `.storybook/supplierFigureFixtures.ts` (dated relative to today, the arithmetic in its comments) + `supplierAnalyticService` in `supplierStub.ts`; `pickTeam` in `pageStory.tsx` · `vitest.config.ts`'s browser port is **6106** (under 49152 — Windows reserves ranges above it after a Docker start) |
| still sample | product-discover-detail's suppliers (`sampleSuppliers.ts`). The Products tab reads the links since 2026-11-14 (`SupplierProductList`, part 3 below) |
| tests | Go: all green from the root (fold 8, reads 6 files, replay 3, maintenance 1, inventory publish 3, the backfill command 1, `owner_team_id` 1) · stories **1047** green · e2e `restock`, `suppliers`, `supplier_channels` — 12 green |
| audits | CRUD: perf **SupplierList HEAVY** ([report](../../../audits/services/supplier_service/performances/SupplierList.md), not applied — 3 open questions there), concurrency SAFE ([lock-order.md](../../../audits/services/supplier_service/concurrency/lock-order.md)) · figures: concurrency — one 🔴 found and **fixed the same day**, two accepts sharing products deadlocked on line order; the fold now writes in product order ([FoldHandler.md](../../../audits/services/supplier_service/concurrency/FoldHandler.md)); everything else proved SAFE (`analytic_fold_race_test.go`, `analytic_replay_compute_race_test.go`, `-tags raceaudit`) · performance — three 🔴 found and **fixed the same day**: the ranking 1 071 → 90 ms @ 1 year (one grouped statement, dates as literals), a page's figures 102 → 20 ms, the fold 3 + lines → 4 statements (2.1 ms @ 20 lines); reports in [performances/](../../../audits/services/supplier_service/performances/); the window's limit is Q19. ⚠ Re-measure on a FRESH database per test — rolled-back seeds bloat a reused one ~4× |
| docs | `docs/database-schema.md` (the three figure tables) · `docs/services/supplier_service/rpc.md` (the fold, the reads, the replay) · `docs/services/inventory_service/rpc.md` (the accept announces) · `docs/tools/san.md` (`supplier backfill-figures`, setup step 6, `supplier-fold`) · CLAUDE.md's setup line |

## Decided, not built

| decision | waits on |
| --- | --- |
| [a-late-correction-lands-in-the-six-columns](../../business/supplier/context_decision.md#a-late-correction-lands-in-the-six-columns) — the adjustment event, a Root-only RPC, its `san` command | nothing — not built this pass. The fold would take a second variant into the same upsert |
| the drop of `legacy_suppliers` / `legacy_supplier_channels` | the move having run on every database — a later inventory migration |

## Next

1. **Q19** — if the cap is taken: a 366-day check in `parseFilters` (`metric_shared.go`), so it holds for both reads and both screens, and the date pickers say why.
2. **SupplierList's search** — the owner's answers to its perf report's three questions, then a trigram migration
   **`00003`** in supplier_service (the owner's call, HARD RULE 3/8).
3. **The adjustment** ([a-late-correction-lands-in-the-six-columns](../../business/supplier/context_decision.md#a-late-correction-lands-in-the-six-columns)) — decided, unbuilt.

## Elsewhere

- ⚠ **The live fold does not run in dev or e2e.** Their subscriptions are PULL (no `--push-base-url`) and the dev server
  has no pull worker — settlement's fold shares this. Figures appear in dev from the backfill (`dev setup` runs it) or
  with `pubsub ensure --push-base-url http://host.docker.internal:8080`. The pull worker is the event architecture's open
  decision, not this context's.
- **`SupplierSelect` is own-team only** — restock [Q2](../../business/inventory/restock_clarify.md#question).
- The audits' perf/race tests are kept, build-tagged `perfaudit` / `raceaudit`. ⚠ Perf tests mislead when run together —
  one at a time, after `VACUUM FULL ANALYZE`.
- ⛔ The owner's [technical/architecture/context.md:7](../../technical/architecture/context.md) still puts the supplier in
  `product_service`; analytic/context.md still draws a *Daily Supplier Report Table*; the owner's table and metric lists
  trail three chat decisions ([chat-decisions-outran-your-doc](../../business/supplier/context_clarify.md#chat-decisions-outran-your-doc)) — theirs to edit.
- **A terse "yes" to a two-way question is ambiguous** — confirm before recording (Q8, Q6, Q10c, Q11).

## 2026-11-02 — the replay lock has a lease

[a-dead-replays-lock-expires-after-a-minute](../../business/settlement/meta_context_decision.md#a-dead-replays-lock-expires-after-a-minute) — the fold's lock is taken with a one-minute lease (`eventLockLease`, `event_lock.go`):
`takeEventLock` / `releaseEventLock(ctx, takenAt)`, a lock older than its lease is taken over and logged once
(`logExpiredEventLock`), and a release only frees the lock it took. Both services, the same file; the fold and the replay
use it. Tests beside each. Also this pass: the year cap and *as of* on its metrics ([analytic](../analytic/rpc_provide.md)).

## 2026-11-06 — the three valuations are doubles (money-type change, part 2)

[every-ledger-moves-to-double-rounded-when-frozen](../../business/order/context_decision.md#every-ledger-moves-to-double-rounded-when-frozen). `supplier_service` `00003_valuations_are_double.sql`: `restock_valuation`, `shipping_lost_valuation`,
`shipping_broken_valuation` `BIGINT` → `double precision`; `supplier_analytic.proto`'s three valuations → `double`.
The fold's `lineValue` freezes each figure with `san_money.Whole` as it writes, and the replay unnests a
`double precision[]`. Applied on `warehouse_test` (the harness re-applies every migration from scratch); not run on dev — `go run ./tools/san migrate up`. The `san` backfill test reads the valuation as `float64`.

## 2026-11-06 — the backend never rounds money ([the-backend-never-rounds-money](../../business/order/context_decision.md#the-backend-never-rounds-money))

`lineValue` no longer rounds: the three valuations are the exact `total × units ÷ ordered`. The race suite's expected
figures follow (`analytic_fold_race_test.go` `figAdd`).

## 2026-11-06 — a row moved and edited since is already moved (backlog #26)

[existing-suppliers-move-with-their-ids](../../business/supplier/context_decision.md#existing-suppliers-move-with-their-ids)
("a row already there is skipped", "run twice: inserts nothing it already has"). `san supplier move` recognised an
earlier move by team + NAME, so a supplier or store renamed in supplier_service after it moved made every later run
(and `dev setup`) refuse. Now `refuseCollisions` (`tools/san/supplier_move.go`) matches the row's **origin** — same team
(a store: same supplier) and same `created_at`, which the move copies and no edit changes: such a row is skipped, never
overwritten, and named in the output (`moveReport.editedSince` → "supplier 7 moved before and edited since (legacy …,
now …) — kept as it is"). Anything else under a moving id — even with the same team and name — still refuses the whole
run; the error now prints each side's team/supplier and creation time (WIB) so the operator sees why. Tests
`TestSupplierMove_SkipsARowEditedSinceItMoved` (edited supplier + store skipped and reported, `ctid` unchanged, a fresh
legacy supplier moved in the same run) and `TestSupplierMove_RefusesAnUnrelatedRowWithTheSameName`; the old three pass.
Docs: [`docs/tools/san.md` § supplier move](../../tools/san.md#supplier-move).

⚠ **The local dev DB holds a GENUINE collision, not an edited move**, so `dev setup` still stops there: legacy supplier 1
is "Test Supplier" of team 90 created 2026-07-16, supplier_service's 1 is "PT sumber makmur" of team 89 created
2026-10-12 from the new sequence; legacy store 1 ("asdasd", supplier 2) vs store 1 ("asdas asdasd", supplier 1); legacy
supplier 2 was never moved (restock_items reference it 15 times; supplier_service 1/store 1 are referenced by 3
restock lines and a batch). Per the decision's table the clash is re-numbered or removed by hand — an owner call.

**2026-11-06 — the dev collision renumbered (owner: "A", local dev DB only).** One transaction on the local docker
Postgres (`localhost:5433/postgres`): legacy `legacy_suppliers` **1 → 3** ("Test Supplier", team 90, deleted) and
`legacy_supplier_channels` **1 → 3** ("asdasd" of legacy supplier 2); `legacy_suppliers_id_seq` and
`legacy_supplier_channels_id_seq` set to 3. Nothing else referenced either legacy id (every `supplier_id` /
`supplier_channel_id` = 1 in `restock_items`, `restock_problem_items`, `batches`, `supplier_product_daily_reports` is
supplier_service's 1 / store 1, created from 2026-10-12, and was left alone). `dev setup --no-docker` then ran clean:
2 suppliers + 2 stores moved (supplier_service now 1, 2, 3 / stores 1, 2, 3), the 15 lines on supplier 2 resolve.
Backup / restore SQL: `D:/hermes/cache/scratch/dev_supplier_renumber_backup.sql` (scratch dir — pruned after 24h idle).

## 2026-11-07 — the supplier pages' Sold / Ready / Gudang terkait are real

`InventoryService.SupplierGoods` (inventory owns batches and their ledger, so no seam): per supplier, store or warehouse —
sold units and orders (the batches' `order` rows netted per transaction, so a cancel is counted back), the last order,
ready units, restocks and the last restock. A supplier's goods = the batches minted with its id
([a-batch-keeps-its-supplier](../../business/inventory/context_decision.md#a-batch-keeps-its-supplier)), EVERY team's
([every-selling-team-sees-every-teams-figures](../../business/supplier/context_decision.md#every-selling-team-sees-every-teams-figures)).

| | |
| --- | --- |
| backend | `inventory_v1/supplier_goods.go` + `_test.go` (6: every team's goods, a cancel counted back, another team reads the same, by store / by warehouse, the last order skips a cancelled one, a transfer is not a restock, the policy) · inventory `00039_batches_supplier_index.sql` · perf `supplier_goods_perf_test.go` — 🟡 [SupplierGoods.md](../../../audits/services/inventory_service/performances/SupplierGoods.md) (list page 41 ms; a 100 000-row supplier ≈ 5 s — fold recommended, not applied) · read only, so no concurrency audit |
| frontend | `features/suppliers/goods.ts` (`useSupplierGoods`, `useSupplierStoreGoods`, `useSupplierWarehouses`, `warehouseSummary`), `figureValues.ts`; supplier list, Discover cards + table, the Toko tab (`ChannelBrowser`), Gudang terkait on both details read them. `sampleWarehouses.ts` deleted; `sampleSupplierFigures.ts` keeps the Produk tab's product figures only |
| marks | list/Discover: `sold`, `ready` removed (range pills now ⚠1–2, warehouse ⚠3) · both details: `warehouses` removed (products 1, sold/ready 2–3 now for the Produk tab only, warehouseFilter 4, sales 5, export 6) |
| Storybook | `.storybook/supplierGoodsStub.ts` (lots per supplier/store/warehouse, `supplierGoodsCalls`), stories assert real numbers |
| e2e | `the_supplier_goods.spec.ts` — own seller restocks 5 from its supplier's store, order of 2 → 2 sold · 3 ready on the list, the store and Gudang terkait; cancel → 0 · 5 (polled) |

**Still not real:** the Produk tab (rows and figures — the store-product link); Penjualan on the Statistik tab — ⚠ UNDECIDED
(which rupiah, which day); the range pills (the bands' source is open, `supplier-figures-filter-by-range-pills`); the
list's Gudang filter (supplier_service's list cannot narrow by inventory's warehouses yet); the warehouse pick narrowing
the tabs; the Exports.

## 2026-11-07 (part 2) — Penjualan is real, and the range pills narrow the list on the server

[penjualan-is-the-selling-value-on-the-order-day](../../technical/frontend/suppliers_decision.md#penjualan-is-the-selling-value-on-the-order-day)
and [the-range-pills-are-a-fixed-set](../../technical/frontend/suppliers_decision.md#the-range-pills-are-a-fixed-set).

| | |
| --- | --- |
| Penjualan | `metrics/suppliers` gains `sales_count` / `sales_value` (fields 8–9, sortable), folded by supplier_service's **sales fold** (`supplier_v1/sales_fold.go`) from `OrderPlaced` / `OrderCancelled` — two new push subscriptions `supplier-order-placed`, `supplier-order-cancelled` (`register.go`, `tools/san/pubsub.go`). The goods are what the order's take drew from batches carrying a supplier, asked of inventory in-process (`GoodsReader.OrderTakeSuppliers` → `cmd/app_development/supplier_goods_reader.go` → `inventory_v1.OrderTakeSuppliers`); the value is each line's share of `platform_total` by its frozen `total`, spread over its units; the order's Jakarta day adds, the cancel's day takes back; the team is the batch's (the restocking team, as Direstok's) |
| schema | supplier `00004_supplier_sales.sql` — `supplier_sale_daily_reports` (signed, keyed as the restock rows), `supplier_sale_orders` (the claim, either event first), `supplier_sale_order_parts` (what the cancel takes back). Read with the restock rows as one UNION ALL in `window()` |
| range pills | `SupplierListFilter.sold` / `ready` (`SupplierFigureBand{min, max}`, lower-inclusive, upper-exclusive, `max` 0 open; CEL-validated). `SupplierList` asks inventory (`GoodsReader.SupplierIDsByFigure` → `inventory_v1.SupplierIDsByFigure`) BEFORE the count and the page; a band from 0 is asked as its complement (a never-sold supplier reads 0). Same filter on Discover (`discover-shows-the-same-figures-and-filters`). In the URL as before (`sold`, `ready`); a pick now resets the page |
| frontend | `figures.ts` + `FigureParts.tsx` read the real sales (`sampleSales.ts` deleted, every `salesMark` prop gone); the `sales` pending mark left both details (export ⚠6 → ⚠5) and the Supplier Report (only Ekspor ⚠1 left); the range pills' two `dropped` marks left `listPending.ts` (the warehouse ⚠3 → ⚠1). `queries.ts` / `discover.ts` send the bands (`figureBand`) |
| tests | Go: `sales_fold_test.go` (7), `sales_fold_race_test.go` (2, raceaudit), `register_test.go` (routes), `supplier_list_test.go` +3 (page 2 found, band edges, validation), inventory `supplier_order_take_test.go` (2), `supplier_ids_by_figure_test.go` (2), `cmd/app_development/supplier_goods_reader_test.go` · stories: SupplierStatistics `SalesSitBesideRestocked` (real numbers), `ByProductReadsItsSales`; SupplierReport `SalesSitBesideRestocked`; suppliers / Discover range-pill stories assert the band sent and the rows narrowed (`supplierListBandCalls`) · e2e `the_supplier_goods.spec.ts` +2 tests and the cancel's Penjualan back to 0 |
| perf | inventory [SupplierIDsByFigure.md](../../../audits/services/inventory_service/performances/SupplierIDsByFigure.md) 🔴 (Terjual band ≈ 0.6–0.9 s at 1 M order rows, Siap ≈ 60 ms) · supplier [SalesFold.md](../../../audits/services/supplier_service/performances/SalesFold.md) (the fold ≈ 2 ms / 6 statements; the reads per table, merged — HEAD-level with no sales, ≈ 2–2.8× on 366-day windows when every restock row also has a sale row) · concurrency [SalesFold.md](../../../audits/services/supplier_service/concurrency/SalesFold.md) ✅ |

**⚠ My readings (report):** a line's selling value is its share of the order's `platform_total` by the lines' frozen
`total` (no line stores a platform price — product-is-its-own-line-metric); Penjualan's team filter means whose goods
(the batch's team), as Direstok means whose restocks. **Not replayed:** `AnalyticReplayCompute` re-seeks only
`supplier-fold`, so Penjualan has no rebuild path yet.

## 2026-11-07 — the date range is Jakarta days for any viewer (backlog #37)

Supplier statistics and the supplier report cut its relative range at the VIEWER's midnight (a local `windowOf`), so a browser outside WIB asked for days a
few hours off the server's Jakarta days. It now reads `jakartaWindowOf` from `frontend/src/lib/jakartaDay.ts`, the one
helper every range screen shares; tests `src/lib/jakartaDay.test.ts` ([architecture state](../architecture/context.md)).

## 2026-11-07 (part 3) — the Toko and Statistik tabs export their tables

[each-supplier-tab-exports-its-own-table](../../technical/frontend/suppliers_decision.md#each-supplier-tab-exports-its-own-table),
on [one-export-is-the-list-as-a-file](../../technical/frontend/warehouse_order_list_decision.md#one-export-is-the-list-as-a-file)
(flow: [rpc.md § The tabs as files](../../services/supplier_service/rpc.md#the-tabs-as-files--supplierchannelexport-and-supplierfigureexport)).

| | |
| --- | --- |
| contract | `SupplierChannelService.SupplierChannelExport` (the list's filter + sort) and `SupplierAnalyticService.SupplierFigureExport` (the tab's `FilterItem`s + `group_by` DAILY / MONTHLY / YEARLY = Per Periode, PRODUCT = Per Produk; SUPPLIER refused), both server streams `{message, done, total, download_url, filename}`; policy Root, Administrator, selling roles — not NO_SIDE_EFFECTS. document `DOCUMENT_RESOURCE_TYPE_TABLE_EXPORT = 8` |
| backend | `supplier_channel_export.go` (`channelListQuery`, now shared with `SupplierChannelList`), `supplier_figure_export.go` (`periodSpine`, `rankedProducts` through `MetricSearch`, fills through `supplierMetricData`), `export_store.go` (`ExportStore` = `san_export.Store` + `ProductNames` + `TeamNames`; the 5th `NewService` dep, nil = Unimplemented) · `GoodsReader.StoreGoods` (inventory `SupplierGoods` by STORE, in-process) · `backend/pkgs/san_export` — the .xlsx stream writer (exact numbers, `Percent` under `0.0%`), the progress stream, WIB `Filename` / `Day` · composition root `cmd/app_development/supplier_exports.go` (`NewSupplierExportStore`: document upload as the caller via `uploadDocument`, products in-process via `product_v1`, teams via the forwarding TeamByIds) · document `00010_allow_table_export_resource_type.sql` |
| frontend | `lib/useFileExport.ts` (the order export's stream → download → toast, for any table; i18n `common.export.*`) · `features/suppliers/exports.ts` (`useStoreExport`, `useStatisticsExport`; `analytics.ts` `statisticsFilters`) · `SupplierTabExport` takes `onExport` / `progress` / `disabled` / optional `mark` · `ChannelBrowser` and `SupplierStatistics` lost their `exportMark` prop and export for real (hidden from a monitored team); the Produk tab keeps the mark |
| marks | both details: `export` stays (⚠5) for the **Produk tab only** — its rows are invented, so no file (the precedent's only-real-data rule); its reason now says so. The Supplier Report's Ekspor ⚠1 is untouched (its content is open) |
| tests | Go `supplier_channel_export_test.go` (4), `supplier_figure_export_test.go` (5), `export_helpers_test.go`, `san_export_test.go` (3), `cmd/app_development/supplier_goods_reader_test.go` (+StoreGoods), document `TestUploadFlow_TableExportIsPrivate` · stories `SupplierTabExport` (5), ChannelBrowser `ExportsTheTabAsFiltered`, `AMonitorHasNoExport`, SupplierStatistics `ExportsTheViewOnScreen`, both details' `EachTabExportsItsOwnTable` / `APhoneExportIsInTheSheet` updated · e2e `the_supplier_exports.spec.ts` (3: the downloaded Toko file's headers and its 2 rows, the Per Produk file's one row at exactly Rp 50000) — helper `e2e/xlsx.ts` reads an .xlsx with no library |
| perf | `-tags perfaudit` `TestPerf_SupplierChannelExport`, `TestPerf_SupplierFigureExport` — ≤ 35 ms but Per Produk over a year on the top supplier, 82 ms median; none heavy, no report |

**Still not built:** the Produk tab's export (waits for the store–product link), the Supplier Report's export (its content
is open — [the-report-export-is-marked](../../technical/frontend/suppliers_decision.md#the-report-export-is-marked)).

## 2026-11-07 (part 4) — the Supplier Report exports the whole ranking

[a-report-export-is-the-whole-view-as-a-file](../../technical/frontend/context_decision.md#a-report-export-is-the-whole-view-as-a-file)
(owner *"A"*) closed what [the-report-export-is-marked](../../technical/frontend/suppliers_decision.md#the-report-export-is-marked)
left open: the file is **the whole ranking as narrowed, each row with its figures** (flow:
[rpc.md § The report as a file](../../services/supplier_service/rpc.md#the-report-as-a-file--supplierreportexport)).

| | |
| --- | --- |
| contract | `SupplierAnalyticService.SupplierReportExport` — `team_id`, the report's `FilterItem`s (window required; team, keyword; a supplier refused), its `MetricSort`; a server stream `{message, done, total, download_url, filename}`; policy Root, Administrator, selling roles — not NO_SIDE_EFFECTS |
| backend | `supplier_report_export.go` — the ranking WHOLE in one statement (`ranking()`, factored out of `MetricSearch` in metric_search.go, which still cuts its pages from it), read with the sums it holds per supplier (`rankedSuppliers` → `rankedSupplier{Key, SupplierFigureSums}`, since 2026-11-14 — each 200 used to be filled by `supplierMetricData`), the suppliers read by id with the deleted ones (`suppliersOf`), teams through `ExportStore.TeamNames`; sheet *Peringkat*: Peringkat · Pemasok · Status (*Dihapus*) · Dikelola oleh · the tabs' figure columns (Penjualan included); file `laporan-pemasok-…` |
| frontend | `features/suppliers/analytics.ts` `reportQuery` (the ranking's filters + sort), `exports.ts` `useReportExport`; `pages/supplier-report` — Ekspor wired on the desktop (progress on the button, disabled on an invalid window) and as the phone header's icon (the-report-export-folds-on-a-phone → a-phone-header-action-is-an-icon); hidden from a monitored team. `pending.ts` DELETED with its i18n reason — the report has no mark left |
| tests | Go `supplier_report_export_test.go` (3: the file = the report's MetricSearch + MetricData across 214 suppliers / 11 screen pages / 2 steps, Penjualan, the deleted marked, the rank across pages; narrowed by rate, search, team; refusals + policy) · stories `ExportsTheWholeRankingAsNarrowed`, `MonitoringOffersNoExport`, `APhoneFoldsTheExport` (taps it) · e2e `the_supplier_exports.spec.ts` "the Supplier Report's file is the whole ranking as narrowed" (headers + the one ranked row, Rp 50000 exact) |
| perf | `TestPerf_SupplierReportExport` (2 000 suppliers), 2026-11-14 old vs new on one seed: a year 1 139–1 171 → 294–362 ms, 31 → 11 queries (by rate 1 339–1 361 → 305, one team 684–697 → 181, a search 2 066–2 094 → 683–722; 30 d ≈ 300 both — the ranking dominates) — 🟡 [SupplierReportExport.md](../../../audits/services/supplier_service/performances/SupplierReportExport.md) finding 1 applied: the figures are the ranking statement's own sums; the old and new file byte-identical on the export test's fixture (six narrowings, fractional Penjualan); at 522k rows only Penjualan (Rp)'s last binary digit can differ, as it already did between two runs of the old export (finding 3). Reading the ranking a MetricSearch page at a time was 2.6 s / 6.3 s before `ranking()` |

**Still not built:** the Produk tab's export (waits for the store–product link).

## 2026-11-14 — the Gudang filter narrows the supplier list and Discover

[the-warehouse-filters-before-the-team](../../technical/frontend/suppliers_decision.md#the-warehouse-filters-before-the-team)
and [the-warehouse-filter-narrows-only-the-rows](../../technical/frontend/suppliers_decision.md#the-warehouse-filter-narrows-only-the-rows)
(flow: [rpc.md § The Gudang filter](../../services/supplier_service/rpc.md#the-gudang-filter--supplierlists-warehouse_id)).

| | |
| --- | --- |
| contract | `SupplierListFilter.warehouse_id = 7` (0 = any warehouse) — buf drift: `supplier.pb.go` + `supplier_pb.ts` only |
| definition | received at W = a batch carrying the supplier, in W, that holds units, was minted by a `restock`, or has an `order` row — exactly the `SupplierGoods` WAREHOUSE rows (Gudang terkait). The batch's own supplier (the restock LINE's, a transfer's copy), every team's goods; transfer-ins count while they hold units or were sold from, as the chips show them |
| backend | inventory `supplier_ids_at_warehouse.go` (plain function over `*gorm.DB`) + test · supplier `goods_reader.go` `WarehouseGoods` (asked of the GoodsReader by type assertion — `tools/san`'s `refoldGoods` needs no new method) · `supplier_list.go` `narrowByGoods` (the warehouse's set cut by the bands in Go → one `= ANY`; a band not asked once empty), a warehouse role only its own building · `cmd/app_development/supplier_goods_reader.go` gains the `db` (wire_gen: one line) |
| frontend | `queries.ts` / `discover.ts` send `warehouseId` (in the query key); both pages reset to page 1 on a pick and count it in "nothing matches"; `SupplierWarehouseFilter` lost its mark; `features/suppliers/listPending.ts` deleted with `suppliers.pending` (en/id) and both pages' `NotImplementedSummary` |
| tests | Go `supplier_list_test.go` +5, inventory `supplier_ids_at_warehouse_test.go`, `cmd/app_development/supplier_goods_reader_test.go` +1 (real batches through the seam) — mutation-checked · stories: suppliers `TheWarehouseNarrowsTheRows`, `TheWarehouseStaysInTheUrl`, Discover `TheWarehouseNarrowsTheCards` (request, rows, whole figures, URL, Clear), the mark-less first-picker stories, `SupplierWarehouseFilter` `AllWarehousesWhenNonePicked` · e2e `the_supplier_goods.spec.ts` +1 (a second, empty warehouse: the supplier under A on the list and Discover, not under B) |
| perf | `cmd/app_development/supplier_list_warehouse_perf_test.go` (2 000 suppliers, 100 000 batches): the seam 32 ms on a 30 000-batch warehouse, 19 ms on 10 000; the list with a warehouse 22–43 ms (unchanged without); a pure index probed and NOT added (no gain for this shape) |
| marks | list / Discover: none left |

**Still not real:** the Produk tab (rows and figures — the store–product link, P2/P3), its export, and the detail page's
warehouse chip narrowing the tabs.

## 2026-11-14 (part 2) — the supplier–product link, and each line credits its own supplier

[restock-accepted-links-the-product-to-its-channel](../../business/supplier/context_decision.md#restock-accepted-links-the-product-to-its-channel),
[every-accepted-line-links-its-own-product](../../business/supplier/context_decision.md#every-accepted-line-links-its-own-product),
[a-link-remembers-its-last-restock](../../business/supplier/context_decision.md#a-link-remembers-its-last-restock),
[a-line-with-no-store-links-under-the-supplier](../../business/supplier/context_decision.md#a-line-with-no-store-links-under-the-supplier)
and the switch in [the-supplier-comes-from-the-restock-until-lines-name-a-store](../../business/supplier/context_decision.md#the-supplier-comes-from-the-restock-until-lines-name-a-store)
(flow: [rpc.md § The links](../../services/supplier_service/rpc.md#the-links--every-accepted-line-links-its-product)).
No screen changes in this phase — the Produk tab reads the rows in P3.

| | |
| --- | --- |
| table | supplier `00005_supplier_channel_products.sql` — `team_id`, `supplier_id`, `channel_id` (NULL = the supplier with no store), `product_id`, `first_restocked_at` (LEAST), `last_restocked_at` + `last_restock_id` (GREATEST), `created_at`, `updated_at`; UNIQUE (supplier, channel, product, team) NULLS NOT DISTINCT; (supplier, last DESC, id DESC) for the tab's page; no FK (the fold must never refuse an accept over a reference — suppliers and stores are soft-deleted). Model `SupplierChannelProduct` · schema doc + erDiagram |
| write path | `analytic_links.go` `upsertLinks` — the fold writes an ACCEPT's links in its own transaction, after the claim (a redelivery writes nothing), one statement sorted by (supplier, store, product, team); every line naming a supplier links — an all-broken line too; a line naming none links nothing; a correction links nothing. The day re-fold links each lost accept it claims (after its table lock). |
| the switch | `creditedLines` — each line's figures credit the line's OWN supplier (`foldLines` groups/locks by supplier, product); a line naming none credits none; a line reading 0 beside a non-zero restock-level id (an event from before lines carried theirs) counts for the restock's. Before/after on a restock mixing Melati's line (7 good, 1 short, 2 broken) and Budi's all-broken line plus a line naming none: **before** — the restock-level id is 0, NOTHING credited; **after** — Melati 7 · 1 · 2, Budi 3 broken, the third line nobody. The day re-fold counts only its supplier's lines and names the other suppliers' days a mixed claim leaves short |
| backfill | `san supplier backfill-links [--dry-run]` (`tools/san/supplier_links.go`, repeatable) — `LinkBackfill` (accepts merged in memory, 500 links per transaction) + `DayRefold` of every supplier day of a MIXED restock (accept day + correction days via new `inventory_v1.RestockCountCorrectionDays`); `dev setup` step 6a. **Dev DB, 2026-11-14:** 7 accepted restocks · 12 lines naming a supplier · **5 links** (dry run 5 new → run 5 new → again 0 new / 5 already right); mixed restocks **none** → the switch moves no dev figure, nothing re-folded (7 figure rows, 7 claims unchanged) |
| tests | Go `analytic_links_test.go` (9: links per line/store/none, two teams, mixed restock before/after, no-supplier lines, first/last, redelivery writes nothing (ctid), correction links nothing, backfill dry/real/repeat + switched, lost mixed accept re-folded per supplier) — mutation: the restock-level crediting fails 4 · `tools/san/supplier_links_test.go` (dry run writes nothing, links + mixed-day figures, second run unchanged, output) · inventory `restock_received_count_correct_test.go` +1 assert · `TestDevSetupDatabaseIsRepeatable` green · e2e `suppliers`, `supplier_channels`, `the_supplier_goods`, `the_supplier_exports`, `restock_warehouse_wants_to_accept`: 39 passed, 3 *expected to fail, but passed* — the acceptance check of the acceptance *multi suppliers → recorded at each supplier* ([restock.md](../../acceptances/inventory/restock.md), ✅ ok on the owner's word 2026-11-14 — its error entry deleted) (`test.fail`, one per warehouse role) now passes: this switch fixes it; its status (and the `test.fail`) change only on the owner's word (acceptances guide `status-is-per-then`) · smoke 11 green |
| concurrency | `analytic_links_race_test.go` (5, `-tags raceaudit`): one link raced 8-way keeps earliest/latest; the second waits on the link; one accept 8× links once; opposite line orders 0 deadlocks (unsorted → 8/30 rounds 40P01); a re-fold waits on the report before any link (links-before-lock → fails). SAFE — no finding file; [lock-order.md](../../../audits/services/supplier_service/concurrency/lock-order.md) rows + History |
| perf | `analytic_links_perf_test.go` `TestPerf_LinkFold` (40 000 links): the fold is 5 statements; 20 lines 4.3–5.0 ms, 100 lines 12–16 ms; the link upsert 0.4 / 1.6 ms in Postgres — nil cost; History row in [performances/FoldHandler.md](../../../audits/services/supplier_service/performances/FoldHandler.md) |
| contract | comments only — `RestockAccepted.supplier_id`, `RestockAcceptedLine.supplier_id`, `RestockReceivedCountCorrected.supplier_id` (buf drift: `event.pb.go` + `event_pb.ts`) |

**Still not real:** the Produk tab (P3 — rows from these links, Terjual/Siap per store × product), its export (P4),
the detail page's warehouse chip narrowing the tabs (P5/P6).

## 2026-11-14 (part 3) — the Produk tab on the links, and its file (P3 + P4)

[the-products-tab-searches-and-pages](../../business/supplier/context_decision.md#the-products-tab-searches-and-pages),
[the-products-tab-filters-by-team-and-store](../../technical/frontend/suppliers_decision.md#the-products-tab-filters-by-team-and-store),
[a-supplier-product-row-says-whose-where-and-when](../../technical/frontend/suppliers_decision.md#a-supplier-product-row-says-whose-where-and-when),
[the-detail-tabs-show-sold-and-ready](../../technical/frontend/suppliers_decision.md#the-detail-tabs-show-sold-and-ready),
[each-supplier-tab-exports-its-own-table](../../technical/frontend/suppliers_decision.md#each-supplier-tab-exports-its-own-table)
(flow: [rpc.md § The Produk tab](../../services/supplier_service/rpc.md#the-produk-tab--supplierproductlist)).
The Produk tab of My Supplier's and Discover's detail reads the links: real rows, real Terjual and Siap, a real file.

| | |
| --- | --- |
| contract | `SupplierChannelService.SupplierProductList` (`NO_SIDE_EFFECTS`; filter `supplier_id`, `q`, `product_team_id`, `store_id` XOR `no_store` — a CEL rule; the guideline List envelope) and `SupplierProductExport` (stream, the same filter). A row: link id, product id/name/code/thumbnail, team, store id/name/type (0 = none), first/last restock, optional figures `{sold_units, orders, last_order_unix, ready_units}` — **no price, no cost** (buf drift: `supplier_channel.pb.go`, `.connect.go`, `supplier_channel_pb.ts`) |
| backend | `supplier_v1/supplier_product_list.go` (`productSet`: the supplier's links, a deleted store's hidden, narrowed, newest restock first, ONE statement with `COUNT(*) OVER ()`; `productRows`: ONE `ProductCards` + ONE `StoreProductGoods` per page) · `supplier_product_export.go` (the set in 200-row steps, sheet *Produk*, Tim gone with a team picked) · seams: `product_catalog.go` (`ProductCatalog` — a 6th `NewService` dependency) and `goods_reader.go` `ProductGoods` (type-asserted on the GoodsReader; missing → an Internal error, never dashes) |
| other services | inventory `SupplierStoreProductGoods` (plain function, the page's store × product pairs: sold net of returns with the orders and last order, ready) · product `IDsMatchingAmong` (name or SKU ILIKE among given ids, one bound array) · composition root `cmd/app_development/supplier_products.go` (`supplierProductCatalog`) + `supplier_goods_reader.go` `StoreProductGoods`; `wire.go` provider `NewSupplierProductCatalog` |
| visibility | the same rows and figures for every selling team — the owning team and any other on Discover (another-team-sees-everything-of-a-supplier, every-selling-team-sees-every-teams-figures); `team_id` authorises only. Export hidden from a monitored team (it stores a file) |
| frontend | `features/suppliers/products.ts` (`useSupplierProductPage`, `NO_STORE`, `productFilter`) · `exports.ts` `useProductExport` · `ProductBrowser.tsx` reads for itself (props `teamId`, `supplierId`, `channels`; search debounced, `product.store=none` in the URL, RefreshOverlay, Export) · `SupplierStoreSelect` `noStoreLabel` (a first "No store" option, a dash under it) · `SupplierTabExport` lost its `mark` prop · **deleted** `sampleProducts.ts`, `sampleSupplierFigures.ts` · i18n `supplierChannel.products.noStore` |
| marks | both details: `products`, `sold`, `ready`, `export` gone — only `warehouseFilter` left (now ⚠1) |
| Storybook | `.storybook/supplierProductFixtures.ts` (31: five links — two teams, no store, bought once, no goods arrived, no picture; 35: 24 links; 36: another team's) + `supplierProductList` / `supplierProductExport` in `supplierStub.ts`, `supplierExportScenario.products` · stories: ProductBrowser 24, supplier-detail Products 7, Tabs / Warehouses / discover Tabs / Header updated, SupplierStoreSelect +1, SupplierFigures and SupplierTabExport off the samples — the three dirs 23 files / 146 tests green |
| tests | Go `supplier_product_list_test.go` (8), `supplier_product_export_test.go` (3), inventory `supplier_store_product_goods_test.go` (3), product `product_ids_matching_among_test.go` (1), `cmd/app_development/supplier_products_test.go` (real wiring) · e2e `the_supplier_goods.spec.ts` (the restocked product on the Produk tab at its store, 2 sold · 3 ready, 0 · 5 after the cancel), `the_supplier_exports.spec.ts` (the Produk file's header and its one row) |
| perf | `cmd/app_development/supplier_product_list_perf_test.go` (2 000 suppliers, 40 000 links, 100 000 batches): 4 statements a page; typical 2.9 ms, the 4 000-link supplier 12.5 ms (page 100: 14.2), one store / no store / one team 5.9 / 10.2 / 10.9 ms; its search ≈ 51–77 ms, ≈ 50 of it the 28 KB id array crossing Docker Desktop's loopback (a control bind costs the same); export 4 000 rows 1.1 s streamed. The figures read was quadratic in the page (a nested loop over two aggregates) — fixed before shipping, 200 pairs 78 → 48 ms. A batches index probed and NOT added. No problem → no audit file; numbers in rpc.md |

**Still not real:** the detail page's warehouse chip narrowing the tabs (P5/P6 — P5 built below), product-discover-detail's suppliers
(`sampleSuppliers.ts`).

## 2026-11-14 (part 4) — the Gudang terkait chip narrows the Toko and Produk tabs (P5)

[a-supplier-page-is-scoped-by-its-warehouses](../../technical/frontend/suppliers_decision.md#a-supplier-page-is-scoped-by-its-warehouses),
[each-supplier-tab-exports-its-own-table](../../technical/frontend/suppliers_decision.md#each-supplier-tab-exports-its-own-table)
(flow: [rpc.md § The Gudang terkait chip](../../services/supplier_service/rpc.md#the-gudang-terkait-chip--the-toko-and-produk-tabs-under-a-warehouse)).
On My Supplier's and Discover's detail, a picked warehouse narrows the Toko and Produk tabs and their files on the server,
and lives in the URL. Statistik does not narrow yet (P6 — the reports carry no warehouse).

| | |
| --- | --- |
| definition | received at W = the Gudang terkait test, now ONE shared SQL predicate (`receivedHere` in `inventory_v1/supplier_ids_at_warehouse.go`): a batch of the supplier in W that holds units, was minted by a `restock`, or has an `order` row. Toko = the supplier's stores with such a batch; Produk = the links whose (store, product) — store 0 for a line naming the supplier alone — has one. Figures (Terjual, Siap) = that warehouse's; *Terakhir dibeli* stays the link's own |
| contract | `warehouse_id` on `SupplierChannelListFilter` (4) and `SupplierProductListFilter` (6) — the lists and both exports; `SupplierGoodsRequest.warehouse_id` (4, 0 = every warehouse). buf drift: `inventory.pb.go`, `supplier_channel.pb.go`, `inventory_pb.ts`, `supplier_channel_pb.ts` |
| backend | `supplier_channel_list.go` (`channelSet` + the stores at W bound before count and page; a warehouse role naming another building → PermissionDenied) · `supplier_product_list.go` (`productSet` + the pairs at W as two unnested arrays inside the one statement) · both exports follow · `goods_reader.go` `WarehouseGoods` gained `StoresAtWarehouse` / `StoreProductsAtWarehouse`, `StoreGoods` / `StoreProductGoods` take W |
| other services | inventory `SupplierStoresAtWarehouse`, `SupplierStoreProductsAtWarehouse` (new, `supplier_stores_at_warehouse.go`), `SupplierStoreProductGoods(…, warehouse, pairs)`, `SupplierGoods` honours `warehouse_id` · composition root `cmd/app_development/supplier_goods_reader.go` |
| frontend | both detail pages `useUrlState("warehouse", idCodec)` → `?warehouse=`; `ChannelBrowser` / `ProductBrowser` take `warehouseId` + `onClearWarehouse` (query keys, figures, Export; back to page 1 on a change; the chip alone leaving nothing → *No supplier stores / products at this warehouse* + All Warehouses); `goods.ts`, `queries.ts`, `products.ts`, `exports.ts` carry it · i18n `noneAtWarehouse`, `noneAtWarehouseHint` (Toko, Produk), the reason reworded |
| marks | both details: `warehouseFilter` stays ⚠1 for **Statistik only** — its reason now *the Statistics tab does not narrow by warehouse yet* |
| Storybook | goods stub honours `warehouseId` (`storeReceivedAt`), product fixtures `warehouses`, `supplierStub` narrows the stores / rows and records the chip in `supplierExportScenario` · stories: ChannelBrowser +3, ProductBrowser +3, supplier-detail Warehouses +2 (pick → URL `warehouse=14`, Toko + Produk narrowed, All clears; opened at `?warehouse=11`, Export carries it), discover Tabs +1 — the three dirs 23 files / 155 tests green |
| tests | Go supplier_v1: channel list (chip W1 / W2 / none / a warehouse with none, a store at both, two teams, paged, + search/type; refusals), product list (a product at both warehouses with each one's figures, a no-store link, team B's row, paged; + store / no store / team / search; needs inventory), both exports follow · inventory `supplier_stores_at_warehouse_test.go`, `SupplierGoods` one warehouse, `SupplierStoreProductGoods` under a chip · `cmd/app_development/supplier_products_test.go` real wiring at two warehouses · 4 guards mutation-checked · e2e `the_supplier_goods.spec.ts` (last: a second store's product restocked into B — B's chip hides what was received at A, A's the reverse, All both) |
| perf | `cmd/app_development/supplier_warehouse_chip_perf_test.go` (2 000 suppliers, 40 000 links, 100 000 batches): the chip adds one statement (the set at W, ≈ 1–2.5 ms); Toko big 2.3 ms; Toko figures big 79 → 15 ms; Produk typical 3.5 ms, big 8.4 ms (no chip 13.0), with a search 64 ms — ≈ 50 of it the loopback stall on a ≈ 17 KB bind (statement 7.9 ms); export Produk 1 500 rows 142 ms. No index added. No problem → no audit file; numbers in rpc.md |

**Still not real:** Statistik under the chip (P6 — the reports' warehouse key and a refold), product-discover-detail's
suppliers (`sampleSuppliers.ts`).

## 2026-11-14 (part 5) — the supplier reports carry the warehouse; Statistik under the chip (P6)

[the-supplier-reports-carry-the-warehouse](../../technical/frontend/suppliers_decision.md#the-supplier-reports-carry-the-warehouse),
[a-supplier-page-is-scoped-by-its-warehouses](../../technical/frontend/suppliers_decision.md#a-supplier-page-is-scoped-by-its-warehouses)
(flow: [rpc.md § The warehouse](../../services/supplier_service/rpc.md#the-warehouse--both-reports-under-a-chip)).
Under a Gudang terkait chip, Statistik — headline, Per Periode, Per Produk, its Export — reads that warehouse's restocks
and sales; no chip is the sum over every warehouse, which is the figures as before. ⚠ An existing-table change: a full
run is due.

| | |
| --- | --- |
| schema | supplier_service `00006_supplier_reports_carry_the_warehouse` (via `san migrate create`): `warehouse_id` on `supplier_product_daily_reports`, `supplier_sale_daily_reports`, `supplier_sale_order_parts` — ADDED AT 0 then the default dropped, last in both unique keys and the parts' PK; Down folds the warehouses back together. Not truncated: claims are pruned after 45 days and parts need inventory's take, so SQL cannot rebuild them. Applied on dev |
| events | none changed — `RestockAccepted.warehouse_id`, `RestockReceivedCountCorrected.warehouse_id` (receiving), `OrderPlaced` / `OrderCancelled.warehouse_id` were there. Inventory's in-process take `OrderTakeSuppliers` returns each part's `batches.warehouse_id` (composition root maps it) |
| folds | restock: the accept's warehouse, a correction its own · sales: the take's warehouse (one per order), else the order's; a cancel subtracts from its parts' warehouse · `DayRefold` keys rows by (product, team, warehouse), a claim naming none falls back to the log's warehouse. Lock order unchanged (warehouse last; one warehouse per event) |
| contract | `metrics/suppliers` supports `FILTER_TYPE_WAREHOUSE` (`supplier_analytic.proto` doc + `supported_filters`) — buf drift: `supplier_analytic.pb.go`, `supplier_analytic_pb.ts` |
| backfill | `san supplier backfill-warehouses [--dry-run]` (`tools/san/supplier_warehouses.go`; service: `analytic_warehouse_backfill.go` — `SalePartWarehouses`, `UnplacedReportDays`, `ReportTotals`): parts re-filed from their take, every supplier day with a 0 row re-folded, every supplier's totals BEFORE == AFTER; repeatable; a `dev setup` step. **Dev**: 5 supplier days re-folded, supplier 1 restock 374 · Rp 11.650.000, lost 110 · Rp 3.850.000, broken 17 · Rp 500.000 and supplier 2 restock 114 · Rp 3.960.000 — unchanged; rows under 0: 7 → 0; a second run: nothing to re-fold |
| frontend | `analytics.ts` (`Window.warehouseId` → `WarehouseFilter` after the window, in the query keys), `exports.ts` `useStatisticsExport` carries it, `SupplierStatistics` `warehouseId` prop (tables back to page 1 on a change); both detail pages pass `?warehouse=` — **deleted** both `pending.ts`, their `NotImplementedSummary`, the chip's ⚠ and i18n `supplierChannel.pending` / `suppliers.discover.pending`; `RelatedWarehouses` `marks` optional. **No mark is left on either detail page** |
| Storybook | `supplierFigureFixtures.ts` rows carry `warehouseId` (Sumber's Beras at 11, Gula at 14 …), `supplierStub` honours `warehouseFilter` · stories: SupplierStatistics +4 (`AWarehouseChipNarrowsEveryFigure`, `NoChipIsTheSumOfTheWarehouses`, `TheExportCarriesTheChip`, `UnderAWarehouseChip`), supplier-detail Warehouses +1 (`AChipNarrowsStatistik`), discover Tabs +1 (`TheChipNarrowsStatistik`), both Tabs `NothingIsMarkedAnyMore`, mark asserts flipped — the three dirs 161 tests green |
| tests | Go `analytic_warehouse_test.go` (7), `metric_warehouse_test.go` (3: chip W1 / W2 / none = their sum every group; no chip byte-equal; the Export), `analytic_warehouse_race_test.go` (3, `raceaudit`), inventory `supplier_order_take_test.go`, `tools/san/supplier_warehouses_test.go`, refold tests' labels · 4 guards mutation-checked (the WHERE, the refold fallback, the take's warehouse, the accept's) · raceaudit suite green (one pause key updated for the wider row read) · e2e `the_supplier_goods.spec.ts` +1 (Statistik under B's chip: Rp 40.000 / 4 Benang, no Kain; A's the reverse; none Rp 90.000) — 10 passed |
| perf | `analytic_perf_test.go` now seeds 3 warehouses (522 000 rows + mirror): chip reads ≈ the no-chip ones — SUMMARY top 366 d 21.2 ms (20.8), 30 d 4.2; DAILY 366 d × 200 13.3 (10.9); PRODUCT ids 19.1 (17.1); `MetricSearch` products 15.5 (17.7). The supplier-day index + a filter; no index added. Fold 6 statements, 8.8 ms @ 100 lines. No problem → no audit file; numbers in rpc.md; concurrency rows in lock-order.md |

**Still not real:** product-discover-detail's suppliers (`sampleSuppliers.ts`).
