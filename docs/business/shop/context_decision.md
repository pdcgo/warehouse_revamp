# Decisions — `shop/context.md`

What the owner settled, recorded before it is acted on. **Append-only** — a decision that is later reversed is
renamed and its references grepped (RULE 12), never quietly edited away. The open set is
[context_clarify.md](./context_clarify.md).

🏗 **As built — recorded 2026-09-28, on your instruction:** *"write already coded and implemented in
context_decision.md so we have documentation review later"*. Every decision marked **as built** is what the code
does TODAY, read from the code and linked to it — not a choice you wrote in a doc. It is here to be reviewed.
Where a [clarify](./context_clarify.md) question proposes to change one, the table says so — and recording it here
**closes no question**: if an answer changes the rule, the decision is renamed.

| decision | what it decided | from | under review |
| --- | --- | --- | --- |
| [access-is-given-per-user-per-shop](#access-is-given-per-user-per-shop) | giving a user access to a shop is the shop's own job — one user, one shop, one grant | owner | [Q1](./context_clarify.md#question) — who needs one |
| [shops-live-in-selling-service](#shops-live-in-selling-service) | `ShopService` is one of three proto services one `selling_service` serves, and `shops`, `shop_users` are its tables | as built | [Q2](./context_clarify.md#question) |
| [every-shop-call-is-scoped-to-its-team](#every-shop-call-is-scoped-to-its-team) | every request names its team and every query is held to it — another team's shop reads as not found | as built | [critique 4](./context_clarify.md#critique) — the team's type |
| [managers-write-shops-and-cs-reads-them](#managers-write-shops-and-cs-reads-them) | owner and admin create, edit, delete and grant · customer service only reads | as built | — |
| [a-shop-is-a-name-a-code-and-a-marketplace](#a-shop-is-a-name-a-code-and-a-marketplace) | the record — a code unique among the team's live shops, a marketplace required | as built | [Q5](./context_clarify.md#question) — no platform name |
| [every-shop-field-stays-editable](#every-shop-field-stays-editable) | an edit writes only the fields it sends — the marketplace included | as built | [Q4](./context_clarify.md#question) |
| [delete-is-soft-and-frees-the-code](#delete-is-soft-and-frees-the-code) | delete flags the row, frees its code, and hides the shop from every read | as built | [Q3](./context_clarify.md#question) |
| [the-shop-list-is-paged-and-searched](#the-shop-list-is-paged-and-searched) | a team's live shops, newest first, a page at a time, searched by name or code | as built | [critique 8](./context_clarify.md#critique) |
| [a-grant-is-idempotent-and-listed-as-ids](#a-grant-is-idempotent-and-listed-as-ids) | adding or removing a grant twice changes nothing · the list returns user ids | as built | [Q1](./context_clarify.md#question) |
| [an-order-needs-a-live-shop-of-its-team](#an-order-needs-a-live-shop-of-its-team) | an order is placed only on a live shop of its own team, checked before any stock moves | as built | — |
| [other-services-keep-a-shop-id-unchecked](#other-services-keep-a-shop-id-unchecked) | expense and settlement store a shop id without asking the shop | as built | ⛔ [critique 6](./context_clarify.md#critique) |
| [the-shop-manages-its-access-list](#the-shop-manages-its-access-list) | managing a shop's access — give it, take it away, see who has it — is the shop's own job | owner | [Q1](./context_clarify.md#question) — who needs one · [Q6](./context_clarify.md#question) — who can hold one |

## access-is-given-per-user-per-shop

> `context.md` §Responsbility 1 *(owner, 2026-09-28)* — *"give access user to shop"*, added beside create, edit,
> delete and list. It answers the first half of [critique 1](./context_clarify.md#critique): shop access was
> built, and missing from the doc.

> 🔄 *(2026-09-29)* The line now reads *"manage access user to shop"* — widened by
> [the-shop-manages-its-access-list](#the-shop-manages-its-access-list). This verdict still holds.

**The verdict.** Access to a shop is **given to a user, one shop at a time**, and giving it is the shop's own job —
the same one that creates and closes the shop. It is the model already built: `shop_users`, one row per user per
shop, written by `ShopUserAdd` and removed by `ShopUserRemove`.

```mermaid
flowchart LR
  M["the team's owner or admin"] -->|"ShopUserAdd"| G["shop_users — one user, one shop"]
  G --> Q{"who needs one, and what it gates"}
  Q -.->|"still open"| Q1["shop Q1"]
```

### The spec

| | |
| --- | --- |
| the grant | one user, one shop — `shop_users (shop_id, user_id)`, unique |
| who gives it | the team's owner and admin, and root and admin — the built policy on `ShopUserAdd`, unchanged |
| where it lives | with the shop — if the shop gets a service of its own ([Q2](./context_clarify.md#question)), the grants move with it |

### What it does NOT settle

- **Who needs a grant** — only the users listed on the shop, or the team's owner and admin without one:
  [Q1](./context_clarify.md#question).
- **What a grant gates** — the import alone, or every write on the shop: [Q1](./context_clarify.md#question).

## shops-live-in-selling-service

> 🏗 As built — [selling.proto:17](../../../proto/warehouse/selling/v1/selling.proto#L17),
> [register.go](../../../backend/services/selling_service/register.go) (#66). Recorded 2026-09-28 for review.

**The verdict.** The shop is `warehouse.selling.v1.ShopService`, one of three proto services served by a single
`selling_service` implementation — beside `OrderService` and `OrderDraftService`. Its two tables, `shops` and
`shop_users`, are `selling_service`'s own, and an order points at its shop with a real foreign key.

```mermaid
flowchart LR
  subgraph "selling_service — one implementation"
    SS["ShopService — 8 RPCs"]
    OS["OrderService"]
    DS["OrderDraftService"]
    T1[("shops")]
    T2[("shop_users")]
    T3[("orders")]
  end
  SS --> T1
  SS --> T2
  OS --> T3
  DS --> T3
  T3 -->|"shop_id, a foreign key"| T1
  FE["the /shops and /shops/:id screens"] --> SS
```

### The spec

| | |
| --- | --- |
| RPCs | `ShopCreate` · `ShopList` · `ShopDetail` · `ShopUpdate` · `ShopDelete` · `ShopUserList` · `ShopUserAdd` · `ShopUserRemove` — one handler file each, `selling_v1/shop_*.go`, unit tests beside them |
| tables | `shops` ([00001](../../../backend/services/selling_service/db_migrations/00001_create_shops.sql)) · `shop_users` ([00002](../../../backend/services/selling_service/db_migrations/00002_create_shop_users.sql)) — goose, owned by `selling_service` |
| mounted | [register.go](../../../backend/services/selling_service/register.go) — behind the shared interceptor chain, so every RPC is policy- and scope-checked |
| screens | `/shops` and `/shops/:shopId` ([router.tsx:232](../../../frontend/src/router.tsx#L232)) — in the menu of a selling team ([nav.ts:262](../../../frontend/src/layouts/nav.ts#L262)) |

⚠ **Under review** — [Q2](./context_clarify.md#question) recommends a `shop_service` of its own.

## every-shop-call-is-scoped-to-its-team

> 🏗 As built — `use_scope` on every request in [selling.proto](../../../proto/warehouse/selling/v1/selling.proto),
> and the `team_id` clause in every handler ([service.go:111](../../../backend/services/selling_service/selling_v1/service.go#L111)).
> Recorded 2026-09-28 for review.

**The verdict.** Every shop request carries `team_id` — required, and the field the access interceptor scopes the
call to. Every query is then held to that team, so a shop of another team is **not found**, never forbidden: the
caller cannot even learn it exists. Root and admin of the root team pass every scope.

```mermaid
flowchart LR
  R["a request — team_id, shop_id"] --> I{"the interceptor — a member of team_id, in a role the policy lists"}
  I -->|"no"| D["refused — the handler never runs"]
  I -->|"yes"| H{"the handler — WHERE id = shop_id AND team_id = team_id"}
  H -->|"no row"| N["NotFound — shop not found"]
  H -->|"a row"| OK["the shop"]
```

### The spec

| | |
| --- | --- |
| the scope | `team_id` — `gt 0` and `use_scope`, on all eight requests |
| another team's shop | `NotFound` from one shop's RPCs, absent from the list — the same as a shop that does not exist |
| root and admin | pass every scope — the root team's roles |
| moving a shop | impossible — no request changes `team_id` |
| ⚠ the team's type | not checked — `ShopCreate` writes into a warehouse team as readily as a selling one ([critique 4](./context_clarify.md#critique)). Only the menu keeps shops to selling teams |

## managers-write-shops-and-cs-reads-them

> 🏗 As built — the `request_policy` on each request in [selling.proto](../../../proto/warehouse/selling/v1/selling.proto).
> Recorded 2026-09-28 for review.

**The verdict.** A selling team's **owner and admin** manage its shops and who may work on them. Its **customer
service** may read them — the list, one shop, and a shop's users — and nothing more.

```mermaid
flowchart LR
  OW["team owner, team admin — and root, admin"] --> W["ShopCreate · ShopUpdate · ShopDelete · ShopUserAdd · ShopUserRemove"]
  OW --> RD["ShopList · ShopDetail · ShopUserList"]
  CS["customer service"] --> RD
```

### The spec

| RPC | root · admin | team owner · team admin | customer service | anyone else |
| --- | --- | --- | --- | --- |
| `ShopCreate` · `ShopUpdate` · `ShopDelete` | ✅ | ✅ | ❌ | ❌ |
| `ShopUserAdd` · `ShopUserRemove` | ✅ | ✅ | ❌ | ❌ |
| `ShopList` · `ShopDetail` · `ShopUserList` | ✅ | ✅ | ✅ | ❌ |

## a-shop-is-a-name-a-code-and-a-marketplace

> 🏗 As built — the `Shop` message ([selling.proto:30](../../../proto/warehouse/selling/v1/selling.proto#L30)), its create
> rules ([line 40](../../../proto/warehouse/selling/v1/selling.proto#L40)) and
> [00001_create_shops.sql](../../../backend/services/selling_service/db_migrations/00001_create_shops.sql). Recorded
> 2026-09-28 for review.

**The verdict.** A shop is a **name**, a **code** and a **marketplace**, with an optional description. The code is the
team's short handle for it — unique among the team's live shops, so two teams may use the same one. The marketplace
is required, from a shared list of seven.

```mermaid
erDiagram
  shops ||--o{ shop_users : "grants, ON DELETE CASCADE"
  shops {
    bigint id PK
    bigint team_id "the owning team, opaque, no FK across services"
    text name "1 to 128, never empty"
    text shop_code "1 to 32, never empty, unique per team among live shops"
    text marketplace "a lowercase code, no DB CHECK"
    text description "up to 1000, empty by default"
    boolean deleted "false by default"
    timestamptz created_at
    timestamptz updated_at
  }
  shop_users {
    bigint id PK
    bigint shop_id FK
    bigint user_id "opaque user_service id"
    timestamptz created_at
  }
```

### The spec

| field | rule | on the wire |
| --- | --- | --- |
| `name` | required, 1–128 characters | ✅ |
| `shop_code` | required, 1–32 · unique per team among shops not deleted — a partial index, so two teams may share a code · a duplicate answers `AlreadyExists`, *"a shop with this code already exists in the team"* | ✅ |
| `marketplace` | required — Shopee, Tokopedia, Lazada, TikTok, Blibli, Bukalapak or Other ([marketplace.proto](../../../proto/warehouse/marketplace/v1/marketplace.proto) — append-only, shared with supplier channels) · stored as a lowercase code by [san_marketplace](../../../backend/pkgs/san_marketplace/marketplace.go), with no DB CHECK, so a new value needs no migration | ✅ |
| `description` | optional, up to 1000 characters | ✅ |
| `deleted` | set by `ShopDelete` only | ✅ |
| `created_at` · `updated_at` | stamped by the service | ❌ |

⚠ **Under review** — nothing records who the shop is ON the platform: [Q5](./context_clarify.md#question).

## every-shop-field-stays-editable

> 🏗 As built — [shop_update.go](../../../backend/services/selling_service/selling_v1/shop_update.go),
> [selling.proto:162](../../../proto/warehouse/selling/v1/selling.proto#L162). Recorded 2026-09-28 for review.

**The verdict.** An edit sends only what changes: a field left out is kept, a field sent is written — the name, the
code, the description, **and the marketplace**. The team is never editable.

```mermaid
sequenceDiagram
  participant P as owner or admin
  participant S as ShopUpdate
  participant DB as shops
  P->>S: team_id, shop_id, and only the fields that change
  S->>DB: a live shop with this id, in this team?
  alt none
    S-->>P: NotFound
  else found
    S->>DB: write the fields sent, and updated_at
    S->>DB: read it back
    S-->>P: the shop as it now is
  end
```

### The spec

| | |
| --- | --- |
| a field left out | kept — the fields are `optional`, so *absent* and *empty* differ |
| the same values sent again | success — existence is checked **before** the write, so a no-op edit is never mistaken for a missing shop |
| a code another live shop holds | `AlreadyExists` |
| a deleted shop | `NotFound` |
| the answer | the shop, read back after the write |

⚠ **Under review** — [Q4](./context_clarify.md#question) recommends the marketplace fixed at creation: it picks the
import's reader and labels every past order.

## delete-is-soft-and-frees-the-code

> 🏗 As built — [shop_delete.go](../../../backend/services/selling_service/selling_v1/shop_delete.go), and the partial
> index in [00001_create_shops.sql](../../../backend/services/selling_service/db_migrations/00001_create_shops.sql).
> Recorded 2026-09-28 for review.

**The verdict.** Deleting a shop **flags** it — the row stays, so its orders, settlement rows and expenses still point
at a real id. From that moment its code is free for a new shop, and the shop is gone from every read: the list, the
detail, its users and order placement all answer as if it never existed. There is no undo.

```mermaid
stateDiagram-v2
  [*] --> live: ShopCreate
  live --> deleted: ShopDelete — deleted set, code freed
  deleted --> [*]
  note right of deleted
    no RPC reads it or brings it back
    its grants stay in shop_users
    its orders keep its id
  end note
```

### The spec

| after `ShopDelete` | |
| --- | --- |
| the row | kept — `deleted = true`, `updated_at` stamped |
| its code | free — a new shop in the team may take it |
| `ShopList` · `ShopDetail` · `ShopUpdate` · `ShopUserList` · `ShopUserAdd` · `ShopUserRemove` | leave it out, or answer `NotFound` |
| deleting it again | `NotFound` |
| placing an order on it | `NotFound` |
| its grants | kept in `shop_users` — the cascade fires only on a row delete, which nothing does |
| its past orders, settlement rows, expenses | keep its id · nothing can read its name — the settlement report shows `#<id>` |

⚠ **Under review** — [Q3](./context_clarify.md#question) recommends *close, not delete*: a shop is still paid after it
stops selling.

## the-shop-list-is-paged-and-searched

> 🏗 As built — [shop_list.go](../../../backend/services/selling_service/selling_v1/shop_list.go),
> [list_slices.go](../../../backend/services/selling_service/selling_v1/list_slices.go),
> [selling.proto:75](../../../proto/warehouse/selling/v1/selling.proto#L75). Recorded 2026-09-28 for review.

**The verdict.** The list is **one team's live shops, newest first, a page at a time** — searched by name or code, in
the guideline's List shape: the ids in order, plus the slices the caller asks for.

```mermaid
flowchart LR
  R["team_id, q, sort, page"] --> F["the team's shops, not deleted"]
  F --> Q["q — name or code contains it, any case"]
  Q --> C["count — the total"]
  C --> O["sort — newest first by default"]
  O --> P["one page"]
  P --> S["ids in order, plus SHOP or GENERAL slices"]
```

### The spec

| | |
| --- | --- |
| page | required — `page` ≥ 1, `limit` 1–200 (RULE 9) |
| `q` | up to 100 characters, trimmed · matches name **or** code, case-insensitive, anywhere in it · `%` and `_` are searched literally |
| sort | newest first (`id` descending) by default · by name, code or id, ascending or descending |
| slices | `SHOP` — the whole shop, and the default · `GENERAL` — id and name only |
| deleted shops | never listed |
| the picker | `ShopSelect` asks for one large page — a team runs a handful of shops |

⚠ **Under review** — [critique 8](./context_clarify.md#critique): no filter by status, marketplace or granted user.

## a-grant-is-idempotent-and-listed-as-ids

> 🏗 As built — [shop_user_add.go](../../../backend/services/selling_service/selling_v1/shop_user_add.go),
> [shop_user_remove.go](../../../backend/services/selling_service/selling_v1/shop_user_remove.go),
> [shop_user_list.go](../../../backend/services/selling_service/selling_v1/shop_user_list.go). The model it serves is
> [access-is-given-per-user-per-shop](#access-is-given-per-user-per-shop). Recorded 2026-09-28 for review.

**The verdict.** Granting a user a shop twice, or removing a grant that is not there, **succeeds and changes
nothing**. The list answers with user **ids**, newest grant first, and the screen resolves the names. The shop must
be live and the team's — the user is not checked at all.

```mermaid
sequenceDiagram
  participant M as owner or admin
  participant S as ShopService
  participant DB as shop_users
  M->>S: ShopUserAdd — team, shop, user
  S->>S: a live shop of this team? else NotFound
  S->>DB: insert, or nothing if the pair exists
  M->>S: ShopUserRemove — team, shop, user
  S->>DB: delete the pair, if it is there
  M->>S: ShopUserList — team, shop, page
  S-->>M: user ids, newest grant first
  Note over M: the names come from UserByIDs
```

### The spec

| | |
| --- | --- |
| add twice | success, one row — `ON CONFLICT DO NOTHING` on `(shop_id, user_id)` |
| remove a missing grant | success |
| list | user ids only, newest grant first, paged — `GENERAL` is its only slice |
| a deleted or foreign shop | `NotFound`, for all three |
| ⚠ the user | not checked — a grant can name someone outside the team, or no one |
| ⚠ who reads a grant | nothing but these three RPCs — orders, settlement and every screen ignore it |

⚠ **Under review** — [Q1](./context_clarify.md#question): who needs a grant, and what it gates.

## an-order-needs-a-live-shop-of-its-team

> 🏗 As built — [order_place.go:119](../../../backend/services/selling_service/selling_v1/order_place.go#L119),
> [00003_create_orders.sql:9](../../../backend/services/selling_service/db_migrations/00003_create_orders.sql#L9).
> Recorded 2026-09-28 for review.

**The verdict.** An order is placed only on a shop that is **live and belongs to the order's team** — checked first,
before any stock moves, so a bad shop is a refused request and never a stock draw to undo. A draft promoted to an
order passes the same check and, if refused, stays a draft to fix.

```mermaid
flowchart LR
  A["OrderCreate, or a draft promoted"] --> C{"a live shop of this team"}
  C -->|"no"| N["NotFound — no stock moved, the draft kept"]
  C -->|"yes"| S["stock drawn, the order written"]
  S --> O["orders.shop_id — a foreign key to shops"]
```

### The spec

| | |
| --- | --- |
| the check | [`shopExists`](../../../backend/services/selling_service/selling_v1/service.go#L111) — the id, the team, not deleted |
| when | before the stock draw |
| `orders.shop_id` | required, a foreign key to `shops`, indexed |
| `order_drafts.shop_id` | `0` until chosen, no foreign key ([00007](../../../backend/services/selling_service/db_migrations/00007_create_order_drafts.sql#L39)) — checked when the draft is promoted |
| filtering orders | `OrderList` takes a `shop_id`, `0` = every shop ([order.proto:438](../../../proto/warehouse/selling/v1/order.proto#L438)) |
| ⚠ the person | not checked against the shop's grants — [Q1](./context_clarify.md#question) |

## other-services-keep-a-shop-id-unchecked

> 🏗 As built — [expense_create.go:30](../../../backend/services/expense_service/expense_v1/expense_create.go#L30),
> [post_entry.go:273](../../../backend/services/settlement_service/settlement_v1/post_entry.go#L273) and
> [:282](../../../backend/services/settlement_service/settlement_v1/post_entry.go#L282). Recorded 2026-09-28 for review.

**The verdict.** Outside `selling_service`, a shop is **just a number**. Expense and settlement store the `shop_id`
they are given and never ask whether it exists or is the team's — there is no RPC for them to ask.

```mermaid
flowchart LR
  EX["ExpenseCreate — shop_id, optional"] -->|"stored as given"| E["the expense"]
  SP["SettlementPost — a row with no order"] -->|"the first row opens the account, under the caller's team"| A["the shop's settlement account"]
  SS["ShopService"]
  EX -.->|"never asked"| SS
  SP -.->|"never asked"| SS
```

### The spec

| service | holds | checked against the shop |
| --- | --- | --- |
| `expense_service` | an expense's `shop_id` — optional, `0` = not one shop's | ❌ — any number is stored |
| `settlement_service` | `shop_id` and `team_id` on every row, frozen · one shop-addressed account per shop | ❌ — the **first** row with no order opens the account under the caller's team. After that, a row naming another team answers `errWrongTeam`, and an order row naming another shop `errWrongShop` |

⛔ **Under review** — [critique 6](./context_clarify.md#critique): one team can claim another team's shop account by
posting to it first.

## the-shop-manages-its-access-list

> `context.md` §Responsbility 1 *(owner, 2026-09-29)* — *"manage access user to shop"*, in place of *"give access
> user to shop"*.

**The verdict.** The shop's job is not only to **give** a user access but to **manage** it: give it, take it away, and
show who has it. All three are the shop's own, and all three are built
([a-grant-is-idempotent-and-listed-as-ids](#a-grant-is-idempotent-and-listed-as-ids)). It widens
[access-is-given-per-user-per-shop](#access-is-given-per-user-per-shop), and reverses nothing.

```mermaid
flowchart LR
  M["the team's owner or admin"] --> A["give — ShopUserAdd"]
  M --> R["take away — ShopUserRemove"]
  M --> L["see who has it — ShopUserList"]
  A --> G["shop_users — one user, one shop"]
  R --> G
  L --> G
```

### The spec

| manage | RPC | as built |
| --- | --- | --- |
| give | `ShopUserAdd` | idempotent — granting twice is one grant |
| take away | `ShopUserRemove` | idempotent — removing a missing grant succeeds |
| see who has it | `ShopUserList` | user ids, newest grant first, paged — the screen resolves the names |

### What it does NOT settle

- **Who needs a grant, and what a grant gates** — [Q1](./context_clarify.md#question). Managing the list says nothing
  about who must be on it.
- **Who can hold one** — a grant can name someone outside the team, and outlives its holder leaving:
  [Q6](./context_clarify.md#question).
