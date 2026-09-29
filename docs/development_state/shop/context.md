# Development state — shop

**Pass:** business analysis on the owner's [shop/context.md](../../business/shop/context.md) — create, edit, delete,
list, manage access, a primary CS, and `ShopAccessCheck` for the importer. Questions:
[context_clarify.md](../../business/shop/context_clarify.md). Decisions:
[context_decision.md](../../business/shop/context_decision.md) — **seven owner decisions** and **ten 🏗 as-built
records** (one now superseded). The lifecycle is at *waiting for the owner* on Q3–Q6; no Storybook prototype yet.

## Decided

| decision | what it means for the build |
| --- | --- |
| [the-shop-gets-its-own-service](../../business/shop/context_decision.md#the-shop-gets-its-own-service) *(Q2)* | shops, shop access and `ShopAccessCheck` leave `selling_service` for a new `shop_service` · `orders.shop_id` loses its FK · supersedes the as-built `superseded-shops-live-in-selling-service` |
| [a-write-needs-a-grant-or-a-manager](../../business/shop/context_decision.md#a-write-needs-a-grant-or-a-manager) *(Q1)* | a grant, or the team's owner/admin role, gates `OrderCreate`, `OrderDraftPush`, `OrderDraftPromote` and both imports · reads stay team-wide · every current CS granted every shop of their team in the SAME release |
| [the-primary-cs-is-a-flag-on-a-grant](../../business/shop/context_decision.md#the-primary-cs-is-a-flag-on-a-grant) *(Q7)* | one flagged grant per shop · the first grant becomes it · Make primary moves it |
| [one-call-answers-the-shop-and-the-access](../../business/shop/context_decision.md#one-call-answers-the-shop-and-the-access) · [a-shop-has-one-primary-cs](../../business/shop/context_decision.md#a-shop-has-one-primary-cs) · [the-shop-manages-its-access-list](../../business/shop/context_decision.md#the-shop-manages-its-access-list) · [access-is-given-per-user-per-shop](../../business/shop/context_decision.md#access-is-given-per-user-per-shop) | from the owner's own edits |

## What exists — all still inside `selling_service`

| | |
| --- | --- |
| RPCs | `ShopCreate` · `ShopList` · `ShopDetail` · `ShopUpdate` · `ShopDelete` (soft) · `ShopUserList` · `ShopUserAdd` · `ShopUserRemove` — and, from f6dab3b (2026-09-29, the importer session): `ShopAccessCheck` (team-scoped, `is_have_access`), `ShopUserSetPrimary`, `OrderByExternalRefs` |
| tables | `shops` · `shop_users` (+ `is_primary`, migration 00014, backfilled from each shop's earliest grant) · `orders.shop_id` is a real FK to `shops` |
| callers | settlement and the importer each own an interface for the shop, adapted at the composition root with a Connect client — so the move to `shop_service` changes those adapters only |
| frontend | `pages/shops`, `pages/shop-detail` (+ `ShopUsersSection`), `features/shops/ShopFormDialog`, `components/pickers/ShopSelect` |

## Decided, not built

| | |
| --- | --- |
| **the move** | `backend/services/shop_service/` (HARD RULE 2) · proto `warehouse.shop.v1` (my spec) · ⚠ how existing rows move — which migration creates the tables, the copy, when `selling_service` drops its copy — is **not designed**: no `docs/technical/shop/` exists |
| **the write gate** | the three order RPCs and both imports call `ShopAccessCheck` · `ShopSelect` on the order form offers only writable shops · **the rollout backfill in the same release** |

## What the build gets wrong today — found, not fixed

| | where |
| --- | --- |
| a deleted shop is readable NOWHERE — `ShopList`, `ShopDetail` and `ShopAccessCheck` all answer as if it never existed, so a closed shop's last statements cannot be imported (Q3) | `selling_v1/shop_list.go`, `shop_detail.go`, `shop_access_check.go` |
| `ShopUpdate` lets the marketplace change on a shop with history (Q4) | `selling_v1/shop_update.go`, `ShopFormDialog` |
| `ShopCreate` does not check the team is a SELLING team (critique 4) | `selling_v1/shop_create.go` |
| ⛔ `SettlementPost` opens a shop-addressed account under the CALLER's team on the first row — the first team to post claims the shop (critique 6) | `settlement_v1/post_entry.go:282-309` |
| `expense_service` stores any `shop_id` unvalidated (critique 6) | `expense_v1/expense_create.go:30` |
| a grant outlives its holder leaving the team, and `ShopUserAdd` accepts a user outside it (Q6) | `selling_v1/shop_user_add.go` |

## Open

| | |
| --- | --- |
| close, not delete | [shop Q3](../../business/shop/context_clarify.md#question) — ⛔ before the importer ships: the built check refuses a deleted shop |
| marketplace and team fixed at creation | [shop Q4](../../business/shop/context_clarify.md#question) — cheapest during the move |
| the shop's own name on the platform | [shop Q5](../../business/shop/context_clarify.md#question) — cheapest during the move |
| who can hold a grant — members only, ended by leaving | [shop Q6](../../business/shop/context_clarify.md#question) — real access now that grants gate writes |

**Next agent:** when the owner answers, record it in `shop/context_decision.md` (named, RULE 12), delete the answered
question, rebuild `docs/biggest_question.md`. Another session (the importer's) builds shop code — check `git log`
and message it before changing shop files it touches.
