# Development state — order

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
| ⚠ not built | `unit_cost_with_markup` and `markup_total` ([the-cross-charge-lives-on-the-line](../../business/order/context_decision.md#the-cross-charge-lives-on-the-line)); `order_items.total` is not on the `OrderItem` wire message |
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
| tests | Go: `TestOrderCreate_ABorrowedLineRaisesTheGoodsCostByItsMarkupAndTheFeeFollows` (18.000 own + 40.800 borrowed → goods_cost 58.800, fee asked on it, total_cost 64.680), `TestOrderDraftPromote_TakesItsMoneyFromTheTakeNotTheRows`, total_cost on the fee test, `order_platform_total_test.go` (renamed), the census's value = Σ platform_total. Story *ABorrowedLineIsPricedWithItsMarkup* (order detail, fixture 105: one borrowed line, harga beli Rp 189.440 with markup, total sistem Rp 191.440). Repo `go test ./...` 1 580 pass; the OrderCreate race audit passes; stories 1 511 pass; e2e orders · order_drafts · settlement_imports · statement 32 pass (2 skipped — the retired revenue tests); the draft push sends no `shippingCost` |
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
| Edit Resi's mark | was broken — it pointed at `receiptCode`, declared on neither screen, so its ⚠ read 0 with no label. Declared on both now; the action still has no RPC ([the-seller-edits-the-resi-until-handover](../../technical/frontend/order_list_decision.md#the-seller-edits-the-resi-until-handover)) |
| marks left | order detail **2** (shippingTracking — deferred, receiptCode) · seller list **2** (import, receiptCode) |
| note limits | `OrderCreateRequest.note` 2000, `OrderNoteCreate` 500 — kept different by the owner ([the-two-note-limits-stay-different](../../technical/frontend/order_detail_decision.md#the-two-note-limits-stay-different)) |
| dev DB | selling migrated to 29 |

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
| `OrderCreate` · concurrency + performance | ✅ the fee is one read (the unique `warehouse_id` index) — 🔄 *(2026-10-23)* now AFTER the take, inside the transaction, with the header's `cogs`/`warehouse_fee` written by one UPDATE of its own row. Raced through the real take and fee (`backend/cmd/app_development/order_create_race_test.go`, `-tags raceaudit`): 8 creates over 2+2 units at two prices × 5 rounds, ×20 runs — exactly 2 orders, cogs 20.000 and 28.000, each fee 10% of its own cogs, each cogs = its take. The fee read takes no lock; the shop's KEY SHARE is held across it as across the take (pattern 6, by design — [lock-order](../../../audits/services/selling_service/concurrency/lock-order.md)) |
| `StockTakeQuote` · performance | ✅ [report](../../../audits/services/inventory_service/performances/StockTakeQuote.md) — 1 query, 0.5/1.6/7.6 ms at 1/20/100 own lines; the reserve rule it shares with the take was an N+1 on borrowed lines, fixed 2026-10-26: 2 queries, 1.57 ms at 20 |
| `TeamReturnConfigurationDetail` · `Set` · performance | 1 query each, under 1 ms over 10 000 rows — not heavy |
| the buyer's username · concurrency + performance | ✅ one more column on writes and reads that already exist (create, push, update, promote, detail, list, export) — no new query, no new lock, no index needed |
| the required total · concurrency + performance | ✅ one column on the draft's existing writes and one comparison in `placeOrder`'s validation, before any read — no new query, no new lock, no index |
| the line's frozen total · concurrency + performance | ✅ the lines' one INSERT moves after the pick, inside the same transaction, carrying one more column — same statement count, no new shared row, no new lock. Liability's product fee drops its terms read (one fewer query per owner) and only its amount changes |

## Decided, not built

| | |
| --- | --- |
| the create check for a return warehouse | rollout steps **2** (each team sets its own — [each-team-sets-its-own-return-warehouse](../../business/order/context_decision.md#each-team-sets-its-own-return-warehouse)) and **3** (create refuses a team without one) — [create-refuses-a-team-with-no-return-warehouse](../../business/order/context_decision.md#create-refuses-a-team-with-no-return-warehouse). Step 1 is this pass |
| the return accept | `return → return_completed`, its own RPC — refused by `OrderStatusChange` today. Its inventory half is [return.md](../../business/inventory/return.md)'s brief |
| *Edit Resi* | [the-seller-edits-the-resi-until-handover](../../technical/frontend/order_list_decision.md#the-seller-edits-the-resi-until-handover) — `receipt_code` and the file exist; the edit RPC and the menu wiring do not |
| the event's fee | `OrderPlaced.warehouse_fee` and liability posting it — step 4 of the fee rollout |
| the return's use of the map | the return accept reading `product_return_maps` to bring a borrowed line back as the team's own product ([a-returned-borrowed-unit-is-relabelled-at-the-accept](../../business/order/context_decision.md#a-returned-borrowed-unit-is-relabelled-at-the-accept)) — waits on the return accept itself. The map is built (eighth pass) |

## Asks for a yes

| | |
| --- | --- |

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
