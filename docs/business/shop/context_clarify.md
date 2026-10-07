# Clarify — `shop/context.md`

What I read out of [context.md](./context.md), and what has to be settled beside it. **That doc is yours — this
one is mine.** An answered point is deleted; what you settled is in [context_decision.md](./context_decision.md).

🔄 **Second pass, 2026-09-28 — the whole doc, read against the build.** The first pass carried importer Q12 across
and asked where the shop lives. Everything §Responsbility lists already ships, so what is open is what the doc
does not say: **where the shop lives, what *delete* does to its history, what is fixed at creation, and what
other services may ask it.**

| | |
| --- | --- |
| 🔄 narrowed (2026-10-06) | [Q6](#question) — *leaving the team ends a grant* was decided in the user context and is built ([removing-a-member-drops-their-shop-access](../user/context_decision.md#removing-a-member-drops-their-shop-access)); left: may a grant be made to a non-member (recommend no) |
| 🔄 elaborated (2026-10-01) | [Q3](#question) — five parts: close only · only new selling refused · waiting drafts stay · the code unique among **open** shops (🔄 my *reserved* revised) · grants stay editable. ⛔ Checked against the code: **four built sites refuse a deleted shop**, and a fifth is being built — financial_account's *Point a shop here* ([A shop's life](#a-shops-life--q3)) |
| ✅ answered (2026-09-29) | [Q2](#question) — its own `shop_service`: [the-shop-gets-its-own-service](./context_decision.md#the-shop-gets-its-own-service). ⚠ `ShopAccessCheck` and the primary CS were built into `selling_service` an hour earlier (f6dab3b) — they move with the shop |
| ✅ answered (2026-09-29, later) | [Q7](#question) — the primary CS is a flag on one of the shop's grants: the first grant becomes it, the owner or admin moves it, removing that grant leaves none — [the-primary-cs-is-a-flag-on-a-grant](./context_decision.md#the-primary-cs-is-a-flag-on-a-grant) · ✅ `ShopAccessCheck` built as [critique 10](#critique) recommends (f6dab3b) |
| ✅ answered (2026-09-29) | [Q1](#question) — a write needs a grant for the shop, or the team's owner or admin role · reads stay team-wide · every current CS is granted on rollout: [a-write-needs-a-grant-or-a-manager](./context_decision.md#a-write-needs-a-grant-or-a-manager) |
| ✅ your edits | §Responsbility gained *"give access user to shop"* (2026-09-28), then made it *"manage access user to shop"* (2026-09-29) — recorded as [access-is-given-per-user-per-shop](./context_decision.md#access-is-given-per-user-per-shop) and [the-shop-manages-its-access-list](./context_decision.md#the-shop-manages-its-access-list) |
| 🆕 +1 (2026-09-29) | [Q6](#question) — *manage* includes seeing who has access, and the list keeps people who left the team |
| ✅ your sections (2026-09-29) | §Manage User Access In Shop and §Rpc That Must Exist — recorded as [a-shop-has-one-primary-cs](./context_decision.md#a-shop-has-one-primary-cs) and [one-call-answers-the-shop-and-the-access](./context_decision.md#one-call-answers-the-shop-and-the-access) |
| 🆕 +1 | [Q7](#question) — the primary CS: its rules, and what the importer does with `primary_user_id` · ⛔ [critique 10](#critique) — `ShopAccessCheck` as written has no team, so a CS cannot call it |
| 🔄 withdrawn | `ShopByIds` — your `ShopAccessCheck` is the call other services need ([critique 6](#critique)), and `ShopList` with a status filter covers labels |
| 🔄 corrected | critique 3 said a deleted shop *stays readable* — nothing can read it, and a closed shop still has payouts coming |
| 🆕 +3 | [Q3](#question) close, not delete · [Q4](#question) marketplace and team fixed · [Q5](#question) the shop's own name on the platform |
| ➡ moved here | [architecture Q6](../../technical/architecture/context_clarify.md#question) — *team_service or order_service?* — is Q2, asked earlier. ✅ Answered with it |
| ⛔ found | settlement opens a shop's account under **whichever team posts to it first** — [critique 6](#critique) |

## What already exists

**`ShopService` ships inside `selling_service`** (#66) — ✅ moving to its own `shop_service`
([the-shop-gets-its-own-service](./context_decision.md#the-shop-gets-its-own-service)) — with shop access (#86), the
`/shops` and shop-detail screens, and `ShopSelect`:

| your doc | built |
| --- | --- |
| create | `ShopCreate` |
| edit | `ShopUpdate` — every field, the marketplace included |
| delete | `ShopDelete` — soft: `deleted` is set, the code is freed, and the shop **disappears from every read** |
| list | `ShopList` — open shops only, searched by name or code |
| — | `ShopDetail` — one open shop |
| manage access user to shop | **shop access** — `ShopUserList` · `ShopUserAdd` · `ShopUserRemove`, one grant of one user to one shop |
| shop can have multiple user | ✅ built — `shop_users`, many rows per shop |
| one primary customer service | ✅ built (f6dab3b) — a flag on a grant, in `selling_service` for now |
| `ShopAccessCheck` | ✅ built (f6dab3b) — in `selling_service` for now · ⚠ a deleted shop still answers `NotFound` ([Q3](#question)) |

Who reads a shop today — a dotted line is a `shop_id` taken on trust, with nothing asked:

```mermaid
flowchart LR
  subgraph "selling_service"
    SS["ShopService — shops, shop_users"]
    O["orders — shop_id is a real foreign key"]
  end
  O --> SS
  O -->|"OpenSale, on every placed order"| SE["settlement_service"]
  SE -.->|"a row with no order — shop_id on trust"| SS
  EX["expense_service"] -.->|"an expense's shop — on trust"| SS
  I["settlement_importer — decided, not built"] -->|"may this caller work on this shop"| SS
```

## Critique

| # | Problem | → Recommend |
| --- | --- | --- |
| **1** | 🔨 **Half built 2026-09-29** — `ShopAccessCheck` and the gate on both imports (f6dab3b, f163139); ⛔ the gate on `OrderCreate`, `OrderDraftPush`, `OrderDraftPromote` and the rollout grants are not built. ✅ **Decided — [a-write-needs-a-grant-or-a-manager](./context_decision.md#a-write-needs-a-grant-or-a-manager).** A grant, or the team's owner or admin role, now gates every write on a shop. Until it is built, `shop_users` is still read only by its own three RPCs. | Build it: `ShopAccessCheck` ([critique 10](#critique)), the check in `OrderCreate`, `OrderDraftPush`, `OrderDraftPromote` and both imports, and the rollout grants. |
| **2** | ✅ **Decided — [the-shop-gets-its-own-service](./context_decision.md#the-shop-gets-its-own-service).** Shops, shop access and `ShopAccessCheck` leave `selling_service` for `shop_service`. | Build the move. How the existing shops move is a technical item, not designed yet. |
| **3** | 🔄 **Delete hides a shop from everything that still points at it.** `ShopList` and `ShopDetail` both filter out `deleted`, so nothing can read a deleted shop: the settlement report's by-shop ranking names its row `#7`, and the orders filter cannot pick it. And a shop is paid **after** it stops selling — its last orders settle and its balance is withdrawn later — while the importer's check, as specified, refuses a deleted shop. | **Close, not delete** — [Q3](#question). |
| **4** | ***"for Selling Team"* is not enforced.** `ShopCreate` writes into any team it is given. The menu hides `/shops` from a warehouse team; the RPC does not. | `ShopCreate` refuses a team whose type is not SELLING — one lookup. |
| **5** | **The marketplace can be edited after a shop has history.** `ShopUpdate` takes it, and the edit dialog offers it. It is what picks the import's reader, what a ref is unique within ([an-order-is-unique-by-shop-and-marketplace-ref](../order/context_decision.md#an-order-is-unique-by-shop-and-marketplace-ref)), and the badge on every past order. | Fixed at creation, with the team — [Q4](#question). |
| **6** | ⛔ **Other services take a `shop_id` on trust, and settlement lets a team claim another's shop.** A row with no order opens its shop's account under the **caller's** team, and the team is checked only after ([post_entry.go:282](../../../backend/services/settlement_service/settlement_v1/post_entry.go#L282)). Team A posts one such row naming team B's shop before B has posted any: the account is A's, and every such post B makes to its own shop answers `errWrongTeam` from then on. `expense_service` stores any `shop_id` it is given. Neither has anything to ask. | 🔄 ✅ **Your §Rpc That Must Exist is the place — widen it past the importer.** Settlement calls `ShopAccessCheck` before opening a shop's account, expense before storing a shop: once it carries `team_id` ([critique 10](#critique)), another team's shop answers `NotFound`, which is the check both lack. My `ShopByIds` is withdrawn. |
| **7** | **A shop does not record who it is on the platform.** Only `shop_code` is unique, and only within a team — one Shopee storefront can be registered twice, in one team or two, and its orders and settlements split between the copies. A Shopee statement names its seller, `Username (Penjual)`, and there is nothing to match it to ([what the file check cannot see](../settlement/settlement_importer_decision.md#a-file-with-another-shops-orders-is-refused)). | Record it — [Q5](#question). |
| **8** | **One list, two questions.** The order form's picker needs the open shops this person may work on; a report's filter needs every shop that ever had a row. `ShopList` has one fixed answer — every open shop. | Filters `status` (open · closed · all), `marketplace` and `user_id`, so each screen asks its own question. |
| **9** | 🆕 **A managed list has to be true — and this one keeps people who left.** *Manage* includes seeing who has access ([the-shop-manages-its-access-list](./context_decision.md#the-shop-manages-its-access-list)). But nothing ends a grant when its holder leaves the team — nothing that owns `shop_users` hears of a membership change — and `ShopUserAdd` never checks that the user is in the team at all. A shop's access list drifts into people who no longer work there. | A grant is held only by a member of the shop's team, and leaving the team ends it — [Q6](#question). |
| **10** | ✅ **Built 2026-09-29 as recommended** (f6dab3b), for the importer — inside `selling_service`, and it moves with the shop ([the-shop-gets-its-own-service](./context_decision.md#the-shop-gets-its-own-service)) — `team_id` scoped, the buf names, `Shop shop`, and your field name `is_have_access` kept. ⚠ Your §Rpc still reads `Payload` · `Response` · `ShopDetail` — yours to update. Was: 🆕 ⛔ **`ShopAccessCheck` as written cannot be called by the person it is for, and does not compile.** **No `team_id`**: the importer calls it under the uploader's token — a CS — and a team-level role on a request with no `use_scope` field is checked against the root team ([CLAUDE.md](../../../CLAUDE.md) §Rules that are easy to get wrong), so only root and admin could call it. **`Payload` · `Response`**: buf's STANDARD lint, used with no exceptions ([buf.yaml](../../../proto/buf.yaml)), wants `ShopAccessCheckRequest` · `ShopAccessCheckResponse`. **`ShopDetail shop`**: there is no `ShopDetail` message — the shop is `Shop`. | `ShopAccessCheckRequest` — `team_id` (`use_scope`, `gt 0`), `shop_id`, `user_id` · `ShopAccessCheckResponse` — `Shop shop`, `primary_user_id`, `bool has_access` · another team's shop answers `NotFound`. See [the contract](#the-contract). |

## Recommendation

✅ **Q1, Q2 and Q7 are decided.** Next, **Q3 — the importer has shipped**, and the built `ShopAccessCheck` answers a
deleted shop `NotFound`, so a shop's last statements, paid after it stops selling, can never be imported. Then **Q6**,
now that a grant is real access. **Q4 and Q5 cost least now** — the move to `shop_service`
([the-shop-gets-its-own-service](./context_decision.md#the-shop-gets-its-own-service)) rewrites every shop RPC anyway.

## Proposed Design

### The jobs

| who | does | how often |
| --- | --- | --- |
| the selling team's owner, admin | open a shop when the team opens a storefront · rename it · grant CS to it · close it | a few times a year |
| CS | pick a shop on every order and draft · import its statements | many times a day |
| everyone in the team | read a shop's orders, settlements and expenses — a closed shop's too | daily |
| orders · settlement · expense · importer | ask whether a shop is the team's, and whether this person may work on it | every write |

### A shop's life — Q3

```mermaid
stateDiagram-v2
  [*] --> open: ShopCreate — marketplace and team fixed
  open --> closed: ShopClose — the storefront stopped selling
  closed --> open: ShopReopen — refused while an open shop holds its code
```

Only **new selling** is refused. Money already earned and work already started all run:

```mermaid
flowchart LR
  C["a closed shop"]
  C -->|"❌ refused"| N["OrderCreate, OrderDraftPush, OrderDraftPromote, the order form's picker"]
  C -->|"✅ runs to its end"| R["a placed order — its status, cancel, return"]
  C -->|"✅ ShopAccessCheck, with its status"| P["the importer, settlement's imported shop row, Point a shop here"]
  C -->|"✅ on trust, as today"| E["an expense naming it, the withdrawal listener"]
  C -->|"✅ marked closed"| L["lists, reports, filters, labels"]
```

| site — read in the code | a deleted shop today | a closed shop |
| --- | --- | --- |
| `OrderCreate` — `shopExists`, [order_place.go:119](../../../backend/services/selling_service/selling_v1/order_place.go#L119) | ❌ `NotFound` | ❌ *"the shop is closed"* |
| `OrderDraftPush` | ✅ stored on trust, no check | ❌ — the gate [critique 1](#critique) already plans |
| `OrderDraftPromote` | ❌ through `order_place` | ❌ — the draft stays (3c) |
| a placed order — status, cancel, return | ✅ no shop check | ✅ |
| the importer's check — [import_run.go:123](../../../backend/services/settlement_importer_service/settlement_importer_v1/import_run.go#L123) | ❌ *"not one of your team's shops"* | ✅ |
| settlement, an imported shop row — [shop_primary.go:56](../../../backend/services/settlement_service/settlement_v1/shop_primary.go#L56) | ❌ *"not a live shop"* | ✅ |
| financial_account **Point a shop here** — `ShopOfTeam`, 🔨 being built | ❌ | ✅ — its last withdrawals need an account, or they open an `unknown` one |
| grants and the primary CS — `lockShop`, `shopExists` | ❌ | ✅ (3e) |
| `ShopList` · `ShopDetail` | ❌ hidden — a report names it `#7` | ✅ marked closed |
| `shop_code` | freed | unique among **open** shops, as today (3d) |

### What a shop carries

| field | editable | rule |
| --- | --- | --- |
| `team_id` | ❌ | a SELLING team (critique 4) — never moves (Q4) |
| `marketplace` | ❌ (Q4) | set at creation |
| `name` | ✅ | what people read |
| `shop_code` | ✅ | unique in the team among **open** shops (Q3, 3d) |
| `platform_shop_ref` 🆕 Q5 | ✅ — platforms allow a rename | unique per marketplace among open shops, **across all teams** |
| `description` | ✅ | |
| `status` 🆕 | by close and reopen | `open` · `closed` — replaces `deleted` |
| `closed_at` 🆕 | — | when it stopped selling |
| `primary_user_id` 🆕 Q7 | by **Make primary** | one of the shop's own users — a flag on their grant, read onto the shop |

Not on the shop, by decision: a return warehouse — one per team
([the-return-warehouse-is-per-team](../order/context_decision.md#the-return-warehouse-is-per-team)).

### Who may work on a shop — ✅ decided

[a-write-needs-a-grant-or-a-manager](./context_decision.md#a-write-needs-a-grant-or-a-manager) — the rule, its
diagram and its spec, the rollout grants included. It is what `ShopAccessCheck` computes as `is_have_access`.

### Where it lives — ✅ decided

[the-shop-gets-its-own-service](./context_decision.md#the-shop-gets-its-own-service) — the before and after, what
moves, and who calls it. Everything below is `shop_service`'s.

### The contract

| RPC | | change |
| --- | --- | --- |
| `Shop` — the message | built | gains `status` (Q3), `platform_shop_ref` (Q5), and `primary_user_id` — the badge, with no second call (Q7) |
| `ShopCreate` | built | refuses a non-SELLING team · takes `platform_shop_ref` (Q5) |
| `ShopUpdate` | built | no longer takes `marketplace` (Q4) |
| `ShopDelete` | built | becomes `ShopClose`, beside a new `ShopReopen` (Q3) |
| `ShopList` | built | filters `status`, `marketplace`, `user_id` (critique 8) |
| `ShopDetail` | built | reads a closed shop too |
| `ShopAccessCheck` 🆕 yours | for other services | `ShopAccessCheckRequest` — `team_id`, `shop_id`, `user_id` · `ShopAccessCheckResponse` — `Shop` (closed included, with its status — Q3), `primary_user_id` (Q7), `has_access` ([a-write-needs-a-grant-or-a-manager](./context_decision.md#a-write-needs-a-grant-or-a-manager)) · another team's shop → `NotFound` (critique 10) · called by the importer, orders, settlement and expense (critique 6) |
| `ShopUserList` · `ShopUserAdd` · `ShopUserRemove` | built | `ShopUserAdd` refuses a user outside the team, and leaving the team ends the grant (Q6) · the list marks the primary (Q7) |
| `ShopUserSetPrimary` 🆕 | owner, admin | moves the primary to another of the shop's users (Q7) |

### The data

```mermaid
erDiagram
  shops ||--o{ shop_users : "grants"
  shops {
    bigint id PK
    bigint team_id "a SELLING team, never moves"
    text marketplace "fixed at creation"
    text name
    text shop_code "unique per team among open shops"
    text platform_shop_ref "NEW, unique per marketplace among open shops"
    text description
    text status "NEW, open or closed, replaces deleted"
    timestamptz closed_at "NEW"
    timestamptz created_at
    timestamptz updated_at
  }
  shop_users {
    bigint id PK
    bigint shop_id FK
    bigint user_id "opaque user_service id"
    boolean is_primary "NEW, at most one per shop, a partial unique index"
    timestamptz created_at
  }
```

### The screens

| where | change |
| --- | --- |
| `/shops` | a status filter, open by default · the primary CS as a badge on each row · **Close** in the row menu, through a `ConfirmDialog` · **Reopen** on a closed row |
| `/shops/:id` | the platform name · the marketplace read-only · a *closed* banner with Reopen · the users section marks the primary with a badge, and offers **Make primary** in each user's row menu |
| a form that writes — the order form | open shops only, and only those the person may write on ([a-write-needs-a-grant-or-a-manager](./context_decision.md#a-write-needs-a-grant-or-a-manager)) |
| every report and filter | closed shops too, marked closed |

## Question

1. ✅ **Answered 2026-09-29 — a write needs a grant or a manager role**, as recommended, all four parts:
   [a-write-needs-a-grant-or-a-manager](./context_decision.md#a-write-needs-a-grant-or-a-manager). Kept as a line
   so the numbers hold.

2. ✅ **Answered 2026-09-29 — its own `shop_service`**, as recommended:
   [the-shop-gets-its-own-service](./context_decision.md#the-shop-gets-its-own-service). It also answers
   architecture Q6. Kept as a line so the numbers hold.

3. **What does *delete* do to a shop with history — and what may a closed shop still do?** Critique 3.
   **→ Recommend: close, not delete.** The platform pays out a shop's last orders and its balance **after** it stops
   selling, and today every one of those payouts is refused. 🔄 *Elaborated 2026-10-01* — five parts, each its own
   yes or no. Every site, today and after: [A shop's life](#a-shops-life--q3).

   | | the question | → Recommend |
   | --- | --- | --- |
   | **3a** | close **instead of** delete, or keep a delete for a shop made by mistake? | **Close only.** *"It has no history"* means asking five services (orders, drafts, settlement, expense, accounts), and a draft can land mid-check. A mistaken shop is closed, and the default *open* filter hides it |
   | **3b** | what does a closed shop refuse? | **Only new selling**: an order, a draft pushed or promoted, the order form's picker. Everything else runs |
   | **3c** | its drafts still waiting? | **The close goes through. They stay, and promote refuses** *"the shop is closed"*: the CS deletes them, or the owner reopens. Refusing the close would let one forgotten draft keep a shop open |
   | **3d** | its `shop_code` | 🔄 **Revised: unique among OPEN shops, as today.** I had *reserved while closed*, but the code is a label `ShopUpdate` already edits, and no other table stores it. Reopen refuses while an open shop holds it. Rename one, then reopen. It also spares the migration from rewriting codes already reused |
   | **3e** | who closes it, and what still works on it? | **Close and Reopen take `ShopDelete`'s roles**: owner, admin. **Grants and the primary CS stay editable.** An import needs a primary CS ([a-shop-with-no-primary-cs-cannot-import](../settlement/settlement_importer_decision.md#a-shop-with-no-primary-cs-cannot-import)), so if theirs leaves after the close, the last statements wait until someone names another |

   **How `ShopAccessCheck` says it:** the `Shop` it returns carries `status`, and **each caller decides**. The
   importer, settlement and the accounts take a closed shop, and an order refuses it. What a closed shop may do is
   the caller's rule, so it lives with the caller, not as a flag on the shop's RPC.
   ⚠ It changes the importer's check: [its spec](../settlement/settlement_importer_decision.md#the-shop-is-checked-before-the-file-is-stored)
   refuses a deleted shop (my reading, marked ⚠ there), and a closed shop must pass it.
   ⚠ **The shops already deleted become `closed`**, with `closed_at` set to their `updated_at`. They come back under
   *Closed*, and their report rows get their names back instead of `#7`.

4. **Are a shop's marketplace and team fixed once it exists?** 🆕 Critique 5.
   **→ Recommend yes, both.** A storefront cannot change platforms or teams: the marketplace picks the import
   and scopes the ref, and settlement freezes `shop_id` and `team_id` on every row. `ShopUpdate` stops taking
   `marketplace`. Nothing moves a shop between teams today, and the rule says nothing will. A marketplace
   picked wrongly is fixed by closing the shop — it has no history yet — and opening the right one.

5. **Does a shop record who it is on the platform?** 🆕 Critique 7.
   **→ Recommend yes — `platform_shop_ref`**: the seller username or shop id the platform shows, required at
   creation, unique per marketplace among open shops **across all teams**. A storefront can then be
   registered only once, and a Shopee statement's `Username (Penjual)` is checked against its shop even when
   no ref finds an order — the case the file check cannot see.
   ⚠ A TikTok statement names no shop, so it gains nothing there — and uniqueness across teams tells a team
   that a storefront is already registered elsewhere.

6. **May a grant be made to somebody who is not in the shop's team?** 🔄 *(2026-10-06, narrowed)* Half of the first
   question — *leaving the team ends every shop grant* — was decided in the user context
   ([removing-a-member-drops-their-shop-access](../user/context_decision.md#removing-a-member-drops-their-shop-access)) and is built: a removal is announced, and the shop side
   drops the person's grants in that team, the primary flag with them. What is left is the other half.
   **→ Recommend no.** `ShopUserAdd` refuses a user who is not a member of the shop's team — so a shop's access list
   is always people who can work there. *(Opened 2026-09-29 as Critique 9 — by *manage*.)* A stale
   grant opens nothing today, since the interceptor refuses a non-member first. What it breaks is the list you now
   manage, which shows people who left — and ⛔ now that a grant gates writes
   ([a-write-needs-a-grant-or-a-manager](./context_decision.md#a-write-needs-a-grant-or-a-manager)), a person who
   rejoins gets their old shops back without anyone granting them. That is real access, not only a wrong list.
   ⚠ The price: the shop has to hear when a membership ends — one event from `user_service`, or a membership
   check when the list is read.

7. ✅ **Answered 2026-09-29 — the primary CS is a flag on a grant**, as recommended:
   [the-primary-cs-is-a-flag-on-a-grant](./context_decision.md#the-primary-cs-is-a-flag-on-a-grant). Kept as a line so
   the numbers hold.

# Contradiction

**None in your doc** — re-examined after both 2026-09-29 edits and the Q1 and Q2 answers. ⚠ One in another of
yours: `technical/architecture/context.md` §Microservice lists no `shop_service` — reported in
[its clarify](../../technical/architecture/context_clarify.md#question). 🔄 One in mine, corrected: the first pass's critique 3 said a deleted shop *stays
readable*, and recommended that it take no new import. `ShopList` and `ShopDetail` both filter a deleted shop
out, and a closed shop still has money coming — see [Q3](#question).
