# Backlog — what is incomplete, ranked

The one ranked list of incomplete work: feature, frontend, API, service, event, statistic and flow.
Rules: [the-backlog-is-reranked-after-every-slice](../development_lifecycle_decision.md#the-backlog-is-reranked-after-every-slice).
Open questions are ranked separately in [biggest_question.md](../biggest_question.md).

**Last full re-audit:** 2026-11-04 (against the code, at `2a7fd781`). **Last re-rank:** 2026-11-04.

Size: S ≈ under a pass · M ≈ one pass · L ≈ several passes. Kind: bug · frontend · API · service · event · statistic · flow.

## Ranking

### Tier 1 — bugs that hurt a person

| # | What is incomplete | Kind | Area | Size | Where |
| --- | --- | --- | --- | --- | --- |
| 1 | **Saving the profile wipes the user's own email and phone** — the page never loads them and sends them blank, so the phone password reset stops working | bug | users | M | `pages/profile/index.tsx:31-72`, `user_v1/helpers.go:39-52` |
| 2 | **The admin team's Admin can search every account and see its phone's last 4 digits** — the monitor bypass lets the read through without the policy's role list | bug | users | S | `access_interceptors/interceptor.go:363-428`, `search_user.go` |
| 3 | **Shop access can be granted to a non-member, a suspended or an erased account** — the server takes any user ([a-grant-goes-only-to-a-team-member](../business/shop/context_decision.md)); the picker offers suspended people | bug | users · shop | S–M | `selling_v1/shop_user_add.go`, `user_v1/user_list.go` |
| 4 | **A warehouse may not be able to print shipping labels** — the decision record says Print Label fails because the label belongs to the seller. ⚠ Not reproduced yet: verify first | bug | order | M | [warehouse_order_list_decision](../technical/frontend/warehouse_order_list_decision.md) `a-warehouse-prints-the-labels-of-orders-it-ships` |
| 5 | **Statement money can land on the wrong order** — two live orders on one marketplace ref: the importer credits the newest instead of posting to the shop | bug | settlement | S | `import_run.go:308,537-560` |
| 6 | **Analytic's "Created by" filter is dead for everyone but Root and the Administrator** — it uses the system-wide user search | bug | statistic | M | `pages/analytic/index.tsx:228` |

### Tier 2 — money that never arrives

| # | What is incomplete | Kind | Area | Size | Where |
| --- | --- | --- | --- | --- | --- |
| 7 | **Restock payments and transfer shipping never leave the paying account** — 6 events are published with no listener (restock and transfer created/updated/cancelled) | event | financial account | M | `financial_account_service/register.go`, `tools/san/pubsub.go` |
| 8 | **A transfer's courier fee is never booked in the team balance** — decided 2026-10-19 (TRANSFER_FEE); the screens still say undecided | event | balance | M | `liability_service/push_handler.go`, `warehouse-transfer-accept/pending.ts` |
| 9 | **An expense names no paying account and publishes nothing** | event · API | expense | M | `expense.proto` |

### Tier 3 — order robustness

| # | What is incomplete | Kind | Area | Size | Where |
| --- | --- | --- | --- | --- | --- |
| 10 | **Stock stays taken when an order create fails after the take** — no per-submit key, no compensation event; cancel calls inventory directly | flow · event | order | L | `stock_picker.go:57-62`, `order_cancel.go:74` |
| 11 | **Problem, lost and forced-return moves have no buttons** — the server allows them | frontend | order | S | `features/orders/rowActions.ts:95-104`, `pages/pick-order` |
| 12 | **No duplicate-ref warning on the order form** (create, draft finalize, Try Again) | frontend | order | M | `OrderByExternalRefs` has no caller |

### Tier 4 — cleanup and small gaps

| # | What is incomplete | Kind | Area | Size | Where |
| --- | --- | --- | --- | --- | --- |
| 13 | **Two always-red tests and no CI on developer branches** — `language.spec.ts:47` matches two "Produk Baru" buttons; financial-account stories fail 22:00–10:00 WIB (`financialAccountStub.ts:77`); `ci.yml` skips `backup/**`, `thoni` | test | all | S | |
| 14 | **Screens say working features are not built** — rack countLock, transfer labelPhoto, courierDebt's reason, discover lockFilter copy, 4 orphan orderForm keys | frontend | inventory · order | S | `pending.ts` files |
| 15 | **Erased people read "erased57" instead of "Former user #57"** on ~10 screens | frontend | users | M | `formerUserId` unused there |
| 16 | **Small screen gaps** — handover scan finds only the first 200 orders; shop filters do nothing; drafts "ready" counts one page; counted racks not disabled in the accept's rack picker; role labels English-only | frontend · API | order · shop · inventory | S each | |
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
