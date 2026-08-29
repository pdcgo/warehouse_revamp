# Development state — balance

**Pass:** `agent_analysis` re-examination, then `implementation_analysis` for the THRESHOLD slice —
both **COMPLETE** (2026-08-29).
**Lifecycle position:** ⛔ **waiting at `design_accept`** for the Credit Terms screen. That gate
blocks, so nothing behind it has run.
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
| **`actor_id` on `liability_entries`** | causes 1–5 are **permanently unattributable**. Only payments record who acted, and it cannot be back-filled |
| **the terms change log** | [a-limit-change-is-recorded](../../business/balance/context_decision.md#a-limit-change-is-recorded) requires actor + reason + a log with a **nullable** limit. None of it is built |
| **a `PaymentReverse` screen** | the RPC ships and nothing calls it — a confirmation made in error cannot be undone by anyone |
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

## Open questions — 14, and only three of them gate work

Business: [context_clarify.md](../../business/balance/context_clarify.md#question) — **9**.
Technical: [team_balance_design_clarify.md](../../technical/balance/team_balance_design_clarify.md#question) — **5**.

| gates work | |
| --- | --- |
| [Q8](../../business/balance/context_clarify.md#question) whose job is the selling daily report | a shipped page **refuses** selling teams today. Balance's §Responsbility 2 claims it |
| [Q2](../../business/balance/context_clarify.md#question) does `found` need the owner's acknowledgement | if yes, `found` becomes two-phase like a payment — a state machine and a screen that do not exist |
| [technical Q5](../../technical/balance/team_balance_design_clarify.md#question) may a creditor REJECT a payment | a terminal state, and it changes the payment screen being designed |

The rest are real but gate nothing shipped: operating costs, repayment in goods, the return half of
`cod_fee`, dispute finality, the chase instrument, external payables, the cost-line enum, `offset` as
a method, and who owns found goods.
