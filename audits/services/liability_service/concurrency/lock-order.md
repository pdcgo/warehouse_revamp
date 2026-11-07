# liability_service — lock order

The service-wide matrix the `audit-sql` skill writes unconditionally. It is not a finding; it is the
reference the **next** write handler is checked against, and the only artefact that can show a lock
inversion — which is invisible from inside any one handler.

**Verdict: one hierarchy, no inversion.** Every path that locks takes `liability_payments` before
`liability_balances`, and no path takes them the other way round.

| Handler | Lock order | Notes |
| --- | --- | --- |
| `LiabilityPaymentConfirm` | `liability_payments` → `liability_balances` | `lockPayment` (`FOR UPDATE`), then `PostEntry` |
| `LiabilityPaymentReject` | `liability_payments` | a strict PREFIX of confirm's order, so it cannot invert it. Nothing posts |
| `LiabilityPaymentRecord` *(2026-11-07)* | `liability_balances` (`FOR SHARE`, the payer's row) | the-debtor-claims-the-creditor-decides made it a check-then-insert: the payer's side of the pair must be negative. The read is `FOR SHARE` inside the claim's transaction, so a confirm squaring the pair (PostEntry's upsert) is waited for and its result read; two claims by one debtor never queue (SHARE locks do not conflict). It takes no `liability_payments` lock — it INSERTs a new row — so it cannot invert confirm's order ([`payment_record_race_test.go`](../../../../backend/services/liability_service/liability_v1/payment_record_race_test.go)) |
| `PostEntry` | `liability_balances` | reached from confirm, or standalone from another service |
| `ChargeTransferCourier` *(2026-11-04)* | `liability_balances` | `PostEntry` on its own transaction, from Warehouse Transfer Accepted. Idempotent by the ledger's unique key (`transfer_fee`, the transfer): 8 deliveries at once → one posting, every one acked; beside a restock courier charge of the same number → both post, no deadlock ([`transfer_courier_charge_race_test.go`](../../../../backend/services/liability_service/liability_v1/transfer_courier_charge_race_test.go)) |

> `LiabilityPaymentReverse` was a third locking path (same order as confirm) and was **removed** on
> 2026-10-01 by [an-accepted-payment-is-final](../../../../docs/business/balance/context_decision.md#an-accepted-payment-is-final).
| `LiabilityTermsSet` | *(none)* | read-then-upsert in one transaction — see below |
| `LiabilityTermsDelete` | *(none)* | read-then-delete in one transaction — see below |

## Why the payment lock is the only one

`liability_payments` is the only table in this service where a handler **reads a value, decides on
it, and writes based on that decision** — the check-then-act shape (pattern 2). Everything else
avoids the lock rather than taking it:

| | how it stays safe without a lock |
| --- | --- |
| `liability_balances` | `INSERT … ON CONFLICT (team_id, counterparty_id) DO UPDATE SET balance = balance + EXCLUDED.balance` — one statement, so the database serialises the arithmetic. There is no Go-side read to go stale |
| `liability_logs` | append-only, and idempotent through its unique key `(source_type, source_id, counterparty, reversal)`. A duplicate posting is refused by the index, not by a check |
| `liability_terms` | `ON CONFLICT (team_id, counterparty_id) DO UPDATE` — "set the rate" is one act whether or not a row exists |

## ⚠ The one thing worth watching — `liability_terms_logs`

`LiabilityTermsSet` and `LiabilityTermsDelete` now read the **before** state and write a log row in
the same transaction. That is a read-then-write, and it is deliberately **not** locked.

**→ Why it is acceptable:** the log is a *record of what happened*, not a value anything is computed
from. Two concurrent edits to one pair produce two log rows whose `old_*` values may both describe
the same prior state — which is a slightly redundant history, not a wrong one, and the `liability_terms`
row itself still lands correctly because the upsert is one statement.

**→ Why it is worth writing down anyway:** if anything ever *derives* from this log — "how many times
was this limit raised", an approval workflow, a rate-of-change alarm — the missing lock stops being
cosmetic. At that point the read must become `FOR UPDATE` on `liability_terms`, taken **before**
`liability_payments` is not an issue (no handler takes both), so the hierarchy would simply gain a
third entry at the top.

## Proved

| | |
| --- | --- |
| `TestRace_LiabilityPaymentConfirm` | 8 concurrent confirms → exactly 1 winner, balance 0 |
| `TestRace_LiabilityPaymentConfirmAgainstReject` | 🆕 8 callers alternating confirm/reject → 1 winner, and the status and the balance tell the SAME story |
| `TestInterleave_RejectBlocksBehindConfirm` | 🆕 **the proof of safety** — B blocked 305ms on A's lock and re-read `confirmed` after acquiring it |
| `TestInterleave_RecordWaitsForTheConfirmThatSquaresThePair` | *(2026-11-07)* a second claim's owes-check blocked 304ms behind a confirm's posting, then read the squared pair and refused — never the 15.000 from before (fails without `FOR SHARE`: returned at once and passed) |
| `TestInterleave_RecordTwoClaimsDoNotQueue` | *(2026-11-07)* two claims by one debtor read the pair at once, neither blocked |

```sh
go test -tags raceaudit -run "TestRace_Liability|TestInterleave_" ./backend/services/liability_service/liability_v1/
```

## Not proved

- **`PostEntry` called from ANOTHER service** (`inventory_service`'s damage and restock postings) racing
  a payment confirm. Both end at `liability_balances` through the same one-statement upsert, so the
  arithmetic is safe by construction — but the cross-service path has no race test of its own.
- **Two different pairs deadlocking.** Every posting writes two legs, and
  [technical Critique 8](../../../../docs/technical/balance/team_balance_design_clarify.md#critique)
  raises the possibility that `(A,W)` then `(W,A)` in one handler and the reverse in another could
  deadlock. `PostEntry` is the single write path and the legs go through one upsert statement, so the
  window is small — but it has never been raced, and that critique is still open.
