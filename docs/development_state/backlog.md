# Backlog — what is incomplete, ranked

The one ranked list of incomplete work: feature, frontend, API, service, event, statistic and flow.
Rules: [the-backlog-is-reranked-after-every-slice](../development_lifecycle_decision.md#the-backlog-is-reranked-after-every-slice).
Open questions are ranked separately in [biggest_question.md](../biggest_question.md).

**Last full re-audit:** 2026-11-04 (against the code, at `2a7fd781`). **Last re-rank:** 2026-11-04 (after #11, #15, #16, #18, 16c, 16g).

Size: S ≈ under a pass · M ≈ one pass · L ≈ several passes. Kind: bug · frontend · API · service · event · statistic · flow.

## Ranking

### Tier 1 — bugs that hurt a person

Empty since 2026-11-04 — all six fixed (see Done). Tier 2 is next.

### Tier 2 — money that never arrives

| # | What is incomplete | Kind | Area | Size | Where |
| --- | --- | --- | --- | --- | --- |
| 7c | **A restock or transfer made before its listener existed** — its payment was never posted, yet a later edit posts the difference and a cancel refunds, so the account gains money that never left. Matters only for data from before 2026-11-04 | event | financial account | S | `postPaymentLegs` |
| 7d | **No warehouse-transfer e2e spec** | test | inventory | M | `frontend/e2e` |
| 9c | **Restocks never check their paying account on the server** — only the form narrows the picker; reuse the expense `PayingAccounts` seam | API | inventory | S | `restock_request_create.go` |
| 9d | **An API caller can send a STOCK_LOSS expense** — stored with no account; refuse it outside inventory's internal call | API | expense | S | `expense_create.go` |

### Tier 3 — order robustness

| # | What is incomplete | Kind | Area | Size | Where |
| --- | --- | --- | --- | --- | --- |
| 10 | **Stock stays taken when an order create fails after the take** — no per-submit key, no compensation event; cancel calls inventory directly | flow · event | order | L | `stock_picker.go:57-62`, `order_cancel.go:74` |
| 12 | **No duplicate-ref warning on the order form** (create, draft finalize, Try Again) | frontend | order | M | `OrderByExternalRefs` has no caller |

### Tier 4 — cleanup and small gaps

| # | What is incomplete | Kind | Area | Size | Where |
| --- | --- | --- | --- | --- | --- |
| 16h | **Return dialogs stretch to full height on desktop** — Receive a Return and Accept Return | frontend | order | S | `features/orders/AcceptReturnDialog.tsx` |
| 16f | **Only the sending warehouse can open a transfer's label photo** — the file is not shared with warehouse B or the seller; owner call | frontend · API | inventory | S | `TransferDetailCards.tsx` |
| 16e | **Several warehouse labels in one PDF** — OrderLabels takes one order today (step 2: merge, a new resource type) | API · frontend | order | L | `pick-queue-next/pending.ts` printMerge |
| 17 | **About 30 stale "not built" markers** in decision and state files (users, settlement, inventory open points) | doc | all | S | |

### Later — decided, bigger

- **Statistics:** Analytic Warehouse Fee and Inventory Lost (data exists); financial account onto MetricSearch; the report-day rebuild command (`a-wrong-day-is-refolded-from-the-log`); server-side month grouping for the expense and balance daily views; real supplier figures (Sold/Ready/Sales/Warehouse); product page suppliers and daily in/out; category product count.
- **Order model:** courier as `shipment_channel_id` (and "no order without a courier"); `order_addresses` tables; drafts without stored mappings; refuse an order for a team with no return warehouse (after every team sets one).
- **Money type:** settlement, liability and expense ledgers still integer (decided double); stock reads still int64.
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
| 2026-11-04 | Table mirroring package — `backend/pkgs/san_table_mirroring`, all 9 decisions; no caller yet ([state](packages/table_mirroring.md)) | uncommitted |
| 2026-11-04 | #1 Saving the profile wiped email and phone — new `ProfileDetail`; save sends only changed fields | uncommitted |
| 2026-11-04 | #2 The admin team's Admin could search every account — SearchUser holds a monitor to its policy | uncommitted |
| 2026-11-04 | #3 Shop grants to non-members or suspended people — refused by ShopUserAdd/SetPrimary; picker excludes them | uncommitted |
| 2026-11-04 | #13 Red tests and CI — language e2e by test id, financial-account stub at N×24h, CI on `backup/**` and `thoni` | uncommitted |
| 2026-11-04 | #4 A warehouse could not open a label — new `OrderLabels` (one order) through an in-process document seam | uncommitted |
| 2026-11-04 | #5 The importer credited the newest of two live orders — posts to the shop, reason "several orders", ids kept | uncommitted |
| 2026-11-04 | #6 Analytic "Created by" was dead for non-root — lists the people on the metric's rows; new `SettlementPersonList` | uncommitted |
| 2026-11-04 | #16b Expenses Storybook — stub, 25 stories with play() | uncommitted |
| 2026-11-04 | #16d Settlement "Created by" read the whole daily report — `user_settlement_reports.last_day` (`00008`, kept by the fold and the replay); 28/31 ms → 1.06/1.04 ms | uncommitted |
| 2026-11-04 | #16b Expenses: the WIB date pre-fill, Record hidden from customer service, the list refreshed after a refusal, short WIB dates | uncommitted |
| 2026-11-04 | #7 Restock payments post to the paying account — created, the difference on edit, account moves, the refund on a returned cancel | uncommitted |
| 2026-11-04 | #8 A transfer's courier fee is booked in the team balance as TRANSFER_FEE (owed to the receiving warehouse) | uncommitted |
| 2026-11-04 | #14 Stale "not built" marks removed (rack count lock, transfer marks); the transfer label photo is shown; the Expenses ⋯ menu closes behind Cancel | uncommitted |
| 2026-11-04 | #18 The restock label photo opens through a signed link (seller); the warehouse sees "attached" | uncommitted |
| 2026-11-04 | #16 Shop filters work (marketplace, primary CS, no primary CS); the drafts Ready count covers every page | uncommitted |
| 2026-11-04 | #11 Mark as Problem, Mark as Lost and Return Goods on problem orders (selling side) | uncommitted |
| 2026-11-04 | #15 Erased people read "Former user #N" everywhere | uncommitted |
| 2026-11-04 | 16c Server errors read as sentences, faults translated | uncommitted |
| 2026-11-04 | 16g Stale notes fixed; the Expenses month follows WIB | uncommitted |
| 2026-11-04 | 16b Expenses phone layout accepted (`the-expenses-phone-layout-is-accepted`) | uncommitted |
| 2026-11-04 | #9 Expenses pay from an account — stored and checked, ads need a shop, events posted to the account (ads_expense / expense), corrections follow | uncommitted |
| 2026-11-04 | #7b A transfer's shipping leaves the paying account as `expense` (`a-transfers-shipping-posts-as-an-expense`) | uncommitted |
| 2026-11-04 | #18b The restock's warehouse opens its label photo (`RestockReceiptPhoto`) | uncommitted |
| 2026-11-04 | #11b Receive a Return (search, force, accept), Force Return on the order pages, Mark as Lost on shipped, Return Goods on completed | uncommitted |
