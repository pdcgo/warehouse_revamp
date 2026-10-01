# Decisions — `team_balance_design.md`

What the owner settled, recorded before it is acted on. **Append-only** — a decision that is later
reversed is renamed and its references grepped (RULE 12), never quietly edited away.

| decision | what it decided |
| --- | --- |
| [the-pair-detail-shows-both-logs](#the-pair-detail-shows-both-logs) | the pair detail page carries a summary AND **two separate logs** — the limit history and the balance history. They are never merged |
| [every-entry-names-who-posted-it](#every-entry-names-who-posted-it) | `actor_id` on every ledger entry — the **human**, not a system sentinel |
| [liability-stays](#liability-stays) | the context is **not** renamed off *liability*. The known cost is accepted, not refuted |
| [two-logs-two-names](#two-logs-two-names) | `liability_logs` for the balance one, `liability_terms_logs` for the limit one — neither owns the bare word *log* |
| [the-actor-was-dropped-at-every-boundary](#the-actor-was-dropped-at-every-boundary) | the human actor is already computed at the call site and thrown away — two parameters, not a sentinel |
| [terms-live-on-the-pair-detail](#terms-live-on-the-pair-detail) | Credit Terms is a **section** of the pair detail, not a screen. ⚠ opened the default-row question below |
| [the-summary-is-tiles-on-the-list](#the-summary-is-tiles-on-the-list) | *Summarize All Balance* is the **tiles on `/liability`** — and the totals must come from the SERVER, not the loaded page |
| [the-default-terms-row-is-a-dialog-on-the-list](#the-default-terms-row-is-a-dialog-on-the-list) | `counterparty_id = 0` is edited in a **dialog opened from the list**. ⚠ against recommendation. Fixes a live regression |

---

## the-pair-detail-shows-both-logs

> `team_balance_design.md` §Detail Pair Team Balance — *"1. Its show general summarize · 2. Its show
> change limit history log · 3. its show change balance log"*

**The verdict.** *"The Change Log"* in §Frontend Requirements 3 was **two logs, not one**, and the
owner has now named them separately. The pair detail page carries three things: the pair's summary,
the **credit-limit history**, and the **balance history**.

This closes the clarify's Q6 — *"which log does item 3 mean, the entries or the limit history?"* — and
it closes it against that file's recommendation of picking one. The answer was both.

```mermaid
flowchart TB
  P["pair detail — warehouse 11 and selling 12"]
  P --> S["1. general summarize"]
  P --> L["2. change LIMIT history log"]
  P --> B["3. change BALANCE log"]

  S --> S1["the position, split into the two directions"]
  L --> L1["a RULE that changed — old limit to new, who, why"]
  B --> B1["money that MOVED — fees, reimbursements, payments"]

  L1 -.->|"different grain, never merged"| B1
```

### Why they must not merge

They answer different questions and only one of them is a ledger.

| | the limit log | the balance log |
| --- | --- | --- |
| what it records | a **rule** changing | **money** moving |
| grain | one row per limit change | one row per posted entry |
| immutable? | yes, but it describes configuration | yes, and it *is* the account |
| who writes it | a person, deliberately | an event — an order placed, a restock accepted |
| what it answers | *"why is this team blocked, and who allowed it"* | *"what do we owe each other, and from what"* |

Merging them into one stream would put a configuration change in a column headed *Amount*, and would
make the running balance meaningless on the rows that moved no money.

### Why BOTH belong on this page

The question a person actually arrives with is *"why is this team blocked?"* — and answering it needs
both halves at once: what they owe, **and** what they were allowed. Splitting them across two screens
makes the reader hold one number in their head while they go and find the other.

### The spec

| | |
| --- | --- |
| 1. general summarize | the pair's position, rendered as **two directions**, never a bare signed number |
| 2. limit history | `LiabilityTermsHistoryList`, filtered to this counterparty. ⚠ **Both limits nullable** — `absent`, `0` and a number are three different acts |
| 3. balance log | `LiabilityEntryList` for the pair, in its four cuts — receivable, payable, my payments, their payments |
| paging | **three independent page numbers.** One shared number would turn to page 2 of a log the reader is not looking at |
| the panel | `features/liability/ChangeLogPanel` — a DOMAIN component, because two pages now read it |

### What it does NOT settle

⚠ **Where a limit is WRITTEN.** Showing the history here says nothing about which screen sets the
limit, and the Credit Terms screen (`/liability/terms`) is still not named in §Frontend Requirements.
That is [Q7 in the clarify](./team_balance_design_clarify.md#question), and it still blocks
`design_accept` on a finished prototype.

---

## every-entry-names-who-posted-it

> The owner, in chat — *"yes"*, answering [Q4](./team_balance_design_clarify.md#question):
> should `liability_entries` carry an actor?

**The verdict.** Every ledger entry records **the person who caused it**. Not the service, not the
event — the human whose act produced the money movement.

⚠ **This closes the first half of Q4 and REVERSES my recommendation on the second.** I proposed a
reserved id meaning *"posted by the system"* for causes 1–5, on the reasoning that five of the six
post from events so *"the service, not a person"* was the honest answer. **The code says otherwise:**
the person is already at hand and is dropped at the boundary.

```mermaid
flowchart LR
  ctx["actorFrom(ctx) — restock_request_fulfill.go:191"] --> a["AcceptedBy"]
  ctx --> b["AcceptedByUserID"]
  ctx --> c["costLines[i].ActorID"]
  ctx --> d["the restock events"]
  ctx -.->|"NOT passed — the signature has no actor"| e["PostRestockOutlay"]
  e --> f["the ledger entry — anonymous"]
```

A column reading *"system"* for five of six causes would cost a migration and answer nothing:
[business Critique 8](../../business/balance/context_clarify.md#critique) — *a team disputing a
charge must see who recorded it* — would still be unanswerable, and the threshold makes that acute,
because a charge nobody can explain can now stop a team trading.

### The spec

| | |
| --- | --- |
| the column | `actor_id` on `liability_entries`, **NOT NULL** |
| what fills it | the **human** who acted — the person who accepted the restock, cancelled the order, recorded the damage |
| how it gets there | **two more parameters**, on `PostRestockOutlay` and `PostStockDamage`. The value already exists at both call sites |
| `0` | reserved for a genuinely unattended posting — a scheduled job. **Today nothing qualifies** |
| backfill | ⚠ **impossible.** Rows written before this cannot be attributed, and there is no source to recover it from. Every day of trading adds more |

### ⚠ One sentinel, two meanings — fix it in the same pass

`liability_payments.recorded_by` / `confirmed_by` are documented as *"0 when unknown"*. If entries
use `0` for *the system*, one value means two things inside one service. A payment is **always** a
person's act, so `0` there is not a state worth having:

| | today | should be |
| --- | --- | --- |
| `liability_entries.actor_id` | — | `0` = the system, and nothing writes it yet |
| `liability_payments.recorded_by` | `0` = unknown | never `0` |
| `liability_payments.confirmed_by` | `0` = unknown | never `0` while confirmed |

### It rides with a migration that is already approved

[the-ledger-speaks-the-business-words](../../business/balance/context_decision.md#the-ledger-speaks-the-business-words)
is decided and unrun, and touches this same table. Adding `actor_id` in that migration costs one
pass instead of two.

---

## liability-stays

> The owner, in chat — *"just keep liability as before i ask change name to balance log"*, after
> floating `balance_logs` and reading what a whole-context rename would cost.

**The verdict.** The service, the proto package, the tables and the frontend route **keep the
`liability` name**. The rename is **cancelled**, not deferred.

```mermaid
flowchart LR
  subgraph "kept"
    A["liability_service"]
    B["warehouse.liability.v1"]
    C["liability_entries · liability_balances"]
    D["liability_payments · liability_terms"]
    E["/liability · liabilityClient"]
  end
  P["proposed: balance_entries, balance_service, …"] -.->|"cancelled"| A
```

### ⚠ The known cost, ACCEPTED — do not re-raise it

The objection was real and it is being accepted, not refuted. Recording it here so the next reader
does not spend the argument again:

| | |
| --- | --- |
| the objection | every posting is a **mirrored pair**, so one side's liability is the other's **receivable**. The table name describes one leg, and half its rows are named after the wrong side |
| what settles it anyway | a whole-context rename is **141 files and 2350 occurrences**, and it forces awkward names on two tables — `balance_balances` is absurd, and `balance_terms` describes a credit limit as if it were a balance |
| what stays true | the code's own comments already say the direction lives in the two team columns, not in the table's name |

### What this does NOT decide

| | |
| --- | --- |
| **the UI label** | *"Change Log"* was never in question — that is what a person reads, and `team_balance_design.md` §Detail Pair Team Balance names it |
| **the source-type words** | [the-ledger-speaks-the-business-words](../../business/balance/context_decision.md#the-ledger-speaks-the-business-words) is untouched. The **values** still become `order_fee` · `incidental_fee` · `broken_good` · `lost_good` · `found` — that migration is about what the rows SAY, not what the table is CALLED |
| **the service split** | `architecture/context.md:7` names a `balance_service`, and [architecture Q10](../architecture/context_clarify.md#question) asks whether the gate half is called that or `liability_service`. ⚠ This is **evidence** for keeping `liability` there too, not an answer — a split creates a new service, which is a different act from renaming an existing one |

### ✅ What it simplifies

The next migration carries **two** approved changes, not three: the source-type vocabulary and
[every-entry-names-who-posted-it](#every-entry-names-who-posted-it). Both land on
`liability_entries`, which keeps its name.

---

## two-logs-two-names

> The owner, in chat — *"liability_logs + liability_terms_logs, yes"*.

**The verdict.** The ledger table is **`liability_logs`**, and the credit-limit history — which does
not exist yet — is **`liability_terms_logs`**. Both names say *what they log*; neither takes the bare
word, in a design where [the-pair-detail-shows-both-logs](#the-pair-detail-shows-both-logs) put two of
them on one screen and said they must never merge.

```mermaid
flowchart TB
  P["pair detail"] --> B["balance log — liability_logs"]
  P --> L["limit log — liability_terms_logs"]
  B -.->|"different grain, never merged"| L
  B --> B1["a row is ONE LEG. group_id pairs the two"]
  L --> L1["a row is one WHOLE change"]
```

⚠ **They are not the same shape**, which is why both names are qualified: a balance row is **half** a
movement, a limit row is a **whole** change.

### The spec

| renames | to |
| --- | --- |
| table `liability_entries` | **`liability_logs`** |
| model `LiabilityEntry` · `liability_entry.go` | `LiabilityLog` · `liability_log.go` |
| proto `LiabilityEntry` · `LiabilityEntryList*` | `LiabilityLog` · `LiabilityLogList*` |
| rpc `LiabilityEntryList` | `LiabilityLogList` |
| handler `entry_list.go` | `log_list.go` |
| frontend `useLiabilityEntries` | `useLiabilityLogs` |
| the unbuilt limit history | **`liability_terms_logs`** — named now because there is one moment to make the pair consistent, and it is before the table exists |

⚠ **The API renames with the table.** Leaving the RPC saying `Entry` over a table called
`liability_logs` is the half-rename that was argued against when the whole-context rename was on the
table. It is breaking, and there is no external consumer — one `buf generate` moves both sides.

| does NOT change | |
| --- | --- |
| the `liability` prefix | [liability-stays](#liability-stays) — this decision is about the suffix |
| `liability_balances` · `liability_payments` · `liability_terms` | untouched |
| the source-type **values** | a separate decision — [the-ledger-speaks-the-business-words](../../business/balance/context_decision.md#the-ledger-speaks-the-business-words) renames what the rows SAY |
| the *"Change Log"* UI label | never in question |

### ⚠ What was traded, recorded once

**"Entry" means one side of a double-entry posting** — which is exactly what a row is, and the
model's own comment says so (*"ONE LEG of one movement"*). **"Log" says "a record of something that
happened"**, and a leg is not a thing that happened; the movement is. That precision is given up
deliberately, in exchange for the schema speaking the words the design docs use.

⚠ **The objection that was WITHDRAWN, so it is not re-raised**: *log* was argued to invite treating a
row as standing alone and breaking *two legs are one posting*. It does not, because the invariant is
held by code rather than by a noun — `group_id` ships (*"Shared by both legs of one movement"*) and
`post_entry.go` is the single construction site, writing both legs in one transaction.

### It rides the pending migration

Third and last rider on the same pass, with
[the-ledger-speaks-the-business-words](../../business/balance/context_decision.md#the-ledger-speaks-the-business-words)
and [every-entry-names-who-posted-it](#every-entry-names-who-posted-it). All three touch this one
table and this one proto. **Nothing gates them now.**

---

## the-actor-was-dropped-at-every-boundary

> A correction to [every-entry-names-who-posted-it](#every-entry-names-who-posted-it), found while
> building it. This log is append-only, so the earlier entry stands as written and this one is the
> amendment.

**What that entry claimed.** *"The person is already at hand and is dropped at the boundary"* — true
of the restock path, which is the one I checked.

**What is actually true.** It is dropped at **every** boundary, and for the two highest-volume causes
there was no channel to carry it at all.

| cause | the actor was… |
| --- | --- |
| `order_fee` · `product_fee` | ⛔ **not available.** `OrderPlacedEvent` had no actor field. `order_place.go` computes one for its own records and the event dropped it |
| `incidental_fee` | ✅ computed in `restock_request_fulfill.go`, dropped by the poster signature |
| `broken_good` · `lost_good` · `found` | ✅ computed in `stock_adjust.go`, dropped by the poster signature |
| `payment` | ✅ on the request |

⚠ **So the fix was bigger than two parameters**: `OrderPlacedEvent` and `OrderCancelledEvent` each
gained an `actor_id`, and selling_service populates both from the `eventActor(ctx)` it was already
computing. Had this not been caught, the column would have read 0 for the two causes that produce
the most rows — which is precisely the shrug the decision said it must not become.

```mermaid
flowchart LR
  O["order_place.go — eventActor(ctx)"] -->|"own records"| R1["order_events"]
  O -.->|"WAS dropped — no field"| E["OrderPlacedEvent"]
  E --> C["liability push handler"] --> L["the ledger"]
  F2["restock_request_fulfill.go — actorFrom(ctx)"] -->|"own records"| R2["4 other columns"]
  F2 -.->|"WAS dropped — no parameter"| P["PostRestockOutlay"] --> L
```

### ⚠ The cancel carries its OWN actor

`OrderCancelledEvent.actor_id` is whoever cancelled, not whoever placed. A reversal is a second act
and often a second person, and the ledger records who caused **each** movement — not who caused the
one being undone.

---

## terms-live-on-the-pair-detail

> The owner, in chat — *"is section of pair detail"*, answering [Q6](./team_balance_design_clarify.md#question).

**The verdict.** Credit Terms is **a section of the pair detail page**, not a screen of its own.
`team_balance_design.md` §Frontend Requirements names three screens and it stays three.

⚠ **This closes against the recommendation**, which argued for a screen. The argument was not
rhetorical and its consequence survives the answer — see below.

```mermaid
flowchart TB
  P["/liability/:counterpartyId — the pair detail"]
  P --> S1["summary"]
  P --> S2["the four entry tabs — money that moved"]
  P --> S3["limit history — a rule that changed"]
  P --> S4["TERMS — where the limit, fee and markup are SET"]
  D["the DEFAULT row, counterparty_id = 0"] -.->|"has no pair, so no page"| P
```

### What moves

| | |
| --- | --- |
| `pages/liability-terms/` | folds into the pair detail. `CreditMeter` and `TermsEditDialog` become `pages/liability-detail/components/` |
| the route `/liability/terms` | goes |
| `ChangeLogPanel` | **stays in `features/liability/`** — it was promoted there when a second page imported it, and it is still read by the terms section and the limit tab |
| the list of every team's terms | goes with the page. Terms are read where the pair is read |

### ⛔ The default row now has no home — and that is a NEW question, not the old one

[terms-are-team-scoped-root-is-global](../../business/balance/context_decision.md#terms-are-team-scoped-root-is-global)
sets the threshold *"per pair, with a **default row** for every counterparty without one"*, stored as
`counterparty_id = 0`. It is the rule every other row is an exception to.

A pair detail page is reached at `/liability/:counterpartyId`, and **team 0 is not a team** — there
is no pair to open, so the section that edits terms can never be shown for it.

**→ Recommend:** the default belongs to the CREDITOR, not to a pair, so it belongs on the creditor's
own settings — one field group on the team page, labelled *"terms for any team without their own"*.
The pair detail's terms section then shows the inherited value with an *"using the default"* marker
until somebody overrides it, which is what an exception-to-a-rule should look like. Filed as
[Q6](./team_balance_design_clarify.md#question) rather than assumed.

## the-summary-is-tiles-on-the-list

> The owner, in chat — *"q7, tile on the list"*, answering [Q7](./team_balance_design_clarify.md#question).

**The verdict.** *"Summarize All Balance"* is the **tiles on top of `/liability`**, not a screen of its
own. ✅ Closes as this file recommended.

§Frontend Requirements names **three requirements**, served by **two pages** — items 1 and 2 are one
screen read top to bottom.

```mermaid
flowchart TB
  subgraph L["/liability — one page, two requirements"]
    T["the four tiles — requirement 1"]
    R["the pair rows — requirement 2"]
  end
  T --> R
  R -->|"click a row"| D["/liability/:counterpartyId — requirement 3"]
```

### ⛔ It does not fix the tiles — it makes fixing them mandatory

[Critique 16](./team_balance_design_clarify.md#critique) survives this answer intact, and the answer
raises its cost: a separate screen could have run its own whole-set query, while a tile sitting on a
**paginated** list is now permanently exposed to the list's page window.

Today three of the four reduce `rows` — one page of **20**, further narrowed client-side by the
search box. A creditor with 21 counterparties reads a headline total that omits the 21st, and turning
to page 2 changes the "total".

| tile | today | after |
| --- | --- | --- |
| Awaiting confirmation | ✅ **already whole-set** — `LiabilityPositionListResponse.awaiting_confirmation` | unchanged. It is the precedent for the other three |
| Total payable | ⛔ `rows.reduce(…)` over the loaded page | from the response |
| Total receivable | ⛔ `rows.reduce(…)` over the loaded page | from the response |
| Oldest unsettled | ⛔ `rows.sort(…)[0]` over the loaded page | from the response — **and it needs the counterparty id too**, because the tile renders that team's name beneath the day count |

### The spec

Three fields on `LiabilityPositionListResponse`, beside `awaiting_confirmation` — the whole-set
number that already ships, so both the shape and the precedent are the service's own:

| field | |
| --- | --- |
| `int64 total_receivable` | Σ of positive balances across **every** counterparty, not the page |
| `int64 total_payable` | Σ of negative balances, as a positive magnitude — the screen never renders a sign ([direction.ts](../../../frontend/src/features/liability/direction.ts)) |
| `uint64 oldest_unsettled_counterparty_id` | whose `oldest_unsettled_at_unix` is the smallest non-zero one, so the tile can name the team. The timestamp itself is read from that row |

⚠ **A `LiabilitySummary` RPC is refused** — a second round trip for numbers the list query already
touches every row of.

⚠ **The client-side search must stop narrowing the tiles.** It filters `positions` in the browser, so
leaving it in place makes the tiles disagree with the filter in a new way — the summary is *all*
balance by requirement, and a search box is not a scope.

### What it does NOT settle

The **80% warning** is a per-row badge, not a tile ([Q9](./team_balance_design_clarify.md#question) is
still open on where the debtor's half lives). A tile that said *"3 teams near their limit"* would be a
fifth summary number nobody asked for.

---

## the-default-terms-row-is-a-dialog-on-the-list

> The owner, in chat — *"q6, dedicated popup in list"*, answering [Q6](./team_balance_design_clarify.md#question).

**The verdict.** The DEFAULT row — `counterparty_id = 0`, the terms applying to every team without
their own — is edited in a **dedicated dialog opened from `/liability`**.

⚠ **This closes against the recommendation**, which put the default on the creditor's own team
settings. The owner's answer keeps it one click from the rows it governs; the recommendation kept it
next to the other things a team configures about itself. Both were defensible and the placement is
now settled.

```mermaid
flowchart TB
  L["/liability — the pair list"]
  L -->|"toolbar action — Default Terms"| DLG["dialog: terms for any team without their own"]
  L -->|"click a row"| P["/liability/:counterpartyId"]
  P --> S["Terms section — this pair's override"]
  S -.->|"shows 'using the default' until overridden"| DLG
  X["/liability/0"]:::refused
  classDef refused stroke-dasharray: 4 4
```

### ✅ It needs no proto change, and no new route

Verified against the shipped contract — both halves already exist and are already reachable:

| | |
| --- | --- |
| read | `LiabilityTermsList` returns every terms row for the creditor, **default first** — [terms_list.go:21](../../../backend/services/liability_service/liability_v1/terms_list.go) orders by `counterparty_id ASC` precisely so it leads. The dialog takes the row where `counterparty_id == 0` |
| write | `LiabilityTermsSet` with `counterparty_id = 0` — the field carries no `gt = 0` constraint, and its comment already says *"0 sets the DEFAULT row"* |
| hooks | `useLiabilityTerms` / `useSetTerms` in [features/liability/queries.ts](../../../frontend/src/features/liability/queries.ts) — both exist, neither is called by a page today |

### The spec

| | |
| --- | --- |
| trigger | one toolbar action on `/liability`, beside the search — **not** a row, because the default is not a counterparty |
| body | `TermsEditDialog` with no `editing` counterparty and no `options` picker — the counterparty is fixed at 0 |
| wording | the dialog says *"terms for any team without their own"*. It must never read as *"terms for team 0"* |
| ⚠ file move | `TermsEditDialog` currently lives in [pages/liability-detail/components/](../../../frontend/src/pages/liability-detail/components/TermsEditDialog.tsx). A second page importing it makes it a domain component — it moves to **`features/liability/`**, per CLAUDE.md's placement rule. `CreditMeter` moves with it: the dialog imports `limitStateOf` from it |
| the pair section | shows the inherited value with a **"using the default"** marker until somebody overrides it — an exception to a rule should look like one |

### ⛔ A synthetic `/liability/0` route stays refused

It puts a page in the pair namespace for something that is not a pair, and every list row, breadcrumb
and back-link would special-case it. The dialog is what makes that route unnecessary.

### ⚠ It qualifies the decision above it, and the qualification is worth naming

[terms-live-on-the-pair-detail](#terms-live-on-the-pair-detail) reasoned *"terms are read where the
pair is read"*. That rule has exactly one exception and this is it: the default has no pair, so it is
read where the **set of pairs** is read. Not a contradiction — that decision opened this question
itself — but the rule is now *"a pair's terms live on the pair, the default lives on the list"*, and
restating the shorter version elsewhere would be wrong.

### What it fixes

⛔ A **live regression**: the default row has been settable nowhere in the running app since the terms
list screen was deleted. §Balance Policy's threshold for every unconfigured team has required direct
database access.
