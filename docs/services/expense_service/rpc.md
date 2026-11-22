# expense_service — RPC & the daily statement

## What an expense is here

Money the business spent that **no order caused** (#161): ads budget, payroll, rent, subscriptions.

The defining fact is that **a person typed it**. A revenue row is written by the system from an order
and frozen; an expense row is entered by hand about a period. Everything else follows: the form has to
be quick, the mistake has to be fixable, and the row records **who** entered it. A mistake is fixed by a **new row**,
an adjustment, never by an edit or a void ([every-correction-is-a-signed-adjustment](../../business/analytic/context_decision.md#every-correction-is-a-signed-adjustment)) — see
[ExpenseAdjust](#expenseadjust--a-correction-is-a-row).

Deliberately not here: per-order costs (COGS and shipping are frozen onto the order, #74), and any
ledger — no balances, no double entry, the same call revenue made.

### The amount is a double, stored exact as it is written (expense 00005)

`expense_records.amount` is `double precision` and every amount on the wire is `double` since 2026-11-06 — the
create's and the adjust's `amount` (`gt 0` / `not_in [0]`, finite), the list rows, the daily and the per-kind sums, and
`ExpenseCreated` / `ExpenseAdjusted.amount` on the events
([every-ledger-moves-to-double-rounded-when-frozen](../../business/order/context_decision.md#every-ledger-moves-to-double-rounded-when-frozen)). **The write is the freeze point, and it is exact**
([the-backend-never-rounds-money](../../business/order/context_decision.md#the-backend-never-rounds-money), 2026-11-06): `ExpenseCreate` and `ExpenseAdjust` store the figure as sent — a `STOCK_LOSS` arrives
from inventory priced at a FIFO unit cost, a fraction, and is stored as that fraction. Create refuses one that is not
finite and above 0 (InvalidArgument, *"an expense must be more than Rp 0"*; float dust below 4 places counts as 0,
`san_money.Positive`); Adjust refuses a correction of 0 (*"a correction of 0 corrects nothing"*, tolerance-tested with
`san_money.IsZero`). Rp 0,4 is a real expense now. Sums equal their rows within the tolerance.

### One kind nobody types: `STOCK_LOSS`

`EXPENSE_KIND_STOCK_LOSS` is written by **inventory_service**, not by a person. When a warehouse adjusts
a batch as damaged or lost, `StockAdjust` values the units at the batch's frozen `unit_cost` and posts
the money as an expense on the **warehouse's own team** (#211,
[expense_poster.go](../../../backend/cmd/app_development/expense_poster.go)).

It had been filed as `OPERATIONAL` until 2026-08-14, and that was the bug: shrinkage sat in the same
bucket as rent and electricity, so *"how much did we break this month"* had no answer — which is most of
what a warehouse's own P&L is made of. Rent is a decision somebody made; a dropped pallet is not, and
only one of the two is worth a manager's morning.

Three consequences worth knowing:

- **The form does not offer it.** `COST_KINDS` (the picker) excludes it and `COST_FILTER_KINDS` includes
  it — reading a kind and being able to type one are different permissions. A hand-typed loss beside the
  automatic ones would make the total partly a guess.
- **The API refuses it** (2026-11-05). `ExpenseCreateRequest.kind` carries a CEL rule
  (`expense_create.kind.stock_loss_is_not_typed`, `this != 5`), so the validation interceptor answers any caller
  InvalidArgument *"stock loss is recorded by inventory, not typed"*. Inventory's `expensePoster` calls the handler
  in-process, where no interceptor runs, so its write-offs still land
  (`TestExpenseCreate_StockLossIsRefusedThroughTheAPI`, `TestExpenseCreate_StockLossNamesNoAccount`,
  `TestExpensePoster_*`).
- **Its day is the Jakarta day of the write-off** (2026-11-06, backlog #29). No person picks a date here, so the poster
  dates it from its own clock through `expense_v1.JakartaDay` — the same WIB conversion a correction's Analytic day uses
  ([the-system-runs-on-jakarta-time](../../technical/architecture/context_decision.md#the-system-runs-on-jakarta-time)).
  It used to format the HOST clock, so on a UTC host a loss counted 00:00–07:00 WIB sat on the day before
  (`TestExpensePoster_AWriteOffAt0030WIBLandsOnItsJakartaDay`: 23:59 WIB keeps its day, 00:30 WIB — 17:30 UTC — is the
  next).
- **History stays mixed.** Rows written before the kind existed are still `OPERATIONAL`. They are only
  identifiable by their free-text note, so a backfill would be a guess that could move a real rent row
  (owner). The split is honest from that date forward, not backwards.
- ⚠ **It does not yet separate BROKEN from LOST.** `stock_batches` carries one `damaged_qty` and
  `MovementKind` has a single `ADJUST`, so the DAMAGED/LOST distinction exists in the `StockAdjust`
  request and is **discarded on write** — that is what #227 is for. One combined figure now, split when
  #227 lands, is additive rather than a rework (owner).

> ⚠ **A batch with an unknown `unit_cost` posts NOTHING.** `unit_cost` is nullable and nil means unknown,
> never 0 (#74), so `StockAdjust` skips the expense entirely for those units. Stock genuinely written off
> is therefore **invisible in the money**, and — unlike the revenue side, which counts its unknown-cost
> orders and says so — nothing counts these. A warehouse's loss figure is a floor, not a total. Fixing it
> needs somewhere to record "units written off at unknown cost", which is a schema decision and not this
> RPC's to make.

Most of the service is single-table CRUD and needs no diagram. The one flow that does is the statement,
because it **spans two services**.

---

## The daily statement — `ExpenseDaily`, and whichever income half applies

`ExpenseList` answers *"what did this period cost"*. `ExpenseDaily` answers *"which **day** did it"* —
and it is the **shared half** of one screen, `/statement`. The other half depends on who is reading:

| | income comes from | because |
| --- | --- | --- |
| **selling** team | `RevenueDaily` — the expected margin on its orders | it sells |
| **warehouse** team | `LiabilityDaily` — the handling fees it charged | it has no orders at all |

The expenses half needs no branch, and that is the neat part: a warehouse's written-off stock is already
an expense on its own team, so the same RPC serves both.

**The statement is assembled on the CLIENT.** No service owns it, because none holds the others' numbers
(HARD RULE 3): no shared model package, no table another can read. A backend "statement" RPC would have
made one service own a figure derived from data it does not have.

```mermaid
sequenceDiagram
    autonumber
    participant UI as "/statement — DailyStatementPage"
    participant E as expense_service
    participant R as "revenue_service — selling"
    participant S as "liability_service — warehouse"

    UI->>UI: DateRangePicker to from/to — refuse if unbounded or over 366 days

    par one period, two services, one grain
        UI->>E: ExpenseDaily(team, from, to, kind, shop, group_by)
        E->>E: filtered() — the SAME WHERE ExpenseList builds
        E->>E: GROUP BY the bucket (the day, or its month or year) and kind — every row, adjustments with their sign
        E->>E: sort the grouped rows, fold (bucket,kind) pairs into one item per bucket
        E-->>UI: SPARSE buckets keyed by their first day + the period's ExpenseTotals
    and the income half, by team type
        alt selling team
            UI->>R: RevenueDaily(team, from, to)
            R-->>UI: SPARSE days + RevenueTotals — income is expected_margin
        else warehouse team
            UI->>S: LiabilityDaily(team, from, to)
            S-->>UI: SPARSE days + by_source — income is HANDLING_FEE only
        end
    end

    UI->>UI: bucketSpine(from,to,grain) — build EVERY bucket in the range
    UI->>UI: per bucket, income − expenses, then a running total
    UI->>UI: footer = the SERVERS' totals, never a re-sum of the rows
```

### A warehouse manager must be able to read this

`ExpenseDailyRequest` carries `ROLE_WAREHOUSE_OWNER` and `ROLE_WAREHOUSE_ADMIN`, which `ExpenseListRequest`
does **not**. That difference is deliberate and load-bearing: without them a warehouse owner gets
`PermissionDenied` on exactly half of their own statement, and the screen would report their fees as pure
profit. `ExpenseList` keeps the narrower set only because no warehouse screen calls it yet — the policies
should differ because of what is built, never because one was forgotten.

### One query, grouped twice

The day item carries a **per-kind split**, so a day that jumped can be read without opening the expense
list. That costs nothing extra: it is the same scan one `GROUP BY` wider — `(occurred_at, kind)` — and
the pairs are folded back into days **in Go**, as a loop over already-sorted rows, rather than as a
second round trip.

A kind with nothing that day is **absent** rather than `0`, matching `ExpenseTotals`. Absent and zero
read identically on a card, and building the empty ones would mean the handler knowing the enum's
members — which would then need editing every time a kind is added.

### The filter is `filtered()`, not a second copy

`ExpenseDaily` builds the `ExpenseListRequest` its period and filters are equivalent to and hands it to
the same `filtered()` helper the list uses. That is the point rather than a tidy-up: a series filtered
to Ads beside a footer that still counted payroll would put a table and a total describing different
things on one screen. One WHERE, three readers.

### The grain is grouped on the server

[periods-are-grouped-on-the-server](../../business/settlement/context_decision.md#periods-are-grouped-on-the-server):
`ExpenseDailyRequest.group_by` (`analytic_base.v1.GroupType` — DAILY, MONTHLY or YEARLY; unset reads DAILY) picks the
grain, and the ONE grouped query groups by the bucket — `occurred_at` itself, or
`date_trunc('month' | 'year', occurred_at::timestamp)::date` (`san_period.Grain.Bucket`). Each item's `date` is the
bucket's **first calendar day** (`2026-08-01`, `2026-01-01`), even when the period starts later in it — the key the
settlement report already fills by. A month is therefore exactly the sum of its day rows (entries, total, every kind),
and the browser only lays the rows on its spine; it never adds days into months. `occurred_at` is a DATE a person chose,
so its month needs no zone. The grouped rows are sorted in Go, not by an `ORDER BY`: with one, Postgres may group by
sorting every row (it cannot estimate how few buckets there are) and spill to disk at volume.

Pinned by `TestExpenseDaily_AMonthsAndAYearsRowAreTheSumOfTheirDays` (30 Dec → 1 Feb: both edge months partial, a
correction on 31 Dec, a write-off dated by `JakartaDay` at 00:30 WIB on 1 January — January, 2026 — and at 23:59 WIB on
31 December — December, 2025; months and years equal the day rows summed, the footer equal at every grain, the kind filter
too) and `TestExpenseDaily_TheSpanFollowsTheGrain`.

### The period IS the pagination

`ExpenseDaily` takes no page cursor, and that does not breach HARD RULE 9. The rule guards a `repeated`
whose length grows **with the data**. This one grows with the buckets in `to − from`, which the caller states:

| | |
| --- | --- |
| Both bounds **required** | unlike `ExpenseList`, where they are optional and a page carries the risk |
| Span **capped per grain** | 366 days · 60 months · 20 years (`san_period`, both ends counted) — `InvalidArgument` beyond it, refused, never clamped |
| Result | ten years of expenses and one year of expenses return the same 366 day rows at most |

The cap must match LiabilityDaily's exactly. The series are read side by side, and a cap that differed would let the
statement load half a period and still look complete. It lives in **one** place on the server —
`backend/pkgs/san_period` (`Grain.MaxBuckets`), which both handlers call — and the daily statement bounds every grain
by `MAX_PERIOD_DAYS` in [frontend/src/lib/period.ts](../../../frontend/src/lib/period.ts) (its windows are unchanged;
the yearly view's longer window is not decided).

**Performance** (`TestPerf_ExpenseDaily`, `-tags perfaudit`, 2026-11-15): two queries (the grouped read and the
period totals) at every grain; a busy team's 54 800 rows over three years among 548 000 — a year daily **11.7 ms**, the
same year monthly **11.0 ms** (12 rows instead of 365), three years yearly **31.4 ms** (3 rows). Both read
`expense_records_team_period_idx`. Before/after on one seed (HEAD's handler vs this one): Harian a year 12.0 → 11.4 ms;
Bulanan 11.2 ms for 365 day rows the browser added up → 11.4 ms for 12 rows; Tahunan over three years 35.2 ms as three
one-year daily reads (1 096 rows — the only way to ask before) → 30.6 ms in one. Months equal the day rows summed (largest
difference 0). Not heavy, so no audit file. At three years the totals query seq-scans in this probe (the team is a tenth
of the table) — 13 ms; a real table with more teams keeps the index.

### Sparse series, one calendar

Both services **omit** days that hold nothing, and the client builds the date spine — it has to build
one anyway to line the two series up, and a server that also emitted empty days would be a second
calendar free to disagree with it.

A quiet day is still **rendered**, dimmed. A missing row cannot tell a reader "nothing was spent" apart
from "that day did not load".

### No timezone question on this side

`occurred_at` is a **DATE**, chosen by a person — there is no instant to convert and therefore no zone
to get wrong. The revenue half buckets a `TIMESTAMPTZ` and has to name one; see
`revenue_service/rpc.md` (removed with the service on 2026-08-29 — `git show 0d4cbc49^:docs/services/revenue_service/rpc.md`) for the UTC-vs-UTC+7 caveat that carries.

### Adjustments count on their expense's day

An adjustment copies its expense's day, so a day's total and the period's `ExpenseTotals` are the corrected figures
with no special case ([an-adjustment-counts-on-the-day-it-fixes](../../business/analytic/context_decision.md#an-adjustment-counts-on-the-day-it-fixes)).
A day whose only expense was cancelled reads **0, made of two entries** — something was entered and taken back, and the
day says so. The list shows both rows, the expense with what it counts for now.

⚠ **Analytic counts a correction differently** — on the day it is MADE, for who made it
([an-expense-correction-counts-on-the-day-it-is-made](../../business/analytic/rpc_provide_decision.md#an-expense-correction-counts-on-the-day-it-is-made)) —
so a day or month there can differ from the same period here by the corrections made later. Accepted; see
[the Analytic expense metrics](#the-analytic-expense-metrics--expenseanalyticservice).

## ExpenseCreate — Paid from and the ads-only shop

Built 2026-11-04 — [an-expense-must-name-the-account-that-paid](../../business/financial_account/context_decision.md#an-expense-must-name-the-account-that-paid),
[an-expense-names-a-shop-only-for-ads](../../business/financial_account/context_decision.md#an-expense-names-a-shop-only-for-ads),
[the-paid-from-prototype-is-accepted](../../business/financial_account/context_decision.md#the-paid-from-prototype-is-accepted).
Every expense a person types names the account that paid it. expense_service never reads financial_account's tables:
the composition root's [expense_accounts.go](../../../backend/cmd/app_development/expense_accounts.go) answers
`PayingAccounts` in-process from `FinancialAccountByIds` (team-scoped, so another team's account is simply absent).

```mermaid
sequenceDiagram
  participant UI as Record Expense dialog
  participant E as expense_service
  participant FA as financial_account, in-process
  participant SH as the shop, over Connect
  participant DB as expense_records
  participant B as Pub/Sub
  UI->>E: ExpenseCreate(team, kind, amount, day, shop, finance_account_id)
  E->>E: the day, then the shop rule — ADS needs a shop, any other kind none
  opt a shop is named
    E->>SH: ShopAccessCheck(team, shop) — BEFORE any transaction
    SH-->>E: the shop, open or closed — or NotFound, and the expense is refused
  end
  alt STOCK_LOSS — inventory's internal call
    E->>DB: INSERT with account 0 — no cash moved, nothing published
  else every kind a person types
    E->>FA: FinancialAccountByIds(team, the account) — BEFORE any transaction
    alt absent, archived, or not marked operational
      E-->>UI: FailedPrecondition, naming the account
    else the team's active operational account
      E->>DB: INSERT with the account, and add it to its Analytic report row — one transaction
      E->>B: ExpenseCreated — after the commit, event id expense-created and the expense id
      E-->>UI: the expense
    end
  end
```

| | |
| --- | --- |
| `finance_account_id` | `uint64.gt = 0` in the proto, re-checked in the handler (InvalidArgument) — a caller that skips the interceptor is not trusted |
| a refused account | FailedPrecondition, naming it: *"BCA Gaji is not one of the team's active operational accounts — pick another, or ask an admin to mark it operational"*, *"… is archived — …"*, or *"account #N …"* for another team's or an unknown id (never confirms an id) |
| the shop | ADS with shop 0 → InvalidArgument *"an ads expense names its shop"* · any other kind with a shop → *"only an ads expense names a shop"* |
| the type (#99 P1, 2026-11-20) | `type` is required on every expense a person types (InvalidArgument without one); `expense_types.go`'s fixed table decides the group (stored as `kind` — a kind sent beside it must be the type's group), the direction, the capital flag and the shop rule, read per TYPE: only *Iklan marketplace* names a shop ([expense-types-sit-under-groups](../../business/financial_account/context_decision.md#expense-types-sit-under-groups)) |
| the account by type | Prive and Setoran modal: any of the team's ACTIVE accounts (the account's capital); every other type, money in included: an active operational one ([the-expense-types-prototype-is-accepted](../../business/financial_account/context_decision.md#the-expense-types-prototype-is-accepted)) |
| the event | `ExpenseCreated.type` / `ExpenseAdjusted.type` (an adjustment copies its expense's) — the listener posts by it |
| the shop is the team's | 2026-11-18, [settlement-and-expense-ask-the-shop-first](../../business/shop/context_decision.md#settlement-and-expense-ask-the-shop-first): a non-zero `shop_id` is asked of the shop BEFORE the account and before any transaction — `Shops`, an interface expense owns, answered by the composition root's [expense_shops.go](../../../backend/cmd/app_development/expense_shops.go) with `ShopAccessCheck` over the shop client, under the caller's token. Another team's or an unknown shop → **NotFound** *"shop #N is not one of this team's shops"* (the same words for both), nothing stored — no row, no Analytic figure, no event. A CLOSED shop is taken (an expense is money still running on it). An expense naming no shop asks nothing; who may spend is unchanged |
| `STOCK_LOSS` | through the API: InvalidArgument *"stock loss is recorded by inventory, not typed"* (a CEL rule on `kind`, enforced by the validation interceptor). Inventory's `expensePoster` calls the handler directly, with no account and no interceptor — stored with account 0 whatever was sent, the account service never asked, nothing published |
| the event | `ExpenseCreated` (topic `expense-created`) — expense id, team, kind, account, amount, the expense's day, shop, actor + override. Published AFTER the commit; a failed publish is logged with its event_id and never fails the expense (no outbox, as a restock's) |
| never published | a `STOCK_LOSS`, an account 0 |

---

## ExpenseAdjust — a correction is a row

The one way to correct an expense ([every-correction-is-a-signed-adjustment](../../business/analytic/context_decision.md#every-correction-is-a-signed-adjustment)). The screen's
**Adjust** sends the typed correction with its direction; **Batalkan** sends minus what the expense still counts for.

```mermaid
sequenceDiagram
  participant UI as Expenses screen
  participant E as expense_service
  participant DB as expense_records
  UI->>E: ExpenseAdjust(team, expense, signed amount, note)
  E->>DB: SELECT the expense FOR UPDATE — scoped to the team
  alt missing, or another team's
    E-->>UI: NotFound
  else it is itself an adjustment
    E-->>UI: FailedPrecondition — correct the expense, not the correction
  else
    E->>DB: sum its adjustments
    alt amount plus adjustments plus this one is below 0
      E-->>UI: FailedPrecondition — a correction cannot make a cost income
    else
      E->>DB: INSERT the adjustment — the expense's team, shop, kind, day and ACCOUNT
      E->>DB: add it to the Analytic report row of TODAY and of its maker — the same transaction, the last lock
      E-->>UI: the adjustment, and the expense with its new net
      E->>E: after the commit, ExpenseAdjusted when the expense names an account
    end
  end
```

| | |
| --- | --- |
| the lock | the expense row, for the check and the write — two people pressing Batalkan at once cannot both pass the floor |
| `amount` | signed, never 0 (validated, and re-checked in the handler) |
| `net_amount` | on an expense row in `ExpenseList` and in this response: its amount plus every adjustment of it |
| the account | copied from the expense, never typed ([a-correction-follows-the-expenses-account](../../business/financial_account/context_decision.md#a-correction-follows-the-expenses-account)) — 0 on an expense made before *Paid from* |
| events | `ExpenseAdjusted` (topic `expense-adjusted`, event_id `expense-adjusted:<adjustment id>`) after the commit — adjustment and expense ids, team, kind, the expense's account, the SIGNED amount, the expense's day, actor + override. Batalkan is just an adjustment of minus the net, so a cancel gives the account the net back. Not published for an account 0 or a `STOCK_LOSS` (built 2026-11-04) |

---

## The capital listener — the account page's Setor / Tarik Modal on Biaya

[prive-and-deposit-on-pengeluaran-are-the-accounts-capital](../../business/financial_account/context_decision.md#prive-and-deposit-on-pengeluaran-are-the-accounts-capital),
[the-expense-types-prototype-is-accepted](../../business/financial_account/context_decision.md#the-expense-types-prototype-is-accepted)
— capital's second door: a SELLING team's Setor / Tarik Modal on the account page is the same one record as Biaya's
Setoran modal / Prive. financial_account_service posts the account's by-hand `capital` row and publishes
`FinancialAccountCapitalRecorded` ([financial_account_service](../financial_account_service/rpc.md#financialaccountcapital--the-second-door-to-biaya));
this records it here. [capital_from_account.go](../../../backend/services/expense_service/expense_v1/capital_from_account.go),
subscription `expense-financial-account-capital-recorded` → `/event/expense-financial-account-capital-recorded/push`
(expense_service's first listener; claims in `expense_event_logs`, migration 00008). Built 2026-11-20 (#99 P2).

```mermaid
sequenceDiagram
    participant B as Pub/Sub
    participant L as the capital listener
    participant T as team_service (TeamSides)
    participant DB as one transaction
    B->>L: FinancialAccountCapitalRecorded
    L->>T: which side is the team on — asked BEFORE the transaction
    L->>DB: CLAIM the event id — a redelivery stops here
    alt a selling team
        L->>DB: INSERT Setoran modal (plus) or Prive (minus), origin ACCOUNT_PAGE, account_log_id ON CONFLICT DO NOTHING
        L->>DB: fold the metric — capital in or out, on the act's day
    else a warehouse team, or neither side
        L->>DB: nothing more — the claim alone
    end
    L-->>B: 200 acks, and any error NACKs and Pub/Sub redelivers
```

| case | what happens |
| --- | --- |
| the row | type Setoran modal for a plus change, Prive for a minus, group Lainnya; the amount positive; the account row's day, note, who (`created_by`) and override mark, account (`finance_account_id`), recorded-on its time; `origin = ACCOUNT_PAGE`; `account_log_id` = the account row |
| nothing is published | the account row is the act's own — `ExpenseCreated` would post a second capital row; so exactly one capital row per act |
| the same event twice, or the same account row under another event id, even at once | one row — the claim, then the partial unique index on `account_log_id` (`ON CONFLICT DO NOTHING`); the metric folds once |
| a warehouse team's | claimed and dropped — never on Biaya |
| a malformed message (no `log_id`, a change of 0) | an error (NACK → dead letter), never a guessed row |
| Adjust / Batalkan on Biaya | ordinary corrections — the type copied, `origin` 0 (made on Biaya), `ExpenseAdjusted` published, the account posts the signed `capital` row (*dari Biaya #N*) |
| the screen | `ExpenseRecord.origin` / `ExpenseRowItem.origin` — the row's *Dicatat di halaman akun* (`expense-origin-<id>`) |
| the old rows | `ImportCapital(ctx, events)` — the same write without the claim, over financial_account's `HandCapitalEvents`; counts imported / already / not selling; run by `san expense import-capital` and `dev setup` |
| the roles | none asked: the person made the act through `FinancialAccountCapital`'s own policy (selling Owner / Admin, root, administrator — the same selling roles `ExpenseCreate` takes), so nobody who may Setor / Tarik Modal is refused |

---

## The Analytic expense metrics — `ExpenseAnalyticService`

Built 2026-11-06 — [expense-has-ads-and-expenses](../../business/analytic/rpc_provide_decision.md#expense-has-ads-and-expenses),
[expense-figures-are-read-from-its-own-records](../../business/analytic/rpc_provide_decision.md#expense-figures-are-read-from-its-own-records),
[an-expense-correction-counts-on-the-day-it-is-made](../../business/analytic/rpc_provide_decision.md#an-expense-correction-counts-on-the-day-it-is-made),
[stock-loss-stays-out-of-analytic-expenses](../../business/analytic/rpc_provide_decision.md#stock-loss-stays-out-of-analytic-expenses),
[the-expense-metrics-follow-the-decisions-already-made](../../business/analytic/rpc_provide_decision.md#the-expense-metrics-follow-the-decisions-already-made),
[an-expense-correction-counts-for-who-made-it](../../business/analytic/rpc_provide_decision.md#an-expense-correction-counts-for-who-made-it),
[the-expense-prototype-is-accepted](../../business/analytic/rpc_provide_decision.md#the-expense-prototype-is-accepted).
`proto/warehouse/expense/v1/expense_analytic.proto`, handlers `expense_v1/metric_{shared,search,data,fold,refold}.go`,
the report `expense_metric_daily_reports` (00006; `flow` 00007; `type` 00009).

| metric | fields | filters | groups |
| --- | --- | --- | --- |
| **Ads expense** `metrics/ads` | `amount` — the ADS kind | date range (required), shop, team (the seller), user | shop, seller, warehouse, created by, daily / weekly / monthly / yearly |
| **Expenses** `metrics/expenses` | `ads`, `payroll`, `operational`, `other` — each group's spending; `total` — Biaya's month total, spending − `money_in` + `capital_out` − `capital_in` (since backlog #107); `money_in`, `capital_out` (Prive), `capital_in` (Setoran modal), positive; then one field per expense type, `ads_marketplace` … `other_in` (fields 9–26, signed: money in and Setoran modal minus) — typed kinds only, no STOCK_LOSS | date range (required), team, user | seller, warehouse, created by, time |

```mermaid
sequenceDiagram
  participant P as a person — Record Expense or Adjust
  participant E as expense_service
  participant T as team_service, in-process
  participant R as expense_records
  participant M as expense_metric_daily_reports
  participant A as Analytic composer
  P->>E: ExpenseCreate or ExpenseAdjust
  E->>T: the team's side, Seller or Warehouse — before the transaction, kept per team
  E->>R: the expense, or the correction on the expense's own day
  E->>M: plus its amount on the report row of its day and its person — same transaction
  Note over M: an expense on its occurred_at, a correction on the day it is MADE, for who made it
  A->>E: MetricSearch — keys of one group, ranked
  A->>E: MetricData — the keys' figures, and the headline grouped by SUMMARY with rows_group
  E->>M: one grouped SELECT per call
```

| | |
| --- | --- |
| the day | an expense: its own `occurred_at`. A correction and a cancel: the Jakarta day the adjustment was made (`created_at` in WIB). A past day never changes in Analytic, while `expense_records` keeps the correction on its expense's day — the Expenses page, `/statement` and the paying account are unchanged ([an-expense-posts-on-its-own-day](../../business/financial_account/context_decision.md#an-expense-posts-on-its-own-day)) |
| the person | `created_by` of the row: the typer of an expense, the corrector of a correction — a person who only corrects reads negative on that day |
| never counted | `STOCK_LOSS` — the fold skips it and the table's CHECK refuses kind 5; settlement's ads fee and a transfer's shipping are other services' rows |
| Seller / Warehouse | the report row carries the team as `seller_id` (a selling team) or `warehouse_id` (a warehouse team); the root team's on neither. The composition root reads `teams.type` (`cmd/app_development/expense_team_sides.go`, kept per process) |
| readers | every member of a team — CS and warehouse staff included, unlike `ExpenseList` — reads its own team's; the root team every team's; another team's rows match nothing. Every RPC of it (`MetricSearch`, `MetricData`, `ExpensePersonList`) is `NO_SIDE_EFFECTS`, so the admin monitor and an agent read them |
| the headline | MetricData with `GROUP_TYPE_SUMMARY`. `rows_group` names the table's group: under an id group the headline sums only the rows that group keys (by Seller the sellers' — a warehouse team's expense is no Seller row — by Warehouse the warehouses'); under a time group or unset, everything visible. On any other `group_by` it is InvalidArgument |
| refusals | InvalidArgument: another service's metric id, a filter or group a metric does not list (a shop on Expenses), a repeated filter, no date range, a range over a year, keys under SUMMARY, a period keyed by any day but its first |
| money | exact doubles, summed in SQL, never rounded |
| by type (backlog #107) | each report row is one type's (`type`, part of the key — [analytic/expense_metric.md](../../acceptances/analytic/expense_metric.md) givens 6–22). A type field is the type's net signed by its direction as Biaya's month card shows it (`ExpenseTotals.by_type`), so the type fields plus the rows from before the types add up to `total`. Rows written before expense 00009 carry type 0: their group and the total only, never a type field — until a re-fold of their day. The sums run in two steps (`metricGrouped`: one `SUM` per key, kind, flow and type, then the twenty-six `FILTER`ed sums over those) — the same figures, at the eight-sum read's cost |
| re-fold | `MetricDayRefold` (`metric_refold.go`) — `san report refold --report expense-daily --team <id> --date <day>` ([san.md](../../tools/san.md#report-refold)): the team's day rebuilt from `expense_records` through the fold's own `metricEntryOf` (expenses of the day by `occurred_at`, corrections made that day by `created_at` in WIB), a matching row left as it is, a stale one (an untyped row whose expenses now sit under their types) deleted. Takes the report in SHARE ROW EXCLUSIVE BEFORE reading the records, so a writer that reaches its fold meanwhile waits and adds on top (`TestInterleave_MetricDayRefold_AFoldInTheGapWaitsForTheReplace`) |
| concurrency | one upsert per row, the transaction's last statement — see [lock-order.md](../../../audits/services/expense_service/concurrency/lock-order.md) |
| perf | one query per read; a team's year 1–2 ms, root's every-team year 23–25 ms (the root scan, as the order metrics and Lost stock); create / adjust with the fold ~1 ms (`TestPerf_ExpenseMetric`, ~137 000 report rows). With the type fields (backlog #107, ~219 000 rows): a team's reads 1–3 ms (before 1–3.4), root's year 36–47 ms (before 34–49 — the twenty-six sums on every row read 63–94 ms for the root headline, hence the two-step sum), create / adjust with the fold ~2 ms (before 2.2–3.4); a sort by a type field 2.5 ms (a team), 36–44 ms (root); a day re-fold of a busy team's day (60 records, 6 corrections) 5.4–5.7 ms, the day's expenses read on `expense_records_team_period_idx` (`TestPerf_ExpenseMetricTypes`) |
| MCP | source `expense` in `mcp_service/tool_metrics.go` |

### Who a USER filter offers — `ExpensePersonList`

Built 2026-11-06 (backlog #30). The Analytic screen's *Created by* field over an expense metric
([a-who-filter-lists-the-people-on-its-rows](../../business/user/context_decision.md#a-who-filter-lists-the-people-on-its-rows)),
in the shape of settlement's `SettlementPersonList`: the distinct `user_id` of `expense_metric_daily_reports` in the
reader's scope (`user_id <> 0`), each at `MAX(day)` — the newest day a report row counts for them — newest first, the id
breaking a tie, paged by `CommonPagination` (the picker asks for 200). So it offers whoever typed an expense and whoever
corrected or cancelled one ([an-expense-correction-counts-for-who-made-it](../../business/analytic/rpc_provide_decision.md#an-expense-correction-counts-for-who-made-it)),
and never the team's member list.

| | |
| --- | --- |
| scope | the metrics' (`metricReaderOf`): a team its own rows, the root team every team's — a person once, at their latest day on any team. A team with no expense row lists nobody |
| `filter.metric_ids` | the expense metrics on the table. Ads expense alone reads the ADS rows only — whoever typed only payroll is on none of its rows; none named, or Expenses among them, every typed kind. Another service's id is InvalidArgument |
| roles | MetricData's exactly ([whoever-reads-a-list-may-filter-it](../../business/user/context_decision.md#whoever-reads-a-list-may-filter-it)) — CS and warehouse staff included |
| kept | former and suspended people ([a-filter-keeps-former-and-suspended-people](../../business/user/context_decision.md#a-filter-keeps-former-and-suspended-people)) |
| range | none — like `SettlementPersonList` and `OrderCreatorList`, the picker loads the set once and filters as you type |
| SQL | ONE statement: `SELECT user_id, MAX(day) AS last_day, COUNT(*) OVER () AS total … GROUP BY user_id ORDER BY last_day, user_id LIMIT …` — the window counts people, not rows; a page past the end alone runs a `COUNT(DISTINCT user_id)` |
| perf | `TestPerf_ExpensePersonList` (perfaudit, ~137 000 report rows over 150 teams): a team 1.1–1.6 ms (bitmap scan of `expense_metric_daily_reports_team_day_idx`), root 24 ms (Ads alone 14 ms) — a seq scan of the whole report, as root's metric reads. ⚠ Root's read is not bounded by a year as the metrics are: it grows with the report's whole history. Settlement met the same at 28–31 ms and moved to a per-person `last_day` row kept by the fold ([the-person-list-reads-the-last-day-from-the-user-report](../../business/settlement/context_decision.md#the-person-list-reads-the-last-day-from-the-user-report)) — the shape to take here if it bites |
| frontend | `features/expense/queries.ts` `useExpensePeople` (key `expenses`, so an expense typed on the Expenses page refreshes it) → `features/analytic/people.ts`, unioned by id after the order creators and settlement's people |

```mermaid
sequenceDiagram
  participant S as Analytic screen — Created by
  participant E as ExpenseAnalyticService
  participant M as expense_metric_daily_reports
  participant U as user_service
  S->>E: ExpensePersonList — team, the expense metrics on the table, page of 200
  E->>M: one grouped SELECT — user_id, MAX(day), the count — own team or every team
  E-->>S: ids, latest first, with each person's last day
  S->>U: UserByIDs — their names
```

## The override stamp on the reads — the "by Root team" badge (built 2026-11-11)

[an-override-shows-a-platform-badge](../../business/user/context_decision.md#an-override-shows-a-platform-badge), accepted as
[the-override-badge-is-accepted-as-by-root-team](../../business/user/context_decision.md#the-override-badge-is-accepted-as-by-root-team):
every read a screen names a person from now carries the record's own `is_override` (stamped at the write by
`san_auth.IsOverride`, [an-override-is-stamped-in-every-service](../../business/user/context_decision.md#an-override-is-stamped-in-every-service)),
and the screen draws the shared `ActorName` / `RootTeamBadge` beside the person. Never sent by a caller; a row from
before the column reads false.

| read | field | read from | performance |
| --- | --- | --- | --- |
| `ExpenseList` | `ExpenseRowItem.is_override` (14) — who recorded it | `expense_records.is_override`, same row | nil |
| `ExpenseCreate`, `ExpenseAdjust` | `ExpenseRecord.is_override` (14) | the row just written | nil |

The Expenses page gains its **Recorded by** column (a line on phones) from `created_by` — the expense named nobody before.
