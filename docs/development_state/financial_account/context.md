# Development state — financial_account

**Pass:** business analysis on the owner's new [financial_account/context.md](../../business/financial_account/context.md)
— a team's bank, ShopeePay and cash accounts, each with a balance and a log. Questions:
[context_clarify.md](../../business/financial_account/context_clarify.md). Decisions: none yet. The lifecycle is at
*waiting for the owner* on Q1–Q9 — no Storybook prototype, no technical doc, no code.

## What exists

Nothing of this context. What it overlaps is already built elsewhere:

| | where | the clarify proposes |
| --- | --- | --- |
| a team's one bank — type, holder, number | `team_service` · `team_infos` · the team detail's *contact & bank* · `TeamInfoUpdate` | Q9 — it becomes one of the team's accounts, marked *where we are paid* |
| how a restock was paid — `shopee_pay` / `bank_account` | `inventory_service` · `restock_requests.payment_type` · `PaymentTypeSelect` | Q2 — *which* account, replacing the kind |
| expenses | `expense_service` · `expense_records` — names no account | Q3 — an optional *paid from* |
| withdrawals | `settlement_service` · `withdrawal` rows, from the importer | Q1 — each posts `marketplace_withdrawal` into its shop's account |
| team payments | `liability_service` · `liability_payments` | Q4 — `team_payment` posts both legs at confirm |

## Proposed, not decided

[the-act-posts-the-entry](../../business/financial_account/context_clarify.md#the-act-posts-the-entry) — a row is
posted by the act that moved the money; the account screens type only opening, transfer, capital and reconcile.
Build order: accounts → restock → withdrawal → expense → team payment.

⛔ The owner's log table has no account column and no cause column
([critique 1](../../business/financial_account/context_clarify.md#critique)) — do not build from it as written.

## Open

Q1–Q9 in the clarify. **Q4 and Q8 first**: they decide which forms exist and which screens show a balance.

**Next agent:** when the owner answers, record it in `financial_account/context_decision.md` (named, RULE 12), delete
the answered question, rebuild `docs/biggest_question.md`. The service will be
`backend/services/financial_account_service/` (HARD RULE 2). Do not start the Storybook prototype before Q4 and Q8
are answered.
