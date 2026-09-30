# Development state — financial_account

**Pass:** business analysis on the owner's new [financial_account/context.md](../../business/financial_account/context.md)
— a team's bank, ShopeePay and cash accounts, each with a balance and a log — re-examined after each of the owner's
edits. Questions: [context_clarify.md](../../business/financial_account/context_clarify.md). Decisions:
[context_decision.md](../../business/financial_account/context_decision.md) — **twenty-four owner decisions**. The
lifecycle is at *waiting for the owner* on Q9 — no Storybook prototype, no technical doc, no code.

## Decided

| decision | what it means for the build |
| --- | --- |
| [the-accounts-are-one-ledger](../../business/financial_account/context_decision.md#the-accounts-are-one-ledger) | `financial_accounts` is the state, `financial_account_logs` the log — no balance moves without a log row, in the same transaction |
| [every-log-row-names-its-account](../../business/financial_account/context_decision.md#every-log-row-names-its-account) *(line 82)* | every log row carries `account_id` — `balance_after` runs per account · `team_id` stays as a copy (⚠ my reading) · an index on `(account_id, id)` (⚠ my spec) |
| [a-row-comes-by-hand-or-from-the-broker](../../business/financial_account/context_decision.md#a-row-comes-by-hand-or-from-the-broker) | two ways in: the account screens, or a listener per topic. No RPC for other services to write with |
| [shopeepay-is-the-wallet-a-team-pays-with](../../business/financial_account/context_decision.md#shopeepay-is-the-wallet-a-team-pays-with) *(Q5)* | a `shopeepay` account is the team's e-wallet — no settlement row ever posts to an account |
| [a-real-account-is-recorded-once](../../business/financial_account/context_decision.md#a-real-account-is-recorded-once) *(Q6)* | a partial unique index on `(account_type, account_number)` where a number exists, across all teams, archived included · a cash box exempt · the `team_infos` copy never happens — the columns were dropped ([the-team-record-holds-no-bank](../../business/financial_account/context_decision.md#the-team-record-holds-no-bank)) |
| [below-zero-is-warned-never-refused](../../business/financial_account/context_decision.md#below-zero-is-warned-never-refused) *(Q7)* | no balance check on any write path · a warning on the list and the account page while below zero |
| [opening-transfer-and-team-payment-join-the-types](../../business/financial_account/context_decision.md#opening-transfer-and-team-payment-join-the-types) *(Q4, three of four)* | three more `change_type` values · ⚠ their posting rules — the opening row at create, two legs per transfer, a team payment at confirm — are my spec, marked so in the decision |
| [capital-joins-the-types](../../business/financial_account/context_decision.md#capital-joins-the-types) *(Q4, the fourth)* | the owner's money in or out, one signed type · ⚠ two rows sharing a `group_id` when it moves between teams — my spec |
| [adjustment-is-for-reconciling-only](../../business/financial_account/context_decision.md#adjustment-is-for-reconciling-only) *(Q4)* | no RPC takes an adjustment amount — `Reconcile` takes the bank's figure and posts the difference · ⚠ a note on a non-zero difference and a `reconciled_at` stamp are my spec |
| [the-log-says-balance-after](../../business/financial_account/context_decision.md#the-log-says-balance-after) *(critique 5)* | the log's column is `balance_after` = the previous row's + this row's `change` |
| [restock-is-never-typed-by-hand](../../business/financial_account/context_decision.md#restock-is-never-typed-by-hand) *(Q10, for restock)* | no hand RPC takes a `restock` · it comes only from a restock event inventory does not publish yet — until then a restock's payment shows only through a reconcile |
| [one-way-in-per-type](../../business/financial_account/context_decision.md#one-way-in-per-type) *(Q10)* | the hand RPCs are Create, Transfer, Capital, Reconcile, and none takes a `change_type` · a listener each for `withdrawal` (settlement — exists), `restock`, `expense`, `team_payment` (their events are new) |
| [revenue-stays-in-settlement](../../business/financial_account/context_decision.md#revenue-stays-in-settlement) *(Q1, the name)* | the type is `withdrawal` (was `revenue_fund`) · the listener posts only settlement's `withdrawal` rows, sign turned · ⚠ the label *+ Withdrawal from <the shop>* is my spec |
| [a-shop-names-the-account-it-withdraws-into](../../business/financial_account/context_decision.md#a-shop-names-the-account-it-withdraws-into) *(Q1)* | the owner's `shop_accounts` — the withdrawal listener looks the shop up there · ✅ `shop_id` unique — [a-shop-has-one-account](../../business/financial_account/context_decision.md#a-shop-has-one-account) |
| [a-shop-with-no-account-gets-an-unknown-one](../../business/financial_account/context_decision.md#a-shop-with-no-account-gets-an-unknown-one) *(Q11, against my recommendation)* | the withdrawal listener, finding no `shop_accounts` row, creates an account with `type` and `account_type` `unknown`, connects it to the shop and posts there — nothing is held · ⚠ one per shop, its name, no opening row, what it may do are my spec · ✅ one per shop holds, `shop_id` unique · how it becomes real: [an-unknown-account-is-filled-in-or-moved-in](../../business/financial_account/context_decision.md#an-unknown-account-is-filled-in-or-moved-in) |
| [a-shop-has-one-account](../../business/financial_account/context_decision.md#a-shop-has-one-account) *(line 19)* | `shop_accounts (shop_id)` unique — one account per shop, many shops per account · a new shop's second concurrent withdrawal rolls back and retries onto the first one's row (⚠ my spec) |
| [the-team-record-holds-no-bank](../../business/financial_account/context_decision.md#the-team-record-holds-no-bank) *(Q9, two parts)* | ✅ **built** — `team_service` `00008_drop_team_bank` drops the three columns · `TeamInfo` / `TeamInfoUpdateRequest` reserve 3–5 · the team detail and row menu read *Contact* · stored numbers are gone, not copied · where a team is paid is still Q9 |
| [an-unknown-account-is-filled-in-or-moved-in](../../business/financial_account/context_decision.md#an-unknown-account-is-filled-in-or-moved-in) *(Q12)* | `FinancialAccountIdentify`, admin and up, on an `unknown` account only — not registered: fill in provider, number, holder, name, rows kept · registered: transfer the balance in, re-point the shop, archive the unknown at zero, one transaction |
| [a-restock-must-name-the-account-that-paid](../../business/financial_account/context_decision.md#a-restock-must-name-the-account-that-paid) *(Q2, required against my recommendation)* | *Paid from* is **required** at create — an operational account, replacing `payment_type` on new restocks · goods plus shipping from the lines · an edit posts the difference · a cancel asks whether the money came back · the courier's cost line names the warehouse's account (⚠ my reading) · old restocks post nothing · a new inventory event · ⚠ a team with no operational account cannot raise a restock — accounts are set up before the field ships |
| [an-expense-must-name-the-account-that-paid](../../business/financial_account/context_decision.md#an-expense-must-name-the-account-that-paid) *(Q3, required against my recommendation)* | *Paid from* is **required** on every expense a person types — `ADS`, `PAYROLL`, `OPERATIONAL`, `OTHER` · `STOCK_LOSS` outside it (⚠ my reading) · a void reverses · a new expense event · an ads charge from the seller balance: [settlement-ads-and-accounts-are-independent](../../business/financial_account/context_decision.md#settlement-ads-and-accounts-are-independent) |
| [settlement-ads-and-accounts-are-independent](../../business/financial_account/context_decision.md#settlement-ads-and-accounts-are-independent) *(Q13)* | settlement's ads rows never reach an account and nothing syncs · an ad is in an account only as an `ADS` expense naming the account that paid · *Paid from* required with no exception |
| [ads-expense-joins-the-types](../../business/financial_account/context_decision.md#ads-expense-joins-the-types) *(line 93)* | `ads_expense` is a type beside `expense` · ⚠ my reading: the expense listener posts it when the kind is `ADS`, `expense` for every other kind |
| [operational-accounts-pay-for-operations](../../business/financial_account/context_decision.md#operational-accounts-pay-for-operations) *(Q2, which account)* | the owner's `operational_accounts` — the restock's *Paid from* picks among them |
| [seeing-is-team-wide-moving-is-admin-and-up](../../business/financial_account/context_decision.md#seeing-is-team-wide-moving-is-admin-and-up) *(Q8)* | `FinancialAccountList`, `FinancialAccountOverview` and `FinancialAccountLogList` open to every member of the team · Create, Update, Archive, Restore, Transfer, Capital, Reconcile, ShopSet to admin and up — `TEAM_ADMIN`/`TEAM_OWNER`, `WAREHOUSE_ADMIN`/`WAREHOUSE_OWNER`, `ADMIN`/`ROOT` (⚠ my reading of *admin up*) · balances stay on their own RPC so narrowing *for now* later is one policy line |

## What exists

Nothing of this context. What it overlaps is already built elsewhere:

| | where | on the broker | the clarify proposes |
| --- | --- | --- | --- |
| a team's one bank | ✅ **gone** — dropped from `team_infos` by `team_service` `00008`, contract fields 3–5 reserved | — | Q9 — which account a team is paid into |
| how a restock was paid — `shopee_pay` / `bank_account` | `inventory_service` · `restock_requests.payment_type` · `PaymentTypeSelect` | ❌ | ✅ which operational account paid — **required**, replacing the kind |
| expenses | `expense_service` · `expense_records` — names no account | ❌ | ✅ a **required** *paid from* · `ADS` posts `ads_expense` · settlement's ads never reach an account |
| withdrawals | `settlement_service` · `withdrawal` rows, from the importer | ✅ `SettlementLogPosted` | ✅ each posts a `withdrawal` into the account in `shop_accounts` — an `unknown` one made when the shop has none |
| team payments | `liability_service` · `liability_payments` | ❌ | ✅ `team_payment` is a type — posts both legs at confirm, from a new payment event |

## Proposed, not decided

Build order: accounts and the hand path → withdrawal (its event already exists) → restock → expense → team payment,
each of the last three needing a new event variant first. Every row names its cause — `source_id` and `reversal`
(critique 1).

✅ The owner's log carries `account_id` ([every-log-row-names-its-account](../../business/financial_account/context_decision.md#every-log-row-names-its-account)), so the ledger's state and log share one scope. Still
missing from it: the cause (critique 1) and the date the money moved (critique 7) — proposals, not blockers.

## Open

Q9 in the clarify. Nothing in the owner's doc blocks the account screens' contract — no contradiction is
open. Q9 shapes only the payee screens.

**Next agent:** when the owner answers, record it in `financial_account/context_decision.md` (named, RULE 12), delete
the answered question, rebuild `docs/biggest_question.md`. The service will be
`backend/services/financial_account_service/` (HARD RULE 2). The Storybook prototype of the account screens is
unblocked — the owner's log carries its `account_id`. Build the payee screens only after Q9, and mark critique 1's
`source_id` and critique 7's `occurred_at` as proposals in any contract drawn before the owner adopts them (HARD RULE 8).
