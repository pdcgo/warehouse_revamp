# financial_account_service — lock order

The service-wide matrix the `audit-sql` skill writes unconditionally. Not a finding — the reference the next
write handler is checked against.

**Verdict: one lock, the account row, taken first — and two of them only ever in id order.** Every write locks
`financial_accounts` `FOR UPDATE` before it touches the log, the balance, the daily report or a link, so the
account row is the top of the hierarchy and every child write happens under it. No handler holds a lock across a
call to another service. Raced and interleaved: **safe** — and one check-then-act race in the withdrawal listener
was found and fixed in this pass (below).

| Handler | Lock order | Notes |
| --- | --- | --- |
| `FinancialAccountCreate` | *(new row)* → its own `financial_accounts` row | the number and name pre-checks only pick the message; the unique indexes refuse a racing duplicate, mapped to `already_exists` |
| `FinancialAccountUpdate` | `financial_accounts` (1) | the name check runs under the lock; the unique index backs it |
| `FinancialAccountIdentify` | `financial_accounts` (2, **ORDER BY id**) → `shop_accounts` (by account) | fill-in locks one; move-in locks both, transfers, re-points, archives |
| `FinancialAccountArchive` · `Restore` | `financial_accounts` (1) → `operational_accounts` | the zero check reads the balance UNDER the lock |
| `FinancialAccountTransfer` | `financial_accounts` (2, **ORDER BY id**) | both legs posted under both locks |
| `FinancialAccountCapital` · `Reconcile` | `financial_accounts` (1) | the reconcile's difference is against the balance read under the lock |
| `FinancialAccountShopSet` | *(ShopAccessCheck — outside the transaction)* → `financial_accounts` (1) → `shop_accounts` (upsert on `shop_id`) | the network call is BEFORE the transaction, so no lock is held across it |
| `FinancialAccountOperationalSet` | `financial_accounts` (1) → `operational_accounts` | insert `ON CONFLICT DO NOTHING` |
| the withdrawal listener | `financial_account_event_logs` (claim) → `financial_accounts` (1) | the claim is an `INSERT … ON CONFLICT DO NOTHING`; a new shop's account + link are inserted, the unique `shop_id` deciding a race |
| the team-payment listener | `financial_account_event_logs` (claim) → `financial_accounts` (2, **two teams**, **ORDER BY id**) | the one write across two teams' books — still one statement, id order, so it composes with every transfer and every other payment. Liability's account check is a network call made BEFORE its own transaction, never under a lock |
| the restock-payment listener *(2026-11-04)* | `financial_account_event_logs` (claim) → `financial_accounts` (1, or 2 for a move, **ORDER BY id**, one team) | `lockOwnedAccounts` — one statement, id order, so a payment moved X → Y composes with a hand transfer Y → X. Every event carries its own delta, so out-of-order deliveries need no lock between them |
| the expense-payment listener *(2026-11-04)* | `financial_account_event_logs` (claim) → `financial_accounts` (1, the expense team's) | `lockOwnedAccounts` with one account — an expense and each correction post on ONE account (the original's, a-correction-follows-the-expenses-account), so it composes with every transfer. Each event carries its own signed delta, so out-of-order deliveries need no lock between them. Expense's account check is an in-process read made BEFORE its insert, never under a lock |
| the transfer-shipping listener *(2026-11-04)* | `financial_account_event_logs` (claim) → `financial_accounts` (1, or 2 for a move, **ORDER BY id**, the selling team's) | the restock listener's own `postPaymentLegs` (`lockOwnedAccounts`, one statement, id order), posting `expense` — so a shipping cost moved X → Y composes with hand transfers both ways. Each event carries its own delta, and each edit's event id is its cost revision, so out-of-order deliveries need no lock between them |
| *(every post)* | under the account lock: `financial_account_logs` → `financial_accounts.balance` → `financial_account_daily_reports` (the day, then later days) | the day rows are per account, so the account lock serialises the upsert and the shift — no advisory lock |

Evidence: [`financial_account_race_test.go`](../../../../backend/services/financial_account_service/financial_account_v1/financial_account_race_test.go) (`raceaudit`), 20 runs clean.

| proved | how |
| --- | --- |
| no lost update on a balance | 8 posts at once → balance 8 000, eight distinct `balance_after`, the day closes on the balance · **Interleave: the second post BLOCKS** and builds on the first's balance |
| no deadlock between opposite transfers | 8 transfers X→Y and Y→X at once → 0 deadlocks, both balances where they started |
| archived only at zero, under concurrency | archive vs a post, 10 rounds → never archived holding money · **Interleave: the archive BLOCKS**, then refuses |
| one real account, one row | 8 creates of one number → 1 row, 7 `already_exists`, 0 `internal` |
| a redelivery posts once | the same event 4× at once → posted once, every delivery acked |
| a new shop gets one unknown account | 4 first withdrawals at once → 1 account, 1 link; the losers fail, are redelivered, and all 4 post once |
| a withdrawal follows a shop moved while it waited | **Interleave** — see below |
| no deadlock between opposite team payments | 8 payments seller→warehouse and warehouse→seller at once → 0 deadlocks, both balances where they started ([`team_payment_race_test.go`](../../../../backend/services/financial_account_service/financial_account_v1/team_payment_race_test.go)) |
| a team payment redelivered posts once | the same acceptance 4× at once → out of the payer once, into the creditor once |
| a team payment takes the account lock | **Interleave: the payment BLOCKS** behind a capital post on the creditor's account, then builds on its balance |
| a restock payment redelivered posts once | the same `RestockCreated` 4× at once → paid once ([`restock_payment_race_test.go`](../../../../backend/services/financial_account_service/financial_account_v1/restock_payment_race_test.go)) |
| no deadlock between a restock move and an opposite transfer | 4 payments moved X → Y beside 4 transfers Y → X at once → 0 deadlocks, 0 failures, money conserved |
| a restock payment takes the account lock | **Interleave: the restock post BLOCKS** behind a capital post on its account, then builds on its balance |
| an expense redelivered posts once | the same `ExpenseCreated` 4× at once → paid once ([`expense_payment_race_test.go`](../../../../backend/services/financial_account_service/financial_account_v1/expense_payment_race_test.go)) |
| expenses and corrections beside hand transfers on the same account | 2 expenses, 2 corrections, 2 transfers out and 2 in, at once → 0 deadlocks, 0 failures, both balances exactly the sum |
| an expense post takes the account lock | **Interleave: the expense post BLOCKS** behind a capital post on its account, then builds on its balance |
| a transfer's shipping redelivered posts once | the same `WarehouseTransferCreated` 4× at once → paid once ([`transfer_shipping_race_test.go`](../../../../backend/services/financial_account_service/financial_account_v1/transfer_shipping_race_test.go)) |
| shipping, its edits, moves and refunds beside hand transfers on the same accounts | 2 trips, 2 edits, 2 moves X → Y, 2 refunds, 2 transfers each way, at once → 0 deadlocks, 0 failures, both balances exactly the sum |
| a shipping post takes the account lock | **Interleave: the shipping post BLOCKS** behind a capital post on its account, then builds on its balance |

---

## Found and fixed in this pass — the listener's link was read before the lock

The withdrawal listener read the shop's `shop_accounts` link, THEN locked the account it named. A
*Which account is this? → move in* committing in between re-points the shop and archives the unknown account — and
the waiting withdrawal, once it got the lock, posted into the archived account its shop had just left (pattern 2,
check-then-act). Proved: with the re-check disabled, the Interleave below fails with *"the withdrawal posted after
the shop moved — into the archived account it left"*.

```mermaid
sequenceDiagram
    participant A as move-in
    participant DB as Postgres
    participant B as withdrawal listener
    B->>DB: read the shop's link — the unknown account
    A->>DB: lock the unknown and the real account
    B->>DB: lock the unknown account — WAITS
    A->>DB: transfer, re-point the shop, archive the unknown
    A->>DB: COMMIT
    DB-->>B: the lock — on an archived account the shop has left
    B->>DB: re-read the link under the lock — it moved
    B-->>B: fail — the redelivery follows the shop to the real account
```

**Fix (applied — a bug in this pass's own code, not a design change):** re-read the link once the account is
locked; if it moved, return an error so the transaction rolls back with its claim and Pub/Sub redelivers. No second
lock is taken while one is held, so the fix cannot introduce a deadlock. The Interleave
`TestInterleave_Withdrawal_FollowsAShopMovedWhileItWaited` is kept as its regression test.

⚠ The next handler that locks TWO accounts must take them `ORDER BY id`, as `lockAccounts` does — and must not lock
a link row before an account, which would invert this order.
