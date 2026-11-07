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
| 27 | **Old dev orders have no Team Balance fees** — liability's order routes were never mounted until 2026-11-06, so their `order-placed` events dead-lettered; `san pubsub redrive --topic order-placed` replays them if wanted | data | liability | S | `docs/tools/san.md` |
| 23 | **Settlement — a screen for a shop's own direct rows** (no RPC lists them; a new screen → prototype first) | frontend · API | settlement | M | `docs/development_state/settlement/context.md` |
| 16e | **Several warehouse labels in one PDF** — OrderLabels takes one order today (step 2: merge, a new resource type) | API · frontend | order | L | `pick-queue-next/pending.ts` printMerge |
| 35 | **The warehouse daily statement's old words** — still says *COD* and *Handling fees* (the report is deferred: `the-daily-report-is-deferred`) | frontend | balance | S | `DailyStatementPage` |

### Later — decided, bigger

- **Large-sum drift** — `large-sum-drift-is-left-for-now`: revisit when anything sums ~100.000 exact entries (tolerance scaled to the count).

- **Statistics:** the report-day rebuild command (`a-wrong-day-is-refolded-from-the-log`); server-side month grouping for the expense and balance daily views; the supplier pages' leftovers — the Produk tab's figures (needs the store–product link), the Gudang filter + warehouse narrowing (a supplier_service seam), exports; running sold totals per supplier on the order-take write path (`SupplierGoods.md`: ~5 s cold for a 100k-order supplier; `SupplierIDsByFigure.md`: a Terjual band 0.6–0.9 s at 1M order rows); a rebuild path for Penjualan (`AnalyticReplayCompute` replays restock only); product page suppliers and daily in/out; category product count.
- **Order model** — left: the return-warehouse refusal (`create-refuses-a-team-with-no-return-warehouse`) waits until every team sets one (dev teams 14, 89, 91 have none); OrderList search for root ~77 ms — a union-of-ids rewrite is recommended in `OrderList.md`.
- **Inventory:** goods-in-transit figure; `warehouse_products` team column; legacy supplier tables to drop; expiry report.
- **Overrides shown on records:** 16 stamped tables have no read field or mark.
- **Products / Discover:** lock and stock-age filters; Discover's warehouse, stock, cross-price filters.
- **Exports:** financial account report, supplier tabs.

## Waiting on the owner

| What | Blocks | Needs |
| --- | --- | --- |
| **Returns back on the shelf** — accepted returns never re-enter stock; short returns never written off | the largest stock gap | `docs/business/inventory/return.md` (today: "unplanned") |
| **Undo a wrong restock or transfer accept; recount surplus approval** | adjustment | `docs/business/inventory/adjustment.md` (empty) |
| **Team Balance screens** | balance can close | a preview and accept |
| **Warehouse order list with scanning** (Storybook only) | the scan before Set Picked | design accept, then routing |
| **Price correction (revaluation)** | wrong restock prices | open point 16: does it write an item row, what sign |
| **Analytic inventory metrics, Ads source, supplier metric on Analytic** | statistics | what they count and filter |
| **Smaller calls** — override marks on screens; product barcode; export contents; Discover division; real Shopee/TikTok export files; 4 performance indexes; shipment tracking provider | various | a decision each |
| **Delete the unused `WarehouseProductList` RPC** | cleanup | an OK |

## Done

| Date | Item | Commit |
| --- | --- | --- |
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
| 2026-11-07 | Real supplier figures — Terjual / Siap with their last dates, store and warehouse figures and the summary counts on the list, both detail pages and Discover, from `InventoryService.SupplierGoods` (every selling team's goods, `every-selling-team-sees-every-teams-figures`; a cancel nets out); inventory 00039 index (50 suppliers 396 → 41 ms); e2e `the_supplier_goods.spec.ts`; dev DB migrated; **Penjualan** (`penjualan-is-the-selling-value-on-the-order-day`: supplier 00004 sales fold on order placed/cancelled, the line's share of `platform_total`, Jakarta day, a cancel on its day) and the **fixed Terjual / Siap bands** filtering the list and Discover on the server (`the-range-pills-are-a-fixed-set`) | uncommitted |
