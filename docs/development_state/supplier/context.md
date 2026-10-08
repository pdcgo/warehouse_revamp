# Development state — supplier

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
| service | `backend/services/supplier_service/` — `supplier_v1/`: 10 CRUD RPCs + 6 figures RPCs + the fold, one file each, a test file each · `supplier_service_models/` (5 models) · `db_migrations/00001_create_suppliers.sql`, `00002_supplier_figures.sql` · `register.go` (4 Connect services + the push route `/event/supplier-fold/push`, `FoldSubscription = "supplier-fold"`) |
| contract | `proto/warehouse/supplier/v1/` — `SupplierService`, `SupplierChannelService` (`supplier.proto`, `supplier_channel.proto`; `SupplierListFilter.owner_team_id` is Discover's Team filter) · `SupplierAnalyticService` (`AnalyticTimeSearch`, `AnalyticProductSearch`, `AnalyticGroupSearch`, `AnalyticGroupMetric`) and `SupplierAnalyticMaintenanceService` (`AnalyticReplayCompute`, `AnalyticMaintenanceRun`) in `supplier_analytic.proto` · `warehouse.events.v1.RestockAccepted` (variant 400, topic `restock-accepted`) |
| the fold | `analytic_fold.go` — settlement's shape: one transaction = lock FOR SHARE → claim `supplier_event_logs` by event id → one upsert per line on (day, supplier, product, team), ADDING (no later-day shift — no balance) → live only: lower `figures_live_since`. Value = units × total ÷ ordered. A restock with no supplier folds nothing, acked |
| the reads | `analytic_*.go` — `window()` + `figureSums()` in `analytic_shared.go`; time buckets per grain with settlement's caps (366 d / 60 m / 20 y); the ranking joins `suppliers` + live stores for `q`, includes deleted suppliers, and orders by rate with `rateMinUnits = 50` first (`rate_min_units` on the response — the screen never keeps its own copy) |
| replay / maintenance | `AnalyticReplayCompute` — settlement's, plus: refused unless `start_date` is AFTER `figures_live_since`'s Jakarta day (the backfilled past was never on the broker) · `AnalyticMaintenanceRun` — prunes `supplier_event_logs` > 45 days by `created_at` |
| inventory_service | `RestockRequestFulfill` publishes `RestockAccepted` AFTER the commit (`restock_accepted_event.go`: `publishAccepted`, the pure `RestockAcceptedEvent`, `AcceptedRestocks` for the backfill). A 5th `NewService` arg, `events event_source.EventSender` (nil → `EmptySender`). A failed publish is logged, never fails the accept · earlier: `00023` renamed the legacy tables; `SupplierChecker` asked before any transaction |
| `san` | `supplier move` · **`supplier backfill-figures`** (`tools/san/supplier_backfill.go`) — `NewSupplierFigures` in the CLI's Wire set; reads `inventory_v1.AcceptedRestocks` in batches of 500, folds via `FoldBackfill`; skips accepts at/after `figures_live_since`; `figures_backfilled` makes a second run fold nothing · `dev setup` step 6 · `pubsub ensure` declares `supplier-fold` on `restock-accepted` |
| dev server | `cmd/app_development/replay_broker.go` — one `replayBroker` per subscription: `NewReplayBroker` (settlement), `NewSupplierReplayBroker`; inventory gets the existing `EventSender` through Wire |
| frontend | `features/suppliers/analytics.ts` — the three hooks on the real RPCs (`listQuery`; names via `ProductByIds`, `SupplierByIds` — a deleted supplier marked — and `teamsByIdsQuery`) · `figures.ts` (the record + rates) · `FigureParts.tsx` (tiles, cells with a muted rate, phone block, `RestockTeamFilter`) · `SupplierStatistics.tsx` (props: `supplierId` only) · `pages/supplier-report/` (search, team picker, rank by value or rate, the 50-unit note, a deleted supplier marked and opening nothing) · Discover's Team filter · the menu's **Suppliers** group (`SUPPLIERS_GROUP` in `nav.ts`) — routes unchanged under `/inventories/suppliers/…` |
| Storybook | `.storybook/supplierFigureFixtures.ts` (dated relative to today, the arithmetic in its comments) + `supplierAnalyticService` in `supplierStub.ts`; `pickTeam` in `pageStory.tsx` · `vitest.config.ts`'s browser port is **6106** (under 49152 — Windows reserves ranges above it after a Docker start) |
| still sample | the Products tab (`sampleProducts.ts`) and product-discover-detail's suppliers (`sampleSuppliers.ts`) — the store-to-product link needs a store on each restock line |
| tests | Go: all green from the root (fold 8, reads 6 files, replay 3, maintenance 1, inventory publish 3, the backfill command 1, `owner_team_id` 1) · stories **1047** green · e2e `restock`, `suppliers`, `supplier_channels` — 12 green |
| audits | CRUD: perf **SupplierList HEAVY** ([report](../../../audits/services/supplier_service/performances/SupplierList.md), not applied — 3 open questions there), concurrency SAFE ([lock-order.md](../../../audits/services/supplier_service/concurrency/lock-order.md)) · figures: concurrency — one 🔴 found and **fixed the same day**, two accepts sharing products deadlocked on line order; the fold now writes in product order ([FoldHandler.md](../../../audits/services/supplier_service/concurrency/FoldHandler.md)); everything else proved SAFE (`analytic_fold_race_test.go`, `analytic_replay_compute_race_test.go`, `-tags raceaudit`) · performance — three 🔴 found and **fixed the same day**: the ranking 1 071 → 90 ms @ 1 year (one grouped statement, dates as literals), a page's figures 102 → 20 ms, the fold 3 + lines → 4 statements (2.1 ms @ 20 lines); reports in [performances/](../../../audits/services/supplier_service/performances/); the window's limit is Q19. ⚠ Re-measure on a FRESH database per test — rolled-back seeds bloat a reused one ~4× |
| docs | `docs/database-schema.md` (the three figure tables) · `docs/services/supplier_service/rpc.md` (the fold, the reads, the replay) · `docs/services/inventory_service/rpc.md` (the accept announces) · `docs/tools/san.md` (`supplier backfill-figures`, setup step 6, `supplier-fold`) · CLAUDE.md's setup line |

## Decided, not built

| decision | waits on |
| --- | --- |
| [restock-accepted-links-the-product-to-its-channel](../../business/supplier/context_decision.md#restock-accepted-links-the-product-to-its-channel) · [every-accepted-line-links-its-own-product](../../business/supplier/context_decision.md#every-accepted-line-links-its-own-product) · [a-link-remembers-its-last-restock](../../business/supplier/context_decision.md#a-link-remembers-its-last-restock) — `supplier_channel_products`, the Products tab | a store on each restock line — restock [Q3](../../business/inventory/restock_clarify.md#question), [Q12](../../business/inventory/restock_clarify.md#question). Then the event gains the line's store, the fold reads the supplier from it ([the-supplier-comes-from-the-restock-until-lines-name-a-store](../../business/supplier/context_decision.md#the-supplier-comes-from-the-restock-until-lines-name-a-store)), and the link is one more upsert in the same fold |
| [a-late-correction-lands-in-the-six-columns](../../business/supplier/context_decision.md#a-late-correction-lands-in-the-six-columns) — the adjustment event, a Root-only RPC, its `san` command | nothing — not built this pass. The fold would take a second variant into the same upsert |
| the drop of `legacy_suppliers` / `legacy_supplier_channels` | the move having run on every database — a later inventory migration |

## Next

1. **Q19** — if the cap is taken: a 366-day check in `AnalyticGroupSearch` and `AnalyticGroupMetric` (beside `parseRange`), and the report's date picker says why.
2. **SupplierList's search** — the owner's answers to its perf report's three questions, then a trigram migration
   **`00003`** in supplier_service (the owner's call, HARD RULE 3/8).
3. **The adjustment** ([a-late-correction-lands-in-the-six-columns](../../business/supplier/context_decision.md#a-late-correction-lands-in-the-six-columns)) — decided, unbuilt.
4. **The link and the Products tab** — when restock lines name a store.

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
