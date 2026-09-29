# Development state — financial_account

**Pass:** business analysis on the owner's new [financial_account/context.md](../../business/financial_account/context.md)
— a team's bank, ShopeePay and cash accounts, each with a balance and a log — re-examined after each of the owner's
edits. Questions: [context_clarify.md](../../business/financial_account/context_clarify.md). Decisions:
[context_decision.md](../../business/financial_account/context_decision.md) — **ten owner decisions**. The lifecycle
is at *waiting for the owner* on Q1–Q3 and Q8–Q10 — no Storybook prototype, no technical doc, no code.

## Decided

| decision | what it means for the build |
| --- | --- |
| [the-accounts-are-one-ledger](../../business/financial_account/context_decision.md#the-accounts-are-one-ledger) | `financial_accounts` is the state, `financial_account_logs` the log — no balance moves without a log row, in the same transaction |
| [a-row-comes-by-hand-or-from-the-broker](../../business/financial_account/context_decision.md#a-row-comes-by-hand-or-from-the-broker) | two ways in: the account screens, or a listener per topic. No RPC for other services to write with |
| [shopeepay-is-the-wallet-a-team-pays-with](../../business/financial_account/context_decision.md#shopeepay-is-the-wallet-a-team-pays-with) *(Q5)* | a `shopeepay` account is the team's e-wallet — no settlement row ever posts to an account |
| [a-real-account-is-recorded-once](../../business/financial_account/context_decision.md#a-real-account-is-recorded-once) *(Q6)* | a partial unique index on `(account_type, account_number)` where a number exists, across all teams, archived included · a cash box exempt · ⚠ the `team_infos` copy (Q9) must list colliding numbers, never drop them |
| [below-zero-is-warned-never-refused](../../business/financial_account/context_decision.md#below-zero-is-warned-never-refused) *(Q7)* | no balance check on any write path · a warning on the list and the account page while below zero |
| [opening-transfer-and-team-payment-join-the-types](../../business/financial_account/context_decision.md#opening-transfer-and-team-payment-join-the-types) *(Q4, three of four)* | three more `change_type` values · ⚠ their posting rules — the opening row at create, two legs per transfer, a team payment at confirm — are my spec, marked so in the decision |
| [capital-joins-the-types](../../business/financial_account/context_decision.md#capital-joins-the-types) *(Q4, the fourth)* | the owner's money in or out, one signed type · ⚠ two rows sharing a `group_id` when it moves between teams — my spec |
| [adjustment-is-for-reconciling-only](../../business/financial_account/context_decision.md#adjustment-is-for-reconciling-only) *(Q4)* | no RPC takes an adjustment amount — `Reconcile` takes the bank's figure and posts the difference · ⚠ a note on a non-zero difference and a `reconciled_at` stamp are my spec |
| [the-log-says-balance-after](../../business/financial_account/context_decision.md#the-log-says-balance-after) *(critique 5)* | the log's column is `balance_after` = the previous row's + this row's `change` |
| [restock-is-never-typed-by-hand](../../business/financial_account/context_decision.md#restock-is-never-typed-by-hand) *(Q10, for restock)* | no hand RPC takes a `restock` · it comes only from a restock event inventory does not publish yet — until then a restock's payment shows only through a reconcile |

## What exists

Nothing of this context. What it overlaps is already built elsewhere:

| | where | on the broker | the clarify proposes |
| --- | --- | --- | --- |
| a team's one bank — type, holder, number | `team_service` · `team_infos` · the team detail's *contact & bank* · `TeamInfoUpdate` | — | Q9 — it becomes one of the team's accounts, marked *where we are paid* |
| how a restock was paid — `shopee_pay` / `bank_account` | `inventory_service` · `restock_requests.payment_type` · `PaymentTypeSelect` | ❌ | Q2 — *which* account, replacing the kind |
| expenses | `expense_service` · `expense_records` — names no account | ❌ | Q3 — an optional *paid from* |
| withdrawals | `settlement_service` · `withdrawal` rows, from the importer | ✅ `SettlementLogPosted` | Q1 — each posts `marketplace_withdrawal` into its shop's account |
| team payments | `liability_service` · `liability_payments` | ❌ | ✅ `team_payment` is a type — posts both legs at confirm, from a new payment event |

## Proposed, not decided

[the-act-posts-the-entry](../../business/financial_account/context_clarify.md#the-act-posts-the-entry) — one way in
per type: by hand only opening, transfer, capital, reconcile; everything else from the broker (Q10). Build order:
accounts and the hand path → withdrawal (its event already exists) → restock → expense → team payment, each of the
last three needing a new event variant first.

⛔ The owner's log table has no account column — now a recorded
[contradiction](../../business/financial_account/context_clarify.md#one-ledger-and-its-state-and-its-log-have-different-grains)
with the ledger line 13 names. The owner's log edits so far renamed `balance_after` and grew the type list; the
account, the cause (critique 1) and the date the money moved (critique 7) are still missing. Do not build from it as
written.

## Open

Q1–Q3 and Q8–Q10 in the clarify. **Q10 first** — now only `expense`, `revenue_fund` and `team_payment`: are they
broker-only like `restock` — then **Q8**, which screens show a balance.

**Next agent:** when the owner answers, record it in `financial_account/context_decision.md` (named, RULE 12), delete
the answered question, rebuild `docs/biggest_question.md`. The service will be
`backend/services/financial_account_service/` (HARD RULE 2). Do not start the Storybook prototype before Q10 and Q8
are answered.
