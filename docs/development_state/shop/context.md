# Development state — shop

**Pass:** business analysis on the owner's [shop/context.md](../../business/shop/context.md) — create, edit, delete,
list, manage access, a primary CS, and `ShopAccessCheck` for the importer. Questions:
[context_clarify.md](../../business/shop/context_clarify.md). Decisions:
[context_decision.md](../../business/shop/context_decision.md) — **seven owner decisions** and **ten 🏗 as-built
records** (one now superseded). 🔄 2026-11-06: the close (a shop is closed, never deleted) is decided, its prototype
accepted and built — [below](#a-shop-is-closed-never-deleted--close-shop-built-2026-11-06); every read filter offers
closed shops too — [below](#report-filters-offer-closed-shops--built-2026-11-06).

## Decided

| decision | what it means for the build |
| --- | --- |
| [the-shop-gets-its-own-service](../../business/shop/context_decision.md#the-shop-gets-its-own-service) *(Q2)* | shops, shop access and `ShopAccessCheck` leave `selling_service` for a new `shop_service` · `orders.shop_id` loses its FK · supersedes the as-built `superseded-shops-live-in-selling-service` |
| [a-write-needs-a-grant-or-a-manager](../../business/shop/context_decision.md#a-write-needs-a-grant-or-a-manager) *(Q1)* | a grant, or the team's owner/admin role, gates `OrderCreate` (a draft's Promote included), `OrderDraftPush` and both imports · reads stay team-wide · every current CS granted every shop of their team in the SAME release |
| [the-primary-cs-is-a-flag-on-a-grant](../../business/shop/context_decision.md#the-primary-cs-is-a-flag-on-a-grant) *(Q7)* | one flagged grant per shop · the first grant becomes it · Make primary moves it |
| [one-call-answers-the-shop-and-the-access](../../business/shop/context_decision.md#one-call-answers-the-shop-and-the-access) · [a-shop-has-one-primary-cs](../../business/shop/context_decision.md#a-shop-has-one-primary-cs) · [the-shop-manages-its-access-list](../../business/shop/context_decision.md#the-shop-manages-its-access-list) · [access-is-given-per-user-per-shop](../../business/shop/context_decision.md#access-is-given-per-user-per-shop) | from the owner's own edits |

## What exists — all still inside `selling_service`

| | |
| --- | --- |
| RPCs | `ShopCreate` · `ShopList` · `ShopDetail` · `ShopUpdate` · `ShopClose` · `ShopReopen` (2026-11-06, replacing `ShopDelete`) · `ShopUserList` · `ShopUserAdd` · `ShopUserRemove` — and, from f6dab3b (2026-09-29, the importer session): `ShopAccessCheck` (team-scoped, `is_have_access`), `ShopUserSetPrimary`, `OrderByExternalRefs` |
| tables | `shops` (`status` + `closed_at` since selling `00043`, replacing `deleted`) · `shop_users` (+ `is_primary`, migration 00014, backfilled from each shop's earliest grant) · `orders.shop_id` is a real FK to `shops` |
| callers | settlement and the importer each own an interface for the shop, adapted at the composition root with a Connect client — so the move to `shop_service` changes those adapters only |
| frontend | `pages/shops`, `pages/shop-detail` (+ `ShopUsersSection`), `features/shops/ShopFormDialog`, `components/pickers/ShopSelect` · from c9c1861 (2026-09-29): the **Primary CS** badge, **Make primary** on every other granted user, a *No primary CS* warning on the shop page and a badge on `/shops` — covered by `e2e/shops.spec.ts`, and accepted as built by the owner ([the-screens-as-built-are-accepted](../../business/settlement/settlement_importer_decision.md#the-screens-as-built-are-accepted)) |
| the list's filters *(2026-11-04, #16)* | `ShopListFilter` gained `marketplace`, `primary_user_id`, `no_primary` (a person and nobody at once → InvalidArgument); `/shops` sends its marketplace / primary CS / *No primary CS* picks and their ⚠ marks, `pages/shops/pending.ts` and the `shops.pending` i18n keys are gone. Tests: `TestShopList_FiltersByMarketplacePrimaryAndNoPrimary`, `TestShopList_PrimaryAndNoPrimaryTogetherIsInvalid`, perf `TestPerf_ShopListFilters` (fast), stories `TheMarketplaceFilterNarrowsTheList` · `ThePrimaryFilterNarrowsTheList` · `NoPrimaryCsNarrowsTheList`, e2e *Filters: marketplace, primary CS and no primary CS narrow the list (#16)*. Uncommitted |

## Decided, not built

| | |
| --- | --- |
| **the move** | `backend/services/shop_service/` (HARD RULE 2) · proto `warehouse.shop.v1` (my spec) · ⚠ how existing rows move — which migration creates the tables, the copy, when `selling_service` drops its copy — is **not designed**: no `docs/technical/shop/` exists |
| **the write gate** | ✅ built for the order writes 2026-11-05 (below) — both statement imports (f163139) and now `OrderCreate` (a draft's Promote included), `OrderDraftPush` and `OrderDraftUpdate` setting a shop refuse without a grant or a manager role; the order form's and the statement import's `ShopSelect` offer only writable shops · ✅ **the rollout grant** built 2026-11-05 as `san shop grant-current-cs` (below) — ⚠ **the release that ships the gate MUST run it** on that database (`--dry-run` first, then for real), or every CS without a grant loses order-taking on day one |

## What the build gets wrong today — found, not fixed

| | where |
| --- | --- |
| ~~a deleted shop is readable only through `ShopAccessCheck`~~ ✅ fixed 2026-11-06 by the close: `ShopList` `status` lists closed shops on asking, `ShopDetail` reads one, the import dialog offers it ([below](#a-shop-is-closed-never-deleted--close-shop-built-2026-11-06)) | `selling_v1/shop_list.go`, `shop_detail.go` |
| `ShopUpdate` lets the marketplace change on a shop with history (Q4) | `selling_v1/shop_update.go`, `ShopFormDialog` |
| `ShopCreate` does not check the team is a SELLING team (critique 4) | `selling_v1/shop_create.go` |
| ⛔ `SettlementPost` opens a shop-addressed account under the CALLER's team on the first row — the first team to post claims the shop (critique 6) | `settlement_v1/post_entry.go:300-332` |
| `lockShop` takes `FOR UPDATE`, which the orders FK's `KEY SHARE` conflicts with — a grant change waits for every order being placed on the shop, and they wait for it. `FOR NO KEY UPDATE` is proved to fix it ([the-lock-no-grep-finds](../../../audits/services/selling_service/concurrency/lock-order.md#the-lock-no-grep-finds)) | `selling_v1/service.go` `lockShop` |
| `ShopUserRemove` takes no shop lock, so Make primary's grant check can go stale. The set-must-land check (a96a491) keeps the answer true; the lock-level fix is open ([ShopUserSetPrimary](../../../audits/services/selling_service/concurrency/ShopUserSetPrimary.md)) | `selling_v1/shop_user_remove.go` |
| `expense_service` stores any `shop_id` unvalidated (critique 6) | `expense_v1/expense_create.go:30` |
| ~~a grant outlives its holder leaving the team, and `ShopUserAdd` accepts a user outside it (Q6)~~ 🔄 fixed: the `MemberRemoved` listener drops a leaver's grants, and since 2026-11-04 `ShopUserAdd` and `ShopUserSetPrimary` refuse a non-member or a suspended account (FailedPrecondition, by user id) through `RoleReader.Member` — user_service's cached resolver, no join. A residual cross-service window is written up: [ShopUserAdd](../../../audits/services/selling_service/concurrency/ShopUserAdd.md) | `selling_v1/shop_user_add.go`, `shop_user_set_primary.go`, `role_reader.go` |

## Open

| | |
| --- | --- |
| ~~close, not delete~~ | ✅ decided ([a-shop-is-closed-never-deleted](../../business/shop/context_decision.md#a-shop-is-closed-never-deleted)) and built 2026-11-06 ([below](#a-shop-is-closed-never-deleted--close-shop-built-2026-11-06)) |
| marketplace and team fixed at creation | [shop Q4](../../business/shop/context_clarify.md#question) — cheapest during the move |
| the shop's own name on the platform | [shop Q5](../../business/shop/context_clarify.md#question) — cheapest during the move |
| who can hold a grant — members only, ended by leaving | [shop Q6](../../business/shop/context_clarify.md#question) — real access now that grants gate writes |

**Next agent:** when the owner answers, record it in `shop/context_decision.md` (named, RULE 12), delete the answered
question, rebuild `docs/biggest_question.md`. Another session (the importer's) builds shop code — check `git log`
and message it before changing shop files it touches.

### a-grant-goes-only-to-a-team-member
🔄 Built 2026-11-04 — `ShopUserAdd` and Make primary (`ShopUserSetPrimary`) refuse a person outside the shop's team, and a suspended or erased one (`refuseUngrantable`, `selling_v1/role_reader.go`); the grant picker offers only active members (`UserList` `exclude_suspended`). Tests: `shop_user_add_test.go`, `shop_user_set_primary_test.go`, `cmd/app_development/role_reader_test.go`, `e2e/shops.spec.ts` "a person outside the shop's team is refused a grant".

### a-write-needs-a-grant-or-a-manager — the order writes (2026-11-05)
🔄 Built 2026-11-05 — `refuseShopWrite` (`selling_v1/shop_write_gate.go`) asks `shopAccess`, the body `ShopAccessCheck` now
shares, in-process: `placeOrder` (OrderCreate + Promote) before the take, `OrderDraftPush` with a shop, `OrderDraftUpdate`
setting one. Refusals: another team's → NotFound · deleted → FailedPrecondition *"<shop>: the shop is closed"* · no grant and no
manager role (incl. no identity) → PermissionDenied *"You have no access to <shop> — ask the team's owner or admin for it"*.
`ShopListFilter.writable` (field 5) feeds `ShopSelect writable` on the order form (the draft page is the same form) and the
statement `ImportFileDialog`; filters still list every shop. Not gated (outside the decision's list — open question): the
order imports and the hand moves. Tests: `shop_write_gate_test.go` (5), `shop_access_check_test.go`
`…ADeletedShopIsAnsweredFlagged`, stories `ShopSelect` *WritableOffersOnlyTheGrantedShops* · *WritableClearsAShopThePersonMayNotWriteOn*
· *WritableOffersAManagerEveryShop*, e2e `writes_need_a_shop_grant.spec.ts`. Perf: `ShopList` writable was heavy by plan only
([ShopList.md](../../../audits/services/selling_service/performances/ShopList.md) — 🔄 fixed by selling `00039`, below).
Test fakes: `everyoneMayWrite` (selling_v1) and `runsEveryShop` (cmd/app_development) answer the team's owner, so order tests
about something else need no grant. ✅ The close (`status`, Close/Reopen, the closed filter) built 2026-11-06 — below.

### a-write-needs-a-grant-or-a-manager — the rollout grant (2026-11-05)
✅ Built 2026-11-05 — `san shop grant-current-cs [--dry-run]` (`tools/san/shop.go`, [san.md](../../tools/san.md#shop-grant-current-cs)).
⚠ **RELEASE STEP: the release that turns the gate on runs it against its database** — dry, then real — in the same deploy.
For every live selling team (team_service `TeamList`), its current CS (user_service `UserList`, `exclude_suspended`, role CS)
get every live shop (`ShopList`) they do not hold (`ShopUserList`), each through `ShopUserAdd` — so `refuseUngrantable` and the
primary rule apply: an existing primary is untouched, a shop with none gets the lowest-id CS granted (the line says so).
Idempotent; refuses a DSN without the schema. Dev DB run 2026-11-05: 3 teams, 1 CS, 4 live shops — 1 grant added (sutoni on
shoshoseee, its first primary); the re-run added 0, skipped 1. Tests `tools/san/shop_test.go` (two teams + a deleted one,
owner/admin/suspended CS, a deleted shop, an existing grant: dry run = real run, idempotent, unmigrated DB refused).
`ShopList` writable: `shop_users_user_shop_idx (user_id, shop_id)` (selling `00039`) — the HEAVY plan is fixed
([ShopList.md](../../../audits/services/selling_service/performances/ShopList.md)).

### a-closed-shop-refuses-only-new-selling — the ShopAccessCheck half (2026-11-05)
🔄 Built 2026-11-05 — `ShopAccessCheck` answers a deleted shop with `deleted = true` (NotFound only for another team's or a
missing one); the settlement importer and settlement's primary-CS lookup accept it; the order writes refuse it; financial
account's `ShopOfTeam` still refuses it (adapter). ✅ The `status`/Close model built 2026-11-06 — below; `deleted` is gone.

### close-a-shop — Storybook prototype (2026-11-06, backlog #21b)
✅ **Accepted** ([the-close-shop-prototype-is-accepted](../../business/shop/context_decision.md#the-close-shop-prototype-is-accepted))
**and built the same day** — the story-only `ShopClosePrototypeProvider` / `closePrototype.tsx` seam is gone; the screens
below are the app's. The table is the accepted design, kept as the record.

| screen | under the prototype | decision |
| --- | --- | --- |
| `/shops` | status filter *Open shops* (default, not counted) · *Closed shops* · *All shops*, URL `status` · a *Closed · date* badge under a closed shop's name · **Close** in Delete's place (ConfirmDialog: what stops, what keeps working, the code freed, a no-primary-CS warning) · **Reopen** on a closed row, no Edit, the primary CS ⋯ kept · no Delete | [a-shop-is-closed-never-deleted](../../business/shop/context_decision.md#a-shop-is-closed-never-deleted), [a-closed-shop-locks-all-but-its-grants](../../business/shop/context_decision.md#a-closed-shop-locks-all-but-its-grants) |
| `/shops/:id` | **Close Shop** in Delete's place; a closed shop: *Closed* badge on the title row, an info banner (closed on, what it still does), **Reopen Shop** alone, access panel still editable, no account link offered | [a-closed-shop-locks-all-but-its-grants](../../business/shop/context_decision.md#a-closed-shop-locks-all-but-its-grants), [a-closed-shop-takes-no-new-account-link](../../business/shop/context_decision.md#a-closed-shop-takes-no-new-account-link) |
| statement import dialog | `ShopSelect withClosed` offers the writable closed shops after the open ones, badged; a picked one says its statements still import | [a-closed-shop-refuses-only-new-selling](../../business/shop/context_decision.md#a-closed-shop-refuses-only-new-selling) |
| order form (`MarketplaceInfoForm`) | `ShopSelect writable` — never offers a closed shop | same |
| reopen refused | while an open shop of the team holds the code, naming it | [a-shop-code-is-unique-among-open-shops](../../business/shop/context_decision.md#a-shop-code-is-unique-among-open-shops) |

**Backend step (decided, not built):** `shops.status` (`open` · `closed`) + `closed_at` replacing `deleted` (deleted rows become
closed, `closed_at = updated_at`), the partial unique index on `status = 'open'`; `ShopClose` / `ShopReopen` (owner, admin, root,
administrator — ShopDelete's policy) replacing `ShopDelete`; `Shop.status`/`closed_at_unix`; `ShopListFilter.status`
(open default); `ShopDetail` and the grant RPCs (`shopExists`/`lockShop`) answering a closed shop; `ShopUpdate` refusing it
(*"reopen the shop first"*); `refuseShopWrite` and financial_account's `ShopOfTeam` reading `status` instead of `deleted`;
every label/filter read (`useShopOptions` callers, `ShopByIds`) naming a closed shop, marked. Found while scoping: a draft on a
closed shop opened in the order form has its shop silently CLEARED by `ShopSelect writable` (it is not in the writable list), so
CS could re-point it at another shop — against [a-close-leaves-the-drafts-waiting](../../business/shop/context_decision.md#a-close-leaves-the-drafts-waiting)
(the ways out are delete or reopen); the form should keep it, badged, with Create refused. The *Open* table above is stale:
Q3–Q6 were answered 2026-10-19.

### a-shop-is-closed-never-deleted — Close Shop built (2026-11-06)
✅ Built 2026-11-06 — the accepted prototype, live. Uncommitted.

| | |
| --- | --- |
| migration | selling `00043_shop_status_replaces_deleted`: `status` (`open`·`closed`, CHECK `shops_status_known`) + `closed_at` (CHECK `shops_closed_at_when_closed`); every deleted shop → closed at its `updated_at`; `deleted` dropped; `shops_team_code_open_unique … WHERE status = 'open'`, `shops_team_status_idx (team_id, status)`. ⚠ the fill renames no code — a deleted shop whose code was since reused reopens only after one is renamed (the reopen refusal says which) |
| proto | `ShopStatus` enum; `Shop.status = 9`, `closed_at_unix = 10` (field 7 `deleted` reserved); `ShopListFilter.status = 6` (`ShopListStatus`: UNSPECIFIED = open, OPEN, CLOSED, ALL); `ShopClose` / `ShopReopen` (owner, admin, root, Administrator); `ShopDelete` removed |
| backend | `shop_close.go`, `shop_reopen.go` (idempotent, `lockShopRow` FOR NO KEY UPDATE, reopen refused naming the open holder of the code) · `ShopUpdate` refuses a closed shop *"reopen the shop first"* · `ShopDetail`, `ShopAccessCheck`, the grant RPCs answer it · `refuseShopWrite` + `refuseClosedShopInTx` (FOR SHARE inside `placeOrder`) refuse new selling · the order imports accept it · financial_account `ShopOfTeam` → NotFound on `SHOP_STATUS_CLOSED` · `san shop grant-current-cs` reads `ShopList` OPEN |
| frontend | `features/shops/status.ts`, `queries.ts` (`useShops`/`useShopOptions` status — name lookups read ALL, so a closed shop is still named; `useCloseShop`/`useReopenShop`; `useDeleteShop` gone) · `ShopSelect` open by default, `withClosed` (statement import, expense, order import) and `keepClosed` (the order form: a waiting draft's closed shop kept, badged) · the order form holds Create with an alert naming the closed shop (`orderForm.shopClosed`) · `/shops` and `/shops/:id` Close/Reopen, no Delete · i18n `shops.delete*` removed |
| tests | `shop_close_test.go`, `shop_reopen_test.go`, `shop_status_migration_test.go`, additions in `shop_update/detail/user/list/write_gate/access_check/shopee_order_import` tests · race `shop_close_race_test.go` (4, mutation-checked) · perf `TestPerf_ShopClose` / `TestPerf_ShopReopen` / `TestPerf_ShopListFilters` — all fast · stories `Pages/Shops/CloseShop` (the *TheLive…* stories now pin the live Close), `ShopSelect` (+3), `OrderCreate` *ADraftOnAClosedShopKeepsItAndRefusesCreate*, shops/shop-detail close stories · e2e `shops.spec.ts` (Close/Reopen replaced Delete), `the_closed_shop.spec.ts` (its own team: close → not offered, a statement still imports, reopen → offered), `writes_need_a_shop_grant.spec.ts` (ShopClose) |
| docs | [selling rpc.md](../../services/selling_service/rpc.md#a-shop-is-closed-never-deleted--shopclose-and-shopreopen-2026-11-06) · [database-schema.md](../../database-schema.md) · [lock-order](../../../audits/services/selling_service/concurrency/lock-order.md) · [ShopList.md](../../../audits/services/selling_service/performances/ShopList.md) |

### report-filters-offer-closed-shops — built (2026-11-06)
✅ Built 2026-11-06 ([report-filters-offer-closed-shops](../../business/shop/context_decision.md#report-filters-offer-closed-shops)).
Uncommitted. Frontend only: every read filter already sent a plain `shop_id` (no RPC checks the shop's status on a read),
so a closed shop's rows were reachable by the API and only the pickers hid it.

| | |
| --- | --- |
| `ShopSelect asFilter` | a read filter's picker: the closed shops after the open ones, badged *Closed* (`withClosed`'s list), and a PICKED closed shop keeps its *Closed* badge in the field (`shop-select-value-closed`) — on a filter nothing else says the shop is closed. `withClosed` / `keepClosed` (the writes) show no field badge, so the accepted write dialogs are unchanged |
| filters now `asFilter` | Orders (`SellerOrders` — every non-warehouse team, with the marketplace narrowing; `WarehouseOrders` carries the flag too, though a warehouse is never shown the shop filter) · Returns · Order Settlement · Statement Imports list · Analytic (the composer's shop filter — a `ShopSelect`, not an `EntityFilter` chip; `EntityFilter` is product/supplier only) · Financial Accounts list |
| unchanged — writes | the order form / a draft (`MarketplaceInfoForm`: open only, `keepClosed` for a waiting draft) · an account's *Link Shop* (`ShopLinks`: open only — [a-closed-shop-takes-no-new-account-link](../../business/shop/context_decision.md#a-closed-shop-takes-no-new-account-link)) · statement import, expense, order import (`withClosed`, as accepted) |
| no shop filter (names only) | settlement report, account report, account detail, order drafts, expenses, order detail, pick queue — they name a row's shop through `useShopOptions` (status ALL) / `ShopByIds`, which already name a closed shop |
| tests | stories `ShopSelect` *AsFilterOffersTheClosedShopsLastAndBadgesAClosedPick*, *WithClosedShowsNoBadgeInTheField* · `SellerOrderListPage` *TheShopFilterOffersAClosedShopLastBadged* (mutation-checked: fails without `asFilter`) · `Analytic/Composer` *TheShopFilterOffersAClosedShopLastBadged* (`shop=22` in the URL) · `FinancialAccount/Accounts` *TheShopFilterOffersAClosedShopLastBadged* · e2e `the_closed_shop.spec.ts` now seeds a warehouse with stock and places one order on each shop while open; after the close, *the Orders filter still offers it after the open shop, badged — and shows its orders* (URL `shop=`, one row, the field badge) |
