# Development state — financial_account

**Pass:** business analysis on the owner's new [financial_account/context.md](../../business/financial_account/context.md)
— a team's bank, ShopeePay and cash accounts, each with a balance and a log — re-examined after each of the owner's
edits. Questions: [context_clarify.md](../../business/financial_account/context_clarify.md). Decisions:
[context_decision.md](../../business/financial_account/context_decision.md) — **sixteen owner decisions**. The
lifecycle is at *waiting for the owner* on Q2, Q3, Q9 and Q12 — no Storybook prototype, no technical doc, no code.

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
| [one-way-in-per-type](../../business/financial_account/context_decision.md#one-way-in-per-type) *(Q10)* | the hand RPCs are Create, Transfer, Capital, Reconcile, and none takes a `change_type` · a listener each for `withdrawal` (settlement — exists), `restock`, `expense`, `team_payment` (their events are new) |
| [revenue-stays-in-settlement](../../business/financial_account/context_decision.md#revenue-stays-in-settlement) *(Q1, the name)* | the type is `withdrawal` (was `revenue_fund`) · the listener posts only settlement's `withdrawal` rows, sign turned · ⚠ the label *+ Withdrawal from <the shop>* is my spec |
| [a-shop-names-the-account-it-withdraws-into](../../business/financial_account/context_decision.md#a-shop-names-the-account-it-withdraws-into) *(Q1)* | the owner's `shop_accounts` — the withdrawal listener looks the shop up there · ⛔ its key `(shop_id, account_id)` allows two per shop, reported as a contradiction |
| [a-shop-with-no-account-gets-an-unknown-one](../../business/financial_account/context_decision.md#a-shop-with-no-account-gets-an-unknown-one) *(Q11, against my recommendation)* | the withdrawal listener, finding no `shop_accounts` row, creates an account with `type` and `account_type` `unknown`, connects it to the shop and posts there — nothing is held · ⚠ one per shop, its name, no opening row, what it may do are my spec · ⛔ one per shop needs `shop_id` unique · how it becomes real is Q12 |
| [operational-accounts-pay-for-operations](../../business/financial_account/context_decision.md#operational-accounts-pay-for-operations) *(Q2, which account)* | the owner's `operational_accounts` — the restock's *Paid from* picks among them |
| [seeing-is-team-wide-moving-is-admin-and-up](../../business/financial_account/context_decision.md#seeing-is-team-wide-moving-is-admin-and-up) *(Q8)* | `FinancialAccountList`, `FinancialAccountOverview` and `FinancialAccountLogList` open to every member of the team · Create, Update, Archive, Restore, Transfer, Capital, Reconcile, ShopSet to admin and up — `TEAM_ADMIN`/`TEAM_OWNER`, `WAREHOUSE_ADMIN`/`WAREHOUSE_OWNER`, `ADMIN`/`ROOT` (⚠ my reading of *admin up*) · balances stay on their own RPC so narrowing *for now* later is one policy line |

## What exists

Nothing of this context. What it overlaps is already built elsewhere:

| | where | on the broker | the clarify proposes |
| --- | --- | --- | --- |
| a team's one bank — type, holder, number | `team_service` · `team_infos` · the team detail's *contact & bank* · `TeamInfoUpdate` | — | Q9 — it becomes one of the team's accounts, marked *where we are paid* |
| how a restock was paid — `shopee_pay` / `bank_account` | `inventory_service` · `restock_requests.payment_type` · `PaymentTypeSelect` | ❌ | Q2 — which operational account paid, replacing the kind |
| expenses | `expense_service` · `expense_records` — names no account | ❌ | Q3 — an optional *paid from* |
| withdrawals | `settlement_service` · `withdrawal` rows, from the importer | ✅ `SettlementLogPosted` | ✅ each posts a `withdrawal` into the account in `shop_accounts` — an `unknown` one made when the shop has none |
| team payments | `liability_service` · `liability_payments` | ❌ | ✅ `team_payment` is a type — posts both legs at confirm, from a new payment event |

## Proposed, not decided

Build order: accounts and the hand path → withdrawal (its event already exists) → restock → expense → team payment,
each of the last three needing a new event variant first. Every row names its cause — `source_id` and `reversal`
(critique 1).

⛔ The owner's log table has no account column — now a recorded
[contradiction](../../business/financial_account/context_clarify.md#one-ledger-and-its-state-and-its-log-have-different-grains)
with the ledger line 13 names. The owner's log edits so far renamed `balance_after` and grew the type list; the
account, the cause (critique 1) and the date the money moved (critique 7) are still missing. Do not build from it as
written.

## Open

Q2, Q3, Q9 and Q12 in the clarify. The account screens' own contract waits on two contradictions — both edits in the
owner's doc: the log's missing `account_id`, and `shop_accounts`' key allowing two accounts per shop.

**Next agent:** when the owner answers, record it in `financial_account/context_decision.md` (named, RULE 12), delete
the answered question, rebuild `docs/biggest_question.md`. The service will be
`backend/services/financial_account_service/` (HARD RULE 2). Do not start the Storybook prototype until the
owner's log carries its `account_id` — building the contract on my proposed column first would settle the
contradiction unasked (HARD RULE 8).
