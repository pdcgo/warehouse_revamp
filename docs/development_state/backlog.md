# Backlog — what is incomplete, ranked

The one ranked list of incomplete work: feature, frontend, API, service, event, statistic and flow.
Rules: [the-backlog-is-reranked-after-every-slice](../development_lifecycle_decision.md#the-backlog-is-reranked-after-every-slice).
Open questions are ranked separately in [biggest_question.md](../biggest_question.md).

**Last full re-audit:** 2026-11-04 (against the code, at `2a7fd781`). **Last re-rank:** 2026-11-05 (after #10, #12 and the small pass).

Size: S ≈ under a pass · M ≈ one pass · L ≈ several passes. Kind: bug · frontend · API · service · event · statistic · flow.

## Ranking

### Tier 1 — bugs that hurt a person

Empty again since 2026-11-07 — #31 fixed (see Done).

### Tier 2 — money that never arrives

| # | What is incomplete | Kind | Area | Size | Where |
| --- | --- | --- | --- | --- | --- |

### Tier 3 — order robustness

| # | What is incomplete | Kind | Area | Size | Where |
| --- | --- | --- | --- | --- | --- |

### Tier 4 — cleanup and small gaps

| # | What is incomplete | Kind | Area | Size | Where |
| --- | --- | --- | --- | --- | --- |
| 27 | **Old dev orders have no Team Balance fees** — the dead-lettered `order-placed` events are GONE (the Pub/Sub emulator keeps them in memory; restarted 2026-11-12), so `san pubsub redrive` replays nothing. Only dev orders 5 and 6 miss fees (15.000 warehouse fee each, order 6 also a product fee). Recovery (a one-off backfill / re-publish) or leave dev as is — the owner's call | data | liability | S | `docs/tools/san.md` |

### Later — decided, bigger

- **Large-sum drift** — `large-sum-drift-is-left-for-now`: revisit when anything sums ~100.000 exact entries (tolerance scaled to the count).

- **Statistics:** server-side month grouping for the expense and balance daily views; the supplier pages' leftovers — the Produk tab's figures (needs the store–product link), the Gudang filter + warehouse narrowing (a supplier_service seam); running sold totals per supplier on the order-take write path (`SupplierGoods.md`: ~5 s cold for a 100k-order supplier; `SupplierIDsByFigure.md`: a Terjual band 0.6–0.9 s at 1M order rows); a rebuild path for Penjualan (`AnalyticReplayCompute` replays restock only); product page suppliers and daily in/out; category product count.
- **Order model** — left: OrderList search for root ~77 ms — a union-of-ids rewrite is recommended in `OrderList.md`.
- **Inventory:** correcting a wrong stock-in — a restock or transfer accepted with the wrong count (direction decided: an `adjustment` for the units still there, `a-rollback-only-undoes-a-take`; who, money and naming undesigned — `adjustment-md-is-retired`); goods-in-transit figure; `warehouse_products` team column; legacy supplier tables to drop; expiry report.
- **OwnerStockHistory leftovers** (`audits/services/inventory_service/performances/OwnerStockHistory.md`): the product's batches are still found by a sequential scan (a full `(team_id, product_id)` index, ≤ 3 ms gain) and the order-key / receipt lookup still runs for every row before paging (a query rewrite — the owner's call); 12.5 s → 19 ms already fixed by inventory 00041.
- **Inventory metrics at volume** (`audits/services/inventory_service/performances/MetricData.md`): Ready by month over a year ≈ 0.6 s cold and root's one-year headline ≈ 0.3 s — page reads past 128 MB shared buffers (9 ms warm). Options when real volume arrives, the owner's call: a monthly rollup folded on every stock write; a third reader index (costs every stock write).
- **Generated-file sweep leftovers:** `ShareDocument` answers Internal (not NotFound) when it loses the race to the sweep — nothing shares a generated file today; a scale-to-zero deploy runs no ticker (the `san` command or a scheduler covers it until a deploy decision).
- **Overrides shown on records — leftovers** (`an-override-shows-a-platform-badge`): `liability_payment_requests` (the notice names the team), `team_agent_policies` (a toggle), `documents` / `document_shares` (no list screen) — nothing to show today; the restock lists' phone blocks name no accepter / arriver, so no badge there.
- **Transfer list (selling side) has no phone layout** — at 390 px its tabs overlap (found 2026-11-12, predates the badge).
- **Products / Discover:** lock and stock-age filters; Discover's warehouse, stock, cross-price filters.
- **Exports:** the supplier Produk tab (its figures are samples); the Supplier Report export at 2.000 suppliers takes 1.1–1.7 s a year — read the figures from the ranking query's own totals (~5×, `SupplierReportExport.md`).

## Waiting on the owner

| What | Blocks | Needs |
| --- | --- | --- |
| **Product barcode** | scanning by barcode (several per product) | ⏸ parked by the owner (2026-10-19, kept parked 2026-11-09) |
| **Real Shopee/TikTok export files** | testing the importers on real data | files from the owner |
| **Index proposals the audits measured** | speed at volume | the owner's OK (HARD RULE 2/3) |
| **Discover division** (Prioritas · Riset · Umum per product) | Discover's division chips (marked) | **Toni** — the product context is his (`products-follow-the-unit-price`); the owner: *"bukan kewenanganku"* |

## Done

| Date | Item | Commit |
| --- | --- | --- |
| 2026-11-12 | **`san report refold` covers every event-fed report** (`a-wrong-day-is-refolded-from-the-log`) — added `order-daily --team`, `supplier-restock-daily` / `supplier-sale-daily --supplier` (claim lost events, lock the report table, dry run, safe to re-run); the fed-by table in `docs/tools/san.md` (in-transaction reports need none); race + interleave tests | uncommitted |
| 2026-11-12 | **#45 The rack page no longer flashes its skeleton** — skeletons only until first drawn, a re-read dims under `RefreshOverlay`; one layout tree at every width; story *A refresh keeps the page drawn* | `ac396de3` |
| 2026-11-12 | **#35 The daily statement's words** — *Order fees* / *Biaya pesanan* (`the-ledger-speaks-the-business-words`) and *Courier COD* / *Ongkir COD* (`the-warehouse-statement-says-ongkir-cod`); `StatementWords.stories.tsx`; full e2e 300 passed | `ac396de3` |
| 2026-11-12 | **#44 A shelf shows a warehouse units only** (`a-warehouse-sees-ready-value-but-a-shelf-only-units`) — `RackDetail` / `RackStock` leave price + value unset for a warehouse-role caller (5 `optional` fields); the rack page draws money only when sent; root / the monitor keep it; e2e `the_warehouse_reads_a_shelf_in_units.spec.ts`; full e2e 302 passed | `078971d5` |
| 2026-11-12 | **Four Inventory metrics on Analytic** — Restock, Transfer, Returned stock, Ready stock (`the-inventory-metrics-prototype-is-accepted` + 3 answers): inventory 00042 daily changes + door reports folded in all 13 stock writers (order take +0.5–0.9 ms); `MetricSearch`/`MetricData` serve them; units-position kind + *Positions (units)* graph; a warehouse sees no value on the three movement metrics; prototype deleted; e2e `the_inventory_metrics.spec.ts`; full e2e 265 passed | `00215cc8` |
| 2026-11-12 | **#43 Analytic no longer crashes switching an id group to a time group** — stale rows keep their own group's labels; story `SwitchingWarehouseToMonthly` | `00215cc8` |
| 2026-11-12 | **Koreksi Harga live** (`the-correct-price-prototype-is-accepted`, `a-corrected-price-is-above-zero`) — `BatchRevalue` (batch row locked first; refuses stale form, ≤ Rp 0, same price, no units left, empty reason); history *Harga dikoreksi* rows; BatchDetail figures from their own rows, not the current price; inventory 00041 history ref indexes (OwnerStockHistory 12.5 s → 19 ms); e2e `the_owner_corrects_a_batch_price.spec.ts`; full e2e 261 passed | `6c49c708` |
| 2026-11-12 | **Team Balance *Recorded by* live** (`the-team-balance-recorded-by-is-accepted`) — ledger + payments name who recorded each row, *by Root team* on Root's; `LiabilityLog.is_override` 12, `recorded_is_override` 15; prototype deleted; restock lists' Accepted / Arrived cells badged (`restockStepOverrides`, one statement, 0.5 ms at 200 rows); e2e `the_team_balance_names_who_recorded.spec.ts`; full e2e 256 passed | `ab1a09ab` |
| 2026-11-12 | **Restock and transfer lists show *by Root team*** on the creator — `created_by_is_override` (RestockRequest 40, WarehouseTransfer 33) from the first trail row, one `DISTINCT ON` lookup per page (0.3 ms at 200 rows); badge beside the name in the cell, desktop + phone; full e2e 250 passed | `ab1a09ab` |
| 2026-11-11 | **The *by Root team* badge is live** (`the-override-badge-is-accepted-as-by-root-team`) — 14 proto fields over 10 protos; `RootTeamBadge` / `ActorName` on 13 stamped tables' screens (orders, drafts, timelines, every stock ledger, restock/transfer timelines, account log, bundles, settlement entries, imports, expenses + its new *Recorded by* column, member log, limit log); prototype deleted; 17 `…_ReadsTheOverrideStamp` tests; `the_root_team_badge.spec.ts`; full e2e 229 passed | `a41abd04` |
| 2026-11-11 | **#41 `WarehouseProductList` deleted** (`warehouse-product-list-is-deleted`) — rpc gone, its messages emptied to `reserved` numbers + names; the arrangement rows untouched | `a41abd04` |
| 2026-11-11 | **#38 Generated downloads swept after 7 days** (`generated-files-are-kept-seven-days`) — `SweepGeneratedFiles` on a daily ticker (`GENERATED_FILE_SWEEP_EVERY`), advisory-locked, 1000/run; `san document sweep-generated`; document 00012 partial index (43 → 0.7 ms at 316k) | `a41abd04` |
| 2026-11-11 | **#39 Label photos honour EXIF orientation** — `san_pdf_merge/orientation.go`, all 8 orientations tested; no new dependency | `a41abd04` |
| 2026-11-11 | **#42 Raw `orderDetail.money.platformTotal` key** — locales caught up with `platform-is-the-word-for-the-outside-marketplace` (*Platform total*); `racks.detail.description` added; `src/i18n/keys.test.ts` guards every literal key; full e2e 225 passed | `a41abd04` |
| 2026-11-11 | **Return warehouse required to order** (`create-refuses-a-team-with-no-return-warehouse`) — dev teams 14/91 → Dev Warehouse, 89 → Jakarta Warehouse; create + Promote refused `FailedPrecondition` naming the team; fixtures + `the_order_needs_a_return_warehouse.spec.ts`; full e2e 225 passed | `a41abd04` |
| 2026-11-04 | Table mirroring package — `backend/pkgs/san_table_mirroring`, all 9 decisions, README + examples; no caller yet ([state](packages/table_mirroring.md)) | `57c1c6c4` |
| 2026-11-04 | #1 Saving the profile wiped email and phone — new `ProfileDetail`; save sends only changed fields | `19607cbb` |
| 2026-11-04 | #2 The admin team's Admin could search every account — SearchUser holds a monitor to its policy | `19607cbb` |
| 2026-11-04 | #3 Shop grants to non-members or suspended people — refused by ShopUserAdd/SetPrimary; picker excludes them | `19607cbb` |
| 2026-11-04 | #13 Red tests and CI — language e2e by test id, financial-account stub at N×24h, CI on `backup/**` and `thoni` | `19607cbb` |
| 2026-11-04 | #4 A warehouse could not open a label — new `OrderLabels` (one order) through an in-process document seam | `19607cbb` |
| 2026-11-04 | #5 The importer credited the newest of two live orders — posts to the shop, reason "several orders", ids kept | `19607cbb` |
| 2026-11-04 | #6 Analytic "Created by" was dead for non-root — lists the people on the metric's rows; new `SettlementPersonList` | `19607cbb` |
| 2026-11-04 | #16b Expenses Storybook — stub, 25 stories with play() | `19607cbb` |
| 2026-11-04 | #16d Settlement "Created by" read the whole daily report — `user_settlement_reports.last_day` (`00008`, kept by the fold and the replay); 28/31 ms → 1.06/1.04 ms | `19607cbb` |
| 2026-11-04 | #16b Expenses: the WIB date pre-fill, Record hidden from customer service, the list refreshed after a refusal, short WIB dates | `19607cbb` |
| 2026-11-04 | #7 Restock payments post to the paying account — created, the difference on edit, account moves, the refund on a returned cancel | `19607cbb` |
| 2026-11-04 | #8 A transfer's courier fee is booked in the team balance as TRANSFER_FEE (owed to the receiving warehouse) | `19607cbb` |
| 2026-11-04 | #14 Stale "not built" marks removed (rack count lock, transfer marks); the transfer label photo is shown; the Expenses ⋯ menu closes behind Cancel | `19607cbb` |
| 2026-11-04 | #18 The restock label photo opens through a signed link (seller); the warehouse sees "attached" | `19607cbb` |
| 2026-11-04 | #16 Shop filters work (marketplace, primary CS, no primary CS); the drafts Ready count covers every page | `19607cbb` |
| 2026-11-04 | #11 Mark as Problem, Mark as Lost and Return Goods on problem orders (selling side) | `19607cbb` |
| 2026-11-04 | #15 Erased people read "Former user #N" everywhere | `19607cbb` |
| 2026-11-04 | 16c Server errors read as sentences, faults translated | `19607cbb` |
| 2026-11-04 | 16g Stale notes fixed; the Expenses month follows WIB | `19607cbb` |
| 2026-11-04 | 16b Expenses phone layout accepted (`the-expenses-phone-layout-is-accepted`) | `19607cbb` |
| 2026-11-04 | #9 Expenses pay from an account — stored and checked, ads need a shop, events posted to the account (ads_expense / expense), corrections follow | `19607cbb` |
| 2026-11-04 | #7b A transfer's shipping leaves the paying account as `expense` (`a-transfers-shipping-posts-as-an-expense`) | `19607cbb` |
| 2026-11-04 | #18b The restock's warehouse opens its label photo (`RestockReceiptPhoto`) | `19607cbb` |
| 2026-11-04 | #11b Receive a Return (search, force, accept), Force Return on the order pages, Mark as Lost on shipped, Return Goods on completed | `19607cbb` |
| 2026-11-04 | #12 The duplicate-ref warning names live orders and drafts on the same shop + ref (`OrderDraftByExternalRefs`) | `c67bea5b` |
| 2026-11-04 | #10 Stock never stays taken by a failed order — a unique key per order, the take first and given back on failure (`InventoryTxCancel`), cancel by event behind the count check, the pick page by transaction id, the form lock + Try Again | `c67bea5b` |
| 2026-11-05 | 9c Restocks refuse an account that is not the team's active operational one; 9d STOCK_LOSS refused through the API | `23cf811d` |
| 2026-11-05 | 12b A colleague's draft is named without a link; 12c draft-by-ref index (selling 00037); 16h return dialogs normal size on desktop | `23cf811d` |
| 2026-11-05 | 7d Warehouse-transfer e2e (`transfers.spec.ts`); 7c dropped — no real data before the listeners (`revamp-has-no-real-orders-yet`) | `23cf811d` |
| 2026-11-05 | 9e Transfers refuse a paying account that is archived or not the team's (any active one may pay — owner B); 16i five more dialogs normal size on desktop | `23cf811d` |
| 2026-11-05 | Statistics: Warehouse Fee on Analytic (net per day, a warehouse sees its amount); Finance category (Account changes, Change types, Account filter, running-sum balance — a year 1.5 s → 11 ms; the three old reads removed, the report moved onto them); Lost stock (count shortages + adjust lost, gross, folded in-process) | `23cf811d` |
| 2026-11-05 | #19 Analytic product and supplier filters are real searchable pickers with name chips (seller: its own; warehouse: what it holds; root: every team's) | `23cf811d` |
| 2026-11-05 | #17 Stale markers: 295 checked against the code — 108 built (58 ✅ lines in decision files, 46 rewritten), 50 still open with current reasons, 137 obsolete; table in `D:/hermes/cache/scratch/stale_markers.md` | `23cf811d` |
| 2026-11-05 | #20 Order create, draft push and draft shop-setting need a shop grant or a manager (shared `shop_write_gate.go`; ShopList `writable` for the pickers); #21 a deleted shop still imports its statements, refused for new orders | `23cf811d` |
| 2026-11-05 | #20b `san shop grant-current-cs` — the shop gate's rollout grant (every current CS gets every live shop of their team; idempotent, --dry-run); **the release must run it**. #20c index `shop_users (user_id, shop_id)` (selling 00039) — ShopList writable 5.7 → 2.9 ms | `23cf811d` |
| 2026-11-05 | #24 closed — not a gap: Mark as Lost / Return Goods are the seller's actions (`every-allowed-move-has-a-button`, built); the warehouse's side is `a-return-is-received-by-search-then-forced`, built. `/san.exe` ignored | `b646600b` |
| 2026-11-05 | 10b *Total* sorts `total_cost`, new *Platform total* sort; 16f a transfer's label photo for A, B and the seller (`WarehouseTransferLabelPhoto`); 10f + 10d `san pubsub releases list / replay`; settlement `orders.settlement_opened_at` (selling 00040) with the *No settlement account* badge and filter live; a key colliding across accounts at once is refused, not *internal* | `b646600b` |
| 2026-11-05 | Settlement: MetricData / MetricSearch as one running sum (200 days 1.6 s → 41 ms); Jakarta DB sessions (`san_dbsession`) + the settlement list's Jakarta period; `san report refold` for the shop and person reports, later days' carry shifted; liability daily on Jakarta days; batch "expiring soon" on the Jakarta day; `the_settlement_report.spec.ts` | `b646600b` |
| 2026-11-06 | Money type: every rupiah is `double precision` / `double` (`every-ledger-moves-to-double-rounded-when-frozen`, `numeric-money-moves-to-double-too`) — settlement, importer, liability, expense, selling costs, inventory reads, supplier valuations, financial accounts, `lost_amount`; frozen to whole rupiah once; a fraction shows up to 3 decimals; full e2e 177 passed | `b646600b` |
| 2026-11-06 | `the-backend-never-rounds-money` — orders, ledgers, reports and events store the exact rupiah, only the screen rounds (3 decimals); **liability's order-placed / order-cancelled routes mounted** (Team Balance never got order fees before); dev DB migrated | `b646600b` |
| 2026-11-06 | #25 one Jakarta-day 'expiring soon' rule on the screens (`lib/expiry.ts`); #26 `supplier move` recognises a moved-then-edited row by origin; dev DB's clashing legacy supplier / store 1 renumbered to 3 (backup `D:/hermes/backups/2026-11-06_dev_supplier_renumber_backup.sql`), `dev setup` runs clean | `88621385` |
| 2026-11-06 | #28 closed — not a bug: a team restocks from another team's supplier by design (`a-team-restocks-from-another-teams-supplier`, `a-line-connects-to-any-teams-supplier-from-a-popup`) | `88621385` |
| 2026-11-06 | #22 Analytic expense metrics live — Ads expense + Expenses (typed kinds), kept by expense_service in the same transaction (expense 00006), a correction on its own day for its maker, Seller / Warehouse headline rule; e2e `the_expense_metrics.spec.ts`; dev DB migrated | `88621385` |
| 2026-11-06 | #30 `ExpensePersonList` — Analytic's Created by lists the expense metrics' people; #29 a stock-loss expense lands on the Jakarta day (`expense_v1.JakartaDay`) | `dfb77e3f` |
| 2026-11-06 | #21b Close Shop — `status` + `closed_at` replace `deleted` (selling 00043), ShopClose / ShopReopen, edit locked but access editable, new selling refused (re-checked in the order's transaction), a waiting draft keeps its closed shop; report filters offer closed shops badged (`report-filters-offer-closed-shops`); e2e `the_closed_shop.spec.ts`; dev DB migrated | `ecd8f0c6` |
| 2026-11-06 | Order model: courier as `shipment_channel_id`, required on the form (selling 00044); `order_addresses` / `order_draft_addresses`, names only (00045, 00046) with the form pre-filling regions on one exact match (`RegionMatch`); drafts store no mapping (00047) and the list's Ready drops *unmapped*; trigram search indexes (00048); dev DB migrated | `9c819418` |
| 2026-11-07 | Team Balance desktop screens pass `design_accept` (`the-team-balance-screens-are-accepted`): review fixes (stub ledger, frozen badge, Pending/Accept words, Edit Terms, order-form limit line), the **All** tab first, #31 only the debtor records a payment (FailedPrecondition, shared lock vs accept, race tests), the proof upload / summary strip / GrowingPager; the phone layout live (`the-team-balance-phone-layout-is-accepted`: blocks, filters in a sheet, tabs scroll in one row); the team-type filter is the shared `ChoiceFilter` | `8644d2ba` |
| 2026-11-07 | #34 Team Balance filters on the server — the pairs list's search (name or code, via the team seam) / team type / awaiting, and the pair's date range (Jakarta days) / direction / side, all before paging; Balance after stays the true running balance; no index needed (6–31 ms) | `2e67d050` |
| 2026-11-07 | Real supplier figures — Terjual / Siap with their last dates, store and warehouse figures and the summary counts on the list, both detail pages and Discover, from `InventoryService.SupplierGoods` (every selling team's goods, `every-selling-team-sees-every-teams-figures`; a cancel nets out); inventory 00039 index (50 suppliers 396 → 41 ms); e2e `the_supplier_goods.spec.ts`; dev DB migrated; **Penjualan** (`penjualan-is-the-selling-value-on-the-order-day`: supplier 00004 sales fold on order placed/cancelled, the line's share of `platform_total`, Jakarta day, a cancel on its day) and the **fixed Terjual / Siap bands** filtering the list and Discover on the server (`the-range-pills-are-a-fixed-set`) | `0d51eb2a` |
| 2026-11-07 | #23 **Entri Toko** — a shop's own settlement rows (`the-shop-entries-page-is-accepted`): `ShopSettlementEntryList` (shop, kind, learned Jakarta day; totals; the statement each row came from via the importer's `StatementLinesBySettlementLogIds`), Reverse inline (`a-shop-entry-reverses-inline`; a row reverses once, under the account lock — race-tested), the menu line and the report's By shop link; #36 the report's window on Jakarta days; settlement 00011 + importer 00005 (1.7 ms a page at 200k rows); e2e `the_shop_entries.spec.ts`; dev DB migrated | `747d4b12` |
| 2026-11-07 | #37 Every date window on Jakarta days — one helper `lib/jakartaDay.ts` (timezone-independent; 34 tests run under five zones) for Analytic, suppliers, financial accounts, settlement list/report, Shop Entries, Team Balance, the daily statement and every list's range; the DatePicker, today cell and the ledger panel's default day fixed too | `7a28377c` |
| 2026-11-07 | Exports: the supplier **Toko** and **Statistik** tabs on both supplier pages (`each-supplier-tab-exports-its-own-table`) on the order export's pattern — `SupplierChannelExport`, `SupplierFigureExport`, a shared `pkgs/san_export` (.xlsx, progress, Jakarta filenames), `TABLE_EXPORT` documents (document 00010), `lib/useFileExport.ts`; e2e `the_supplier_exports.spec.ts` reads the .xlsx; the **Supplier Report** and **Financial Account Report** exports (`a-report-export-is-the-whole-view-as-a-file`: the whole ranking / every period incl. quiet ones / one sheet per breakdown) | `b3bb2a51` |
| 2026-11-09 | #16e **Labels print together** (`a-warehouse-prints-the-labels-of-orders-it-ships`): `OrderLabels` takes up to 50 ids and merges them into one private `order_labels` PDF (document 00011, pdfcpu v0.15.0 — PDFs and photos), one expiring link + a result per order (not shipped here / no label / unreadable); the bulk bar's *Print Labels* sends the ticked rows; e2e `the_labels_print_together.spec.ts`; dev DB migrated | `6c6b408e` |
| 2026-11-09 | **The new warehouse order list is live** at `/warehouse-orders` (`the-warehouse-order-list-is-accepted`): Set Picked only after every line is scanned exact on the pick page (`the-item-scans-live-on-the-page`, `the-pick-page-opens-first-by-the-label`); **Scan Label** and the handover scan look up this warehouse's orders on the server — several shown, none chosen, cancelled skipped (`scan-label-opens-the-pick-page`); the **Returns** tab (`the-warehouse-list-has-a-returns-tab`, `OrderListFilter.statuses`); a monitor sees no writes; on a phone Scan Label stays a one-tap icon (`scan-label-stays-an-icon-on-a-phone`); the old page retired; e2e `the_warehouse_list.spec.ts` | `6c6b408e` |
| 2026-11-09 | #40 **Returns go back on the shelf** — `adjustment.md` and `return.md` retired (`adjustment-md-is-retired`, `return-md-is-retired`); the return's stock half decided (`only-the-return-warehouse-accepts-a-return`, `a-return-mints-one-batch-per-batch-the-order-took`, `a-short-return-is-missing-at-the-door`, `a-broken-returned-unit-is-thrown-away-at-the-door`, `a-return-door-row-carries-an-optional-note`, `the-return-accept-page-is-accepted`) and built: inventory `OrderTransactionReturn` (inventory 00040, `order_return_problem_items`, once per take) + `OrderReturnAccept` with racks, broken, missing and notes, refused outside the return warehouse (selling 00049); the accept page `/warehouse-orders/:orderId/accept-return`; e2e `the_return_goes_back_on_the_shelf.spec.ts`; full e2e 223 passed | `e3e36c49` |
