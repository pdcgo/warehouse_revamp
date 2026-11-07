# Development state — balance

✅ **2026-11-07: the Team Balance filters are the server's (backlog #34)** — uncommitted.

| | |
| --- | --- |
| proto | `LiabilityPositionListFilter` + `q`, `counterparty_type`, `awaiting_only`; `LiabilityLogListFilter` + `from`, `to`, `direction` (new enum `LiabilityLogDirection`); `LiabilityPaymentListFilter` + `from`, `to`, `side` (new enum `LiabilityPaymentSide`); `LiabilityTermsHistoryListFilter` + `from`, `to`. All applied before the page; rules in [rpc.md](../../services/liability_service/rpc.md#the-team-balance-lists-filter-before-the-page-backlog-34) |
| backend | `liability_v1/list_filters.go` (`listPeriod` — Jakarta midnights, [the-liability-day-is-the-jakarta-day](../../business/balance/context_decision.md#the-liability-day-is-the-jakarta-day); `teamMatches`); `position_list.go` `positionRows` (summary unnarrowed); the seam `TeamNamer.TeamFacts` (name, code, type) — `cmd/app_development/liability_deps.go` now calls team_service's `TeamByIds` handler in-process (Wire regenerated), batches of 200. No migration, no index |
| screens | list: `q` sent debounced (`useDebounced`, as every list), team type and *awaiting only* sent; the client-side narrowing is gone; every filter resets the page and the `GrowingPager`. Detail: the date range (`liabilityPeriod`, URL unchanged) and the open tab's direction / side go with each read, each tab draws its own server page (a tab's skeleton while its cut loads; rows kept only within the same pair), pagers reset on a range / tab change; `ChangeLogPanel` sends the range |
| tests | Go: `TestPositionList_ASearchFindsAPairOnPage2`, `…TheKindFilterNarrowsBeforeThePage`, `…TheSummaryIgnoresTheSearch`, `…AnUnknownTeamNeverMatchesAFilter`, `…AwaitingOnlyNarrowsBeforeThePage`, `…OnlyASearchAsksTeamService`; `TestEntryList_ADateRangeFindsEntriesOnPage2`, `…ARangeReadsJakartaDays` (00:30 / 06:30 WIB, the process clock set to UTC; mutation-checked), `…AFilteredPageCarriesTheTrueRunningBalance`, `…ABadPeriodIsRefused`; `TestPaymentList_EachSideIsItsOwnPage`, `…ADateRangeNarrowsBeforeThePage`; `TestTermsHistory_ADateRangeNarrowsBeforeThePage`; `TestLiabilityTeamNamer_ReadsNamesAndFactsFromTeamService` (cmd). Stories (stub filters as the server does; requests recorded in `.storybook/liabilityScenario.ts`): PairList `ASearchFindsATeamByNameOrCodeOnTheServer`, request asserts in `FiltersLiveInTheUrl` / `TheTeamTypeFilterNarrowsAndClearsFromItsX`; PairDetail `EachTabReadsItsOwnServerPage`, range asserts in `FiltersLiveInTheUrl`. e2e `liability.spec.ts` *a search finds a team and a date range narrows the ledger* |
| perf | probes `-tags perfaudit` for all four; none heavy except `LiabilityPositionList` by query count (7 with a search, 6 unfiltered — the old probe's bound of 5 was red at HEAD) → [audit](../../../audits/services/liability_service/performances/LiabilityPositionList.md) |

✅ **2026-11-07: the phone layout is live; the list's team filter is Chakra's Select** — uncommitted.

| | |
| --- | --- |
| phone | [the-team-balance-phone-layout-is-accepted](../../technical/balance/team_balance_design_decision.md#the-team-balance-phone-layout-is-accepted): `features/liability/phonePrototype.tsx` (provider + `useLiabilityPhoneLayout`) is deleted; `pages/liability-list` and `pages/liability-detail` read `phone = useIsMobile()` (the pair page's desktop header lost its `isMobile` branch, now unreachable). The #32 row below describes the arrangement itself, unchanged |
| stories | the `PhonePrototype*` stories ARE the `Mobile*` stories now (no decorator): PairList `Mobile`, `MobileFiltersFromASheet`; PairDetail `Mobile` (also keeps the old Mobile's creditor checks: balance, Request Payment only), `MobileFiltersFromASheet`, `MobilePaymentsAreBlocks`, `MobileTheDebtorPays`, `MobileLimitChangesAreBlocks`. The old "live phone unchanged" `Mobile` assertions (no `data-layout`, ledger a `TABLE`) are gone |
| team filter (#33 leftover) | [chakra-first-whenever-it-has-the-component](../../technical/frontend/context_decision.md#chakra-first-whenever-it-has-the-component): the desktop team-type filter was a `NativeSelect`; it is `ChoiceFilter` (Chakra's composable `Select`, inline) — *All teams* as its placeholder, Warehouse / Selling as options, a pick's × back to all ([every-filter-clears-from-its-own-x](../../technical/frontend/context_decision.md#every-filter-clears-from-its-own-x)); URL `kind` unchanged. `ChoiceFilter` moved from `pages/products/components/` to `components/pickers/` (a second page uses it) with `description` and its own story `Components/Pickers/ChoiceFilter` (3 plays). Stories: PairList `TheTeamTypeFilterNarrowsAndClearsFromItsX`; `FiltersLiveInTheUrl` reads the trigger's text. The phone sheet keeps its `RadioPills` |
| e2e | no phone check: the suite has no phone-viewport pattern (one project, `Desktop Chrome`; the only `setViewportSize` widens a desktop) |
| checks | `npm run typecheck` ✅; `test:unit` 54/54; stories full run 2057 passed + 10 failed to LOAD ("Failed to fetch dynamically imported module" / browser connection closed on 6 files + order-create) → those 7 files alone 160/160; `e2e/liability.spec.ts` 5/5 (temporary config on :5195 — :5175 held by another project's dev server; deleted after) |

✅ **2026-11-07 (follow-up to the accept): the All tab, Make Payment is the debtor's, the shared parts; a phone
PROTOTYPE** — uncommitted.

| | |
| --- | --- |
| All tab | [the-team-balance-screens-are-accepted](../../technical/balance/team_balance_design_decision.md#the-team-balance-screens-are-accepted): *All* is the first tab and the default on `/liability/:id` — every movement of the pair in the ledger's order, *Balance after* on every row (`liability-detail-all`, `liability-detail-balance-after-<id>`); *Receivable* / *Payable* / payments / limit changes / terms unchanged. Tabs are `lazyMount unmountOnExit` now (All and the cuts draw the same entries) |
| #31 | [the-debtor-claims-the-creditor-decides](../../business/balance/context_decision.md#the-debtor-claims-the-creditor-decides): `LiabilityPaymentRecord` refuses a payer whose side of the pair is not negative (creditor, square, no row, float dust) — `FailedPrecondition`, *"your team owes this team nothing right now, so there is no payment to record — only the team that owes records a payment"* (the code `LiabilityPaymentRequestSend` uses for nothing owed). The balance row is read `FOR SHARE` in the claim's tx (`payerOwes`). Screen: Make Payment only while `signOfRupiah(balance) < 0` (desktop button and phone icon). Flow: [rpc.md](../../services/liability_service/rpc.md#only-the-debtor-records--and-only-while-it-owes) |
| #33 | the proof field is Chakra's `FileUpload` (trigger *Attach Proof* / *Attach Another*, `record-proof-pick`; hidden input `record-proof-input`) — `components/MakePaymentDialog.tsx`; the list's four tiles and the pair's three figures are `SummaryStrip`/`SummaryCard` (the pair's net figure leads, its direction the card's line: `liability-detail-balance` = the figure, `liability-detail-direction` = the words); every pager on both pages and `ChangeLogPanel` is `GrowingPager` (always on screen) — [a-list-summary-is-the-order-lists-card-strip](../../technical/frontend/context_decision.md#a-list-summary-is-the-order-lists-card-strip), [every-list-pages-with-the-growing-pager](../../technical/frontend/context_decision.md#every-list-pages-with-the-growing-pager), [chakra-first-whenever-it-has-the-component](../../technical/frontend/context_decision.md#chakra-first-whenever-it-has-the-component) |
| #32 ⚠ PROTOTYPE | phone layouts for both pages behind ONE gate, `features/liability/phonePrototype.tsx` (`LiabilityPhonePrototypeProvider`, mounted only by the `PhonePrototype*` stories; `useLiabilityPhoneLayout()` = `useIsMobile() && provider`). List: blocks (`PairBlock`), `FilterBar` sheet (team type as `RadioPills`, the two ticks), Default Terms as the header icon. Detail: one-row header, the position card across the row, date range in the sheet, seven tabs scrolling in one row (picked one kept in view), ledger / payments / limit changes as blocks (`phone` prop on `LiabilityLedgerTable`, `PaymentTable`, `ChangeLogPanel`). The live phone (`Mobile` stories) is unchanged. Screenshots 390 px: `D:/hermes/cache/scratch/balance_phone/01…09` (+ `10`, `11` desktop). On accept: delete the provider and read `useIsMobile()` |
| stub | `liabilityPaymentRecord` refuses a payer that owes nothing; the pair ledger and payment list are scoped to the asking team's pair (a third team read Melati's legs) |
| tests | Go: `TestPaymentRecord_TheCreditorCannotRecordAPayment`, `…_ASquarePairHasNothingToPay`, `…_TheCheckIsThisPairs` (mutation-checked); payment-list tests reseeded with debts; raceaudit `TestInterleave_RecordWaitsForTheConfirmThatSquaresThePair` (304 ms block, fails without `FOR SHARE`) and `…_RecordTwoClaimsDoNotQueue`. Stories: PairDetail `TheAllTabRunsTheWholeLedger`, `TheCreditorIsNotOfferedMakePayment`, `ASquarePairOffersNoPayment`, `PhonePrototype`, `…FiltersFromASheet`, `…PaymentsAreBlocks`, `…TheDebtorPays`, `…LimitChangesAreBlocks`; PairList `PhonePrototype`, `…FiltersFromASheet`; Ledger Table `TheWholeLedgerRunsRowToRow`, `OnAPhoneEachEntryIsABlock`; the payment stories now run as the debtor (Melati). e2e `liability.spec.ts`: All selected and the accepted payment's row (`+Rp 5.000`, balance after `−Rp 20.000`), the creditor refused (`failed_precondition`) and not offered Make Payment |
| perf / audit | the record gains one lookup on `liability_balances`' `(team_id, counterparty_id)` unique index — not heavy, no file; [lock-order.md](../../../audits/services/liability_service/concurrency/lock-order.md) row updated |
| still open | the list's search / team filter narrow only the loaded page of 20, the detail's date range only the loaded 50 rows; the list's desktop team filter is a `NativeSelect` (chakra-first) — not touched |

✅ **2026-11-07: prepared for review** (the `design_accept` gate — the owner has still not looked; nothing here is
accepted). No new feature; uncommitted. Screens, in viewing order, as Storybook stories — screenshots (desktop 1440,
phone 390) in `D:/hermes/cache/scratch/balance_review/` (scratch, not committed):

| screen | story | decisions it shows |
| --- | --- | --- |
| `/liability` pair list — tiles, rows, 80% / over / frozen badges, Default Terms | `Pages/Liability/PairList` Default, Mobile, BlockedAndFrozenTeamsAreBadgedUnlimitedIsNot | the-summary-is-tiles-on-the-list, the-threshold-warns-at-eighty-percent, the-threshold-defaults-to-unlimited, the-default-terms-row-is-a-dialog-on-the-list, a-creditor-may-request-payment |
| `/liability/:id` pair detail — position, 4 ledger cuts, Limit changes, Terms | `Pages/Liability/PairDetail` Default, Mobile; `Pages/Liability/Ledger Table` EveryCauseReadsInItsBusinessWords | the-pair-detail-shows-both-logs, the-ledger-speaks-the-business-words, terms-live-on-the-pair-detail |
| Make Payment (amount, Paid from, proof) · Accept Payment (Received into) · Reject Payment (reason) | PairDetail TheDebtorSeesTheRequest / TheCreditorCanOpenTheProof, driven by hand | the-debtor-claims-the-creditor-decides, a-payment-must-carry-proof, a-team-payment-posts-on-accept, an-accepted-payment-is-final |
| the debtor's side — Limit set on you, the request notice | PairDetail TheDebtorSeesTheLimitSetOnIt / TheDebtorSeesTheRequest | the-debtor-sees-the-limits-set-on-it, a-creditor-may-request-payment |
| the order form's Debt Limits at the limit | `Pages/Order/OrderCreate` ACreditorAtItsLimitSaysTheOrderIsRefused; `Features/Orders/CreditLimitPanel` AtTheLimitTheOrderIsRefused | over-the-limit-refuses-the-create, the-block-stops-orders-only |
| the warehouse daily statement (deferred, still served) | `Pages/Statements/DailyStatementPage` Warehouse (`!test`) | the-daily-report-is-deferred |
| the limit edit | PairDetail Terms tab → Edit Terms | a-limit-change-is-recorded, three-roles-edit-the-threshold |

`pages/balance/` (BalanceSheetPage) is NOT Team Balance — an accounting balance-sheet design mock with no route.

**Fixed in this pass** (each follows a decision): the stub served the pair ledger as slice `entry` (the oneof case is
`log` since two-logs-two-names), so every ledger tab drew EMPTY in Storybook — now `log`, the debtor reads the mirrored
legs, and `Default` asserts a row; positions had no oldest-unsettled day (the list read "Square" beside a 8.7m debt) —
fixtures now relative days, the pair ledger carries one row of every warehouse-pair cause with a running balance that
ties; the list's 80% badge uses `creditWarning` (one threshold), says *their next order is refused* when over, and a
FROZEN pair is badged (it was pinned unbadged — a limit of 0 refuses the next order); payment wording follows the
owner's lifecycle — Pending / Accept / Accepted (was Recorded / Confirm / Confirmed), the accept dialog says it is
final; `incidental_fee` reads *Courier at a restock* (was *Delivery costs*); stale *fee / markup* words gone from Terms;
Edit Terms names the team (was *Team #12*) and is pinned to the pair (it offered the default row on a pair page);
dates are the app's language and Jakarta time; empty payment tabs / limit log use `EmptyHint`; action buttons carry
icons; example placeholders on the payment note and the terms reason; the order form's Debt Limits row says *at the
limit — this order will be refused* when the committed debt is at or over the limit (or frozen); id *"{{count}}
dikonfirmasi"* (meant the opposite) fixed. New stories: PairList/PairDetail `Mobile`, Ledger Table
`EveryCauseReadsInItsBusinessWords`, CreditLimitPanel `AtTheLimitTheOrderIsRefused`, OrderCreate
`ACreditorAtItsLimitSaysTheOrderIsRefused`.

**Open, not fixed** (bigger than a wording fix): no phone arrangement on the list or the detail (tables squeezed and
clipped, six tabs overlap — a-phone-reads-each-line-as-a-block, a-phone-filters-from-a-sheet); tiles are `Stat`, not
the SummaryStrip (a-list-summary-is-the-order-lists-card-strip); `Pagination`, not `GrowingPager`; Make Payment is
offered to the CREDITOR and `LiabilityPaymentRecord` accepts a payment from a team that owes nothing
(the-debtor-claims-the-creditor-decides: never the creditor); the proof field is the browser's native file input
(chakra-first-whenever-it-has-the-component); the list's search and team filter narrow only the loaded page of 20; the
detail's date range filters only the loaded 50 rows; the daily statement still says *COD* and *Handling fees*
(the-ledger-speaks-the-business-words — left alone, the report is deferred). Owner question: the Receivable / Payable
cuts split by the SIGN of a movement, so a payment received and a reversal land under *Payable* and *Balance after*
skips rows — add an *All* tab with the full running ledger?

Checks 2026-11-07: `npm run typecheck` ✅; stories on the touched dirs ✅; `e2e/liability.spec.ts` ✅ 5/5 (before and
after the edits) — the RED note of 2026-10-14 below is stale.

✅ **2026-11-04: a transfer's courier charge posts** — uncommitted. `LIABILITY_SOURCE_TYPE_TRANSFER_FEE = 10`
(`transfer_fee`, `source_id` = the transfer) and `ChargeTransferCourier`
([transfer_courier_charge.go](../../../backend/services/liability_service/liability_v1/transfer_courier_charge.go)), fed by the
push handler's `WarehouseTransferAccepted` case on subscription `liability-warehouse-transfer-accepted`: the selling team owes
the RECEIVING warehouse, once per transfer, nothing for 0 or to oneself
([a-transfer-charge-is-a-transfer-fee](../../business/balance/context_decision.md#a-transfer-charge-is-a-transfer-fee)).
No migration (`source_type` has no CHECK). 4 unit + 2 push-handler tests, 2 race tests, perf 6 statements ~1.6 ms (FAST).
✅ Frontend follow-up done (verified 2026-11-07): the `TRANSFER_FEE` label is in `liability-detail/format.ts`,
`daily-statement/queries.ts` and en/id.json, beside `RETURN_INCIDENTAL_FEE`'s.

**Pass:** implementation of `balance_context.md`, end to end (2026-08-31). Everything the owner's doc
promises that has been DECIDED is now built, tested and documented.

**2026-10-01:** `LiabilityPaymentReverse` **removed** — [an-accepted-payment-is-final](../../business/balance/context_decision.md#an-accepted-payment-is-final).
RPC, handler, its 6 unit tests and its race test are gone; `REVERSED = 3` is `reserved` in the proto; no
schema change. ⚠ **New build work arrived from financial_account** and is NOT done: a payment must carry
`from_account_id` (payer, at record) and `to_account_id` (creditor, at accept), and accept must publish
them — [a-team-payment-posts-on-accept](../../business/financial_account/context_decision.md#a-team-payment-posts-on-accept).

**2026-10-08:** the account pickers are **built in the frontend, ahead of the contract** — *Paid from*
in Make Payment, *Received into* in a new `AcceptPaymentDialog` (it replaced the plain `ConfirmDialog`
on Confirm). Both are required, any active account of the acting team (not operational-only — settling
a debt is not an operation), and both are **`dropped`** pending marks (`pages/liability-detail/pending.ts`):
neither request has an account field, so the pick is thrown away. ⛔ **Still to do:** `from_account_id`
on `LiabilityPaymentRecordRequest`, `to_account_id` on `LiabilityPaymentConfirmRequest`, the columns,
and the accept event carrying both — then delete the two marks. The stub now serves Record, Confirm
(which moves the position) and ShareDocument, so the whole §Payment Flow is clickable in Storybook.
⛔ **A real bug was found and fixed on the way:** Make Payment could never be SENT from the screen —
the proof's file input is `required` and cleared after each upload, so the browser swallowed every
submit. The form is now `noValidate` (`ready` is its validation). The e2e never saw it because it
records payments through the RPC; `APaymentNamesTheAccountItWasPaidFrom` is the regression story.

**2026-10-14:** ✅ **the two account fields are WIRED** — the 2026-10-01 and 2026-10-08 *still to do* above is done.
`from_account_id` (required) on `LiabilityPaymentRecordRequest`, `to_account_id` (required) on
`LiabilityPaymentConfirmRequest`, both on `LiabilityPayment` and in migration `00009` (`NOT NULL DEFAULT 0`, the
pre-existing rows left at 0). Each is asked of financial_account_service **before** the write, under the caller's
token — `AccountChecker` → `FinancialAccountByIds` in `cmd/app_development/liability_deps.go`: the team's own,
active, never `unknown` (what the picker offers). Confirm publishes `LiabilityPaymentAccepted` after its commit
(`events.go`, the settlement pattern: a failed publish is logged, not retried). `pending.ts` and its i18n keys are
deleted; the Storybook stub refuses a missing account as the contract does. Flow:
[rpc.md](../../services/liability_service/rpc.md#where-the-money-left-and-where-it-landed--the-accounts).
`NewService(db, events, accounts)` — nil events is `EmptySender`, nil accounts refuses every named account.
✅ *(2026-11-07: green, 5/5 — the seed was rewritten to `RestockRequestCreate`/`Accept` + the pushed *Restock Accepted*.)*
⚠ **`e2e/liability.spec.ts` is RED on this branch, not from this change**: its seed step creates the COD debt
through `RestockRequestFulfill` with `quantity` and cost lines, and the restock rework (`723ab03`) replaced that
with `Arrive`/`Accept`, `count`, and a required `finance_account_id`. The payment test is updated for the account
fields but cannot run until the seed creates a debt the new way — that is the restock design's call. The full
path was proven instead by a one-off spec against the real server (both refusals, both ids stored, the listener
posting both legs once), then deleted. The dev database is migrated (liability_service `00009`, 2026-10-14); a
running `san dev run` needs a restart to serve the new code and to `pubsub ensure` the new subscription.

**2026-10-23:** ✅ **the ledger charges the frozen line totals**
([the-ledger-charges-the-frozen-line-total](../../technical/balance/team_balance_design_decision.md#the-ledger-charges-the-frozen-line-total)).
The product fee is Σ the owning team's `OrderPlacedLine.total`, rounded once on the sum (`order_fees.go`); liability
reads no markup and no terms for it. Migration `00010` drops `liability_terms.product_markup_bp` and the terms log's
`old_/new_product_markup_bp`, rebuilding the `liability_terms_non_negative` CHECK (the drop would have taken the whole
CHECK with it); the three proto fields are `reserved`. The terms dialog's markup pass-through, the stub's, the
fixtures' and the bridge e2e (*"editing terms does not wipe the cross-product markup"*) are gone. ⚠ The line total had
to be MADE first: the take returned it and `stockPicker` threw it away, so `StockPicker.Pick` now returns it and
selling `00023` freezes it on `order_items.total`. Tests: the fee per owner at two products' rates, an own line, a
fraction rounded once on the sum, and a catalog check that no markup column is left. The dev DB is migrated (liability
`00010`, selling `00023`), both Downs round-trip.

**2026-10-23:** ✅ **the debtor sees the limits set on it**
([the-debtor-sees-the-limits-set-on-it](../../technical/balance/team_balance_design_decision.md#the-debtor-sees-the-limits-set-on-it)).
`LiabilityCreditByIds` on `LiabilityService` (handler `liability_credit_by_ids.go`): `team_id` = the debtor (scope,
top-level), `filter.ids` = its creditors (1–50). One CREDIT item per creditor — `credit_limit` (optional), `debt`,
`state` — read through `CheckCredit`'s own `creditLimits` / `debtsToward`, with AT_LIMIT on `refusesCredit` (now the
one `debt >= limit` both use). Two queries for any number of creditors; 1,3 ms median at 10 000 terms rows — not heavy,
no audit file (`liability_credit_by_ids_perf_test.go`, `-tags perfaudit`). `GENERAL` names the creditors through a new
`TeamNamer` (`NewLiabilityTeamNamer` → `TeamByIds`, caller's token) — so it is now
`NewService(db, events, accounts, names)`, nil names = ids only. No schema change. Frontend: `useLiabilityCredit`
(plain default, reason in the hook) feeds the order form's Debt limits and the pair detail's `LimitSetOnYou` — shown
only when this team owes the counterparty or the counterparty set a limit on it, so the creditor's view is unchanged;
`CreditMeter` gained `setBy` for the debtor's wording. Flow:
[rpc.md](../../services/liability_service/rpc.md#the-debtors-side-of-a-limit--liabilitycreditbyids). Tests: 11 unit
(pair row over default, default, none = unlimited, the three states at their edges agreeing with `CheckCredit`, no debt
yet and frozen, a third team's limit never returned, self dropped, names, two queries for 50, validation); stories
`Features/Liability/CreditMeter`, `Features/Orders/CreditLimitPanel`, and one each on the create page and the pair detail.

**Lifecycle position:** `Run Testing` complete — unit, integration and e2e all green for the first
time. ⛔ **`design_accept` still un-previewed**: the owner has not looked at the running screens — prepared for review
2026-11-07 (top of this file).

> ⚠ **Read this first if you are picking the context up.** The business word is `balance`, the code
> word is `liability` — same thing. And since `0d4cbc4` *settlement* names a **different** service, so
> do not read `no-overdue-only-the-threshold`'s "no settlement cycle" as a statement about
> `settlement_service`.

## The owner's doc, requirement by requirement

| `context.md` says | state |
| --- | --- |
| §General 1–4 — team scope, two mirrored rows, per-pair grain, no overdue | ✅ |
| §Responsbility 1 — Manage Balance | ✅ |
| §Responsbility 2 — Serve Balance Daily Report | ⚠ **warehouse only.** The selling half is DEFERRED by decision, and the shipped page refuses non-warehouse teams |
| §Responsbility 3 — Manage Payments Across Team | ✅ record · confirm · **reject**, with proof readable by both sides. ⛔ **No reverse** — removed 2026-10-01 by [an-accepted-payment-is-final](../../business/balance/context_decision.md#an-accepted-payment-is-final) |
| §Payment Flow — claim with proof → check manually → accept / reject | ✅ **complete**, and covered end to end in e2e |
| §Payment lifecycle — pending → accept \| reject | ✅ both terminal states exist |
| §What Things Affect The Balance — all six causes | ✅ all post |
| §What Warehouse Can Receivable — `order_fee` · `cod_fee` · `found` | ✅ `cod_fee` is `incidental_fee` in the ledger |
| §What Warehouse Can Payable — `broken_good` · `lost_good` | ✅ |
| §Balance Policy 1 — threshold set by team owner, overridable by admin/root | ✅ and every change is **recorded** with actor, reason and override flag |
| §What Things Affect The Balance 3 — Cross/Shared Product | ✅ the CHARGE is balance's, the **rate is `product_service`'s** ([the-cross-markup-belongs-to-the-product](../../business/balance/context_decision.md#the-cross-markup-belongs-to-the-product)): the ledger posts the order lines' frozen totals and has no markup column of its own (2026-10-23, [the-ledger-charges-the-frozen-line-total](../../technical/balance/team_balance_design_decision.md#the-ledger-charges-the-frozen-line-total)) |
| §Balance Policy 2 — cross products compared to the committed pair row only | ✅ `CheckCredit` checks each creditor against **its own** pair row |
| §About Thresholds 1 — 80% warning on the balance screen | ✅ per-row badge on `/liability`, and — since 2026-10-23 — the DEBTOR's side on the pair detail and the order form ([the-debtor-sees-the-limits-set-on-it](../../technical/balance/team_balance_design_decision.md#the-debtor-sees-the-limits-set-on-it)). ⚠ the daily-report home is deferred with the report |
| §About Thresholds 2 — default unlimited, edited by owner/admin/root | ✅ including the **default row**, which had no home at all until this pass |

## What this pass built

| | |
| --- | --- |
| **payment reject** | proto value + `LiabilityPaymentReject` + migration `00007` (`reversal_reason` → `reason`) + a dialog with a required reason. It posts **nothing** — before it, a creditor could only leave a bad claim pending forever or confirm-then-reverse, writing two real ledger movements for money that never moved |
| **the creditor can SEE the proof** | the payer's upload half had shipped and the ids reached the client, but no screen showed them — so §Payment Flow's *"Team B check manually"* had nothing to look at. `PaymentProof` mints the signed URL on click |
| **Summarize ALL Balance** | three fields on `LiabilityPositionListResponse`. The tiles were a `rows.reduce` over one page of 20, so a creditor with 21 counterparties read a headline that omitted the 21st |
| **the 80% badge** | on `/liability`, worded from the creditor's side. Terms are read **beside** positions, never merged onto them |
| **the default terms row** | a dialog opened from the list. It had been settable **nowhere** in the running app since the terms screen was deleted |
| **the limit change log** | `liability_terms_logs` (migration `00008`), written inside the same transaction as the terms write. `LiabilityTermsHistoryList` had been returning `Unimplemented` |
| **`san_auth.GetCallerRole`** | the interceptor now carries the role it already resolved forward, so a write can record whether it was an **override** without a second membership lookup or a cross-service call |

## ✅ The verification gap is CLOSED — and it was hiding four real bugs

Every previous revision of this file said *"nothing below the contract is verified"*: Docker had never
run here, so `san_testdb` skipped every DB-backed test. Docker is up, **all 8 pending migrations are
applied**, and the tests execute. Four bugs surfaced immediately, none of them mine:

| | |
| --- | --- |
| 3 inventory tests | asserted the **pre-migration** vocabulary (`cod_fee`, `stock_damage`) against code that correctly writes `incidental_fee` / `broken_good` / `lost_good` |
| `TestShareDocument_AShareStopsTheDocumentBeingDeleted` | needed a **SAVEPOINT**. A constraint violation aborts the enclosing transaction and `san_testdb` gives the test one — so it reported *"the proof is gone"* for a document that was perfectly fine |
| 2 e2e specs | sent `RESTOCK_COST_KIND_COD_SHIPPING`, an enum value that no longer exists, without the now-required note |

⚠ **The lesson worth carrying:** a skipped test reports the same green as a passing one. Everything
below the contract had been "fine" for as long as nothing could run it.

## Testing

| layer | |
| --- | --- |
| unit | `go test ./...` green. 5 new tests for reject, 5 for the terms history, 3 for the summary |
| story | **1412 pass**, 0 fail. `/liability` had **no story file at all** — it has five now |
| e2e | `liability.spec.ts` **5 pass**, including §Payment Flow end to end with a real upload → PUT → confirm → share → reject → re-pay → accept |
| concurrency | ✅ **safe.** `TestRace_LiabilityPaymentConfirmAgainstReject` (8 callers alternating → 1 winner, status and balance tell the same story) and `TestInterleave_RejectBlocksBehindConfirm` — B blocked 305ms on A's lock and **re-read** the new status after acquiring it. The matrix is [audits/services/liability_service/concurrency/lock-order.md](../../../audits/services/liability_service/concurrency/lock-order.md) |
| performance | ✅ **fast, no file** (a report is only written for a HEAVY result). `LiabilityPositionList` over 500 counterparties: **6.7ms wall, 5 queries**, fixed regardless of row count — the summary added two queries, not an N+1. Kept as `position_list_perf_test.go` (`-tags perfaudit`) because its real assertion is that the query count cannot grow |

⚠ **`liability_balances` has only the `(team_id, counterparty_id)` unique index**, so both the row
ordering and the new oldest-lookup sort without one. Bounded by how many counterparties one team has —
teams, not customers — so it is not a problem now. It is the first thing to look at if it ever becomes
one.

## ⛔ Two of MY bugs that only RUNNING the app found

Every layer was green — 1412 story tests, the whole Go suite, 5 e2e — and both of these were still
there. They were found by calling the RPC against the dev server, in the space of two minutes.

| | |
| --- | --- |
| **a nil-pointer panic** | `req.Msg.GetFilter().CounterpartyId` — `GetFilter()` is nil-safe, the FIELD access after it is not, and a caller omitting the filter (*"every counterparty"*) is the ORDINARY call. Six tests missed it because they all passed a filter OBJECT with a nil field inside. ⚠ It is the only raw-field access in the service — every other site uses the nil-safe getter chain — and it was forced by `optional`, which has no nil-safe getter that can tell absent from 0 |
| **every log row stamped year 1** | GORM fills timestamps by NAME (`CreatedAt`/`UpdatedAt`) and the column is `changed_at`, so it inserted Go's zero time EXPLICITLY and the column's `DEFAULT NOW()` never fired. Worse than a wrong date: the list is `ORDER BY changed_at DESC`, so a table of identical zero timestamps orders by nothing. Six tests missed it because none of them looked at the timestamp |

**→ The lesson, and it is the same one as the skipped tests above:** a test asserts what somebody
thought to assert. Both of these are in the gap between *what the handler was tested for* and *what a
caller actually sends*. Each now has a regression test.

⚠ **The dev database has a default-terms row for team 13** (`counterparty_id = 0`, fee 15.000, no limit — its
20% markup went with the column in `00010`) and one log entry, left deliberately so the preview has something to look at. The one
row written before the timestamp fix was deleted.

## ✅ The e2e suite is GREEN — 100 pass, 2 skipped, 0 fail

It had **4 failures**, all pre-existing (proved by re-running them in a worktree at `62ac73b`, before
any of this work — they failed identically there). Fixing them revealed **6 more that had never run**:
the specs are `serial`, so a failure at the top stops everything below it.

| was failing | why | fix |
| --- | --- | --- |
| `restock.spec.ts:154` | asserted `product-list-item-ongoing-`, the **list** layout's testid — the picker asks for `layout="table"`, which renders its own cell | read the table testid |
| …then `product-picker-stock-scope` | that note is gone: the table says the scope with **named columns** and a sticky header | assert the column headers |
| `language.spec.ts:22` | asserted a `/products` **heading** that was deliberately removed (the breadcrumb already said it) | assert an in-page control instead — the test's real claim is that CONTENT translates |
| `statement.spec.ts:97` | asserted the *EXPECTED* notice, which belonged to the SELLING mode removed with `revenue_service` | dropped, with a note to restore it when the report returns |
| …then `statement.spec.ts` cost row | `OTHER_EXPENSES_CELL = 7`, counted for the **selling** column layout; warehouse mode draws 7 cells so `nth(7)` waited 60s for one that does not exist | **resolve the column from its header** — swapping 7 for 4 would only move the rot |
| `orders.spec.ts` accept flow | typed a COD amount with **no note**, and the note became unconditional when the cost kinds collapsed | fill the note |
| `orders.spec.ts` ×2 revenue | `/revenue` went with `revenue_service` and the route deliberately 404s | **`test.skip`**, not deleted — they are the spec of what must work when the deferred report returns |

⚠ **The two skips must be un-skipped in the same change that brings the selling report back**, exactly
like `DailyStatementPage.stories.tsx`'s `tags: ["!test"]`. A permanently skipped test is one nobody
reads again.

## What is left, and why

**Nothing in the doc is unimplemented for a reason other than a decision.** What remains is either
parked by the owner or waiting on an answer only they can give (HARD RULE 8):

| | |
| --- | --- |
| the selling team's daily report | ⛔ **deferred** ([the-daily-report-is-deferred](../../business/balance/context_decision.md#the-daily-report-is-deferred)). §Responsbility 2 goes on promising it |
| a dispute mechanism | ⛔ **[balance Q5](../../business/balance/context_clarify.md#question)**, and it is now **#3 in [biggest_question.md](../../biggest_question.md)** — refusing `found` a handshake made dispute a team's only recourse against a charge asserted in the asserter's favour |
| a chase instrument | [balance Q6](../../business/balance/context_clarify.md#question) — lowering the limit is still the only lever |
| an `order_id` filter on the log | [balance Q9](../../business/balance/context_clarify.md#question) — recommended, not decided |
| ~~`handling_fee` → `order_fee`~~ | ✅ moot *(2026-10-29)*: liability `00011` dropped the column (step 5 of [the-flat-rate-is-dropped-last](../../business/teams/warehouse/context_decision.md#the-flat-rate-is-dropped-last)), and Credit Terms no longer shows a fee |
| `offset` as a payment method · goods repayment | [technical Q2](../../technical/balance/team_balance_design_clarify.md#question) · [balance Q3](../../business/balance/context_clarify.md#question) — one question wearing two hats: is a payment ever non-cash? |

## The next agent's first move

**Ask the owner to preview the screens.** `design_accept` is the one gate this pass did not pass, and
it is the only thing between the balance context and done:

```sh
docker compose up -d
go run ./tools/san migrate up-all --dsn "postgres://user:password@localhost:5433/postgres?sslmode=disable"
cd backend && go run ./cmd/app_development     # :8080
cd frontend && npm run dev                     # :5174
```

`/liability` — the tiles, the badges, the Default Terms dialog. Click a row for the pair detail — the
five tabs, the proof links, Confirm and Reject.

**2026-11-02:** ✅ **the payment request is built** — [a-creditor-may-request-payment](../../business/balance/context_decision.md#a-creditor-may-request-payment).

| | |
| --- | --- |
| contract | `LiabilityPaymentService.LiabilityPaymentRequestSend` (creditor's owner and admin, `team_id` = the creditor); `LiabilityPaymentRequest`; `LiabilityPosition.payment_request` (5) |
| schema | liability `00012_payment_requests.sql` — one per pair, `amount > 0`, indexed by debtor |
| handlers | `payment_request_send.go` (upsert, FailedPrecondition when nothing is owed); `position_list.go` attaches the open request either way; `payment_record.go` deletes it in the payment's transaction |
| screens | pair detail: **Request Payment** (confirm, toast, then a muted line) and the debtor's warning (`PaymentRequestNotice`); list: a badge on the row. `useLiabilityPosition` reads one pair, `useRequestPayment` sends |
| tests | `payment_request_send_test.go`; stories `TheCreditorAsksADebtorToPay`, `TheDebtorSeesTheRequest`, `TheWarehouseAdminMayAskToPay`, `ARequestedPairIsMarked`. The stub now reads positions from the asking team's side (a debtor sees its pair with Gudang Pusat, mirrored) |
| dev DB | ⚠ **not migrated by this pass** — `go run ./tools/san migrate up --service liability_service` |

**2026-11-05:** ✅ **the liability daily view is on Jakarta days** — [the-liability-day-is-the-jakarta-day](../../business/balance/context_decision.md#the-liability-day-is-the-jakarta-day).

| | |
| --- | --- |
| handler | `liability_v1/liability_daily.go`: groups by `(created_at AT TIME ZONE 'Asia/Jakarta')::date`; `parsePeriod` reads both dates as Jakarta midnights (`jakarta`, fixed +7), so the half-open bounds are `[from 00:00 WIB, to+1 00:00 WIB)` |
| tests | `TestLiabilityDaily_AnAmountOwedBefore0700WIBLandsOnItsJakartaDay` (00:00 and 06:00 WIB on their WIB day, 23:59 WIB the evening before outside the period), `TestLiabilityDaily_TheLastDayOfThePeriodCountsInFull` moved to WIB times (23:30 WIB in, 00:05 WIB next day out — one UTC day); both red on the UTC code |
| perf | `liability_daily_perf_test.go` (`-tags perfaudit`): 1 query, 10.7 ms (31 days) / 30 ms (366 days) median at 50 000 legs for the team among 500 000; plan unchanged from the UTC grouping (bitmap on `liability_logs_pair_idx`, `team_id` prefix). Not heavy — [rpc.md](../../services/liability_service/rpc.md#bucketing--the-jakarta-day) |
| screens | none changed — the daily statement (`pages/daily-statement`) already sends Jakarta date strings |

## 2026-11-06 — the team-balance ledger is a double, frozen whole by `PostEntry` (money-type change, part 2)

[every-ledger-moves-to-double-rounded-when-frozen](../../business/order/context_decision.md#every-ledger-moves-to-double-rounded-when-frozen).

| | |
| --- | --- |
| schema | `liability_service` `00014_liability_money_is_double.sql` — 10 columns `BIGINT` → `double precision`: `liability_logs.amount` / `balance_after`, `liability_balances.balance`, `liability_payment_requests.amount`, `liability_payments.amount`, `liability_terms.credit_limit`, `liability_terms_logs.old_/new_credit_limit`, `old_/new_handling_fee`. Applied on `warehouse_test` (the harness re-applies every migration from scratch); not run on dev — `go run ./tools/san migrate up`. |
| wire | `liability.proto` — every position/credit/daily/summary figure and the `by_source` maps, `credit_limit` (`gte 0`, finite) ×3, `LiabilityPaymentRecordRequest.amount` (`gt 0`, finite); `LiabilityPaymentAccepted.amount` on the event |
| freeze | `PostEntry` is THE freeze point — refuses NaN/±Inf, `san_money.Whole`, then requires `> 0`; the order-fee, courier and stock-loss posters hand it doubles and skip a figure whose whole is ≤ 0. `LiabilityPaymentRecord` freezes the claim and refuses one under Rp 1; `LiabilityTermsSet` freezes a limit (`wholeLimit`) |
| tests | `TestPostEntry_RoundsAFractionOnceToWholeRupiah`, `TestPostEntry_RefusesAnAmountThatFreezesToNothingOrIsNotFinite`, `TestPaymentRecord_FreezesAFractionalClaimToWholeRupiah`; raceaudit `TestRace|TestInterleave` green |
| frontend | the liability pages, `CreditMeter` (whole-rupiah ratio from `wholeRupiah`), `ChangeLogPanel`, direction words take a `Rupiah`; the order form's credit panel takes the doubles through `wholeRupiah` (`figuresOf`) |
| MCP | `balance_positions` answers the figures as JSON numbers — asserted by `TestMCP_AnotherTeamIsRefusedThroughTheTool` |

## 2026-11-06 — the backend never rounds money ([the-backend-never-rounds-money](../../business/order/context_decision.md#the-backend-never-rounds-money))

Supersedes the *freeze* row above: `PostEntry` stores the posting EXACT — it refuses NaN/±Inf and anything not above 0
(`san_money.Positive`; float dust counts as 0) and no longer rounds. A 2,5% fee of Rp 12.666,99 posts Rp 316,67475 on
both legs (the screen shows Rp 316,675). `LiabilityPaymentRecord` stores the claim as typed (refuses one not above 0,
*"a payment must be more than Rp 0"*); `LiabilityTermsSet` stores a limit as set (`wholeLimit` is gone); the order-fee,
courier and stock-loss posters skip a figure that is not above 0. "Square" is a tolerance test in SQL
(`abs(balance) < 0.00005` in the `oldest_unsettled_at` CASE and `unsettled_only`), and `LiabilityPaymentRequestSend`
refuses "nothing owed" with `Positive`. Frontend: `CreditMeter`/`creditWarning`, `directionOf` and `ChangeLogPanel`
read the exact doubles with the server's 4-place tolerance (`isZeroRupiah` / `signOfRupiah`) — no `wholeRupiah`.
Tests `TestPostEntry_StoresAFractionExact`, `TestPostEntry_RefusesDustOrAnAmountThatIsNotFinite`,
`TestPaymentRecord_StoresAFractionalClaimExact`, `TestChargeOrder_TheFrozenFeeIsPostedExact`,
`TestChargeOrder_AFractionalTotalIsPostedExactOnTheSum`, the push transfer test (5.000,4).

**Found and fixed in the same pass — the order's fees never reached the ledger in a running app.** `register.go` mounted
the restock / return / transfer push routes but not `/event/liability-order-placed/push` or
`/event/liability-order-cancelled/push`, while `san pubsub ensure` declares both subscriptions: every *Order Placed*
push 404'd and dead-lettered (the e2e emulator's `order-placed.dlq.triage` held them), so no warehouse fee or product fee
was ever charged outside the unit tests, which call `ChargeOrder` directly. Both routes are mounted now (the same push
handler); test `TestRegister_TheOrderEventsReachTheLedger` drives them through the real mux. Orders placed on a dev
database before this fix have no fee entries — revamp has no real orders (revamp-has-no-real-orders-yet), so nothing is
backfilled; a dev DB's dead-lettered events can be redriven with `san pubsub redrive --topic order-placed`.
