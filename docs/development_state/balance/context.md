# Development state — balance

**Pass:** `agent_analysis` re-examination, `implementation_analysis` for the THRESHOLD slice, and
**three** re-examinations after three owner edits to `balance_context.md` and
`team_balance_design.md` in one day — all **COMPLETE** (2026-08-29).
**Lifecycle position:** ⛔ **waiting at `design_accept`** for the Credit Terms screen. That gate
blocks, so nothing behind it has run. ⚠ **And the owner's doc has since named three frontend
requirements that do not include this screen** — so the gate now has a question in front of it:
[technical balance Q7](../../technical/balance/team_balance_design_clarify.md#question), *is Credit
Terms a screen or a section?*
**The context as a whole does not advance** — the business lane's `clarity` gate answers **yes** with
9 open questions. One slice moved because none of them touched it.

⚠ **This context was built BEFORE it was designed.** `liability_service` shipped; the technical doc
[team_balance_design.md](../../technical/balance/team_balance_design.md) is still **0 bytes**. That is
backwards from HARD RULE 6, and it is why the technical clarify reads as a re-derivation of something
that already exists. Do not treat the missing doc as a missing design — read the migrations.

⚠ **The business word is `balance`, the code word is `liability`.** Same thing. And since `0d4cbc4`
*settlement* names a **different** service — do not read `no-overdue-only-the-threshold`'s "no
settlement cycle" as a statement about `settlement_service`.

## What EXISTS

| | |
| --- | --- |
| business doc | [business/balance/context.md](../../business/balance/context.md) — filled out. **15 decisions** in [context_decision.md](../../business/balance/context_decision.md) |
| technical doc | **empty** — one heading |
| proto | `proto/warehouse/liability/v1/` — **3 services, 10 RPCs** |
| schema | `liability_entries` · `liability_balances` · `liability_payments` · `liability_terms`, 4 migrations |
| service | `backend/services/liability_service/` — 12 handlers, mounted in `app_development` |
| tests | unit per RPC, plus `payment_confirm_race_test.go` (`-tags raceaudit`). `go build ./... && go vet ./...` clean, `go test ./backend/services/liability_service/...` passes |
| frontend | `pages/liability-list` · `pages/liability-detail` · `features/liability/`. `npm run typecheck` exits **0** |
| docs | [database-schema.md](../../database-schema.md) · [services/liability_service/rpc.md](../../services/liability_service/rpc.md) |

**All six business causes post today.** Direction is rendered as **words, never a sign**
(`features/liability/direction.ts`) — nothing shows a bare negative.

## What does NOT exist

| | cost |
| --- | --- |
| **the terms screen** | `liabilityTermsClient` has **zero callers**. The debt threshold — fully decided — is configurable only by direct database access |
| **the 80% warning** | needs that screen, and a place on the daily report |
| **`actor_id` on `liability_entries`** | ✅ **DECIDED, not built** — [every-entry-names-who-posted-it](../../technical/balance/team_balance_design_decision.md#every-entry-names-who-posted-it). It records the **human**, not a system sentinel: `restock_request_fulfill.go:191` already computes the actor and `PostRestockOutlay`'s signature drops it. Two parameters plus a NOT NULL column. ⚠ Rows written before it are **permanently unattributable** and every day adds more |
| **the terms change log** | [a-limit-change-is-recorded](../../business/balance/context_decision.md#a-limit-change-is-recorded) requires actor + reason + a log with a **nullable** limit. None of it is built |
| **a `rejected` payment state** | ⛔ **a confirmed DEFECT and now BUILD WORK.** §Payment Flow gives the creditor `reject`, terminal, posting nothing. Spec in [§Reject, as build work](../../technical/balance/team_balance_design_clarify.md#reject-as-build-work) — a proto value, an RPC, a rename of `reversal_reason` to `reason`, and one dialog. No migration for the status: the column is text |
| **payment PROOF, and any way for the creditor to see it** | ⛔ **the flow's middle step cannot be executed.** A payment carries a 500-char `note` and no document, and `document_service` scopes every read to the owning team — so a payer's file is NotFound to the creditor. ⚠ **Smaller than first reported**: a `document_shares` row + a `ShareDocument` RPC scoped to the file's owner + one clause in `GetDownloadUrl`, all in the payer's own scope. **No service-to-service trust path is needed** — that first assessment is retracted. [technical C19](../../technical/balance/team_balance_design_clarify.md#critique) |
| **a `PaymentReverse` screen** | ⚠ **INVERTED — no longer a defect.** It was recorded as one last round. §Payment Flow makes `accept` terminal, so the shipped RPC may be a path the design does not want. Do not build a screen until [business Q11](../../business/balance/context_clarify.md#question) answers |
| **the selling team's daily report** | `revenue_service` was removed in `0d4cbc4`. `StatementMode` is `"warehouse"` alone and the page **refuses** a selling team |
| **a dispute mechanism / a chase instrument** | neither exists. With no cycle, lowering the limit is the only lever a creditor has |

## ✅ The toolchain blocker is GONE (2026-08-29)

This section used to say the BSR token was invalid and that every remaining backend item was blocked
behind it. **It was, and it is not any more** — fixed by removing the account, not by getting one.

[proto/buf.gen.yaml](../../../proto/buf.gen.yaml) now uses `local:` plugins:

| plugin | pinned by |
| --- | --- |
| `protoc-gen-go` | a `tool` directive in the root [go.mod](../../../go.mod) |
| `protoc-gen-connect-go` | the same |
| `protoc-gen-es` | a devDependency in [frontend/package.json](../../../frontend/package.json) |

```sh
cd frontend && npm install     # the TS plugin lives here
cd proto && buf generate       # no Buf account
```

**Verified by running it**: 51 files regenerated, `go build`/`go vet`/`go test` clean, `tsc --noEmit`
clean. The Go diff was the version stamp alone; the TS diff was `codegenv1` → `codegenv2` and
`| undefined` on optional fields, because the generator now matches the runtime it generates against.

⚠ **`clean: true` still empties both gen trees on a failed run.** They are committed —
`git checkout -- backend/gen frontend/src/gen`.

**So these four are now ordinary BUILD work, not blocked work:**

| the change | why it is wanted |
| --- | --- |
| the vocabulary rename | [the-ledger-speaks-the-business-words](../../business/balance/context_decision.md#the-ledger-speaks-the-business-words) — **decided**. `broken_good` / `lost_good` / `found` are one `STOCK_DAMAGE` + a boolean today |
| `order_id` on `LiabilityEntryListFilter` | [balance Q9](../../business/balance/context_clarify.md#question) — the fee knows its order, no caller can ask |
| `LIABILITY_PAYMENT_STATUS_REJECTED` | [technical Q5](../../technical/balance/team_balance_design_clarify.md#question) — today a creditor must *confirm then reverse* a payment that never arrived |
| `actor_id` on the entry + the terms change log | [technical Q4](../../technical/balance/team_balance_design_clarify.md#question) and [a-limit-change-is-recorded](../../business/balance/context_decision.md#a-limit-change-is-recorded) |

⚠ **A live bug rides on the first one.** The daily statement reads `LiabilitySourceType.COD_FEE` in
three files and **nothing posts it** — `RESTOCK_OUTLAY` superseded it and appears in no column. The
COD column is permanently zero. The rename fixes it without touching the screen.

## 🆕 The pair detail now carries the LIMIT history too

`team_balance_design.md` §Detail Pair Team Balance named three things, and the second was a log
this page did not have. Recorded as
[the-pair-detail-shows-both-logs](../../technical/balance/team_balance_design_decision.md#the-pair-detail-shows-both-logs),
and built:

| | |
| --- | --- |
| a fifth tab | `/liability/:counterpartyId` → *Limit changes*, filtered to that pair |
| the panel moved | `pages/liability-terms/components/ChangeLogPanel` → **`features/liability/`** — two pages read it now, so it stopped being one page's component (CLAUDE.md) |
| stories | 3, on a new `LiabilityDetailPage.stories.tsx` — the page had none before |
| the stub grew | `liabilityEntryList` and `LiabilityPaymentService`, so the detail page is previewable at all |

⚠ **The two logs must never merge.** The entry tabs are money that MOVED; the limit tab is a RULE
that changed. Different grains, and only one of them is a ledger.

⚠ **`limitPage` is a THIRD page number** on that screen, deliberately. One shared number would turn
to page 2 of a log the reader is not looking at. It also has to be declared with the other hooks,
**above** the `if (!current)` guard — declared after it, React throws on the hook order.

## 🆕 §Payment Flow specified the lifecycle — and it matched the proposal

Two diagrams in `balance_context.md`, recorded as
[the-debtor-claims-the-creditor-decides](../../business/balance/context_decision.md#the-debtor-claims-the-creditor-decides).
The technical clarify's §Item 6 proposal turned out right in every part it stated — payer creates,
creditor decides, a claim posts nothing, reject is terminal — so nothing shipped has to change.

| §Payment Flow | shipped |
| --- | --- |
| the **debtor** creates, seeing a negative figure | ✅ `PaymentRecordRequest.team_id` is the payer **and** the scope |
| carries **proof of bank transfer** | ❌ nothing to carry it, and the creditor could not read it |
| the creditor checks **manually** | ⛔ not possible — nothing to look at |
| accept posts, reject posts nothing | ✅ accept · ❌ reject |
| `accept` is **terminal** | ⚠ shipped `REVERSED` leaves it |

⚠ **Two claims from last round changed.** The missing `rejected` state is **confirmed** as a defect
and is now buildable. The missing `PaymentReverse` screen is **not** a defect any more — a terminal
`accept` makes that RPC questionable rather than under-built. The next agent should not build it.

⚠ **The proof requirement, and a retraction.** `document_service` answers NotFound for another
team's file *on purpose*, and it cannot learn what a payment is without becoming the wrong service.
This report first said the fix needed an **internal, non-team-scoped signing path** with balance
vouching for the creditor. **That is retracted** — it is the expensive design, and one bug in the
vouching service's relation check would leak every private file. **The payer can grant the share
themselves**, in their own scope, before creating the payment: a `document_shares` row, a
`ShareDocument` RPC scoped to the file's owner, and one extra clause in `GetDownloadUrl`. No
cross-service call, and `document_service` keeps its invariant — *no read without a row saying you
may.* Two rules come with it: a shared file cannot be hard-deleted, and a share is permanent.

## ⚠ 10 story tests fail, and they are the daily statement's

`npm run test:stories` is **1416 pass / 10 fail**, all in
`pages/daily-statement/DailyStatementPage.stories.tsx` — including one named *"A Selling Statement
Says Its Income Is Only Expected"*. **Pre-existing**, proved by restoring HEAD's generated TypeScript
and re-running: the same 10 fail.

They are stories for the **selling mode `0d4cbc4` removed from the page and left in the story file**.
Same root cause as [Q8](../../business/balance/context_clarify.md#question) — fix the question first,
then the stories follow it. Do not "fix" the stories in isolation.

## 🟡 The threshold slice — `implementation_analysis` DONE, waiting at `design_accept`

The prototype exists and is previewable. **Nothing after `design_accept` has run**, by design: that
gate blocks, so there is no migration, no handler and no wiring behind it.

```sh
cd frontend && npm run storybook       # Pages/Liability/CreditTerms
```

| | |
| --- | --- |
| the page | `pages/liability-terms/` — the table, the 80% warning, the change log |
| its components | `CreditMeter` · `TermsEditDialog` · `ChangeLogPanel` — all page-local, none reused elsewhere yet |
| the way in | a header action on `/liability`, **not a menu entry** — only six roles may write terms and the menu is read by everyone who can read a balance |
| reads / writes | `features/liability/queries.ts` — `useLiabilityTerms`, `useTermsHistory`, `useSetTerms`, `useDeleteTerms` |
| the stub | `LiabilityTermsService` in `.storybook/stubTransport.ts`, with a **writeable** terms table so a story can freeze a team and watch the row change. Reset in `preview.tsx`'s `beforeEach` |
| stories | 9, each pinning one rule |

**The design decision the screen is built around:** the credit limit is a **three-way choice**, never
a number field. `absent` · `0` · `n` are unlimited, frozen and a ceiling — and the first two are
OPPOSITES. The amount input only exists once "Limit of" is chosen, so a blank field can never be
saved as 0; the meter renders unlimited and frozen as words rather than a bar, because a percentage
of unlimited is not a number and a percentage of zero is a division by zero.

### The contract grew, and that is part of this gate

The contract is derived from the screen and accepted with it (HARD RULE 6):

| | |
| --- | --- |
| `reason` on `LiabilityTermsSet` / `LiabilityTermsDelete` | required when the actor is outside the creditor team. ⚠ The ACTOR is not a field — it comes from the token |
| `LiabilityTermsHistoryList` + `LiabilityTermsChange` | the change log, with **both** limits optional |

⛔ **`LiabilityTermsHistoryList` returns `Unimplemented`** — deliberately, and it refuses rather than
returning an empty page, because an empty list reads as *"nobody ever changed a limit"*. It exists
only because a service is mounted whole. See
[services/liability_service/rpc.md](../../services/liability_service/rpc.md).

### What the next pass builds — AFTER the gate

1. `liability_terms_changes` — the migration. ⚠ **Both limit columns NULLABLE.**
2. The actor and the override flag, stamped from the token in `Set` and `Delete`.
3. `LiabilityTermsHistoryList` for real, then its unit test and its performance audit.
4. The 80% warning's **second** home: the daily report. The screen has it — the report does not.

## ✅ Why this slice could move at all

Because `implementation_analysis` is **frontend-first with mock wiring and produces a Storybook
prototype — no backend, no migration** — and because the threshold itself has no open question left.

**The threshold is settled end to end** — 7 decisions, no open question:
[the-threshold-warns-at-eighty-percent](../../business/balance/context_decision.md#the-threshold-warns-at-eighty-percent) ·
[the-threshold-defaults-to-unlimited](../../business/balance/context_decision.md#the-threshold-defaults-to-unlimited) ·
[three-roles-edit-the-threshold](../../business/balance/context_decision.md#three-roles-edit-the-threshold) ·
[terms-are-team-scoped-root-is-global](../../business/balance/context_decision.md#terms-are-team-scoped-root-is-global) ·
[warehouse-roles-count-as-their-own-team](../../business/balance/context_decision.md#warehouse-roles-count-as-their-own-team) ·
[a-limit-change-is-recorded](../../business/balance/context_decision.md#a-limit-change-is-recorded) ·
[the-block-stops-orders-only](../../business/balance/context_decision.md#the-block-stops-orders-only).

Every input the screen needed was already decided. ⚠ **What was NOT decided and had to be derived
from the screen is the contract** — the `reason` field and the change-log RPC — which is why those go
through `design_accept` with the pages rather than being settled separately.

## ✅ THREE ANSWERS BUILT (2026-08-31) — and NONE of the migrations applied

The owner answered three questions in one message. All three are built.

| answered | built |
| --- | --- |
| [an-incidental-line-must-say-what-it-was-for](../../business/balance/context_decision.md#an-incidental-line-must-say-what-it-was-for) | one `INCIDENTAL` cost kind, the note required **in the proto**, the picker deleted, `inventory_service` 00022 |
| [terms-live-on-the-pair-detail](../../technical/balance/team_balance_design_decision.md#terms-live-on-the-pair-detail) | `/liability/terms` gone, `TermsPanel` as a sixth tab on the pair detail |
| [a-payment-must-carry-proof](../../business/balance/context_decision.md#a-payment-must-carry-proof) | `document_shares` + `ShareDocument`, `liability_payment_documents`, and an upload in the payment dialog |

⛔ **FOUR MIGRATIONS ARE WRITTEN AND NONE HAS RUN** — Docker was never up on this machine, so
`san migrate up` never executed and every DB-backed test skipped:
`liability_service` 00005 and 00006, `inventory_service` 00022, `document_service` 00005. The next
agent must run them and re-run `go test ./...` with Postgres up before trusting any of it.

### 🆕 The proof plumbing, and the invariant it protects

The creditor has to read a file the payer owns, and `GetDownloadUrl` scopes every read to the owning
team. **The payer grants the share themselves**, as themselves — so no service ever asks another for
permission and `document_service` keeps *there is no read without a row saying you may*.

```
RequestUpload(team=payer) → PUT → ConfirmUpload → ShareDocument(with=creditor) → PaymentRecord
```

| | |
| --- | --- |
| `document_shares` | unique on (document, team); **ON DELETE RESTRICT** on the document, because evidence for a decision cannot be withdrawn by the party who supplied it. There is no unshare |
| `liability_payment_documents` | a child table, **not** a `text[]` — that would have been this system's first array column and a new driver dependency for one field |
| the contract | `document_ids` `min_items: 1` on record. Neither table has a NOT-EMPTY constraint: payments and cost lines written before today legitimately have none, and no migration can invent a bank slip |
| 6 unit tests | on `ShareDocument` — including that a stranger still gets NotFound, and that a shared document cannot be deleted |

### ⚠ What is NOT covered

The creditor's screen shows that proof exists; **it has no viewer yet** — no call to
`GetDownloadUrl` from the payment row. The share makes it possible; the button is not built.

## ✅ THE LEDGER MIGRATION IS BUILT (2026-08-31) — and NOT YET APPLIED

All three approved changes landed in one pass, as
[00005_rename_entries_to_logs_and_business_words.sql](../../../backend/services/liability_service/db_migrations/00005_rename_entries_to_logs_and_business_words.sql).

| | |
| --- | --- |
| the source-type vocabulary | `order_fee` · `product_fee` · `payment` · `incidental_fee` · `broken_good` · `lost_good` · `found`. `COD_FEE`'s number is **reserved**, not reused |
| `actor_id` | `BIGINT NOT NULL DEFAULT 0` on the log table, threaded from four origins |
| the rename | `liability_entries` → `liability_logs`, with its indexes, constraint and sequence renamed explicitly — Postgres does not follow the table |

⛔ **NOT RUN. Docker was not running on this machine**, so `san migrate up` never executed and the
DB-backed tests skipped. The next agent must run it and re-run `go test ./...` with Postgres up
before trusting any of it. Everything that can be checked without a database was:
`go build` · `go vet` · `buf lint` · `tsc` · **1428/1438 stories** (the 10 are the pre-existing
daily-statement failures) · 208 mermaid diagrams.

### ✅ A live bug is fixed on the way past

The daily statement read `COD_FEE`, superseded and posting nothing since — so **its column reported 0
every day while the warehouse's outlay appeared in no column at all.** It now reads
`INCIDENTAL_FEE`.

### ⚠ What the migration CANNOT recover

`stock_damage` carried three business movements under one name. `reversal = TRUE` is recoverably
`found`; everything else was broken **or** lost and no column says which, so it lands on
`broken_good` — **a documented guess**, written into the migration so nobody later reads those rows
as authoritative.

### 🆕 Two things the build surfaced

| | |
| --- | --- |
| **the actor was dropped at EVERY boundary** | not just the poster's. `OrderPlacedEvent` had no actor field at all, so the two highest-volume causes had no channel to carry one. Both order events gained `actor_id`. Recorded as [the-actor-was-dropped-at-every-boundary](../../technical/balance/team_balance_design_decision.md#the-actor-was-dropped-at-every-boundary) |
| **a count shortfall is now `lost_good`** | `stock_opname` posted shrinkage under the same type as breakage. It is shrinkage, and it now says so |

## ⚠ Still undecided, and now visible in the code

| | |
| --- | --- |
| **`liability_terms.handling_fee`** | the ledger line is `order_fee` and the terms column that sets its rate is still `handling_fee` — so the Credit Terms screen says *Handling fee* for money the pair detail calls an *Order fee*. Now filed as [technical Q8](../../technical/balance/team_balance_design_clarify.md#question), same reason as above |
| **the restock cost-kind collapse** | `RESTOCK_COST_KIND_COD_SHIPPING` + `OTHER` → one `INCIDENTAL` is decided and **not done** — the only unbuilt step of an otherwise-complete migration. Now filed as [Q12](../../business/balance/context_clarify.md#question) rather than living only here: a state report is written for the next agent, and an open question belongs in the clarify file of the doc that can answer it (HARD RULE 7b) |

## ⚠ SUPERSEDED — what this section planned is BUILT (see above)

| | |
| --- | --- |
| the source-type vocabulary | [the-ledger-speaks-the-business-words](../../business/balance/context_decision.md#the-ledger-speaks-the-business-words) — decided, unrun |
| `actor_id` on the entries table | [every-entry-names-who-posted-it](../../technical/balance/team_balance_design_decision.md#every-entry-names-who-posted-it) — decided, unrun |

Both touch the same table and the same proto — run separately, each is a full pass over the service.

⚠ **A third rider is proposed and undecided**: renaming `liability_entries` → **`liability_logs`**
([technical Q8](../../technical/balance/team_balance_design_clarify.md#question)). It keeps the
`liability` prefix, so it does not disturb the decision below. **153 occurrences across 38 files** —
cheap inside this migration, a second pass outside it. What it really settles is the name of the
**other** log, the limit history, which does not exist yet.

> ⛔ **A third rider was floated and cancelled.** Renaming `liability_*` to `balance_*` —
> [liability-stays](../../technical/balance/team_balance_design_decision.md#liability-stays). Do not
> re-open it: the objection (the name describes one leg of a **mirrored pair**, so half the rows are
> named after the wrong side) is **accepted as a known cost**, not unheard. The cost that settled it
> was 141 files, and two tables left worse off — `balance_balances` and `balance_terms`.

## Open questions — 18, and FOUR of them gate work

Business: [context_clarify.md](../../business/balance/context_clarify.md#question) — **12**.
Technical: [team_balance_design_clarify.md](../../technical/balance/team_balance_design_clarify.md#question) — **6**.

| gates work | |
| --- | --- |
| [Q8](../../business/balance/context_clarify.md#question) whose job is the selling daily report | a shipped page **refuses** selling teams today. Balance's §Responsbility 2 claims it |
| [Q2](../../business/balance/context_clarify.md#question) does `found` need the owner's acknowledgement | if yes, `found` becomes two-phase like a payment — a state machine and a screen that do not exist |
| [Q10](../../business/balance/context_clarify.md#question) is payment proof REQUIRED | the flow's middle step is unexecutable without it. ⚠ The fix is **ordinary build work**, not an architecture decision — an earlier claim that it needed a service-to-service trust path is retracted |
| [Q12](../../business/balance/context_clarify.md#question) must an incidental cost line carry a NOTE | ⛔ **the sharpest one**: it is the LAST step of a migration that has otherwise already run, and it waits on a rule only the owner can set because it adds a required field to what a warehouse person types |

The rest are real but gate nothing shipped: operating costs, repayment in goods, the return half of
`cod_fee`, dispute finality, the chase instrument, external payables, the cost-line enum, `offset` as
a method, who owns found goods, and whether a confirmed payment is final.

> ⛔ **Technical Q5 — may a creditor reject — is ANSWERED and deleted.** The technical clarify's
> questions were **deliberately not renumbered**: `context_decision.md` is append-only and already
> cites *technical Q5* and *Q6*, so renumbering would silently repoint them. That is the ordinal cost
> RULE 12 names, showing up in practice.
