# Development state — shop

**Pass:** business analysis — **second pass** (2026-09-28) on the owner's new
[shop/context.md](../../business/shop/context.md): create, edit, delete, list. Questions:
[context_clarify.md](../../business/shop/context_clarify.md). **Four owner decisions**, from the owner's own edits —
[access-is-given-per-user-per-shop](../../business/shop/context_decision.md#access-is-given-per-user-per-shop)
(*"give access user to shop"*, the built `shop_users` model), widened on 2026-09-29 by
[the-shop-manages-its-access-list](../../business/shop/context_decision.md#the-shop-manages-its-access-list)
(*"manage access user to shop"* — give, take away, list) · and the same day, from two new sections,
[a-shop-has-one-primary-cs](../../business/shop/context_decision.md#a-shop-has-one-primary-cs) (NOT built) and
[one-call-answers-the-shop-and-the-access](../../business/shop/context_decision.md#one-call-answers-the-shop-and-the-access)
(`ShopAccessCheck` for the importer — NOT built, and as written it has no `team_id`). **Plus ten 🏗 as-built decisions** in the same
[context_decision.md](../../business/shop/context_decision.md), recorded on the owner's instruction for a later
review — what the code does today, each linked to the clarify question that would change it. They close no
question. The lifecycle is at *waiting for the owner*; no Storybook prototype until the questions come back.

## What exists

| | |
| --- | --- |
| proto | `ShopService` in [selling.proto](../../../proto/warehouse/selling/v1/selling.proto) — `ShopCreate`, `ShopList`, `ShopDetail`, `ShopUpdate`, `ShopDelete` (soft), and shop access: `ShopUserList`, `ShopUserAdd`, `ShopUserRemove` |
| service | inside `backend/services/selling_service/` — `shops` and `shop_users` are its tables · `orders.shop_id` is a real FK to `shops` |
| frontend | `pages/shops`, `pages/shop-detail` (+ `ShopUsersSection`), `features/shops/ShopFormDialog`, `components/pickers/ShopSelect` |

## What the build gets wrong today — found in this pass, not fixed

| | where |
| --- | --- |
| a deleted shop is readable NOWHERE — `ShopList` and `ShopDetail` filter `deleted = false`, so the settlement report's by-shop ranking prints `#<id>` and the orders filter cannot pick it | `selling_v1/shop_list.go:25`, `shop_detail.go:24`, `pages/settlement-report/index.tsx:116` |
| `shop_users` is written and read by nothing else — no RPC or screen enforces a grant | `selling_v1/shop_user_*.go` |
| `ShopUpdate` lets the marketplace change on a shop with history | `selling_v1/shop_update.go`, `ShopFormDialog` |
| `ShopCreate` does not check the team is a SELLING team | `selling_v1/shop_create.go` |
| ⛔ `SettlementPost` opens a shop-addressed account under the CALLER's team on the first row, then checks the team — the first team to post claims the shop, and its real owner gets `errWrongTeam` after | `settlement_v1/post_entry.go:282-309` |
| `expense_service` stores any `shop_id` unvalidated | `expense_v1/expense_create.go:30` |
| a grant outlives its holder leaving the team, and `ShopUserAdd` accepts a user outside the team — nothing in `selling_service` hears of a membership change | `selling_v1/shop_user_add.go` |

## Open

| | |
| --- | --- |
| who may work on a shop, and what a grant gates | [shop Q1](../../business/shop/context_clarify.md#question) — re-routed from importer Q12 |
| is the shop its own service | [shop Q2](../../business/shop/context_clarify.md#question) — recommended now: its own `shop_service`. Absorbs architecture Q6 |
| close, not delete | [shop Q3](../../business/shop/context_clarify.md#question) — ripples into the importer's shop check |
| marketplace and team fixed at creation | [shop Q4](../../business/shop/context_clarify.md#question) |
| the shop's own name on the platform | [shop Q5](../../business/shop/context_clarify.md#question) |
| who can hold a grant — the team's members only, ended by leaving | [shop Q6](../../business/shop/context_clarify.md#question) — opened 2026-09-29 by *manage* access |
| the primary CS — its rules, and what the importer does with `primary_user_id` | [shop Q7](../../business/shop/context_clarify.md#question) — the importer doc's §How We Decide `user_id` is empty while the owner rewrites it |
| `ShopAccessCheck`'s contract — `team_id`, buf's message names, `Shop` not `ShopDetail` | [shop critique 10](../../business/shop/context_clarify.md#critique) — a build item once Q1 and Q2 are answered |

**Next agent:** when the owner answers, record each in `shop/context_decision.md` (named, RULE 12), delete the
answered question, rebuild `docs/biggest_question.md`. Q2 decides where every build item above lands, so it
goes first.
