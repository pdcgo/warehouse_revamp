# Backlog — what is incomplete, ranked

The one ranked list of incomplete work: feature, frontend, API, service, event, statistic and flow.
Rules: [the-backlog-is-reranked-after-every-slice](../development_lifecycle_decision.md#the-backlog-is-reranked-after-every-slice).
Open questions are ranked separately in [biggest_question.md](../biggest_question.md).

**Last full re-audit:** 2026-11-04 (against the code, at `2a7fd781`). **Last re-rank:** 2026-11-05 (after #10, #12 and the small pass).

Size: S ≈ under a pass · M ≈ one pass · L ≈ several passes. Kind: bug · frontend · API · service · event · statistic · flow.

## Ranking

### Tier 1 — bugs that hurt a person

Empty since 2026-11-04 — all six fixed (see Done). Tier 2 is next.

### Tier 2 — money that never arrives

| # | What is incomplete | Kind | Area | Size | Where |
| --- | --- | --- | --- | --- | --- |

### Tier 3 — order robustness

| # | What is incomplete | Kind | Area | Size | Where |
| --- | --- | --- | --- | --- | --- |

### Tier 4 — cleanup and small gaps

| # | What is incomplete | Kind | Area | Size | Where |
| --- | --- | --- | --- | --- | --- |
| 21b | **Close a shop** (`a-shop-is-closed-never-deleted`: status, Close/Reopen, a "closed" filter) — until then a closed shop's statements import through the API and auto-import but not from the dialog | feature | shop | M | `docs/business/shop/context_decision.md` |
| 25 | **The screens' "expiring" colour uses `now + 30 × 24 h`** — the server now counts Jakarta days (`batch_list.go` soonCutoff); the batches, batch detail and warehouse product pages can disagree for a few hours on the 30th day | bug · frontend | inventory | S | `docs/development_state/architecture/context.md` |
| 26 | **`san dev setup` stops at `supplier move` on the dev DB** — "supplier_service already holds a different row under a moving id" (store 1, supplier 1 renamed since the move); steps 5–10 don't run after it. Dev data, not code — the move should skip or report rows already moved and edited | tool | supplier | S | `tools/san` supplier move |
| 27 | **Old dev orders have no Team Balance fees** — liability's order routes were never mounted until 2026-11-06, so their `order-placed` events dead-lettered; `san pubsub redrive --topic order-placed` replays them if wanted | data | liability | S | `docs/tools/san.md` |
| 22 | **No report folds expenses** — `ExpenseCreated` / `ExpenseAdjusted` reach only the paying account; Analytic's expense figures do not hear them | statistic | expense | M | `tools/san/pubsub.go` |
| 23 | **Settlement — a screen for a shop's own direct rows** (no RPC lists them; a new screen → prototype first) | frontend · API | settlement | M | `docs/development_state/settlement/context.md` |
| 16e | **Several warehouse labels in one PDF** — OrderLabels takes one order today (step 2: merge, a new resource type) | API · frontend | order | L | `pick-queue-next/pending.ts` printMerge |

### Later — decided, bigger

- **Large-sum drift** — `large-sum-drift-is-left-for-now`: revisit when anything sums ~100.000 exact entries (tolerance scaled to the count).

- **Statistics:** the report-day rebuild command (`a-wrong-day-is-refolded-from-the-log`); server-side month grouping for the expense and balance daily views; real supplier figures (Sold/Ready/Sales/Warehouse); product page suppliers and daily in/out; category product count.
- **Order model:** courier as `shipment_channel_id` (and "no order without a courier"); `order_addresses` tables; drafts without stored mappings; refuse an order for a team with no return warehouse (after every team sets one).
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
| 2026-11-05 | #24 closed — not a gap: Mark as Lost / Return Goods are the seller's actions (`every-allowed-move-has-a-button`, built); the warehouse's side is `a-return-is-received-by-search-then-forced`, built. `/san.exe` ignored | uncommitted |
| 2026-11-05 | 10b *Total* sorts `total_cost`, new *Platform total* sort; 16f a transfer's label photo for A, B and the seller (`WarehouseTransferLabelPhoto`); 10f + 10d `san pubsub releases list / replay`; settlement `orders.settlement_opened_at` (selling 00040) with the *No settlement account* badge and filter live; a key colliding across accounts at once is refused, not *internal* | uncommitted |
| 2026-11-05 | Settlement: MetricData / MetricSearch as one running sum (200 days 1.6 s → 41 ms); Jakarta DB sessions (`san_dbsession`) + the settlement list's Jakarta period; `san report refold` for the shop and person reports, later days' carry shifted; liability daily on Jakarta days; batch "expiring soon" on the Jakarta day; `the_settlement_report.spec.ts` | uncommitted |
| 2026-11-06 | Money type: every rupiah is `double precision` / `double` (`every-ledger-moves-to-double-rounded-when-frozen`, `numeric-money-moves-to-double-too`) — settlement, importer, liability, expense, selling costs, inventory reads, supplier valuations, financial accounts, `lost_amount`; frozen to whole rupiah once; a fraction shows up to 3 decimals; full e2e 177 passed | uncommitted |
| 2026-11-06 | `the-backend-never-rounds-money` — orders, ledgers, reports and events store the exact rupiah, only the screen rounds (3 decimals); **liability's order-placed / order-cancelled routes mounted** (Team Balance never got order fees before); dev DB migrated | uncommitted |
