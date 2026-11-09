# Decisions — `member.md`

Append-only. What the owner decided, recorded before it is acted on.

## hendra-joins-later

**Decided** in [member.md](./member.md) §Scope Responsbility 3 — *"`Hendra`, Still work legacy, join
later."* — answering *"what is Hendra's scope?"*, which is now deleted from
[member_clarify.md](./member_clarify.md).

**The verdict:** Hendra is a member of this project with **no scope today**, and no date.

**What follows directly, and is binding:**

| | |
| --- | --- |
| the roster is **three**, the people deciding are **two** | Toni and Heri |
| **no context is reserved** for an absent member | a reserved scope and an unowned scope are the same thing for every question asked in between |
| Hendra's scope is decided **on arrival**, not now | it depends on what is still undesigned then, which nobody can name today |

```mermaid
flowchart LR
  subgraph now["now — two deciders"]
    t["Toni · stock"]
    h["Heri · order, settlement, balance"]
    u["product, user, ledger, analytic — no owner"]
  end
  subgraph later["on arrival"]
    n["Hendra · scope decided then"]
  end
  u -.->|"must be owned MEANWHILE, not held"| now
  now -->|"handover is the _decision.md files, already written"| later
```

**What it does NOT settle:** who decides `product`, `user`, `ledger` and `analytic` in the
meantime — still open in [member_clarify.md](./member_clarify.md#question).

## products-follow-the-unit-price

**Decided** in [member.md](./member.md) §Scope Responsbility 1 — `Toni` now owns *"Stock &
Inventory"* **and** *"Products"* — answering half of *"who owns the four unowned contexts?"*, which
narrows in [member_clarify.md](./member_clarify.md#question) rather than closing.

**The verdict:** [`product`](../product/context.md) is **Toni's**, with stock.

**Why it holds together:** the whole of §Unit Pricing System is minted at *accept restock* — a
product has no price until it is received — so the catalogue and the receiving desk are one
decision, not two. It was also already true in the code: **`supplier` and `supplier_channel` live
in `inventory_service`**, not in `product_service`, so the supplier half of the product context was
Toni's before this was written down.
🔄 *2026-10-06:* the supplier moves out of `inventory_service` to its own `supplier_service` — [the-supplier-gets-its-own-service](../supplier/context_decision.md#the-supplier-gets-its-own-service).

```mermaid
flowchart LR
  re["Restock"] --> acc["Accept Restock"]
  acc --> price["Unit price frozen"]
  price --> prod["product — catalogue, supplier, markup"]
  prod -->|"cross markup charged"| bal["balance · Heri"]
```

**What it changes elsewhere:** the two lanes are no longer even —
Toni holds **60 RPCs / ~9.8k lines**, Heri **40 / ~8.1k**. Not a reason to rebalance: Heri carries
the undesigned half (`ledger`, `analytic`, the cross-service saga) and 4 of the 7 boundary arrows.

**What it does NOT settle:** `user`, `ledger` and `analytic` — still unowned, **12 open questions**
between them. And whether `category_service` rides along with Products
([member_clarify.md Q1](./member_clarify.md#question)).

## analytic-sits-with-stock

**Decided** in [member.md](./member.md) §Scope Responsbility 1 — `Toni` also owns *"Analytic"*.
⚠ **Against my recommendation**, which was to give it to whoever owns the ledger it reads.

**The verdict:** [`analytic`](../analytic/context.md) is **Toni's**.

**The argument for it, which I had underweighted:** analytics is a **reader**. Nothing it does
writes, so it does not need to sit with the data it reports on — and a reader owned by someone other
than the writer is the one arrangement where a metric cannot quietly be redefined to match what the
writer already produces.

**The cost, which is now real and must be paid somewhere:** every metric over Heri's numbers becomes
a **cross-lane contract**. Toni cannot define *"cost of goods sold this week"* without settlement's
and the ledger's agreement on what a row means.

```mermaid
flowchart LR
  set["settlement · Heri"] --> led["ledger · NOBODY"]
  pur["purchasing · Toni"] --> led
  led -->|"read over the contract"| ana["analytic · Toni"]
```

**What follows, and is binding:** the ledger's **read RPC is the contract between the two lanes** —
a `Stat`-shaped read per [guidelines/service-guideline.md](../../../guidelines/service-guideline.md),
not a direct table read from the analytic side. A projection read by another owner cannot be reached
around.

## identity-sits-with-order

**Decided** in [member.md](./member.md) §Scope Responsbility 2 — `Heri` owns *"Users & Role
System"*, which had belonged to neither scope while gating both.

**The verdict:** [`user`](../user/context.md) — identity, roles and the ACL — is **Heri's**.

**Why it is safe despite gating both lanes:** it is the one context that is **already built** —
`request_policy`, the access interceptor, the role cache — so most of what is open there is
ratification, not design. And the ACL is declared **in the `.proto` of the message being guarded**
(`CLAUDE.md`, *the "roling" system*), so Toni writes his own policies in his own files. What Heri
owns is the **mechanism**, not each service's policy.

```mermaid
flowchart LR
  subgraph H["Heri — owns the mechanism"]
    int["access interceptor, roles, cache"]
  end
  subgraph T["Toni — writes his own policy"]
    p["request_policy in inventory .proto"]
  end
  p -->|"read by reflection at request time"| int
```

**What it does NOT settle:** whether `team_service` rides along with Users & Roles
([member_clarify.md Q1](./member_clarify.md#question)). Roles are per-team, so I read yes.

## support-services-sit-with-order

**Decided** in [member.md](./member.md) §Scope Responsbility 2 — `Heri` also owns **Documents**,
**region**, **shipping** and **expense**, the four services the doc had never named.

**The verdict:** `document_service`, `region_service`, `shipping_service`, `expense_service` — 16
RPCs, ~2.5k lines — are **Heri's**.

**✅ Checked, and it creates no new fence into Toni's lane.** The worry was that receiving consumes
them, which would have pointed three new dependencies at the most contested number in the system
(the frozen unit cost). It does not:

| | what `inventory_service` actually does |
| --- | --- |
| `document_service` | **no use at all** — the only hits are the word *"document"* in prose comments |
| `region_service` | **no use at all** |
| `shipping_service` | ⚠ a *string*, not a call — `ShippingCode` and `ShippingCost` are columns on inventory's own `restock_request`. The courier catalogue is read to fill a dropdown, nothing more |

**What it changes:** Heri now owns **8 of the 12 built services** — 75 RPCs and ~13.1k lines against
Toni's 60 and ~9.8k (before the `category` and `team` riders). The four are reference and CRUD, so
the *design* load barely moves; the *surface* does.

```mermaid
flowchart LR
  subgraph T["Toni — 2 services, 60 RPC"]
    inv["inventory · 52"]
    prod["product · 8"]
  end
  subgraph H["Heri — 8 services, 75 RPC"]
    sell["selling · 25"]
    usr["user · 19"]
    lia["liability · 12"]
    small["document, region, shipping, expense · 16"]
    setl["settlement · 3"]
  end
  T -->|"reads the courier code as a string, never calls it"| H
```

## progress-is-reported-per-person

**Decided** in [member.md](./member.md) §Reporting and Documenting The Progress — a finished slice
of *Design, Code, Implementing* is followed by a progress report at
**`docs/development_state/[person].md`**, and the loop repeats.

**The verdict:** progress reporting is **per person**, and it is a **loop**, not a one-off — the
report is the step that closes a slice before the next one starts.

```mermaid
stateDiagram-v2
    d: Design, Code, Implementing
    fin: Finish the slice
    rep: Report progress — development_state/[person].md
    d --> fin
    fin --> rep
    rep --> d
```

**⚠ What it collides with, and what is still open.** `docs/development_state/` is today addressed by
**coordinate** — `<big_context>/<small_context>.md`, the same coordinates as the owner's two trees,
so one context is one lookup in three files. A per-person file is a **second index over the same
facts**. How the two coexist is proposed, not decided:
[member_clarify.md](./member_clarify.md#the-progress-report---decided-and-the-audience-moved-it).

## a-report-fires-per-slice

**Decided** by the owner, answering *"is one report a slice or a day?"* — **A: per slice.**
*"its for general summary for Product Manager Review."*

**The verdict:** an entry in `docs/development_state/[person].md` fires **once per finished slice**,
at the same moment the lifecycle's `state_report` fires — after `Audit RPC`. Never on a clock.

**⚠ The reason changes the file more than the cadence does: the reader is a PRODUCT MANAGER, not the
next agent.** That splits the two files by audience as well as by tense, and it is the stronger
split of the two:

| file | reader | reads for |
| --- | --- | --- |
| `development_state/<big>/<small>.md` | the **next agent** | what exists, what does not, what to pick up. Dense, code-facing — the balance one opens by explaining that the business word is `balance` and the code word is `liability` |
| `development_state/<person>.md` | the **product manager** | what got done, what it means, what is next |

```mermaid
flowchart LR
  slice["a finished slice"] --> ctx["<big>/<small>.md — for the NEXT AGENT: what is true"]
  slice --> log["<person>.md — for the PM: what shipped and what it means"]
  log -.->|"links down for detail, never depends on it"| ctx
```

**The entry, specified.** It must be readable by someone who will not open the link:

```markdown
## 2026-08-27 · order / draft-promote
**Shipped:** a CS can turn a marketplace draft into a real order without retyping it.
**State:** ✅ done · ⚠ partial · ⛔ blocked — one line of why, in business words
**Next:** receiving
<sub>agent detail: [development_state/order/draft.md](../order/draft.md)</sub>
```

⚠ **An accepted, known gap — recorded so it is not re-litigated.** Per-slice means the file is
**silent while a slice runs**, and *"still working"* and *"stopped"* look identical in it. The owner
took A knowing this: the question being answered is *"what did each person ship"*, not *"how is it
going right now"*. If the second question is ever asked, the answer is the `## Now` block from
option C, not a move to daily entries.

## ledger-is-retired-as-a-context

> Owner, in chat (2026-10-31): *"yes"* — to *"should `ledger` be retired as a context?"*, the ledger half of
> [Q1](./member_clarify.md#question), *who owns `ledger`?* As recommended, against my earlier *"→ Toni"*, whose
> premise — analytic is ledger's only reader, and Toni's — no longer held.

**The verdict.** `ledger` is **not a context** any more, so nobody owns it. There is no central book: every service keeps
its own ledger ([the-template-is-an-index](../../technical/ledger/mutation_and_ledger_decision.md#the-template-is-an-index)),
and the financial statistics the doc drew are served by each service's metrics
([the-pattern-replaces-the-shipped-analytics](../analytic/rpc_provide_decision.md#the-pattern-replaces-the-shipped-analytics)).
A central copy would be a second source of truth to keep in step.

```mermaid
flowchart LR
  subgraph "the ledger doc drew"
    S1["settlement log"] --> B["one central book"]
    P1["purchasing log"] --> B
    I1["inventory log"] --> B
    E1["expense log"] --> B
  end
  subgraph "what stands"
    S2["settlement's ledger"] --> M["each service's metrics"]
    L2["liability's ledger"] --> M
    I2["inventory's ledgers"] --> M
    F2["financial accounts"] --> M
  end
```

| | |
| --- | --- |
| the ledger context | retired — [ledger/context.md](../ledger/context.md) describes a book that will not be built; reported in its clarify |
| its open questions | Q5, who reconciles the logs against the book — closed: there is no book. Q7, what lag a money screen may show — moved to the metric pattern ([a-money-figure-says-how-current-it-is](../analytic/rpc_provide_decision.md#a-money-metric-says-as-of-when)) |
| purchasing | not a context either — the restock is inventory's ([inventory-owns-the-restock-end-to-end](../inventory/context_decision.md#inventory-owns-the-restock-end-to-end)) |
| the technical template | [mutation_and_ledger.md](../../technical/ledger/mutation_and_ledger.md) stays — it is how each service builds ITS ledger |
| still open in Q1 | the two riders: does `category` go with Products, and `team` with Users & Roles? |

**What it ripples** (HARD RULE 11) — the sites that name the retired book: [settlement context.md](../settlement/context.md)
line 33 and [settlement-publishes-to-the-book](../settlement/context_decision.md#settlement-publishes-to-the-book)'s *Financial
Ledger* consumer, reported in [settlement-posts-to-a-retired-book](../settlement/context_clarify.md#settlement-posts-to-a-retired-book).

## category-goes-with-products-and-team-with-users

> Owner, in chat (2026-10-31): *"yes"* — to the two riders left in [Q1](./member_clarify.md#question): *does `category` go
> with Products, and `team` with Users & Roles?* As recommended.

**The verdict.** Each goes with the context that is its only reason to exist: **`category`** with **Products** — a
category exists to file a product ([a-product-has-one-category](../product/context_decision.md#a-product-has-one-category)) —
and **`team`** with **Users & Roles** — a team exists to hold people and their roles.

| context | goes with | so, by [member.md](./member.md) |
| --- | --- | --- |
| `category` (4 RPCs) | Products | Toni's |
| `team` (9 RPCs) | Users & Roles | Heri's |

```mermaid
flowchart LR
  C["category"] --> P["Products"]
  T["team"] --> U["Users and Roles"]
```

⚠ **What it does not settle:** whether ownership follows member.md or practice — on this branch Heri decides Products
too ([Q2](./member_clarify.md#question), in the overtaken list).

## each-branch-decides-its-own-design

> Owner, in chat (2026-11-02): *"toni like custom our subsystem in inventory related, but in same time i have one to."*, then
> *"left the main. im active develop on this"* — to [Q3](./member_clarify.md#question) *(who settles a boundary?)* and
> [Q4](./member_clarify.md#question) *(who breaks a tie?)*, and [Q2](./member_clarify.md#question) with them.

**The verdict.** Two people each develop their own design of the inventory subsystem, one per branch
([the-two-inventory-designs-live-on-separate-branches](../inventory/context_decision.md#the-two-inventory-designs-live-on-separate-branches)),
and on each branch its developer decides **everything** — every boundary between contexts, every tie, every
cross-cutting call. [member.md](./member.md)'s lanes say who builds what; they do not move a decision off its branch.

```
backup/inventory  →  Heri's design   →  Heri settles every boundary and breaks every tie
thoni             →  Toni's design   →  Toni does, for that design
```

```mermaid
flowchart LR
  H["backup/inventory - Heri, developing now"] --> HD["Heri decides everything here"]
  T["thoni - Toni"] --> TD["Toni decides his design there"]
  M["which design reaches main"] -.->|"not asked - left for later"| X["no question opened"]
```

| | |
| --- | --- |
| Q3 — a boundary | on this branch, Heri settles it |
| Q4 — a tie | on this branch, Heri breaks it |
| Q2 — does member.md grant decision authority? | not across branches: on each, its developer decides |
| `main` | left aside — the owner is developing on `backup/inventory`; no question is opened about which design reaches it |

## each-developer-works-on-their-own-branch

> Owner, in chat (2026-11-02): *"i follow your recomendation"* — confirming the overtaken list, which named [Q5](./member_clarify.md#question), *does the
> single-`dev`-branch rule survive two people?* Earlier the same day: *"left the main. im active develop on this branch"*.

**The verdict.** There is no single shared `dev` branch any more. Each developer works on a long-lived branch of their
own and decides its design ([each-branch-decides-its-own-design](#each-branch-decides-its-own-design)). `dev` has been
idle since 2026-10-12. Which work reaches `main`, and how, is left aside — not asked.

```
backup/inventory   Heri — active
thoni              Toni
frada, hfrada      merged across when wanted (5739fd0e: frada into backup/inventory)
dev                idle since 2026-10-12
```

| | |
| --- | --- |
| where work lands | the developer's own branch, committed only when they say so |
| between branches | a merge by hand, when asked |
| `main` | left aside |
| ✅ CLAUDE.md §Git workflow | updated 2026-11-02 on the owner's ask, with the FAQ's branch entry — it had said *commit straight to `dev`* ([claude-md-still-sends-every-commit-to-dev](./member_clarify.md#claude-md-still-sends-every-commit-to-dev)) |
| also closes | [workflow Q3](../../technical/development/workflow_clarify.md#question), *how many people build on `dev` at once?* |
| ✅ built | nothing to build |

---

## heri-owns-the-ledger-area

> Owner (Heri), in chat (2026-11-07): *"I own the ledger area, not toni"* — answering the assistant's question *"who owns the ledger, you or Toni?"*, asked from a stale *Next* line in `heri.md` without reading [ledger-is-retired-as-a-context](#ledger-is-retired-as-a-context) first.

**The verdict.** The **ledger area is Heri's**. It amends one line of [ledger-is-retired-as-a-context](#ledger-is-retired-as-a-context) — *"nobody owns it"* — and keeps the rest: there is still **no central book**; every service keeps its own ledger and the statistics come from each service's metrics.

| | |
| --- | --- |
| Heri decides | the ledger docs ([ledger/context.md](../ledger/context.md) and its clarify), the technical template every service builds its ledger by ([mutation_and_ledger.md](../../technical/ledger/mutation_and_ledger.md)), and any question that spans more than one service's ledger |
| unchanged | a ledger inside a service stays that service's; the earlier *"→ Toni"* recommendation in [member_clarify](./member_clarify.md) is overruled |
| should the central book come back | not implied by this — it stays retired unless Heri says so |
