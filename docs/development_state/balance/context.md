# Development state — balance

**Pass:** implementation of `balance_context.md`, end to end (2026-08-31). Everything the owner's doc
promises that has been DECIDED is now built, tested and documented.

**Lifecycle position:** `Run Testing` complete — unit, integration and e2e all green for the first
time. ⛔ **`design_accept` still un-previewed**: the owner has not looked at the running screens.

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
| §Responsbility 3 — Manage Payments Across Team | ✅ record · confirm · **reject** · reverse, with proof readable by both sides |
| §Payment Flow — claim with proof → check manually → accept / reject | ✅ **complete**, and covered end to end in e2e |
| §Payment lifecycle — pending → accept \| reject | ✅ both terminal states exist |
| §What Things Affect The Balance — all six causes | ✅ all post |
| §What Warehouse Can Receivable — `order_fee` · `cod_fee` · `found` | ✅ `cod_fee` is `incidental_fee` in the ledger |
| §What Warehouse Can Payable — `broken_good` · `lost_good` | ✅ |
| §Balance Policy 1 — threshold set by team owner, overridable by admin/root | ✅ and every change is **recorded** with actor, reason and override flag |
| §What Things Affect The Balance 3 — Cross/Shared Product | ⚠ the CHARGE is balance's, but the **rate is `product_service`'s** ([the-cross-markup-belongs-to-the-product](../../business/balance/context_decision.md#the-cross-markup-belongs-to-the-product)). Removed from the balance screens; the ledger still reads balance's column — [technical Q10](../../technical/balance/team_balance_design_clarify.md#question) |
| §Balance Policy 2 — cross products compared to the committed pair row only | ✅ `CheckCredit` checks each creditor against **its own** pair row |
| §About Thresholds 1 — 80% warning on the balance screen | ✅ per-row badge on `/liability`. ⚠ the daily-report home is deferred with the report |
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

⚠ **The dev database has a default-terms row for team 13** (`counterparty_id = 0`, fee 15.000, markup
20%, no limit) and one log entry, left deliberately so the preview has something to look at. The one
row written before the timestamp fix was deleted.

## ⛔ One pre-existing failure, NOT fixed and NOT mine

`restock.spec.ts:154` — *"tick two products in the picker and save"* fails on the product picker's
"ongoing" badge. **Verified by stashing this pass's changes and re-running: it fails identically
without them.** It is outside the balance context, so it was reported rather than folded into this
work. `dev` is not fully green because of it.

## What is left, and why

**Nothing in the doc is unimplemented for a reason other than a decision.** What remains is either
parked by the owner or waiting on an answer only they can give (HARD RULE 8):

| | |
| --- | --- |
| the selling team's daily report | ⛔ **deferred** ([the-daily-report-is-deferred](../../business/balance/context_decision.md#the-daily-report-is-deferred)). §Responsbility 2 goes on promising it |
| a dispute mechanism | ⛔ **[balance Q5](../../business/balance/context_clarify.md#question)**, and it is now **#3 in [biggest_question.md](../../biggest_question.md)** — refusing `found` a handshake made dispute a team's only recourse against a charge asserted in the asserter's favour |
| a chase instrument | [balance Q6](../../business/balance/context_clarify.md#question) — lowering the limit is still the only lever |
| a `PaymentReverse` screen | [balance Q11](../../business/balance/context_clarify.md#question) — the RPC ships and may be a path the design does not want. **Do not build it until that answers** |
| an `order_id` filter on the log | [balance Q9](../../business/balance/context_clarify.md#question) — recommended, not decided |
| `handling_fee` → `order_fee` | [technical Q8](../../technical/balance/team_balance_design_clarify.md#question) — the terms screen says *Handling fee* for money the pair detail calls an *Order fee* |
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
