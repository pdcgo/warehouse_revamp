# Development state — order

> 🔀 **2026-10-30 — `frada` merged in.** The order screens now carry its work on our wire: the order list's seven date
> pills (Dibuat and Tanggal order real, the five status dates ⚠), no tab counts, the statistics read only when opened, the
> filters in the URL; a draft opens IN the order form (`/orders/new?draft=ID`, the draft page deleted) and its Create
> sends `order_draft_id`; bundles added through a dialog on `BundleList`. Where the two lines disagreed:
> [two-branches-designed-the-order-list-and-the-drafts-apart-and-the-merge-combined-them](../../technical/order/design_clarify.md#two-branches-designed-the-order-list-and-the-drafts-apart-and-the-merge-combined-them).

**Pass:** `implementation` + `technical_test` + `Audit RPC` (2026-10-21) — the build that follows the order context's
design closing. Four slices, built together at the owner's ask: **the eleven statuses with one status move**, **root
reads every team's orders**, **settlement listens to the order events** (and the emulator pushes locally), and **the
return warehouse's table and screen**. Decisions: [context_decision.md](../../business/order/context_decision.md) — the
order context has **nothing open, critiqued, contradicted or awaiting**.

**Second pass (2026-10-22):** the order list's six decided-but-unbuilt marks, at the owner's *"build 6 decided"* — the
warehouse filter, the summary's units, the status date, the tracking number, the frozen warehouse fee and the summary's
money. The fee is step 3 of [the-flat-rate-is-dropped-last](../../business/teams/warehouse/context_decision.md#the-flat-rate-is-dropped-last)
(step 2, the carry-over, with it — [teams/warehouse/context.md](../teams/warehouse/context.md)).

| | built 2026-10-22 |
| --- | --- |
| tracking number | `orders.receipt` (selling `00018`) = `Order.receipt_code`, written at create (form field, already on screen, now sent); searched; on the seller and warehouse rows, the detail, Find Parcel, the handover scan and the export |
| status date | `Order.status_at_unix` — the newest timeline row into the current status, per page row; the list's *Tgl \<status\>* column |
| warehouse filter | `warehouse_id` on `OrderListFilter` + `OrderStatFilter` ([the-seller-list-filters-by-warehouse](../../technical/frontend/order_list_decision.md#the-seller-list-filters-by-warehouse)) |
| frozen fee | `orders.warehouse_fee` (selling `00019`, DOUBLE PRECISION, NULL = never priced): `placeOrder` prices it with `WarehouseFeeCalculate` on `cogs` before its transaction and refuses a warehouse with no rate ([rpc.md](../../services/selling_service/rpc.md)). The form and the draft page show the real fee (`useWarehouseFeeQuote`); Beli, the detail's money and the export read it |
| census | `OrderStatusCount` gains `item_count` and, over the measurable orders only (cost + MP figure + fee), `mp_value` · `cogs` · `fees` · `margin_unknown`. `summaryMock.ts` and the row mocks for resi / fee / stage date are deleted |
| marks left | seller list **4** (import, mpDate, deadline, withdrawal) · warehouse list **5** · order detail **7** · order form drops `receiptCode` and `warehouseFee` |
| dev DB | selling migrated to 19; `warehouse_fees` has Dev Warehouse at 0% / 15.000 / 15.000 (its old flat fee). ⚠ Every other warehouse there has no rate and now refuses orders until it sets one |

**Third pass (2026-10-22):** the platform's two dates, at the owner's *"can we implement the two decided"* —
[platform-created-at-is-required-at-finalize](../../business/order/context_decision.md#platform-created-at-is-required-at-finalize),
[the-shipment-deadline-is-the-platforms-and-optional](../../business/order/context_decision.md#the-shipment-deadline-is-the-platforms-and-optional),
[the-date-filter-switches-created-or-platform](../../technical/frontend/order_list_decision.md#the-date-filter-switches-created-or-platform),
[the-urgency-bands-are-6-and-24-hours](../../technical/frontend/order_list_decision.md#the-urgency-bands-are-6-and-24-hours).

| | built 2026-10-22 |
| --- | --- |
| schema | selling `00020`: `platform_created_at`, `platform_shipment_deadline` on `orders` AND `order_drafts`, NULL before |
| the rule | `placeOrder` refuses an order without the platform date — both doors; a draft may be without it until Promote |
| drafts | push stores both, an edit marks each touched, Promote copies both |
| list | the date filter's *Dibuat · Tgl MP* switch (`OrderDateField`), the Tgl MP column, the deadline badge from the real field (bands 6 h / 24 h in `features/orders/deadline.ts`, `deadlineMock.ts` deleted) |
| form | the order date is required (Create off until set); the ship-by field is the marketplace's deadline; both sent, and both saved with Save as Draft |
| marks left | seller list **2** (import — Q19, withdrawal — Q20) · warehouse list **3** · order detail **6** · order form **10** |
| ⚠ the e2e and the stories | every flow that places an order now picks the order date first (`pickOrderDate`) |

**Fourth pass (2026-10-23):** the buyer's username, its contract accepted —
[the-buyers-username-is-optional](../../business/order/context_decision.md#the-buyers-username-is-optional).

| | built 2026-10-23 |
| --- | --- |
| schema | selling `00021`: `buyer_username TEXT NOT NULL DEFAULT ''` on `orders` AND `order_drafts`, `''` = none |
| contract | `buyer_username` (`max_len: 100`) on `Order`, `OrderCreateRequest`, `OrderDraft`, `OrderDraftPush`, `OrderDraftUpdate` (`optional` there) |
| the rule | none — trimmed by `placeOrder` (both doors), push and update; spaces alone are `''`; empty never refuses |
| drafts | push stores it unless touched (`buyer_username` is its own touched name), an edit marks it, Promote copies it |
| screens | the form sends it on Create and Save as Draft; the draft page seeds it and saves it only when changed; the order detail shows it under the customer (seller's recipient section, warehouse's Info) only when set; the seller's export has a *Buyer username* column beside *Customer* |
| marks left | order form **8** — the `buyerUsername` mark and its copy are deleted; the draft page's `draftKeeps` copy now lists the username among what a draft keeps |
| tests | `order_buyer_username_test.go` (create trims, spaces alone and empty are accepted as none · push, re-push, edit, touched, clear · promote copies, and promotes without one); the seller export's columns shifted by one; the stories *TheBuyersUsernameShowsUnderTheCustomer*, *NoBuyersUsernameShowsNothing*, *TheBuyersUsernameIsKeptByTheDraft*; the e2e create flow types one and reads it back on the detail |
| dev DB | selling migrated to 21 (round-tripped down/up) |

**Fifth pass (2026-10-23):** four decided marks on the order form, at the owner's ask —
[platform-total-is-required-at-finalize](../../business/order/context_decision.md#platform-total-is-required-at-finalize),
[the-cross-markup-belongs-to-the-product](../../business/balance/context_decision.md#the-cross-markup-belongs-to-the-product),
[an-order-records-no-shipping-cost](../../business/order/context_decision.md#an-order-records-no-shipping-cost).

| | built 2026-10-23 |
| --- | --- |
| schema | selling `00022`: `order_drafts.marketplace_total BIGINT NOT NULL DEFAULT 0` — still the build's name, the `platform_total` rename is its own pass |
| contract | `marketplace_total` on `OrderDraft` (22), `OrderDraftPush` (15), `OrderDraftUpdate` (14, `optional`); `OrderCreateRequest`'s comment says required at finalize, its validation stays `gte 0` so the refusal names the field |
| the rule | `placeOrder` refuses `marketplace_total <= 0` — *"an order must say what the buyer paid on the marketplace"* — on both doors; Promote copies the draft's figure. Settlement's `openSale` keeps its skip of a 0 as the guard for orders before `00022` |
| drafts | push stores it unless touched (`marketplace_total` is its own touched name), an edit marks it, 0 clears it |
| create form | the sell price is required (`Field.Root required`, Create off until it is > 0) |
| draft page | seeds the sell price from the stored figure (as typed) when > 0, follows the rows while it is 0; `changed` compares the field with what is stored, Save sends it, and Promote lists *"The sell price is missing."* while the stored figure is 0 — so a derived figure needs one Save. The helper reads the rows' sentence whenever the figure equals the rows' sum |
| invoice | `invoiceRows` charges each line at its PRODUCT's `cross_markup_bps` (read off the same `ProductByIds` rows that name the owner) and sums per owner; a row whose lines share one rate shows it, mixed rates show the markup in rupiah (`orderForm.totals.markupMixedNote`). `mockTerms` kept only the credit limit and debt — and is gone since the seventh pass |
| marks left | order form **6** — `shippingCost` (no shipping by design) and `invoice` deleted; the draft page's own **4** — `sellPrice` deleted, `draftKeeps` lists the sell price as kept. `profit` stays, its reason now only the open minimum margin |
| tests | `order_marketplace_total_test.go` (create refuses 0 and keeps a figure · push, re-push, edit, touched, yield, clear · promote copies · promote of a 0 is refused, nothing written, the draft survives) and a *no marketplace total* case in promote's validation table; every test order carries `testMarketplaceTotal`; the stat test's "no marketplace figure" order is zeroed after placement, as an order from before the rule. Stories *CreateStaysOffUntilTheSellPriceIsFilled*, *TheInvoiceChargesTheProductsOwnMarkup*, *TheSellPriceIsStoredOnTheDraft*, *TheInvoiceChargesEachProductsOwnRate*; fixture product 71 carries 10%, draft 202 stores 130.000. The e2e's `placeOrderViaForm` fills a sell price. Green: selling 167 tests, stories 1475/1475, `orders` + `order_drafts` e2e 23 pass, 2 skipped |
| dev DB | selling migrated to 22 (round-tripped down/up) |

**Sixth pass (2026-10-23):** three decided items at the owner's ask —
[the-ledger-charges-the-frozen-line-total](../../technical/balance/team_balance_design_decision.md#the-ledger-charges-the-frozen-line-total),
the draft list's readiness, and the invoice's fee copy.

| | built 2026-10-23 |
| --- | --- |
| the line's total | the take's per-line `total` was returned and discarded — `StockPicker.Pick` now returns it (`PickTotals`, per product) and `placeOrder` inserts the lines AFTER the pick with it frozen on `order_items.total` (selling `00023`, `DOUBLE PRECISION`, NULL = never frozen). `OrderPlacedLine.total = 5` carries it |
| the ledger | liability posts Σ an owner's line totals, rounded once on the sum, and reads no markup — liability `00010` dropped `product_markup_bp` (and the terms log's pair); the form's invoice and the posted fee are now one rate |
| the draft list | `draftReadiness.ts` gains the order date and the stored sell price, in the detail's Promote order — badges *Order date* / *Sell price* (`orderDrafts.gapOrderDate` / `gapSellPrice`). Fixtures 203 (no date) and 204 (no sell price); story *NoDateOrNoPriceIsNotReady*; the e2e's pushed draft now reads *Shop +4* |
| the fee copy | `orderForm.totals.feeNote` — *Priced by the warehouse for fulfilling this order.* (en) / *Ditetapkan oleh gudang untuk pemenuhan pesanan ini.* (id) |
| ✅ built 2026-10-28 | `unit_cost_with_markup` and `markup_total` (selling `00025_order_item_markup.sql`, `OrderItem` 9–10) ([the-cross-charge-lives-on-the-line](../../business/order/context_decision.md#the-cross-charge-lives-on-the-line)); `OrderItem.total` (8) is on the wire |
| ⚠ two cost bases | `unit_cost` (and `cogs`, the fee's basis) is `StockCost`'s weighted average read before the transaction; `total` is the take's oldest-first draw. One batch drawn, they agree |
| dev DB | selling migrated to 23, liability to 10 (both round-tripped down/up) |

**Seventh pass (2026-10-23):** the form's debt limits are real —
[the-debtor-sees-the-limits-set-on-it](../../technical/balance/team_balance_design_decision.md#the-debtor-sees-the-limits-set-on-it),
its contract accepted.

| | built 2026-10-23 |
| --- | --- |
| the read | liability's `LiabilityCreditByIds` (the debtor's own scope, its creditors as ids) — the same limit precedence and the same committed balance `CheckCredit` reads, through the same code ([rpc.md](../../services/liability_service/rpc.md#the-debtors-side-of-a-limit--liabilitycreditbyids)). No selling change: the create's check is untouched |
| the form | `creditRows` takes the read (`creditReadOf(useLiabilityCredit(teamId, creditorIds(invoice, warehouseId)))`) on both the create page and the draft page; one call for the warehouse and every owning team. A row still reading says *Reading the limit…*, a failed one *Could not read this limit…* — neither is ever drawn as *Unlimited*. The ordering team is no longer listed as its own creditor (the check never asked about it) |
| gone | `mockTerms` / `MockTerms` from `mockData.ts` (the return-link half stays) · the `creditLimit` mark, its `PendingId` and both locales' copy |
| marks left | order form **2** — `returnMap`, `receiptScan`; the draft page's own **4** unchanged |
| tests | stories *TheDebtLimitsAreEachCreditorsOwn* (Melati at 87% of Gudang Pusat's 10.000.000), `Features/Orders/CreditLimitPanel` (read · still reading · failed); fixture `liabilityCredits` for the creditors other than 11, whose figures come from `liabilityTerms` / `liabilityPositions` so both sides of that pair agree |

**Eighth pass (2026-10-23):** the return map's server side, its contract accepted —
[the-return-map-is-selling-services-and-read-by-ids](../../technical/frontend/order_create_decision.md#the-return-map-is-selling-services-and-read-by-ids).

| | built 2026-10-23 |
| --- | --- |
| schema | selling `00024` `product_return_maps` — `UNIQUE (team_id, shared_product_id)`, `CHECK (shared_product_id <> own_product_id)`, no `warehouse_id` |
| contract | `ProductReturnMapCreate` and `ProductReturnMapByIds` on `TeamReturnConfigurationService` (`return_configuration.proto`); policy Root · Administrator · Selling Owner · Selling Admin · Selling CS; ByIds 1–100 borrowed ids, slice `PAIR` |
| the write | ownership checked through `ProductCatalog.Snapshots` (borrowed must be another team's, ours must be ours, a borrowed id nobody owns is NotFound), then `INSERT … ON CONFLICT DO NOTHING` and a read of the standing row → `created = false`. Never an UPDATE |
| order create | `placeOrder` (both doors) resolves owners ONCE (`lineOwners`), refuses an unmapped borrowed line naming every SKU (`requireReturnMaps`, one query), and the credit check reads the same owners. ⚠ A failed owners lookup now **refuses** (`Unavailable`) — [a-failed-owner-lookup-refuses-the-create](../../business/order/context_decision.md#a-failed-owner-lookup-refuses-the-create) is built with it; the credit check used to fail open |
| the form | `features/orders/form/returnMapping.ts` (`useReturnMapping`) serves both pages: standing pairs from `useProductReturnMaps` (ByIds, named by `useProductsByIds`), picks from the card. The card writes through `useCreateProductReturnMap`; a refused write is a toast and the row stays unmapped; `created = false` with another product shows the standing pair and *"Someone mapped it first — … was not saved."*; while the pairs are read an unanswered row is a placeholder, and a name still being read is a skeleton |
| gone | `mockData.ts` (deleted — the return link was all that was left), `resetReturnLinks` in `preview.tsx`, the `returnMap` mark, its `PendingId` and both locales' copy |
| marks left | order form **1** — `receiptScan`; the draft page's own **4** unchanged |
| tests | Go: `product_return_map_create_test.go` (7), `product_return_map_by_ids_test.go` (2), `order_return_map_test.go` (7 — create refuses and names, names every one, mapped is placed, another team's map does not count, own-only needs none, a failed lookup refuses, promote refuses and then places once mapped); `fakeCatalog` gained `owners` and `err`. Race: `product_return_map_create_race_test.go`. Stories: `Features/Orders/ReturnMappingCard` on real fixtures through the stub (+ *WhileThePairsAreRead*, *ANameStillBeingReadIsAPlaceholder*, *APairAlreadyStandingWinsAndSaysSo*, *AFailedWriteLeavesTheRowUnmapped*), order-create *ABorrowedProductMappedBeforeArrivesLocked*. The stub seeds Melati (12): Gula (73) → Beras (74) |
| dev DB | selling migrated to 24 (round-tripped down/up) |

**Ninth pass (2026-10-23):** the receipt file is read for real — shipment's `ReceiptCheck` is built
([the-receipt-check-prototype-is-accepted](../../business/shipment/context_decision.md#the-receipt-check-prototype-is-accepted),
state in [shipment/context.md](../shipment/context.md)). **The order form has no pending marks left.**

| | built 2026-10-23 |
| --- | --- |
| the form | unchanged in behaviour: `scanReceipt` → `checkLabel` now reaches a real handler outside Storybook. ⚠ A bulk print answers `unknownLabel` (says nothing) until the reader exports its error, so the `multipleLabels` notice is reachable only in Storybook |
| gone | the `receiptScan` mark (its entry, its badge beside *filled from the file*, both locales' copy). `ORDER_FORM_PENDING` is EMPTY — `PendingId = never` — and stays, because the draft page extends it |
| the strip | `NotImplementedSummary` renders nothing for an empty list, so the create page keeps its mount and shows no strip. The story *TheWarehouseLeadsTheFormUnderTheWarning* became *TheWarehouseLeadsTheForm* (the strip it ordered is gone) |
| marks left | order form **0**; the draft page's own **4** (`draftKeeps`, `rowBundle`, `rowSplit`, `listingQty`), renumbered 1–4 |
| tests | stories *NothingOnTheFormIsMarkedNotImplemented* (a label read, no strip, no ⚠), `Features/Pending/PendingMarks` *AnEmptyListLeavesNoStrip*. e2e `orders.spec.ts`: the attached `%PDF-1.4` stub file now gets the real answer — the `unreadable` notice — and the typed numbers stay |

**Tenth pass (2026-10-23):** an order is costed at what leaves the shelf, its contract accepted —
[an-order-is-costed-at-what-leaves-the-shelf](../../business/order/context_decision.md#an-order-is-costed-at-what-leaves-the-shelf).

| | built 2026-10-23 |
| --- | --- |
| the read | inventory `StockTakeQuote(team, warehouse, lines 1–100)` — the take's own selection read-only ([inventory/order.md](../inventory/order.md)). Per line: owner, `available`, `enough`, the draw's `total_cost` and `unit_cost` (absent when it would draw nothing), its batches oldest first. Cost only — the form adds a borrowed product's markup |
| the freeze | `placeOrder` (both doors) no longer reads `StockCost` before the take. `StockPicker.Pick` answers a `PickDraw` per product (`Cost`, `UnitCost`, `Total`); the lines' `unit_cost` (whole rupiah, rounded) and `total`, the header's `cogs` (the draw's cost, rounded once) and the fee's basis all come from it. `StockPicker.UnitCosts` is gone |
| the fee | priced AFTER the take, inside the transaction (`WarehouseFeeCalculate` in-process); the header's `cogs` and `warehouse_fee` are written by one UPDATE of its own row before the lines. A warehouse with no rate now fails the transaction and the take is released — the owner's spec in [a-warehouse-with-no-rate-takes-no-orders](../../business/teams/warehouse/context_decision.md#a-warehouse-with-no-rate-takes-no-orders); its 2026-10-22 *built* row ("before any stock moves") is now stale |
| the form | `useStockTakeQuote` (features/inventory) replaces `useStockAvailability` + `useStockCosts` on the order form and the draft page: one answer for the stock column and the cost, a product on two lines asked as their sum, debounced 300 ms (`useDebounced`), the previous draw kept while repriced but never across warehouses, and the lines table dims under `RefreshOverlay`. `lines.ts`: `Costs` is a map of draws; `lineTotal` uses the draw's own total, `costSplit` / `formatCostSplit` give "1 × Rp 8.000 + 1 × Rp 9.500" under the HPP (order form) and in the draft row's quiet line. A short line's HPP reads *not recorded*. `useStockCosts` is deleted |
| fixtures | `productBatches` + `drawFrom` (Teh 72: 1 at 8.000, 2 at 9.500 — avg 9.000); the stub answers `stockTakeQuote` from them |
| tests | Go: selling `TestOrderCreate_FreezesEveryFigureFromTheTakesDraw`, the fee tests now expect the take released; inventory `stock_take_quote_test.go`; `stock_picker_test.go` asserts the draw. Stories: *ALineSpanningTwoBatchesShowsTheSplit*, *ALineFromOneBatchShowsNoSplit*, *KeptFiguresDimWhileRepriced* (OrderItemCard), *ALineSpanningTwoBatchesShowsTheSplit*, *TheInvoiceChargesWhatTheTakeWouldDraw* (order form), *ARowSpanningTwoBatchesShowsTheSplit* (draft page) |

**Eleventh pass (2026-10-23):** two order-creation bugs, no design change.

| | fixed 2026-10-23 |
| --- | --- |
| one product on two lines | the form sends a bundle's products as ordinary lines, so a product could arrive twice and the take refused it. `placeOrder` (both doors) now merges lines of one product — `mergeOrderLines`, quantities summed — after `validate` and before owners, return maps, credit and the take, and stores the one line ([rpc.md](../../services/selling_service/rpc.md#one-line-per-product-and-the-takes-refusal-as-it-came--placeorder-both-doors)). Lines of one product that differ in `sku` or `name` are refused `InvalidArgument`, naming the product (a differing `unit_price` was too, until the twelfth pass) |
| the form's totals | `byProduct` (features/orders/lines.ts) — the order form's subtotal, products total and invoice, and the draft page's products total and invoice, are summed per product, so a product on two lines is one draw priced once, as stored |
| a refused take | was wrapped as a database error → `Internal`. `takeError` passes the take's Connect error through (code, message, `OrderTransactionRefusal` detail); a non-Connect failure is still `Internal`. `takeRefusalOf` + `TakeRefusalAlert` (features/orders) show the reason and every named line by name on both pages — `orderForm.refusal.*`, en and id |
| ~~⚠ open, reported~~ | ✅ settled by the twelfth pass below: the line carries no marketplace price, so two rows at two prices merge as one line |
| ⚠ not changed | `canSubmit` / the short-line marks still judge each row alone — two rows of one product can each fit while their sum does not; the server's refusal now says so by name. The form's products total is still Σ per product rounded, where `cogs` rounds once over all products (≤ 1 rupiah a product) |
| tests | selling `order_line_merge_test.go` (create and promote merge, take asked one line, figures equal a single line; ~~two prices refused on both doors~~ — merged since the twelfth pass) · `order_take_refusal_test.go` (short on create, not-allowed on promote: code + detail; a non-Connect failure is Internal) · composition root `order_create_lines_test.go` through the real take. Stories *ARefusedTakeNamesItsReasonAndTheLine* (order form), *ARefusedPromoteNamesItsReasonAndTheLine* (draft page), `Features/Orders/TakeRefusalAlert`; the stub refuses on `takeRefusalScenario` |

**Twelfth pass (2026-10-23):** an order line carries no marketplace price, and stores the owner's last two money
columns — [an-order-line-carries-no-marketplace-price](../../business/order/context_decision.md#an-order-line-carries-no-marketplace-price),
per the owner's §Table That Must Have.

| | built 2026-10-23 |
| --- | --- |
| schema | selling `00025`: `order_items.unit_cost_with_markup`, `markup_total` — `DOUBLE PRECISION`, CHECK >= 0, NULL = never frozen, not back-filled. Dev DB migrated to 25; the Down round-trips |
| the freeze | `PickedLine` gains `UnitCostWithMarkup`, `MarkupTotal` (the composition root's picker copies them from the take). `placeOrder` freezes them beside `unit_cost` and `total`, and stamps `unit_price` = `unit_cost` on BOTH doors — `orderItemModels` reads no money from the request |
| Promote | `draftOrderItems` sends no price. The header's `subtotal`/`total` still sum the draft ROWS' marketplace prices (`draftRowsSubtotal`) — the figure it always was, and now NOT Σ line qty × `unit_price` |
| the merge | `mergeOrderLines` no longer compares `unit_price`; it still refuses one product under two skus or names (only an `OrderCreate` client can send that) |
| the take | inventory's `pricedTake` prices the markup ON the draw's value (value × rate) and the total as value + markup, so an own line's markup is exactly 0 — the old (value ÷ qty) × qty − value went a hair negative (1 ÷ 49 × 49), which the new CHECK would have refused |
| API | `OrderItem` gains `optional double total = 8`, `unit_cost_with_markup = 9`, `markup_total = 10` — read-only, absent when NULL. `unit_price`'s and `Order.subtotal`'s comments say what they hold now. No screen shows the new two: the detail's lines have no "price with markup" place |
| frontend | no copy existed for the merge's price refusal (it surfaced as the raw server sentence). The order form's comments now say the server stamps `unit_price` from the take |
| tests | selling `order_item_markup_test.go` (a borrowed and an own line freeze every figure, the API carries them; an unpriced line freezes none; a promoted line's `unit_price` is the take's and equals `OrderCreate`'s for the same draw) · `order_line_merge_test.go` (two request prices → one line at the take's cost; two names refused; two marketplace prices promote as one line) · inventory `order_transaction_price_internal_test.go` · `stock_picker_test.go` asserts the two new figures |
| ~~⚠ open, reported~~ | ✅ settled by the thirteenth pass below — no subtotal at all. Was: which `subtotal` an order carries — Promote: the rows' marketplace value; OrderCreate: the form's cost. Nothing on the seller screens reads it (the warehouse detail's `InfoPanel` prints it and `unit_price`), and `OrderPlaced.revenue` = `total` has no consumer. The owner's `orders` has `goods_cost`/`total_cost` and no subtotal |
| ~~⚠ `unit_price` could go~~ | ✅ dropped by the thirteenth pass (selling `00028`). Was: it is now a copy of `unit_cost` on every new line. Readers left: the warehouse detail's `InfoPanel` (price column and line sum), the Storybook order fixtures (still a selling-price-looking 75.000 beside a 48.000 cost), and the form still SENDS it (ignored). Dropping it is a proto `reserved` + a migration |

**Thirteenth pass (2026-10-23):** the order's money columns aligned with the owner's §Table That Must Have —
[the-total-is-ours-the-platform-total-is-theirs](../../business/order/context_decision.md#the-total-is-ours-the-platform-total-is-theirs),
[an-order-records-no-shipping-cost](../../business/order/context_decision.md#an-order-records-no-shipping-cost), and the
two 🔄 corrections the coordinator recorded under
[an-order-is-costed-at-what-leaves-the-shelf](../../business/order/context_decision.md#an-order-is-costed-at-what-leaves-the-shelf)
(the fee's basis includes a borrowed line's markup) and
[an-order-line-carries-no-marketplace-price](../../business/order/context_decision.md#an-order-line-carries-no-marketplace-price)
(`unit_price` is dropped).

| | built 2026-10-23 |
| --- | --- |
| the mapping | `orders.cogs` → **`goods_cost`** (now Σ line `total`, markup in) · `subtotal`, `total` → gone, **`total_cost`** = goods_cost + warehouse_fee · `shipping_cost` → dropped · `marketplace_total` → **`platform_total`** (orders and drafts) · `order_drafts.shipping_cost` → dropped · `order_items.unit_price` → dropped |
| schema | selling **`00026`** (the platform_total renames + the draft touched mark) · **`00027`** (goods_cost rename, total_cost added and back-filled as goods_cost + COALESCE(fee, 0), subtotal/total/shipping_cost dropped on orders, shipping_cost on drafts + its touched mark) · **`00028`** (order_items.unit_price). Dev DB migrated to 28; every Down round-trips (the dropped values come back as 0) |
| the freeze | `orderGoodsCost` sums the draw's `Total` (was `Cost`); the fee is priced on it; `orderTotalCost` = goods_cost + fee; one UPDATE writes all three. A borrowed line now raises goods_cost by its markup, and the fee follows |
| proto | renames keep their numbers (`goods_cost` 16, `platform_total` 17 / 13 / 22 / 14 / 15, event 4 and 11); dropped fields `reserved` by number and name on `Order`, `OrderItem` (6), `OrderCreateRequest`, `OrderDraft`, `OrderDraftUpdateRequest`, `OrderDraftPushRequest`, `OrderPlaced` (`revenue` 3, `shipping_cost` 5); new `Order.total_cost = 31` (double). `OrderStatusCount.cogs` → `goods_cost` (6) |
| census | `OrderStatusCount.value` and `OrderStatPreview.revenue_30d` summed `total`; they now sum **`platform_total`** (what the buyers paid — their own comments' meaning). ⚠ a choice the owner should check: the warehouse's *Pendapatan 30h* tile and the strip's *Transaction value* move from our quote to the platform's figure |
| frontend | the order form sends `platformTotal` and no money of its own; its products total and the fee quote use `goodsCostOf` (a borrowed product with its own markup, per line, as the invoice) on the form and the draft page. The seller detail prices each line at `unit_cost_with_markup` (`lineUnitBeli`) and sums the frozen line totals (`linesGoodsCost`), so the lines add up to goods_cost. The warehouse detail's `InfoPanel` shows harga beli, *Total produk* / *Biaya lain* / *Total sistem* and the platform total — no subtotal, no shipping. The old warehouse list's Total column shows the platform total. `MarketplaceInfoForm`'s value is `platformTotal`; the WORDS on screen are unchanged |
| external client | `OrderDraftPush` by JSON: send `platformTotal` (was `marketplaceTotal`), stop sending `shippingCost` — documented in [rpc.md](../../services/selling_service/rpc.md#draft-orders--orderdraftpush-and-the-blanks-only-merge-190-191). A stale `marketplaceTotal` is discarded silently (Connect ignores unknown JSON), so such a client's drafts reach Promote at 0 |
| tests | Go: `TestOrderCreate_ABorrowedLineRaisesTheGoodsCostByItsMarkupAndTheFeeFollows` (18.000 own + 40.800 borrowed → goods_cost 58.800, fee asked on it, total_cost 64.680), `TestOrderCreateFromDraft_TakesItsMoneyFromTheTakeNotTheRows`, total_cost on the fee test, `order_platform_total_test.go` (renamed), the census's value = Σ platform_total. Story *ABorrowedLineIsPricedWithItsMarkup* (order detail, fixture 105: one borrowed line, harga beli Rp 189.440 with markup, total sistem Rp 191.440). Repo `go test ./...` 1 580 pass; the OrderCreate race audit passes; stories 1 511 pass; e2e orders · order_drafts · settlement_imports · statement 32 pass (2 skipped — the retired revenue tests); the draft push sends no `shippingCost` |
| ⚠ left as it was | settlement's own margin decision (`balance + marketplace_total − order.cogs`, [settlement-owns-revenue](../../business/settlement/context_decision.md#settlement-owns-revenue)) leaves the warehouse fee out; its screens already subtract total beli (goods + fee) — only the field names changed. The other `order_drafts` differences from the owner's table (`source`/`external_id` vs `order_external_ref_id`, `shipping_code` vs `shipment_channel_id`, the inline address vs `order_draft_addresses`, `order_draft_items` vs `order_draft_platform_items`, no `platform_type` / `receipt` / `receipt_file`) are untouched |

**Order detail pass (2026-10-26):** the order detail's six marks, at the owner's *"i saw 6 parts … not implemented"* —
decisions in [order_detail_decision.md](../../technical/frontend/order_detail_decision.md).

| | built 2026-10-26 |
| --- | --- |
| picture | each line shows its product's `default_image_url` from one `useProductsByIds` read (`ProductByIds` does not filter by team, so a borrowed product resolves) |
| platform title | gone from the line, its mock and `ScrapedName` deleted ([an-order-line-keeps-no-platform-title](../../technical/frontend/order_detail_decision.md#an-order-line-keeps-no-platform-title)) |
| return leg | gone — the order leg only ([the-return-leg-waits-for-tracking](../../technical/frontend/order_detail_decision.md#the-return-leg-waits-for-tracking)) |
| withdrawal | *Edit Withdrawal* and both screens' `withdrawal` marks gone; a completed order has no actions ([no-withdrawal-is-typed-on-an-order](../../technical/frontend/order_detail_decision.md#no-withdrawal-is-typed-on-an-order)) |
| notes | `OrderNoteCreate` writes a status-less `order_timeline_logs` row from either end; the create form's note is the first such row; selling `00029` moved `orders.note` there and dropped it; `Order.note` (18) reserved. *Catatan* on both details, the Timeline status rows only ([a-note-is-a-timeline-row](../../technical/frontend/order_detail_decision.md#a-note-is-a-timeline-row)) |
| Edit Resi's mark | was broken — it pointed at `receiptCode`, declared on neither screen, so its ⚠ read 0 with no label. Declared on both now; the action had no RPC then (✅ `OrderReceiptUpdate` built 2026-10-29) ([the-seller-edits-the-resi-until-handover](../../technical/frontend/order_list_decision.md#the-seller-edits-the-resi-until-handover)) |
| marks left | order detail **2** (shippingTracking — deferred, receiptCode) · seller list **2** (import, receiptCode) |
| note limits | `OrderCreateRequest.note` 2000, `OrderNoteCreate` 500 — kept different by the owner ([the-two-note-limits-stay-different](../../technical/frontend/order_detail_decision.md#the-two-note-limits-stay-different)) |
| dev DB | selling migrated to 29 |

**Edit Resi pass (2026-10-29):** at the owner's *"yes"* to *"commit first, then Edit Resi"* — decision
[the-seller-edits-the-resi-until-handover](../../technical/frontend/order_list_decision.md#the-seller-edits-the-resi-until-handover).

| | built 2026-10-29 |
| --- | --- |
| RPC | `OrderReceiptUpdate(team_id, order_id, optional receipt_code, receipt)` — the selling team only, `pending`/`processed`/`picked` only (`FailedPrecondition` after), each of the two on its own, at least one. One transaction: the order `FOR UPDATE`, one UPDATE, one note row naming the old and the new. No migration |
| screen | `features/orders/EditReceiptDialog.tsx`, opened by `useOrderActions` from the list's kebab and the detail's buttons; sends only what changed. `rowActions.ts` lost its pending machinery (Edit Resi was its last user) and Edit Resi is `selling`-side now — it was offered to the warehouse too |
| marks left | seller list **1** (import) · order detail **1** (shippingTracking — deferred) |
| tests | 6 unit (`order_receipt_update_test.go`), 3 race (`-tags raceaudit`), 1 perf; stories `Features/Orders/EditReceiptDialog` (3) and the detail's `EditResiSendsOnlyTheNumber`, `TheWarehouseHasNoEditResi`; e2e *Edit Resi: the seller replaces the tracking number…* |
| ⚠ my reading | the record is a note row (no status), not a row into the current status, which would reset the status date |

**Import dialog pass (2026-10-30):** at the owner's *"step 1 choose platform, step 2. ShopSelect and file, step 3. log
result"* — decision [the-import-is-platform-then-shop-and-file-then-log](../../technical/frontend/order_list_decision.md#the-import-is-platform-then-shop-and-file-then-log).
Frontend only.

| | built 2026-10-30 |
| --- | --- |
| dialog | `ImportOrdersDialog` takes `teamId`; step 2 is `ShopSelect` narrowed to the picked marketplace above the drop zone, Import waits for both; *Another Marketplace* drops the shop and the file |
| log | `pages/orders/components/OrderImportLog.tsx` — bar, the three counts (moved / already there / not applied), five not-applied rows then *and N more in the log*, *Show Log*. Its props (`OrderImportResult`) are what the stream will have to carry |
| ⚠ until built | Import opens the log on ONE error line (*nothing was read*), never a sample result — my reading, recorded in the decision |
| stories | `Pages/Orders/ImportOrdersDialog` (6), `Pages/Orders/OrderImportLog` (6) |
| marks left | seller list **2** (import, dateType) |
| samples | owner: *"file is same form like on examples\settlement_samples"*, *"you can create mock"*. Four MOCK exports in [examples/order_samples/](../../../examples/order_samples/README.md), Shopee and TikTok, two per shop four days apart; generated, column names and status words are a guess until a real export arrives |
| backend *(same day)* | owner *"yes"* — [the-order-import-is-one-rpc-per-platform](../../technical/order/design_decision.md#the-order-import-is-one-rpc-per-platform). `ShopeeOrderImport` · `TiktokOrderImport` on OrderService (proto `OrderImportLogLevel`, `OrderImportTally`), core `selling_v1/order_import.go` + `order_import_log.go` (slog → stream), readers in `selling_service/order_import_readers/` (xlsx or csv, one order per ref, TikTok's description row skipped). Every move is `moveOrders`, note *"Shopee order import"*. Runs on `context.WithoutCancel`. No migration. Flow in [rpc.md](../../services/selling_service/rpc.md#a-marketplaces-order-export-imported--shopeeorderimport-and-tiktokorderimport) |
| frontend *(same day)* | `useOrderImport` folds the stream into `OrderImportLog`; Shopee/TikTok only, others *not yet* at step 2; 10 MB cap client-side; the stub transport streams a fixed log (`orderImportScenario`) |
| tests | readers 6 (on the mocks), handlers 9 (`shopee_order_import_test.go`, `tiktok_order_import_test.go`), race 2 (`-tags raceaudit`, ×20, safe — lock-order updated), perf 1 (`-tags perfaudit`); stories `Pages/Orders/ImportOrdersDialog` (8), `Pages/Orders/OrderImportLog` (6) |
| marks left | seller list **2** — `import` is now `derived` (mock layouts, draft word tables), `dateType` |
| bridge *(same day)* | owner *"yes"* — [a-completed-shipping-order-passes-through-shipped](../../technical/order/design_decision.md#a-completed-shipping-order-passes-through-shipped): `importBridges` gives `shipping` + completed the path shipped → completed, applied in rounds (`applyImported` / `moveImported`); 2 more handler tests |
| cancelled *(same day)* | owner *"yes"* — [a-cancelled-order-with-nothing-live-is-already-there](../../technical/order/design_decision.md#a-cancelled-order-with-nothing-live-is-already-there): `decideImported` counts a cancelled ref with no live order as already there; tallies in the handler tests updated |
| perf *(same day)* | owner *"yes"* to the audit: the ref lookup carries `order_external_ref_id <> ''` and keeps its partial index past 100 refs (0.29 ms per 200). The slow timeline INSERT is NOT GORM and NOT the note: a ~50 ms step once a statement's parameters pass a size, on the local Docker connection — no code change, re-measure on Linux ([audit](../../../audits/services/selling_service/performances/ShopeeOrderImport.md)) |
| not done | an e2e spec for the import; a real export from either platform |

**Status-date filter pass (2026-10-30):** at the owner's *"take this"* — the five status dates of
[the-order-list-filters-by-seven-dates](../../technical/frontend/order_list_decision.md#the-order-list-filters-by-seven-dates).

| | built 2026-10-30 |
| --- | --- |
| proto | `OrderDateField` + `ENTERED_PROCESSED` · `_PICKED` · `_SHIPPING` · `_COMPLETED` · `_RETURN` (3–7); `Order.date_entered_at_unix` (32 — 31 is `total_cost`). No migration |
| backend | `scopedOrders` → `dateEnteredWindow`: `orders.id IN` the timeline rows into the status inside the window with no earlier row into it (ties by id). No window = no narrowing. `orderListColumns` became a function and adds a per-page-row `MIN` as `date_entered_at` only for a status date |
| frontend | `DATE_FIELDS` maps the seven pills; every type sends its window; the column reads `dateEnteredAtUnix` under a status date, `statusAtUnix` under a tab alone. The `dateType` pending entry, its ⚠ on the pills and the column, and its copy are gone — the seller list's banner is down to **1** (import) |
| stub | `ENTERED_STATUS` + `enteredAt` in stubTransport: the fixture's first timeline row into it, else its status date, else placement + the step's `STATUS_OFFSET` (now exported) for a step it has passed |
| tests | 2 unit (`order_list_date_entered_test.go`), 1 perf (`-tags perfaudit`, `order_list_date_entered_perf_test.go`); story `AStatusDateNarrowsByItsFirstEntry` |
| ⚠ open | the window seq-scans `order_timeline_logs` (every team): 50.6 ms list / 25.3 ms stat at 150 000 rows, 7.0 / 4.0 ms with `(status, created_at)` — proposed as `00031`, NOT added ([OrderList finding 5](../../../audits/services/selling_service/performances/OrderList.md#5-a-status-date-window-seq-scans-the-timeline-)) |

**Return accept pass (2026-11-02):** [the-return-accept-is-built-before-its-stock-half](../../business/order/context_decision.md#the-return-accept-is-built-before-its-stock-half),
at the owner's *"build now"*.

| | built 2026-11-02 |
| --- | --- |
| contract | `OrderReturnAccept(team_id = the ACCEPTING warehouse, order_id, missing_lines, courier_charge, courier_charge_note)` → the order + `OrderReturnLabel`s; policy Root · Administrator · Warehouse Owner · Admin · Staff, a write. Event `OrderReturnAccepted` (variant 203, topic `order-return-accepted`, id `order-return-accepted:<order>`); liability `LIABILITY_SOURCE_TYPE_RETURN_INCIDENTAL_FEE = 9` |
| the handler | `order_return_accept.go`: the order + lines unlocked, the maps, ONE catalogue call (owners + mapped codes), then the transaction — FOR UPDATE, re-check `return`, `setOrdersStatus` (from warehouse, the charge as the row's note), the missing note row at the same moment. `is_override` on both rows; publish after commit, non-fatal |
| 🔄 corrected the same day | it first let only the order's own warehouse accept (`warehouse_id = caller`) — the coordinator's "who" row, against [a-return-may-land-in-another-warehouse](../../business/order/context_decision.md#a-return-may-land-in-another-warehouse) and [the-accept-records-where-it-was-accepted](../../business/order/context_decision.md#the-accept-records-where-it-was-accepted) ([the-accept-was-recorded-as-the-shipping-warehouses](../../business/order/order_return_clarify.md#the-accept-was-recorded-as-the-shipping-warehouses)). Now: ANY warehouse accepts an order in `return`; an order in another status is NotFound unless the caller reads it; the selling team is PermissionDenied, the root team InvalidArgument. Selling `00034` adds `order_timeline_logs.accepting_warehouse_id` (written on the accept's row, on the wire as `OrderTimelineLog.accepting_warehouse_id`) and `orders_return_team_idx`; `OrderReturnAccepted.warehouse_id` is the accepting warehouse, which the charge is owed to; liability skips a charge to oneself |
| the reads | `orderReaders` (`order_list.go`), shared by OrderList, OrderStat, OrderExport, OrderCreatorList, OrderDetail: the two ends, and the selling team's configured return warehouse for orders in `return` / `return_completed` only. So the Returns tab lists them and the pick screen opens them. `ANY(ARRAY(subquery))` + the partial index keep it one BitmapOr — 2–4 ms over 50 000 orders, as before (`TestPerf_OrderList_ReturnWarehouse`) |
| liability | `ChargeReturnCourier` (`return_courier_charge.go`), the push handler's `OrderReturnAccepted` case, route `/event/liability-order-return-accepted/push` |
| the fold | Return Arrived counts `OrderReturnAccepted` (`selling-order-fold-return-accepted`), no longer `OrderStatusChanged` to `return_completed` — which nothing publishes |
| subscriptions | `tools/san/pubsub.go` declares both; [docs/tools/san.md](../../tools/san.md) lists them |
| frontend | `pages/pick-queue` **Returns** tab (status `return`); `pages/pick-order` **Accept Return** → `components/AcceptReturnDialog.tsx` (missing per line, courier charge + required note, then the labels step); `useAcceptReturn`; the liability history's *"Courier at a return · order #N"*; the daily statement's courier column sums both courier types (`courierAsks`) |
| why the pick screen | it is where the warehouse's Orders menu goes (`/warehouse-orders`) and it offers the ONE next step per status — a return's is the accept. `pages/returns` / `return-detail` stay preview: they model a return RECORD (codes, received/cancelled), which [the-accept-is-the-status-return-completed](../../business/order/context_decision.md#the-accept-is-the-status-return-completed) decided against |
| tests | Go: `order_return_accept_test.go` (10), `return_courier_charge_test.go` (3, incl. the key not colliding with a restock of the same number), the push handler's override cases, the fold test now on the accept event. Race: `order_return_accept_race_test.go`. Perf: `order_return_accept_perf_test.go`. Stories: `Pages/Order/AcceptReturnDialog` (7), PickOrderPage *AReturnIsAcceptedHere*, *OnlyAReturnOffersTheAccept*, PickQueuePage *TheReturnsTabListsWhatIsComingBack*. E2E: orders.spec *Return: the warehouse accepts a returned parcel…* |
| stub | `.storybook/returnAcceptStub.ts` + `returnAcceptScenario` / `withOrdersInReturn` (sessionScenario.ts): a story names the orders read in `return`; no fixture moved |
| ⚠ not built | the stock half (above); **finding the order at a stale-label warehouse** — it is neither end nor the configured one, so no list or scan of its own matches; the server accepts it by id, and a cross-team label search is not designed; a screen naming where a return was accepted (on the wire, not drawn); ~~a forced return from the warehouse's screens~~ ✅ built 2026-11-04 (*Receive Return*, `pages/pick-queue/components/ReceiveReturnDialog.tsx`); a reprint of the labels after the dialog closes |

## What exists

| | |
| --- | --- |
| statuses | `OrderStatus` is the eleven: pending · processed · picked · shipping · shipped · completed · problem · lost · return · return_completed · cancel — numbers kept aligned with the old six, `4` reserved. Selling `00015` moved every order and history row (`placed → pending`, `confirmed`/`picking → processed`, `packed → picked`, `shipped → shipping`, `cancelled → cancel`). Selling `00017` then replaced `order_events` with the owner's `order_timeline_logs` (status, note, `from` warehouse/selling, actor) — [order-timeline-logs-replaces-order-events](../../business/order/context_decision.md#order-timeline-logs-replaces-order-events); nothing carried over. Note-only rows are written since the order detail pass (2026-10-26) |
| the move | `OrderStatusChange(team_id, order_ids 1–200, to, note)` — one per-order result, the table `orderMoves` (from → to → which side), a note required back to pending, the whole batch saved in one transaction of four statements locked in id order ([a-batch-move-saves-in-one-transaction](../../technical/frontend/warehouse_order_list_decision.md#a-batch-move-saves-in-one-transaction)). Cancel (`OrderCancel`, pending only) and the return accept keep their own RPCs. `OrderConfirm` · `OrderPick` · `OrderPack` · `OrderShip` are removed ([one-status-change-for-every-plain-move](../../technical/frontend/warehouse_order_list_decision.md#one-status-change-for-every-plain-move)) |
| list filters and row | `OrderListFilter` and `OrderStatFilter` gained `seller_team_id`, `marketplace`, `shipping_code`; `Order.item_quantity` is summed by the list query; `ShopByIds` names shops across teams — [the-filter-gains-seller-marketplace-and-courier](../../technical/frontend/warehouse_order_list_decision.md#the-filter-gains-seller-marketplace-and-courier), [the-warehouse-row-fills-from-shop-and-user-by-ids](../../technical/frontend/warehouse_order_list_decision.md#the-warehouse-row-fills-from-shop-and-user-by-ids). The seller list's strip was **10** parts, the warehouse list's **6** — **4** and **5** after the second pass above |
| export | `OrderExport`, a server stream: the list's filter and tab (or the warehouse bar's ticked rows, `order_ids`), the reader's columns, .xlsx with ids and phones as text, stored as a private `order_export` document (document `00008`) as the caller, an expiring link — [one-export-is-the-list-as-a-file](../../technical/frontend/warehouse_order_list_decision.md#one-export-is-the-list-as-a-file), flow in [rpc.md](../../services/selling_service/rpc.md#the-list-as-a-file--orderexport). Only real data: no invented tracking number, MP date or deadline |
| root | `OrderList` / `OrderDetail` drop the team clause for the root team (`readsEveryTeam`) |
| settlement | `OrderPlaced` carries `shop_id` + `platform_total` (`marketplace_total` until the thirteenth pass), `OrderCancelled` carries `shop_id`; settlement's `OrderSaleHandler` opens and cancels the sale, idempotent on its key. Selling no longer calls settlement |
| local events | the emulator pushes to `:8080` (project `warehouse-dev`) and to the e2e's `:8081` (`warehouse-e2e`) — [the-emulator-pushes-locally](../../technical/event_architecture/context_decision.md#the-emulator-pushes-locally) |
| return warehouse | selling `00016` `team_return_configurations` · `TeamReturnConfigurationService` (`Detail`, `Set` — an upsert, no clear, `ByIds` — root's) · Settings → **Return Warehouse** card (a selling team's managers) · root's Teams list badges each selling team with none. Team `00009` dropped `team_infos.return_warehouse_id` / `return_user_id`, proto fields 6–7 reserved |
| return map | selling `00024` `product_return_maps` · `ProductReturnMapCreate` (written once, a standing pair comes back `created = false`) and `ProductReturnMapByIds` on the same service · `placeOrder` refuses an unmapped borrowed line on both doors, and a failed owners lookup · the order form's Return Mapping card writes at the confirmed pick and both pages pre-fill from the read — eighth pass above, flow in [rpc.md](../../services/selling_service/rpc.md#a-borrowed-products-return-map--productreturnmapcreate-and-productreturnmapbyids) |
| the return accept | `OrderReturnAccept` (2026-11-02) — any warehouse holding the parcel, recorded on the accept's row, from `return` only: `return_completed`, the missing units on one warehouse note, the borrowed lines' labels, the courier's charge on `OrderReturnAccepted` → liability's `return_incidental_fee`; Return Arrived folds from that event. The pick queue's **Returns** tab and the pick screen's **Accept Return** dialog. No inventory call — pass below, flow in [rpc.md](../../services/selling_service/rpc.md#the-warehouse-accepts-a-return--orderreturnaccept) |
| colours | every status's hue is the owner's: picked sky, shipping cyan, return red, return_completed pink decided 2026-10-21 ([shipping-is-cyan-and-picked-is-sky](../../technical/frontend/order_list_decision.md#shipping-is-cyan-and-picked-is-sky), [pink-follows-retur-diterima-to-return-completed](../../technical/frontend/order_list_decision.md#pink-follows-retur-diterima-to-return-completed)) |
| frontend | one tab per status plus All, one stage per status (`features/orders/stages.ts`), the 6-step stepper, the timeline's notes and *handed back*, the warehouse workbench's four steps (`pages/pick-queue-next/steps.ts`), batch handover through the one RPC |
| dev DB | migrated 2026-10-21 (team 9, selling 16): 2 pending, 1 shipping, 1 cancel. **No team has a return warehouse yet** |

```sh
go test ./backend/services/selling_service/... ./backend/services/settlement_service/... ./backend/services/team_service/...
go test -tags raceaudit -count=20 -run 'TestRace_OrderStatusChange|TestInterleave_OrderStatusChange|TestRace_TeamReturnConfigurationSet|TestInterleave_TeamReturnConfigurationSet' ./backend/services/selling_service/selling_v1/
go test -tags perfaudit -run 'TestPerf_OrderStatusChange|TestPerf_OrderList_Root|TestPerf_TeamReturnConfiguration' -v ./backend/services/selling_service/selling_v1/
cd frontend && npx playwright test e2e/orders.spec.ts      # 19 pass, 2 skipped (as before)
```

## Audits

| RPC | result |
| --- | --- |
| `OrderStatusChange` · concurrency | ✅ safe — 140/140 at `-count=20`, the interleave shows the row lock holding and B re-reading; re-run 80/80 on the one-transaction save ([lock-order](../../../audits/services/selling_service/concurrency/lock-order.md)) |
| `TeamReturnConfigurationSet` · concurrency | ✅ safe — the first set's phantom insert is serialised by the unique index, proved by interleave |
| `OrderStatusChange` · performance | ✅ [resolved](../../../audits/services/selling_service/performances/OrderStatusChange.md) — was 4 queries per order, 248 ms for 200; the owner took the set-based save: **4 queries, 11 ms** for 200 |
| `OrderList` (root) · performance | 🔴 [re-audited 2026-10-22](../../../audits/services/selling_service/performances/OrderList.md) — pages 4–6 ms at 50 000; a deep OFFSET page was 252 ms after `status_at` and is **20 ms** with the page chosen first (fixed, no contract change). Still 🔴: the **search** seq-scans the scope with four ILIKEs, 112–120 ms — the fix is a trigram index, a schema question for the owner |
| `OrderStat` · performance | 🔴 [new report](../../../audits/services/selling_service/performances/OrderStat.md) — 190 ms at 50 000 orders, ~80% the `item_count` correlated sum (`loops=50000`, JIT). The recommended fix stores the unit count on the order, which reopens [the-warehouse-row-fills-from-shop-and-user-by-ids](../../technical/frontend/warehouse_order_list_decision.md#the-warehouse-row-fills-from-shop-and-user-by-ids) — the owner's to decide |
| `OrderCreate` · idempotency key | ✅ *(2026-11-04)* the key lookup is 1 query, ≈0.5 ms at 50 000 orders (index-only); two submits of one key: one order, the twin waits on the unique index and is refused, took nothing — 40/40 at `-count=20` |
| `OrderCreate` · concurrency + performance | ✅ the fee is one read (the unique `warehouse_id` index) — 🔄 *(2026-10-23)* now AFTER the take, inside the transaction, with the header's `cogs`/`warehouse_fee` written by one UPDATE of its own row. Raced through the real take and fee (`backend/cmd/app_development/order_create_race_test.go`, `-tags raceaudit`): 8 creates over 2+2 units at two prices × 5 rounds, ×20 runs — exactly 2 orders, cogs 20.000 and 28.000, each fee 10% of its own cogs, each cogs = its take. The fee read takes no lock; the shop's KEY SHARE is held across it as across the take (pattern 6, by design — [lock-order](../../../audits/services/selling_service/concurrency/lock-order.md)) |
| `StockTakeQuote` · performance | ✅ [report](../../../audits/services/inventory_service/performances/StockTakeQuote.md) — 1 query, 0.5/1.6/7.6 ms at 1/20/100 own lines; the reserve rule it shares with the take was an N+1 on borrowed lines, fixed 2026-10-26: 2 queries, 1.57 ms at 20 |
| `TeamReturnConfigurationDetail` · `Set` · performance | 1 query each, under 1 ms over 10 000 rows — not heavy |
| the buyer's username · concurrency + performance | ✅ one more column on writes and reads that already exist (create, push, update, promote, detail, list, export) — no new query, no new lock, no index needed |
| the required total · concurrency + performance | ✅ one column on the draft's existing writes and one comparison in `placeOrder`'s validation, before any read — no new query, no new lock, no index |
| `OrderReceiptUpdate` · concurrency + performance | ✅ safe — 60/60 at `-count=20`: eight edits at once form one chain of notes (each old is the previous new), and an edit waiting on the handover's row lock is refused once it gets it. 4 statements, ~2 ms over 50 000 orders, every plan an index read — not heavy, no file |
| `OrderReturnAccept` · concurrency + performance | ✅ safe — 8 accepts of one parcel × 10 rounds leave one `return_completed` row and one event, and so do 4 + 4 from two warehouses at once (the row names the winner); the interleave shows the second waiting on the row lock, then refused although its unlocked pre-read saw `return`. 7 queries, ~3.7 ms over 50 000 orders, every read an index scan — not heavy, no file |
| the line's frozen total · concurrency + performance | ✅ the lines' one INSERT moves after the pick, inside the same transaction, carrying one more column — same statement count, no new shared row, no new lock. Liability's product fee drops its terms read (one fewer query per owner) and only its amount changes |

## 2026-11-04 — a warehouse opens the label of an order it ships (`OrderLabels`, step 1)

| | |
| --- | --- |
| the bug | the warehouse order detail (`ReceiptCard`) and the pick queue preview (`printOne`) read the label with `GetDownloadUrl` under the WAREHOUSE's team; the label is the seller's document and nothing shares it, so it was NotFound on every order |
| decision | [a-warehouse-prints-the-labels-of-orders-it-ships](../../technical/frontend/warehouse_order_list_decision.md#a-warehouse-prints-the-labels-of-orders-it-ships) — step 1 only: one order, no merge |
| contract | `OrderService.OrderLabels(team_id use_scope, order_ids max 1)` → `url`, `expires_at_unix`, `results[] {order_id, included, reason NOT_SHIPPED_HERE / NO_LABEL}`; WAREHOUSE_OWNER/ADMIN/STAFF + ROOT/ADMINISTRATOR; `NO_SIDE_EFFECTS` |
| backend | `selling_v1/order_labels.go` — `id IN ? AND warehouse_id = ?` (root: all), then the new seam `LabelLinker.LabelURL(owner = order.team_id, document)`; `document_v1/label_url.go` — an in-process method (not an RPC) over document_service's own table: an ACTIVE `order_receipt` of that owner, else NotFound (→ NO_LABEL); adapter `cmd/app_development/order_label_linker.go`, wired. `selling_v1.NewService` gained the `labels` parameter (every caller passes `nil`). Flow in [rpc.md](../../services/selling_service/rpc.md#the-labels-a-warehouse-prints--orderlabels) |
| frontend | `features/orders/labels.ts` `useOrderLabels` — a WAREHOUSE or ROOT team asks OrderLabels, a seller keeps GetDownloadUrl; a refusal toasts why (en + id `orders.label.*`). `ReceiptFile` (both detail pages) and the pick queue preview's `printOne` use it. The `printMerge` mark stays (step 2) |
| tests | `TestOrderLabels_*` (the shipping warehouse and root get the link; another warehouse / no such order → NOT_SHIPPED_HERE and document_service never asked; no label / a file not the seller's → NO_LABEL; a linker failure is an error; no linker → Unimplemented; policy + NO_SIDE_EFFECTS) · `TestLabelURL_*` (signs the owner's receipt and still no GetDownloadUrl for another team; another owner / a payment proof / no id → NotFound) · `TestOrderLabelLinker_TheShippingWarehouseOpensTheSellersLabel` (real wiring, both schemas) · `TestPerf_OrderLabels` (1 query, 0.5 ms at 50 000 — not heavy). Stories `TheSellerOpensItsLabelAsTheOwner` · `TheWarehouseOpensTheLabelThroughTheOrder` · `AWarehouseLabelRefusalSaysWhy`. e2e `orders.spec.ts` *Label: the warehouse's staff opens the seller's label* — a ROLE_WAREHOUSE_STAFF user created for it; asserts the OrderLabels answer and that GetDownloadUrl as the warehouse is still 404 |
| ⚠ my reading | Root also reads labels through the order (it owns no seller's file either; `GetDownloadUrl` under team 1 was NotFound too) |

## 2026-11-04 — the moves with no button (#11) and the drafts' ready count (#16)

| | |
| --- | --- |
| the gap | `orderMoves` served `shipped → problem`, `problem → return`, `problem → lost`, but the action table offered none of them |
| decisions | [customer-service-sets-shipped-and-problem-by-hand](../../business/order/context_decision.md#customer-service-sets-shipped-and-problem-by-hand) (its ⚠: the menu had no way into `problem`), [a-forced-return-follows-the-status-move](../../business/order/context_decision.md#a-forced-return-follows-the-status-move), [the-action-menu-is-a-table-keyed-by-status](../../technical/frontend/order_list_decision.md#the-action-menu-is-a-table-keyed-by-status) |
| frontend | `features/orders/rowActions.ts`: `shipped` = Return Goods · Complete Order · **Mark as Problem** (`markProblem`, CircleAlert, selling, no confirm — `problem` still completes, returns or is lost); `problem` = Resolve Dispute · **Return Goods** (either end, confirms) · **Mark as Lost** (selling, confirms). The list's kebab and the detail's button bar draw it through `useOrderActions`; en + id `orders.rowAction.markProblem` |
| ✅ built 2026-11-04 | the warehouse's forced return — the pick queue's *Receive Return* and the pick order page (`features/orders/useForceReturn.tsx`), per [a-return-is-received-by-search-then-forced](../../business/order/context_decision.md#a-return-is-received-by-search-then-forced). `shipped → lost` and `completed → return` got their buttons on the seller's order actions ([every-allowed-move-has-a-button](../../business/order/context_decision.md#every-allowed-move-has-a-button), ✅ 2026-11-04, `features/orders/rowActions.ts`); the warehouse's side is the receive-by-search-then-force flow, not those buttons |
| tests | stories `Pages/Order/OrderRowActions` (5: the two menus, both confirms, the warehouse end offered only the return) and `Pages/Order/OrderActionBar` (3); e2e `orders.spec.ts` *Moves: a shipped order is marked a problem, then returned (#11)* and *Moves: a problem order is written off as lost (#11)* — last in the file, since earlier tests count orders and stock |
| drafts' ready | `OrderDraftListResponse.ready_count` — the whole filtered set's ready drafts (`readyDrafts`, the SQL twin of `draftGaps`); the drafts screen's *Ready* card reads it, its ⚠ `readyCount` mark, `pages/order-drafts/pending.ts` and the `orderDrafts.pending` / `summary.onThisPage` keys are gone. `TestOrderDraftList_ReadyCountIsTheWholeSets`, `TestPerf_OrderDraftListReadyCount` (4 queries, ≈9 ms at 5 000 drafts an author), e2e *Order drafts: a pushed draft appears…* asserts `0 of N` and no mark. Flow in [rpc.md](../../services/selling_service/rpc.md#reading-drafts--two-narrowings-not-one-192) |

## 2026-11-04 — the duplicate-ref warning reads drafts, and dates from the lookup (backend step)

| | |
| --- | --- |
| decisions | [the-duplicate-ref-warning-is-accepted](../../business/order/context_decision.md#the-duplicate-ref-warning-is-accepted) (+ its *Settled in chat*: a new read shaped like `OrderByExternalRefs`), [a-duplicate-ref-is-warned-not-refused](../../business/order/context_decision.md#a-duplicate-ref-is-warned-not-refused), [the-duplicate-warning-reads-drafts-too](../../business/order/context_decision.md#the-duplicate-warning-reads-drafts-too) |
| contract | `OrderDraftService.OrderDraftByExternalRefs(team_id use_scope, filter {shop_id > 0, refs 1..50 unique, each 1..128})` → `map<ref, list{draft_ref: map<draft_id, {draft_id, shop_id, author_user_id, created_at_unix}>}>`; OrderCreate's roles; `NO_SIDE_EFFECTS`. `OrderRefItem.created_at_unix` (5) added and filled by `OrderByExternalRefs` |
| backend | `selling_v1/order_draft_by_external_refs.go` — one query `team_id = ? AND source <> 'manual' AND external_id IN ? AND shop_id = ?`, any author (the list/detail keep their own-drafts rule). `draftSourceManual` const, also used by `readyDrafts`. Flow in [rpc.md](../../services/selling_service/rpc.md#the-duplicate-ref-warnings-two-reads--orderbyexternalrefs--orderdraftbyexternalrefs) |
| frontend | `features/orders/form/duplicateRef.ts` asks both reads at once (`Promise.all`; either failing = the "could not check" warning), dates orders from `createdAtUnix` (the per-order `OrderDetail` reads are gone), `draftsOn` + `otherDrafts` drop the draft being finalized. `DuplicateRefDialog` lost its "drafts are not checked" line; dates are `formatUnixDate` (short day, WIB). The `draftLookup` pending entry, its `NotImplemented` and the `orderForm.pending.draftLookup` / `orderForm.duplicate.draftsUnread` keys (en + id) are gone — `ORDER_FORM_PENDING` is empty again, `PendingId = never` |
| stub | `.storybook/duplicateRefStub.ts` serves `orderDraftByExternalRefs` (fixtures + `withRefDrafts`, team + shop filter, never manual) and each order's `createdAtUnix`; `draftCalls` log |
| marks left | order form **0** again |
| tests | Go `TestOrderDraftByExternalRefs_FindsTheTeamsDraftsInTheShop` (any author's, not another shop/team/manual, created_at) · `_NothingFoundIsEmpty` · `_Policy` (OrderCreate's roles, NO_SIDE_EFFECTS) · `TestOrderDraftByExternalRefsRequest_IsBounded` (50 ok; 51, none, no shop, empty, repeated refused) · `TestOrderByExternalRefs_CarriesWhenTheOrderWasTypedIn` · `TestPerf_OrderDraftByExternalRefs`. Stories: order form *ADraftOnTheRefWarns* (now really warns, Create Anyway places) · *AnotherShopsDraftDoesNotWarn* · *FinalizingADraftNamesAnotherDraft* · *FinalizingADraftDoesNotWarnAboutItself* asserts the draft read ran and 202 was dropped · *NothingOnTheFormIsMarkedNotImplemented* restored; dialog *TheDateIsTheWibDay*. e2e `orders.spec.ts` *Duplicate ref: a second order on a used ref is warned about, and can still be created* — last in the file (it places orders the list tests would count): the warning names the first order (link, Pending, today's WIB date), Go Back keeps the form, Create Anyway places the double, a pushed draft on another ref in the shop is named *Draft #id* |
| audit | `OrderDraftByExternalRefs` 🟡 [report](../../../audits/services/selling_service/performances/OrderDraftByExternalRefs.md) — 1 query, ≈6.6 ms (1 ref) / ≈15 ms (50 refs) at 50 000 drafts in one team; the unique `(team_id, source, external_id)` index cannot seek on the ref, so it is linear in the team's drafts. A `(team_id, shop_id, external_id)` index is recommended, NOT added. `OrderByExternalRefs` re-probed with the extra column: 0.65 ms at 20 refs, unchanged plan |
| ✅ was open | a colleague's draft linked to `/orders/new?draft=ID`, which opens NotFound for anyone but its author — fixed 2026-11-05, below |

## 2026-11-05 — the duplicate-ref warning names a colleague's draft without a link; the lookup seeks

| | |
| --- | --- |
| frontend | `DuplicateDraft` carries `authorUserId` (from `OrderDraftByExternalRefs`); `DuplicateRefDialog` takes `selfUserId` (the order form passes `useAuth().identity.identityId`) and links ONLY the caller's own drafts to `/orders/new?draft=id`. A colleague's is *"A colleague's draft #id"* (`orderForm.duplicate.colleagueDraft`, en + id *"Draf rekan #id"*), dated, no link (`duplicate-ref-draft-colleague-<id>`) |
| stories | dialog `AColleaguesDraftIsNamedWithoutALink` (own 201 links, colleague's 202 does not); order form `ADraftOnTheRefWarns` now a colleague's (author 62) — named, no link, Create Anyway still places — and `YourOwnDraftOnTheRefLinks` (author = the signed-in user). e2e `orders.spec` *Duplicate ref…* unchanged: its pushed draft is root's own, so it still links |
| schema | selling `00037_order_drafts_external_ref_lookup.sql` — `order_drafts_team_shop_external_idx (team_id, shop_id, external_id)`, not unique ([database-schema.md](../../database-schema.md)) |
| audit | `OrderDraftByExternalRefs` ✅ re-probed: an index seek per ref, ≈0.52 ms (1 ref) / ≈0.56 ms (50 refs) at 50 000 drafts in one team, was ≈6.6 / ≈15 ms ([report](../../../audits/services/selling_service/performances/OrderDraftByExternalRefs.md)) |

## 2026-11-05 — the settlement-missing badge and filter are live on the order list

[the-settlement-missing-badge-is-accepted](../../business/settlement/context_decision.md#the-settlement-missing-badge-is-accepted)
— the prototype behind `SellerOrdersPage settlementMissingPrototype` is now the live screen; the prop is removed.

| | |
| --- | --- |
| frontend | `pages/orders/SellerOrders.tsx`: a row whose `settlementOpenedAtUnix` is 0 shows a warning *No settlement account* badge beside its stage (`order-settlement-missing-<id>`); the filter bar always offers *Settlement not opened* (`orders-settlement-missing`, URL `unopened`, → `OrderListFilter.settlement_not_opened`). Every reader of the list (seller, warehouse, root, admin) |
| stories | `SellerOrderListSettlementMissing`: badge, filter, phone, and `TheLiveListShowsIt` (was `TheLiveListIsUnchanged`) — the routed `OrdersPage` carries the badge on 103/109 and offers the filter |
| ⚠ odd | the badge follows the prototype and ignores the status: a CANCELLED order whose account never opened keeps it (and the filter lists it). Drafts are not orders, so they never show it |

## 2026-11-05 — the return dialogs stop stretching on desktop

*Receive a Return* (`pages/pick-queue/components/ReceiveReturnDialog.tsx`) and *Accept Return*
(`features/orders/AcceptReturnDialog.tsx`) used `size={{ base: "full", md: "lg" }}`: Chakra merges a responsive variant,
so full's min-height survived on desktop and the dialog filled the window. Now `size={isMobile ? "full" : "lg"}` by the
JS breakpoint (`useIsMobile`). Pinned by `AcceptReturnDialog` *Default* and pick queue *ReceiveNotFound* (dialog shorter
than the window, narrower than it) — both fail on the old size. ⚠ The same responsive `size={{ base: "full", md: … }}` is
still on `ReportFoundDialog`, `AddFoundDialog`, `NewSessionDialog`, `MoveGoodsDialog` and `RecordSampleDialog` — not
touched here.

## 2026-11-04 — the order's idempotency key (backlog #10, slice 1)

| | |
| --- | --- |
| decisions | [the-frontend-mints-the-idempotency-key](../../business/order/context_decision.md#the-frontend-mints-the-idempotency-key), [the-order-stores-its-idempotency-key](../../business/order/context_decision.md#the-order-stores-its-idempotency-key), [the-idempotency-key-is-unique](../../business/order/context_decision.md#the-idempotency-key-is-unique), [the-order-refuses-a-used-key](../../business/order/context_decision.md#the-order-refuses-a-used-key), [every-submit-mints-a-new-key](../../business/order/context_decision.md#every-submit-mints-a-new-key), [a-used-key-is-never-cancelled](../../business/order/context_decision.md#a-used-key-is-never-cancelled), [revamp-has-no-real-orders-yet](../../business/order/context_decision.md#revamp-has-no-real-orders-yet) |
| contract | `OrderCreateRequest.idempotency_key = 22` — **required** (`min_len 1`, `max_len 128`); `Order.idempotency_key = 33` |
| schema | selling `00035_order_idempotency_key`: `orders.idempotency_key TEXT`, existing dev rows filled `'order:' \|\| id`, then `NOT NULL` + `orders_idempotency_key_idx` UNIQUE; the Down drops both. [database-schema.md](../../database-schema.md#selling_service) |
| backend | `selling_v1/order_idempotency_key.go` — `keyShapeError` (empty, or starting `order:` → InvalidArgument), `refuseUsedKey` (one COUNT on the unique index), `keyUsed()` (the refusal). `OrderCreate` runs both FIRST; `placeOrder` re-checks the shape in `validate`, stores the key, and maps a unique violation on its `orders` INSERT to the same refusal — the INSERT precedes the take, so a refused twin takes nothing. The take is unchanged: inside `placeOrder`, under `order:<id>`. Flow in [rpc.md](../../services/selling_service/rpc.md#the-submits-own-key--ordercreateidempotency_key-backlog-10-slice-1) |
| ⚠ awaiting the owner (#10 Q9/Q10) | built as the recommended defaults, not yet decided: **Q9** a used key is refused `AlreadyExists` carrying inventory's `OrderTransactionRefusal{KEY_USED}` (no lines) — the form shows its existing *key already used* alert (*"This order was already placed"*); **Q10** the key is looked up FIRST in `OrderCreate`, before the draft, the owner lookup and the credit check, with the unique index as the backstop |
| callers | the order form's `place()` (`pages/order-create/index.tsx`) — also the draft's finalize — mints `crypto.randomUUID()` inside every submit. No other caller: `tools/san`, the MCP service and the e2e helpers never call OrderCreate (the e2e places through the form). Go tests: a `newOrderKey()` helper (`crypto/rand.Text`, prefixed `test-`) in `selling_v1/setup_test.go` and `cmd/app_development/order_create_lines_test.go`, on all 29 request literals and on every directly-seeded `orders` row (the UNIQUE would refuse a second empty key) |
| stub + stories | `orderCreate` stub checks the key first (`refuseOrderKeyIfUsed`: empty / `order:` → InvalidArgument, a used one → AlreadyExists + KEY_USED), records `orderKeyScenario.sent`, marks a placed key `used`. Stories *EverySubmitMintsANewKey* (a refused submit then a placed one: two UUIDs, different) · *FinalizingADraftSendsItsOwnKey* · *AUsedKeyIsRefused* (`crypto.randomUUID` pinned to a used key → the keyUsed alert, no navigation) |
| tests | `order_create_idempotency_test.go`: the key stored and answered (create + detail); a used key refused AlreadyExists + KEY_USED before the owner lookup, the credit check and the take, no second order; empty / `order:1` / `order:` refused InvalidArgument with nothing reached; only the prefix is reserved; another team's key refused without disclosing its order. `-tags raceaudit` `TestRace_OrderCreateSameKey` (2 submits of one key × 5 rounds through the real take: one order, one KEY_USED, the shelf net one take) and `TestInterleave_OrderCreateSameKey_TheIndexIsTheBackstop` (the twin passes the lookup, waits on the index, refused on the first's commit, took nothing) — 40/40 at `-count=20` |
| audits | performance `TestPerf_OrderCreateKeyLookup` (`-tags perfaudit`, 50 000 orders): a used key is 1 query, ≈0.5 ms — an Index Only Scan on `orders_idempotency_key_idx`, 0.026 ms execution; a whole create is 7 queries, ≈2.7 ms median — not heavy, no file. Concurrency: [lock-order](../../../audits/services/selling_service/concurrency/lock-order.md) row and test rows updated — the lookup is lock-free, the twin waits on the index at the INSERT, no new lock and no change of order — safe, no file |

## 2026-11-04 — the take before the order, and its compensation (backlog #10, slice 3)

| | |
| --- | --- |
| decisions | [the-compensation-event-is-inventory-tx-cancel](../../business/order/context_decision.md#the-compensation-event-is-inventory-tx-cancel), [every-release-goes-by-the-key](../../business/order/context_decision.md#every-release-goes-by-the-key), [a-used-key-is-never-cancelled](../../business/order/context_decision.md#a-used-key-is-never-cancelled), [the-release-is-direct-then-the-event](../../business/order/context_decision.md#the-release-is-direct-then-the-event), [the-cancel-event-names-the-team](../../business/order/context_decision.md#the-cancel-event-names-the-team), [a-cancel-still-meets-the-count-first](../../business/order/context_decision.md#a-cancel-still-meets-the-count-first), [inventory-tx-cancel-is-an-order-event](../../business/order/context_decision.md#inventory-tx-cancel-is-an-order-event), [no-answer-is-only-a-lost-connection](../../business/order/context_decision.md#no-answer-is-only-a-lost-connection), [revamp-has-no-real-orders-yet](../../business/order/context_decision.md#revamp-has-no-real-orders-yet) |
| contract | `events.v1.InventoryTxCancel` = envelope field **204**, topic `inventory-tx-cancel` — `idempotency_key` (1–128), `team_id` (> 0), `warehouse_id`, `actor_id`, `reason`; `OrderPlaced.idempotency_key = 14`, `.transaction_id = 15`; `Order.transaction_id = 34` |
| schema | selling `00036_order_transaction_id`: `orders.transaction_id BIGINT NULL`, no index, no backfill. [database-schema.md](../../database-schema.md#selling_service) |
| backend | `placeOrder` (`order_place.go`): after the key, the shop, owners, return maps and credit, **`stock.Pick(..., K)` OUTSIDE the transaction** → `Take{TransactionID, Draw}`; then one transaction inserts the order with K, `transaction_id` and `goods_cost`, the timeline rows, the draft's delete, the fee (inside, as before), the UPDATE of fee/total and the lines. `compensateTake` (`order_take_compensation.go`) on ANY failure after the take was called except a KEY_USED refusal (`isKeyUsedRefusal`, read off the detail): `stock.Return(K)` under `context.WithoutCancel`, then ALWAYS `InventoryTxCancel` (event_id `inventory-tx-cancel:<K>`); a failed release or publish is logged, both failing logs *STOCK STILL TAKEN* with K. The synchronous compensation under the request ctx and `stockRef(order.ID)` are gone. `OrderCancel` releases by `orders.idempotency_key`. The bridge (`cmd/app_development/stock_picker.go`) passes K through and answers the transaction id. A step's own Connect error (the draft already promoted → Aborted) now reaches the caller as it came, no longer wrapped Internal. Flow in [rpc.md](../../services/selling_service/rpc.md#the-take-before-the-order-and-its-compensation--backlog-10-slice-3) |
| inventory | `releaseByKey` extracted from `OrderTransactionRelease`, shared with the listener `Service.InventoryTxCancel` (`inventory_tx_cancel_listener.go`): taken → rolled back once; released / claimed-with-none → no-op; unseen → claimed with none; another team → ACK + warn log; a count lock → error (redelivered). `push_handler.go` dispatches the variant; `register.go` mounts `/event/inventory-tx-cancel/push` (`InventoryTxCancelSubscription`) and drops the old `/events/inventory` skeleton route. `tools/san/pubsub.go` declares `inventory-tx-cancel` with its `event_type` filter (dead-letter by the shared setup); [san.md](../../tools/san.md) row. See [inventory/order.md](../inventory/order.md) |
| frontend | the pick page (`features/picking/queries.ts`) reads `OrderDetail` FIRST and asks `StockPickLocations` by the order's `idempotencyKey` — the take is no longer filed under `order:<id>`. ⛔ Superseded by slices 5–6 below (by `transactionId`) |
| tests | `order_create_compensation_test.go` (9): the fee refused after the take, the draft already promoted after the take, the request cancelled during / after the take, a stock refusal → no order, ONE release under K with a live ctx, ONE `InventoryTxCancel{K, team, warehouse}`; KEY_USED → nothing released or published; a failed publish still released; a failed release still published; `OrderPlaced` carries K and the transaction. `TestOrderCreate_TakesStock` (the take under the request's K, `transaction_id` stored and answered), `TestOrderCancel_ReturnsStock` (by the order's key), `TestStockPicker_TakesAndReleasesByTheOrdersKey`. Inventory: `inventory_tx_cancel_listener_test.go` (4), `push_handler_test.go` (2). Races: `TestRace_TakeVsTxCancel` (×20, both outcomes hit), `TestRace_TxCancelRedelivery` (×10), `TestInterleave_OrderCreateSameKey_TheTakeRefusesTheTwin` (replaces *TheIndexIsTheBackstop*), the OrderCreate races re-run |
| audits | perf `TestPerf_OrderCreate_TakeBeforeTheRow` (`cmd/app_development`, real take + fee): a placed create 20 queries ≈9 ms, a compensated one 33 ≈13 ms; `TestPerf_InventoryTxCancel`: 14 statements at 1 or 20 lines (5.3 / 8.8 ms), 4 for a released take or an unseen key (≈1 ms); `TestPerf_OrderCreateKeyLookup` re-run (7 queries ≈2.9 ms) — none heavy, no file. Concurrency: both [selling](../../../audits/services/selling_service/concurrency/lock-order.md) and [inventory](../../../audits/services/inventory_service/concurrency/lock-order.md#order-takes-and-their-release-2026-11-04) lock-order.md updated — no selling lock is held across the take any more; safe, no file |
| ⚠ open | (1) the fee is still priced INSIDE the order's transaction, so its KEY SHARE on the shop spans a cross-service read — it could move before the transaction now that the draw is known first; (2) a stock refusal is compensated too (a release + an event per refused create), as the decision reads literally — the take is atomic, so a refusal carrying an `OrderTransactionRefusal` detail could skip it; (3) ✅ *fixed as #10c, below* — a commit that fails ambiguously would have released a placed order's stock; (4) the compensation's release has no deadline of its own |

## 2026-11-04 — a commit that reports an error is looked for first (backlog #10c)

| | |
| --- | --- |
| backend | `placeOrder` marks `reachedCommit` when the transaction's body ran to the end; an error after that may come from a commit that landed. `placedOrderByKey` (`order_take_compensation.go`) re-reads `orders` by K on `s.db` — never the failed tx — under `context.WithoutCancel`: found → `order` = it, the normal `OrderPlaced` publish and success answer, NOTHING released or published as cancelled; not found → `compensateTake` as before; the read failing → `Unavailable` (`errOrderOutcomeUnknown`), nothing released, *STOCK MAY STILL BE TAKEN* logged with K. An error from inside the body is a rollback: compensated with no read. By K alone (unique; a second take under K is refused KEY_USED, so the order holding K is this placement's) |
| test seam | `Service.orderCommitResult func(error) error`, nil in every built server, set only by `export_test.go` `SetOrderCommitResult` — san_testdb's nested transaction is a SAVEPOINT with no COMMIT, so no database hook can fake a lost commit |
| tests | `order_create_commit_test.go` (3): landed-but-reported → the order answered with its lines, 1 order, no release, no `InventoryTxCancel`, one `OrderPlaced` with the take's transaction; did-not-land (the hook deletes the rows, then errors) → compensated once by K; the re-read failing (the hook aborts the test tx) → `Unavailable`, nothing released. Every earlier compensation test unchanged |
| flow | [rpc.md](../../services/selling_service/rpc.md#the-take-before-the-order-and-its-compensation--backlog-10-slice-3) — the sequence's *the COMMIT reports an error* branch and its table row |

## 2026-11-04 — the cancel's stock comes back on its event (backlog #10, slice 4)

| | |
| --- | --- |
| decisions | [inventory-returns-stock-on-order-cancelled](../../business/order/context_decision.md#inventory-returns-stock-on-order-cancelled), [a-cancel-still-meets-the-count-first](../../business/order/context_decision.md#a-cancel-still-meets-the-count-first), [every-release-goes-by-the-key](../../business/order/context_decision.md#every-release-goes-by-the-key), [the-cancel-event-names-the-team](../../business/order/context_decision.md#the-cancel-event-names-the-team) |
| contract | `events.v1.OrderCancelled` gains `idempotency_key = 6` and `warehouse_id = 7` (no validation rule — an order that never took stock carries an empty key). Nothing else in the proto moved |
| backend | `OrderCancel` (`order_cancel.go`): in its transaction, after the order row is locked and the pending check, `refuseCounted` asks `StockPicker.StockLockCheck(team, warehouse, K)` — a READ; a count → `FailedPrecondition` with the warehouse's own `CountedError` sentence (the same words as before), the order untouched; a failed check → `Unavailable`; then `setOrderStatus`, COMMIT, and `OrderCancelled{…, K, warehouse}` after the commit. **No `Return` in the cancel any more**; `isNothingToReturn` and the cancel's fakes (`returnErr` NotFound / FailedPrecondition tests) are gone. `Return` stays for `compensateTake` only. A failed publish logs *STOCK IS STILL TAKEN* with K. The bridge (`stock_picker.go`) adds `StockLockCheck` → `inventory_v1.StockLockCheck` → `*selling_v1.StockLock{SessionID, Reason}`. No Wire change (same provider) |
| inventory | `StockLockCheck` (`stock_lock_check.go`, own tables only, no lock) and the `OrderCancelled` listener (`order_cancelled_listener.go`, `releaseByKey`: empty key ACK, another team ACK + warn, count lock → error, else released once). `push_handler.go` dispatches the variant; `register.go` mounts `/event/inventory-order-cancelled/push` (`InventoryOrderCancelledSubscription`); `tools/san/pubsub.go` declares `inventory-order-cancelled` on topic `order-cancelled` with its `event_type` filter; [san.md](../../tools/san.md) row. See [inventory/order.md](../inventory/order.md) |
| tests | selling `order_stock_test.go`: `TestOrderCancel_ChecksTheCountThenPublishesTheKeyAndTheWarehouse`, `…_ACountRefusesItBeforeAnythingChanges` (still pending, no cancel timeline row, nothing published or released), `…_AFailedCountCheckLeavesTheOrderPending` (replacing the four `Return` tests). Inventory `order_cancelled_listener_test.go` (6) and `push_handler_test.go` (+1). Races `TestRace_OrderCancelled_AndALateTxCancelRollBackOnce` (×10, one rollback per key) and `TestRace_OrderCancelled_RacingACountStartWaitsForIt` (×10, all three ends hit: refused by the check / released before the count / refused by the lock then released after) |
| e2e | `orders.spec.ts` *Lifecycle*: the seed rack's stock drops on place and is POLLED back after the cancel (`expect.toPass`, 45 s). `stock_count_cancel.spec.ts` (its own file, named to run after `orders.spec.ts` and `statement.spec.ts`, because root reads every team's orders and `orders.spec` asserts an empty start) holds *Count: a cancel is refused naming the count, and goes through once the count ends* — its own warehouse, rack and selling team places one unit, a product count starts, `OrderCancel` is refused with *being counted* and `count #<id>`, the order stays `ORDER_STATUS_PENDING`, the count is cancelled, the cancel goes through and the unit is polled back |
| audits | perf `TestPerf_OrderCancel_CountCheckThenEvent` (`cmd/app_development`, real seam): the cancel 8 statements ≈2.5 ms, the listener 14 ≈4.3 ms, a redelivery 4 ≈1 ms; `TestPerf_OrderCancelled` (inventory, background volume): `StockLockCheck` 3 ≈1 ms at 1 or 20 lines, the release 14 (4.4 / 8.2 ms) — none heavy, no file. Concurrency: [selling](../../../audits/services/selling_service/concurrency/lock-order.md) (pattern 6 gone for the release; the check is a lock-free read) and [inventory](../../../audits/services/inventory_service/concurrency/lock-order.md#a-cancelled-order-released-on-its-event-2026-11-04) lock-order.md — safe, no file |
| ⚠ awaiting the owner (#10 Q11) | whether to tell the person that the stock comes back a moment after the cancel. Built the recommended default: **no message changed** — the cancel still answers "Cancelled" at once and the shelf catches up on the event |
| ⚠ open | a lost `OrderCancelled` publish leaves the take standing with no automatic retry (logged with K; release by hand) — the same trade the other after-commit events make |

## 2026-11-04 — the pick page reads its racks by transaction id (backlog #10, slices 5–6)

| | |
| --- | --- |
| decisions | [the-placement-page-reads-racks-by-transaction-id](../../business/inventory/order_decision.md#the-placement-page-reads-racks-by-transaction-id), [revamp-has-no-real-orders-yet](../../business/order/context_decision.md#revamp-has-no-real-orders-yet) (no fallback for older rows) |
| contract | `inventory.v1.StockPickLocationsRequest`: `uint64 transaction_id = 3` (gt 0, required); `ref` removed — `reserved 2; reserved "ref"`. `warehouse_id` stays the `use_scope` field; policy unchanged. Only `inventory.pb.go` / `inventory_pb.ts` regenerated (md5 of every gen file before/after) |
| backend | `inventory_v1/stock_pick_locations.go`: `product_placement_logs AS l JOIN placements r WHERE l.transaction_id = ? AND l.warehouse_id = ?`, same GROUP BY / `HAVING SUM(-l.stock_change) > 0` / order. The `idempotency_order_check` join is gone. Another warehouse's transaction reads as an empty walk |
| frontend | `features/picking/queries.ts` sends `order.transactionId` (no read by key; `0n` → no call, empty walk). Storybook: `orderDetailFor` carries `transactionId: pickTransactionOf(id)` (70 000 + id) instead of `idempotencyKey: order:<id>`; the stub's `stockPickLocations` reads `pickLocationsByTransaction(req.transactionId)` (unknown → empty) |
| bridge leftovers | inventory tests' take keys `"order:N"` → `"key-N"` (batch_backend, count_lock, override_stamp, stock_availability, warehouse_product_search, warehouse_stock_list); [inventory rpc.md](../../services/inventory_service/rpc.md#stockpicklocations--the-pick-pages-racks-by-transaction) and [selling rpc.md](../../services/selling_service/rpc.md#which-shelf-to-walk-to--stockpicklocations) rewritten. Kept on purpose: selling `00035`'s fill, the `order:` prefix refusal (handler + stub), and event `AggregateId: "order:<id>"` (an event aggregate name, not the take's key) |
| tests | `stock_pick_locations_test.go` (6): by transaction id across three racks; scoped to its own take, an unknown id empty; another warehouse's transaction → empty; a released take nets out → empty; `transaction_id` 0 refused by protovalidate; policy roles unchanged and `warehouse_id` is the scope |
| audits | `TestPerf_StockPickLocations` (new, `-tags perfaudit`, ledger background 50 000 log rows): 1 query, ≈0.5 ms median at 1 and 20 lines, index scan on `product_placement_logs_transaction_idx` — not heavy, no audit file. Read-only RPC: no concurrency audit |
| checks | gofmt; root `go build`/`vet`/`test -count=1 -p 1 ./...`; vet `raceaudit`/`perfaudit`; `buf lint`; `npm run typecheck`; vitest pick-order / pick-queue / pick-queue-next (53); e2e `orders` (28 + 2 skipped), `opname_sessions` (5), `inventory` (2); `lint:mermaid` |

## Decided, not built

| | |
| --- | --- |
| the create check for a return warehouse | rollout steps **2** (each team sets its own — [each-team-sets-its-own-return-warehouse](../../business/order/context_decision.md#each-team-sets-its-own-return-warehouse)) and **3** (create refuses a team without one) — [create-refuses-a-team-with-no-return-warehouse](../../business/order/context_decision.md#create-refuses-a-team-with-no-return-warehouse). Step 1 is this pass |
| the return's stock half | the return transaction into the configured return warehouse, and the missing units' write-off — [return.md](../../business/inventory/return.md)'s brief, still unplanned ([return-is-unplanned](../../business/inventory/context_decision.md#return-is-unplanned)). Until then a `return_completed` order's units are on no shelf |

## Asks for a yes

| | |
| --- | --- |

## The shop write gate on the order writes (2026-11-05, backlog #20/#21)

| | |
| --- | --- |
| what | `OrderCreate` (a draft's Promote included), `OrderDraftPush` naming a shop and `OrderDraftUpdate` setting one refuse a shop the caller may not write — [a-write-needs-a-grant-or-a-manager](../../business/shop/context_decision.md#a-write-needs-a-grant-or-a-manager): `PermissionDenied` *"You have no access to <shop> — ask the team's owner or admin for it"*; a deleted (closed) shop `FailedPrecondition` *"<shop>: the shop is closed"* ([a-closed-shop-refuses-only-new-selling](../../business/shop/context_decision.md#a-closed-shop-refuses-only-new-selling)); another team's `NotFound`, as before |
| how | `refuseShopWrite` → `shopAccess` (`selling_v1/shop_write_gate.go`), the body `ShopAccessCheck` now shares — in-process, no RPC hop, before the take. Replaces `placeOrder`'s `shopExists` |
| the form | `ShopSelect writable` (← `ShopListFilter.writable`) on `MarketplaceInfoForm` — the order form and the draft page — and on the statement import dialog; a held shop not on the list is cleared |
| not gated | the order imports and the hand moves — not in the decision's list (open question, see the shop state doc) |
| tests | `shop_write_gate_test.go` (5 tests), `TestShopCheckers_AClosedShopImportsButIsNotLinked`, `ShopSelect` stories ×3, e2e `writes_need_a_shop_grant.spec.ts`. The test role readers `everyoneMayWrite` / `runsEveryShop` answer the team's owner, so an order test about something else needs no grant |
| audits | whole create 8 queries ≈3.2 ms (was 7) — not heavy; `ShopList` writable heavy by plan only ([ShopList.md](../../../audits/services/selling_service/performances/ShopList.md)); concurrency: no lock, row in [lock-order](../../../audits/services/selling_service/concurrency/lock-order.md) |
| ⛔ left | the rollout grant (every current CS granted every shop of their team) — decided to ship in the SAME release, not built |

## Traps this pass walked into

| | |
| --- | --- |
| a dev and an e2e server on one emulator project | each got the other's orders pushed into its database. Fixed by a project each |
| a server bound to loopback in CI | the emulator's container cannot push to it. CI binds `E2E_API_ADDR=0.0.0.0:8081` |
| `-g` on the serial `orders.spec.ts` | skips the setup that creates the warehouse, so a later test fails on `undefined`. Run the whole file |
| the e2e and the race/perf audits share `warehouse_test` | the e2e drops it at the end. Never run them at once |

**Next agent:** step 2 of the return rollout is the teams' own — each sets its return warehouse on Settings, no backfill
([each-team-sets-its-own-return-warehouse](../../business/order/context_decision.md#each-team-sets-its-own-return-warehouse)).
Step 3 is one check before the create's transaction, turned on once root's Teams list shows no *No return warehouse*
badge ([root-sees-which-teams-have-no-return-warehouse](../../business/order/context_decision.md#root-sees-which-teams-have-no-return-warehouse)).

## 2026-11-06 — `platform_total` is a double, frozen whole at placement (money-type change, part 1)

[every-ledger-moves-to-double-rounded-when-frozen](../../business/order/context_decision.md#every-ledger-moves-to-double-rounded-when-frozen).

- **Schema** — `selling_service` `00041_platform_total_is_double.sql`: `orders.platform_total`, `order_drafts.platform_total`,
  `order_daily_reports.mp_total` → `double precision`. Applied on `warehouse_test`; not run on dev —
  `go run ./tools/san migrate up --service selling_service`.
- **Wire** — `platform_total` on Order, OrderCreateRequest (`double.finite`, `gte 0`), OrderDraft, OrderDraftUpdateRequest,
  the push line and `OrderPlaced`; `OrderStatusCount.value`/`mp_value`, `OrderStatPreview.revenue_30d`, the five order
  metric `*mp_total` fields → `double`. The MCP metric tool forwards them as JSON numbers now (were quoted strings).
- **Freeze** — a draft keeps what was typed; `placeOrder` refuses NaN/±Inf and a figure that rounds to nothing, and writes
  `san_money.Whole(platform_total)` — so the row, the response, the event, the census and settlement's `initial_total`
  carry one whole number. Export's `moneyOrEmpty` takes a double (`IsZero`).
- **Tests** — `TestOrderCreateFromDraft_APlatformTotalIsADoubleFrozenWholeEndToEnd` (draft 131.000,5 → order/row/event/
  detail/census/revenue 131.001), `TestOrderCreate_RefusesAPlatformTotalThatRoundsToNothing`.
- **Frontend** — `platformTotal` is a `number` on every order screen (list MP cell, warehouse list, detail tiles, money
  breakdown, margin bar, info panel, create form seed/send, draft readiness). `features/orders/margin.ts` takes the
  revenue as a `Rupiah` and keeps its bigint arithmetic (`goods_cost`, fees are still bigint); `stat.ts` bridges `value`,
  `mp_value`, `revenue_30d` with `wholeRupiah` — exact, they are sums of frozen whole figures.
- ✅ **Part 2 built 2026-11-06** (below): `goods_cost`, `unit_cost`, `unit_price`, `courier_charge`, and the margin moved to number.

## 2026-11-06 — the order's costs are doubles, frozen whole at placement (money-type change, part 2)

[every-ledger-moves-to-double-rounded-when-frozen](../../business/order/context_decision.md#every-ledger-moves-to-double-rounded-when-frozen).

- **Schema** — `selling_service` `00042_order_costs_are_double.sql`: `orders.goods_cost`, `order_items.unit_cost`,
  `order_draft_items.unit_price` → `double precision`. Applied on `warehouse_test` (the harness re-applies every migration from scratch); not run on dev — `go run ./tools/san migrate up`.
- **Wire** — `goods_cost` (Order, `OrderPlaced`, both `gte 0` + finite where a caller sends it), `unit_cost` (OrderItem,
  `OrderPlacedLine`), `unit_price` (OrderDraftItem, the push line), `OrderReturnAcceptRequest.courier_charge` (`gte 0`,
  finite) and `OrderReturnAccepted.courier_charge` → `double`.
- **Freeze** — `placeOrder` writes `san_money.Whole(line.UnitCost)` per line and `goods_cost = Whole(Σ unrounded line
  totals)`, once; `OrderReturnAccept` freezes the courier's charge before its note check, its event and the liability
  posting. A draft's `unit_price` is kept as read. The credit check's block message formats the figures `%.0f`.
- **Tests** — `TestOrderCreate_FractionalCostsFreezeWholeOnceAndTravelAsDoubles`; the raceaudit
  `order_create_race_test.go` reads `goods_cost` / `unit_cost` as `float64` now.
- **Frontend** — `features/orders/margin.ts` is `number` throughout; the order detail, list cells, summary, margin bar,
  settlement panel and AcceptReturnDialog read `number`. The ORDER FORM keeps its typed/frozen figures in whole-rupiah
  `bigint`, and now builds them the way the order freezes them: `lineValue` (unrounded) per line, `goodsCostOf` and each
  owner's invoice row summed unrounded and rounded ONCE (`form/money.ts`, unit test `form/money.test.ts`) — it rounded
  each line and floored each markup before, a rupiah or two off the frozen `goods_cost` on a fractional draw.
- ✅ Part 2 is built: the "not built" bullet of the part-1 note above is closed by this one.

## 2026-11-06 — the backend never rounds money ([the-backend-never-rounds-money](../../business/order/context_decision.md#the-backend-never-rounds-money))

Supersedes the whole-rupiah freezing of the two sections above (the `double` shape and the tolerance compares stand).

| | now |
| --- | --- |
| `platform_total` | frozen EXACT at placement (`order_place.go`; refused only when not finite or not above 0 — `san_money.Positive`, float dust counts as 0). Rp 0,4 is placed as 0,4 |
| `goods_cost` / `unit_cost` | the exact Σ of the lines' totals / the take's exact unit cost — `san_money.Whole` is deleted from the repo |
| warehouse fee / `total_cost` | as before, unrounded: 2,5% of Rp 12.666,99 is stored Rp 316,67475 (the screen shows Rp 316,675) |
| return courier charge | frozen as typed; the accept's note writes it with `san_money.Text` ("Rp 316,675") |
| credit block message | figures via `san_money.Text` ("Rp 52.000.000") instead of `%.0f` |
| order form | previews the exact figures (`features/orders/form/money.ts` `goodsCostOf`/`invoiceRows`/`creditRows`, `lines.ts`, `TotalsInvoicePanel`, `ProfitEstimatePanel`, `CreditLimitPanel`, `checks.ts` `profitPct`, the fee quote) — `number`, no bigint whole-rupiah maths; `CurrencyInput fraction` lets the platform total carry a draft's fraction (typed with a comma, up to 3 places) |

⚠ **[a-draft-keeps-its-platform-total-as-typed](../../business/order/context_decision.md#a-draft-keeps-its-platform-total-as-typed)** says the figure is *"rounded to whole rupiah once, when the order is placed"* — no longer: placement keeps it exact (the newer decision supersedes that sentence; the owner text is unchanged). Its *"a figure that rounds to nothing is refused"* is now *"not above 0 (float dust included) is refused"*.

Tests: `TestOrderCreate_FractionalCostsAreFrozenExactAndTravelAsDoubles`, `TestOrderCreateFromDraft_APlatformTotalIsFrozenExactEndToEnd`, `TestOrderCreate_RefusesAPlatformTotalOfDustButPlacesAFraction`, the unit-cost asserts in `order_item_markup_test` / `order_line_merge_test` / `order_stock_test`, `features/orders/form/money.test.ts`, e2e `the_order_keeps_exact_figures.spec.ts` (form preview == stored order via `formatRupiah`; Team Balance posts 316,67475).

Note — the owner's example in the decision reads total cost `12.983,675`; the exact sum of goods `12.666,99` and fee `316,67475` is `12.983,66475`, shown `Rp 12.983,665`. The fee example (`316,675`) matches the 3-decimal display of the exact fee.

## 2026-11-06 — the courier is a shipment channel id, and the server refuses an order without one (order model, item a)

Decisions: [shipment-channel-is-an-id-into-shipment-service](../../business/order/context_decision.md#shipment-channel-is-an-id-into-shipment-service),
[the-channel-name-is-not-frozen](../../business/order/context_decision.md#the-channel-name-is-not-frozen),
[no-order-without-a-courier](../../business/order/context_decision.md#no-order-without-a-courier),
[the-app-converts-the-courier-to-a-channel-id](../../business/shipment/context_decision.md#the-app-converts-the-courier-to-a-channel-id).

| | built |
| --- | --- |
| schema | selling `00044_order_shipment_channel_id.sql` — `shipment_channel_id BIGINT NOT NULL DEFAULT 0` on `orders` and `order_drafts`, `shipping_code` dropped on both, the draft touched mark renamed. No code-to-id fill (a dev order from before shows no courier); up and down proved in a rolled-back transaction on `warehouse_test` |
| contract | `uint64 shipment_channel_id` on `Order` (36), `OrderCreateRequest` (23), `OrderListFilter` (14), `OrderStatFilter` (13), `OrderDraft` (23), `OrderDraftUpdateRequest` (15, optional), `OrderDraftPushRequest` (16); every `shipping_code` reserved by number and name. The create request carries no `gt = 0`: the placement rule names what is missing |
| the rule | `placeOrder` validate → `errOrderNoCourier` *"an order must say which courier carries it"* (InvalidArgument), both doors, before the shop gate and the take. Opaque: never looked up |
| reads | the list/stat filter is an id equality; `OrderExport`'s courier column is the channel CODE through the new `OrderExportStore.ChannelCodes` (composition root `order_export_deps.go` → `ShipmentChannelByIds`), `#id` when unresolved |
| frontend (no visible change) | the form picks with `ShipmentChannelSelect` (same look and copy as ShippingSelect) and seeds the draft's id; `features/orders/OrderCourierBadge.tsx` (new, story `Features/Orders/OrderCourierBadge`, 4) names an order's courier from the shared session catalogue for `AwbCell`, the warehouse InfoPanel, the pick screen and pick-queue-next; `OrderReferences`/`ShipmentLeg` print the code through `courierCodeOf`; pick-queue-next's courier filter is an id in the URL. Fixtures: jne 91, sicepat 93, the old `anteraja` → 95 (an id the catalogue does not hold, shown `#95`) |
| ⚠ prototype only | the form's REQUIRED courier — `OrderCreatePage courierRequired` (red `*`, `orderForm.courierRequired` under the field, Create held): `pages/order-create/courierRequired.stories.tsx` (5 stories, incl. *TheLiveFormDoesNotMarkTheCourier*). Awaiting the owner's design accept; until then a live Create without a courier shows the server's refusal in `order-create-error` |
| e2e | every form flow picks JNE (`pickCourier` in orders.spec, the exact-figures spec); the direct `OrderCreate` seeds (stock_count_cancel, the_closed_shop, writes_need_a_shop_grant) send `shipmentChannelId: "1"` |
| tests | Go `order_shipment_channel_test.go` (refuses none, stores the id, draft push/pick/yield, promote needs one, export names by code); 19 test files' requests carry `testShipmentChannel`; the warehouse filter test filters by id; perf `TestPerf_OrderList_Courier` ≈6 ms median over 50 000 orders (a filter on the warehouse's bitmap scan) — no report. Concurrency: one column and one comparison, no new lock — no report |

## 2026-11-06 — an order's address is its own row, names only (order model, item b — the order's half)

Decisions: [an-address-is-plain-names](../../business/order/context_decision.md#an-address-is-plain-names),
[one-address-per-order-and-per-draft](../../business/order/context_decision.md#one-address-per-order-and-per-draft).

| | built |
| --- | --- |
| schema | selling `00045_order_addresses.sql` — `order_addresses` (UNIQUE `order_id`, FK cascade, CHECK customer present), every existing order copied in, `orders` loses `customer_name`, `customer_phone`, the four codes, the four names, `kode_pos`, `address_line` and `orders_customer_present`. Up/down proved in a rolled-back transaction on `warehouse_test` |
| code | model `OrderAddress` + `Order.Address` (has-one) and `Customer()`/`Phone()`; `placeOrder` inserts the row after the order; `attachAddresses` (`order_address.go`) for list/export/cancel/receipt/return-accept/re-read; `OrderDetail` preloads; the search is `orders.id IN (… order_addresses …)` |
| contract | none changed — `Order.customer_name`, `customer_phone`, `address` filled from the row; an order's address codes are always empty |
| tests | `order_address_test.go` (3) + `TestOrder_CreateThenDetail` now asserts no codes; 13 test files' seeded `Order{}` rows carry `Address` |
| perf | ⚠ `TestPerf_OrderList_Root`: a warehouse's search 47 → 118 ms (the address subquery is unscoped); root 112–119 → 128–142 ms. Written into the OrderList audit's finding 1 with the split trigram fix (58–83 ms probed) — recommended, not applied. ⚠ `TestPerf_OrderStat` fails on a scan of `item_count` into int64 — not this pass's code (the probe's own SQL), left as found |
| ⛔ not built | `order_draft_addresses` — a draft's address stays inline with codes. Names-only drafts could not fill the code-driven AddressPicker the form seeds from a draft: a visible change, awaiting the owner |

## 2026-11-06 — order model part 2: the courier required live, the draft's address row, drafts store no mapping, the search's trigram indexes

Decisions: [the-courier-required-look-is-accepted](../../business/order/context_decision.md#the-courier-required-look-is-accepted),
[the-cs-edits-the-whole-address-before-create](../../business/order/context_decision.md#the-cs-edits-the-whole-address-before-create),
[a-draft-carries-the-scraped-address](../../business/order/context_decision.md#a-draft-carries-the-scraped-address),
[one-address-per-order-and-per-draft](../../business/order/context_decision.md#one-address-per-order-and-per-draft),
[an-address-is-plain-names](../../business/order/context_decision.md#an-address-is-plain-names),
[a-draft-stores-no-mapping](../../technical/frontend/order_draft_decision.md#a-draft-stores-no-mapping),
[the-drafts-list-counts-no-mapping](../../technical/frontend/order_draft_decision.md#the-drafts-list-counts-no-mapping).
Supersedes the *⚠ prototype only* and *⛔ not built* rows of the two entries above.

| | built |
| --- | --- |
| the courier, live | `OrderCreatePage` takes no prop: the courier field always carries the `*` and the hint while none is picked, and Create is held until `shipmentChannelId > 0n`. `courierRequired.stories.tsx` 4 stories (the live-unmarked one removed); `index.stories` / `formLock.stories` pick JNE after the shop |
| schema | selling `00046_order_draft_addresses.sql` (UNIQUE `order_draft_id`, FK cascade, names only, best effort, every draft copied, twelve columns off `order_drafts`), `00047_order_draft_items_no_product.sql` (drop `product_id`), `00048_order_search_trigram.sql` (`pg_trgm`, `order_addresses_customer_trgm_idx`, `orders_ref_receipt_trgm_idx`). All three down → up proved in one rolled-back transaction on `warehouse_test` (the draft's names survive both ways) |
| the matcher | region_service `RegionMatch` (new RPC, `region_v1/region_match.go`, `allow_only_authenticated`): exact on all four levels after normalising case/spacing and the Kabupaten / Kab. / Kab / Kota (Administrasi) prefix; one desa = its ancestry, several or none = no match (`matches` 0/1/2). Perf `TestPerf_RegionMatch` over the real 91 599-row seed: 0.5–2.1 ms, 2 queries — no report |
| the seam | `selling_v1.RegionMatcher` (10th `NewService` dep) → `cmd/app_development/order_draft_regions.go` (`protovalidate`, then the handler in-process). `OrderDraftDetail` returns `OrderDraft.region_match` (24) — read-time only; a blank level is never asked, a failed lookup is logged and leaves it unset |
| draft RPCs | push creates the address row with the draft and a re-push updates its untouched parts; `OrderDraftUpdate` writes the present parts; detail and list read it (`order_draft_address.go`, one `IN` read for a page). `readyDrafts`: + address row's `customer_name`/`address_line`, + `shipment_channel_id`, − the mapping clause. `ProductHasHistory` reads no draft lines. Proto reserved: `OrderDraftItem.product_id` 4, `OrderDraftLineEdit.product_id` 2, `OrderDraft.unmapped_item_count` 18 |
| the form | `pages/order-create/draftAddress.ts` `addressOf` — the four levels from `regionMatch`, else empty; the draft's postcode (over the place's) and street seeded; `DraftAddressText` shows the marketplace's address above the picker through the new `CustomerInfoForm addressHint` slot; no line is seeded from a draft |
| the drafts list | *Baris* = `draft-lines-<id>`, the unmapped badge and gap removed; `draftGaps` + `gapAddress` (no street line), `gapCourier` (no channel), every other gap kept; i18n − `orderDrafts.unmappedOf/unmappedLines`, + `orderDrafts.gapAddress/gapCourier`, `orderForm.draftAddress.title/none` |
| tests | Go: `region_match_test.go` (4), `order_draft_address_test.go` (4), detail pre-fill (2, `fakeRegions`), `TestDraftRegionMatcher_PrefillsADraftsAddressFromTheRegionList` (real wiring), the ready-count test over 7 drafts (no-courier, no-address, no-customer), draft tests map in the form (`promoteMapped`/`mappedItems`). Frontend: `draftAddress.test.ts` (4), `draftReadiness.test.ts` (4), stories *ADraftAddressThatMatchesOnePlaceOpensPrefilled*, *APrefilledAddressStaysEditable*, *ADraftAddressWithNoMatchOpensEmpty*, *TheListCountsNoMapping*, *NoAddressOrNoCourierIsNotReady*, `CustomerInfoForm` *AnAddressHintSitsAboveThePicker*; e2e `order_drafts.spec.ts` (gaps title; a Kab. match pre-fills, a Kota mismatch stays empty, through the real server) |
| perf | `OrderDraftList` ≈10 ms, 5 queries over 50 000 drafts. OrderList's search re-measured with `00048` — see the [OrderList audit](../../../audits/services/selling_service/performances/OrderList.md), finding 1. Concurrency: the address row is written under the draft's existing `FOR UPDATE` lock in the same transaction (a racing first push still loses on the draft's unique index and retries as a merge) — no new lock, no report |

## 2026-11-09 — several warehouse labels in one PDF (`OrderLabels` step 2, backlog #16e)

Decision: [a-warehouse-prints-the-labels-of-orders-it-ships](../../technical/frontend/warehouse_order_list_decision.md#a-warehouse-prints-the-labels-of-orders-it-ships)
(✅ Built line added there, and under `scanning-is-the-crews-hands` for the `printMerge` mark). Supersedes the *step 1*
limits of the 2026-11-04 entry above.

| | built |
| --- | --- |
| contract | `OrderLabelsRequest.order_ids` 1 to **50** (was 1), unique; `OrderLabelReason.UNREADABLE = 3` (new); `DocumentResourceType.ORDER_LABELS = 9` (new). Policy and `NO_SIDE_EFFECTS` unchanged — the stored PDF is the answer, not a record |
| backend | `selling_v1/order_labels.go`: ONE id → `LabelURL`, as before (its own file, nothing read or stored); SEVERAL → `LabelFiles` (bytes per distinct document, owner-checked), `san_pdf_merge.Merge` in the asked order, `StoreOrderLabels` under the CALLER's team, filename `labels-<WIB yyyy-mm-dd-hhmmss>.pdf`. Two orders on one file print it once. Nothing printable → no link, nothing stored. `LabelLinker` gained `LabelFiles` + `StoreOrderLabels` (types `LabelRef`, `LabelFile`) |
| document_service | `document_v1/label_files.go` (one `IN` query over active `order_receipt` rows, owner kept per ref, one store read each capped at the upload limit; a row whose file is gone → no content → UNREADABLE), `document_v1/order_labels_store.go` (object straight to `assets/`, ACTIVE `order_labels` row of the warehouse, creator + override stamp, object deleted if the row fails, signed link). `RequestUpload` refuses `ORDER_LABELS`. Migration `document 00011_allow_order_labels_resource_type.sql` (CHECK + `order_labels`) |
| the PDF library | **pdfcpu v0.15.0** (pure Go, Apache-2.0) — new direct dependency; v0.16.x needs Go 1.26 and would have bumped the module's `go` line. Behind `backend/pkgs/san_pdf_merge`: each file read on its own (PDF relaxed validation; JPEG/PNG/WEBP/TIFF → one page of the picture's own size), rewritten once and read back (pdfcpu reads lazily — a broken stream otherwise lands in the merged file unreadable), a library panic recovered per file, a failed append rebuilds from the files already in, config dir disabled, offline; output without object streams (classic xref) |
| frontend | `features/orders/labels.ts` `printLabels` — one `orderLabels` with the ticked ids (list order), opens the link when any label made it, toasts each order left out with its reason (`orders.label.unreadable`, `someLeftOut_one/_other`, `noneToPrint`, en + id). `pages/pick-queue-next` (the hidden preview) bulk bar *Print Labels* calls it (loading while it runs); `printMerge` mark, `sayPending` and its i18n gone. Stub `orderLabels` takes 1–50 ids, merged URL for several, `orderLabelScenario.labelled` / `unreadable` |
| tests | Go `san_pdf_merge` (every sample merges, page count = sum and the text page count; a photo is one page of its size; a bad file refused first/middle/last; nothing readable; 24 corruptions × every sample never crash; an untyped file sniffed); `TestOrderLabels_*` + 8 (several merge into one PDF — pages = sum, page order = asked order; each refusal per order incl. another warehouse's, never read; nothing printable stores nothing; a shared file prints once; one id is its own file; root merges any warehouse's under team 1; read / store failure is an error; the 50 cap); `TestLabelFiles_*` (2), `TestStoreOrderLabels_*` (2), `TestOrderLabelLinker_TheWarehouseMergesTheSellersLabels` (real wiring, real samples, stored under the warehouse, no share row). Stories `PrintLabelsMergesTheTickedRows`, `PrintLabelsWithNothingPrintable`. e2e `the_labels_print_together.spec.ts` (its own seller + two warehouses: staff prints 3 → 3 pages, NO_LABEL reported, the PDF is the warehouse's own document, the label still 404 as owner; another warehouse → NOT_SHIPPED_HERE ×3) |
| perf | `TestPerf_OrderLabels_FiftyMerged` (cmd/app_development, real linker + local store, 20 000 other label rows): 3 queries, DB ≈3 ms, ≈85 ms wall for 50 real labels (4.9 MB); `TestPerf_Merge`: 50 labels 69 ms, 100 labels 142 ms — not heavy, no report. Concurrency: the one write is an INSERT of a fresh random-id row plus its own object — no shared row, no read-modify-write, no lock — so two prints at once are two files; no report |
| ⚠ open | the warehouse order list that carries the bar is still the unrouted preview (owner: hidden for now), so no LIVE screen prints several yet; the live `/warehouse-orders` (`pages/pick-queue`) has no selection. Stored `order_labels` files are never cleaned up (exports neither). A JPEG's EXIF rotation is not applied |

## 2026-11-09 — the warehouse order list prepared for review (`PickQueueNextPage`, Storybook only)

Review prep for the owner's design accept of the unrouted preview (backlog *Waiting on the owner*: the scan before Set
Picked). No Go, proto, migration or route change.

| | |
| --- | --- |
| fixed — follows a decision | the pager is `GrowingPager` ([every-list-pages-with-the-growing-pager](../../technical/frontend/context_decision.md#every-list-pages-with-the-growing-pager)); an empty list is `EmptyHint`, *nothing matches* with its own Clear Filters ([an-empty-list-shows-a-hint](../../technical/frontend/context_decision.md#an-empty-list-shows-a-hint)); first load `ListSkeleton`, the page's `enter`, the tabs' sliding indicator ([motion-is-small-quick-and-shared](../../technical/frontend/context_decision.md#motion-is-small-quick-and-shared)); on a phone *Scan Handover* is the header's icon ([a-phone-header-action-is-an-icon](../../technical/frontend/context_decision.md#a-phone-header-action-is-an-icon)); the seller-team filter shows the name alone ([a-one-type-picker-shows-the-name-alone](../../technical/frontend/context_decision.md#a-one-type-picker-shows-the-name-alone)) |
| fixed — wording (en + id) | the bar's skip toast said *not packed* (Dikemas folded into picked, 00015) → *not picked yet*; the back dialog said *Return to Confirmed* (a move back goes to pending) → *Back to To Confirm* / *Kembalikan ke Perlu Konfirmasi*; the scan's button said *Move to Picked* → **Set Picked** ([the-item-scans-live-on-the-page](../../business/inventory/order_decision.md#the-item-scans-live-on-the-page)); id *Export* → *Ekspor* (the seller list's word, [one-export-is-the-list-as-a-file](../../technical/frontend/warehouse_order_list_decision.md#one-export-is-the-list-as-a-file)); *No Receipt File* in Title Case |
| stories | 27 (was 25): + `HandOverSkipsWhatIsNotPicked`, `NothingMatchesSaysSoAndClears`; asserts added for the pager, the back title, *Set Picked*, the name-alone filter (mutation-checked). typecheck; vitest pick-queue-next · pick-queue · pick-order · features/orders · components/chrome · components/feedback 200/200 |
| ⚠ open — bigger than a slip | the row menu and the bulk *Change Step* still move a Dikonfirmasi order to *Sudah diambil* with no scan, while *Set Picked* is on only when every line is exact ([the-item-scans-live-on-the-page](../../business/inventory/order_decision.md#the-item-scans-live-on-the-page)); the scan sits in a list dialog, not on the one pick page opened by the label ([the-pick-page-opens-first-by-the-label](../../business/inventory/order_decision.md#the-pick-page-opens-first-by-the-label)) — and the live pick page (`pick-order`) advances with no scan at all; the handover's lookup keeps one order per code and never skips `cancel` ([two-orders-on-one-label-are-shown-not-chosen](../../business/inventory/order_decision.md#two-orders-on-one-label-are-shown-not-chosen)) |
| ⚠ go-live gap vs the live `/warehouse-orders` (`pages/pick-queue`) | its **Retur** tab and **Receive a Return** ([the-return-receiving-screens-are-accepted](../../business/order/context_decision.md#the-return-receiving-screens-are-accepted)); write actions hidden from a monitored team (`canWrite`); the route swap in `router.tsx`, its stories and the e2e step that clicks `pick-tab-return` (`orders.spec.ts`) |
| pending marks | `resiLookup` — the handover looks only in the 200 orders it loaded; needs a per-scan server lookup as this warehouse (OrderList's own `q`, as Receive a Return does) with several matches shown, cancel skipped. `barcode` — the validation matches the SKU; the product barcode is ⏸ parked by the owner ([design_clarify Q18](../../technical/order/design_clarify.md#question)) |
| screenshots | `D:/hermes/cache/scratch/warehouse_list_review/` (desktop 1440, phone 390) |

## 2026-11-09 — the warehouse order list is live (`/warehouse-orders`)

Decisions: [the-warehouse-order-list-is-accepted](../../technical/frontend/warehouse_order_list_decision.md#the-warehouse-order-list-is-accepted),
[scan-label-opens-the-pick-page](../../technical/frontend/warehouse_order_list_decision.md#scan-label-opens-the-pick-page),
[the-warehouse-list-has-a-returns-tab](../../technical/frontend/warehouse_order_list_decision.md#the-warehouse-list-has-a-returns-tab),
[the-item-scans-live-on-the-page](../../business/inventory/order_decision.md#the-item-scans-live-on-the-page),
[the-pick-page-opens-first-by-the-label](../../business/inventory/order_decision.md#the-pick-page-opens-first-by-the-label)
(✅ Built lines added under each). Supersedes the *⚠ open* and *go-live gap* rows of the review entry above, and the
*⚠ open* "no live screen prints several" of the labels entry.

| | built |
| --- | --- |
| the route | `/warehouse-orders` = the accepted list, moved from `pages/pick-queue-next` into `pages/pick-queue` (`PickQueuePage`; Storybook `Pages/Warehouse/PickQueuePage`, no longer hidden). The old pick queue (three columns, its own tabs) is gone; its `ReceiveReturnDialog` stays in `pages/pick-queue/components/`. `ScanInput` → `features/picking/` (shared with the pick page); `usePickQueue` deleted; the list's `pending.ts` deleted (no mark left) |
| Set Picked | only on the pick page: `pages/pick-order/components/ItemScan.tsx` under the racks of a `processed` order — per-scan count on the page, an unknown product code or one too many refused with the wrong sound, *Set Picked* on only when every line is exact, one `OrderStatusChange` to `picked`. `NEXT_STEP` lost its plain *Mark Picked*; `steps.ts` `confirm → [toConfirm]` only, so neither the row menu nor Change Step offers *Sudah diambil*. The list's *Scan to Validate* item and `ValidationScanDialog` are gone. The `barcode` mark moved to `pages/pick-order/pending.ts` (`picking.pending.barcode`) |
| Scan Label | `pages/pick-queue/components/ScanLabelDialog.tsx` from the header (phone: in the ⋯ with Scan Handover and Receive a Return — three fold). `features/picking/labelLookup.ts` `lookupLabel`: OrderList's own `q` as this warehouse (one page of 100), kept where tracking number, ref or id EQUALS the code in any case (`labelMatch.ts`, unit-tested), an all-digit id pushed off a full page asked by `OrderDetail`; `cancel` split off. One live → `/warehouse-orders/:id`; several → listed (shop, status, date, units) under the ask-warning, none opened, each its own *Open*; none / only cancelled → wrong sound + sentence |
| the handover | `HandoverScanDialog` asks `lookupLabel` per scan (the 200-loaded-orders map and the `resiLookup` mark are gone): several live → a `several` entry naming each, none handed over; a cancelled twin skipped; the label's other barcode is the same parcel; a scan in flight is not asked twice |
| Retur | `pages/pick-queue/tabs.ts`: *Retur* after *Sudah diserahkan* = `return` + `return_completed`, through the new **`OrderListFilter.statuses`** (15; `statusFilter` in `order_list.go`, shared with `OrderExport`), counted as the two together, `?step=return`, its own empty sentence. *Receive a Return* in the header |
| who writes | `canWrite(current)`: a monitoring team gets no Scan Handover, Receive a Return, row move, Change Step or Hand Over, and no item scan on the pick page; Scan Label, Print Labels and Export (reads) stay |
| tests | Go `TestOrderList_StatusesListsAnyOfThem` (list + export, mutation-checked); perf `TestPerf_OrderList_Statuses` ≈ 4.9 ms, 3 queries over 50 000 orders — no report. Frontend unit `labelMatch.test.ts` (5). Stories: `Pages/Warehouse/PickQueuePage` 44 (+ Scan Label ×6, handover several / cancelled twin, Retur both, the return warehouse's two, Receive a Return ×4 moved from the old page, monitor, phone header, NoMarkIsLeft, menu / Change Step never picked — the last five mutation-checked), `Pages/Order/PickOrderPage` +5 (SetPickedIsTheScans, NoPlainMarkPicked, OnlyAProcessedOrderIsScanned, APickedOrderGoesToTheHandover, AMonitorReadsThePickPageOnly). e2e: new `the_warehouse_list.spec.ts` (own seller, warehouse, staff, admin-team monitor: menu + Change Step never offer picked; Scan Label → pick page → wrong item refused → exact → too many refused → Set Picked, the server reads picked; Retur counted + in the URL; the monitor sees no write on the list or the pick page); `orders.spec.ts` walks pick by scan (`pickByScan`), finds rows by id, Retur in the URL; `the_labels_print_together.spec.ts` prints by clicking the bar's *Print Labels* |
| stub | `orderList` honours `statuses`; `labelScanScenario` (`withSharedLabel`, searches asked), `statusChangeScenario.calls` (sessionScenario.ts) |
| checks | `go build/vet/test -count=1 -p 1 ./...` green; vet `raceaudit`/`perfaudit`; buf lint + generate (drift: `order.pb.go`, `order_pb.ts` only); typecheck; `test:unit` 93; full stories 216 files / 2265 tests; full e2e in eight name-ordered batches 219 passed, 2 skipped (the long-skipped Revenue pair); `lint:mermaid` |
| ⏸ parked | product barcodes (the item scan matches the product code) |
