# Development state — architecture

Cross-cutting decisions that are **taken but not applied**. One entry per owed change, so the next agent
finds it without having to re-read every decision log.

## Jakarta time — ✅ APPLIED 2026-11-05

> **Built.** Steps 1, 2, 3 and 5 below are done: `backend/pkgs/san_dbsession` pins `TimeZone=Asia/Jakarta` on every
> connection — the dev server (`cmd/app_development/deps.go`), `cmd/shipment_service`, `san` (`NewDatabase`,
> `openDatabase`, so `migrate` too) and `san_testdb` — set on the parsed config, so a DSN in any form, naming any zone, is
> Jakarta. Settlement `00009` writes the column comments. Tests: `san_dbsession/session_test.go`,
> `settlement_v1/post_entry_jakarta_test.go`. Existing rows were not rewritten — revamp holds no real data
> (revamp-has-no-real-orders-yet), which answers *the one thing to decide* below. Step 4 (`expense_records.occurred_at`)
> needs nothing: the form sends the picked date string.
>
> **Checked beside it (2026-11-05):** already Jakarta in Go — financial_account (`jakarta`), inventory (`fold_lost`,
> restock accept), selling (order fold, export), supplier, settlement (`order_sale`, replay), warehouse (receiving, info);
> `date_trunc` over `DATE` columns needs no zone; list filters taking unix bounds leave the day to the browser.
> **Fixed:** settlement's list period (`updated_at` bounds were UTC midnights → `parseJakartaDay`). ~~⚠ Not changed,
> flagged~~ — ✅ both fixed 2026-11-05: `liability_v1/liability_daily.go` groups by the Jakarta day with Jakarta-midnight
> bounds ([the-liability-day-is-the-jakarta-day](../../business/balance/context_decision.md#the-liability-day-is-the-jakarta-day),
> [balance state](../balance/context.md)); `inventory_v1/batch_list.go` `soonCutoff(now)` is the Jakarta midnight that starts
> today's Jakarta date + 31, compared `expired_at <` it — the whole 30th Jakarta day is "soon" at any hour, on any host
> (`expired_at` is a TIMESTAMPTZ, not a DATE; the old `now + 30 days` instant moved the edge with the hour the list was
> opened). Tests `TestBatchList_TheSoonWindowEndsWithTheThirtiethJakartaDay` (01:30 WIB written as UTC, 23:59 WIB, a UTC−5
> `now`, the step at 00:00 WIB) and `TestBatchList_ExpiringSoonCountsTheWholeThirtiethJakartaDay` (filter + header count).
> ~~⚠ **Left:** the screens' amber flag still computes `now + 30 × 24 h` in the browser~~ — ✅ fixed 2026-11-06 (backlog
> #25): ONE helper, `frontend/src/lib/expiry.ts` `isExpiringSoon(expiresOnUnix, now)` / `expiringSoonCutoffMs(now)`, the
> server's rule — expiring before 00:00 WIB of Jakarta day today + 31, already-expired included, `0n` (no expiry) never —
> as fixed UTC+7 arithmetic on the instant, so the browser's zone is never read. The three local copies (`pages/batches`,
> `pages/batch-detail`, `pages/warehouse-product`) are gone; each page imports it. Tests `src/lib/expiry.test.ts`
> (`npm run test:unit`): 23:30 and 00:30 WIB edges, expired / no expiry, and the same answers with Node's zone stubbed to
> UTC, America/Los_Angeles and Asia/Makassar (a browser-local-midnight mutant fails all three). ⚠ Still browser-zone:
> those pages' own `formatDateUnix` prints the expiry DATE with `toLocaleDateString` (no `timeZone`) — a different
> concern, not changed.
>
> ✅ **Fixed 2026-11-06 (backlog #29) — the stock-loss expense's day.** Step 4 above held for the form, which sends the
> picked date string, but not for the one writer of `expense_records.occurred_at` with no person picking a date:
> `cmd/app_development/expense_poster.go` `PostStockLoss` formatted the HOST clock (`time.Now().Format`), so on a UTC host
> a write-off 00:00–07:00 WIB was filed on the day before. It now dates by `expense_v1.JakartaDay(now)` — the expense
> service's existing `wib` zone, the conversion a correction's Analytic day already used (`metricDay` reads it too) —
> with an injectable `now`. Test `TestExpensePoster_AWriteOffAt0030WIBLandsOnItsJakartaDay` posts on a UTC clock at
> 16:59 UTC (23:59 WIB, keeps 5 Nov) and 17:30 UTC (00:30 WIB, lands on 6 Nov); the host-clock mutant fails it.

### (the plan as it was written)

**Decision:** [the-system-runs-on-jakarta-time](../../technical/architecture/context_decision.md#the-system-runs-on-jakarta-time)
(2026-09-02) — WIB (UTC+7) is the system's calendar. Every `DATE`, every day boundary, every report
window. **The owner asked for it to be fixed later**, so nothing below has been done.

**Today the system is on UTC**, silently: the DSN sets no timezone and the Postgres image defaults to
UTC.

### The change list, in order

| | what | ⚠ |
| --- | --- | --- |
| **1** | `TimeZone=Asia/Jakarta` in [`san_dbtarget.LocalDSN`](../../../backend/pkgs/san_dbtarget/target.go#L49) **and** `ProductionDSN` | this one line is the whole standard for every service at once — do it first and most of the rest verifies itself |
| **2** | the same in [`san_testdb`](../../../backend/pkgs/san_testdb) | ⛔ **skip this and tests pass on a different calendar than production** — the worst possible outcome, because it makes the bug invisible where it would be caught |
| **3** | `settlement_logs.posted_on` — a column comment saying it is a Jakarta date | the migration's `DEFAULT CURRENT_DATE` becomes Jakarta automatically once 1 is done. **No DDL change is needed** |
| **4** | `expense_records.occurred_at` — the only other `DATE` in the system | it is **caller-supplied**, so check what the frontend sends: a native date input gives the browser's local date, which is already Jakarta for users in Indonesia |
| **5** | a test asserting `CURRENT_DATE` equals the Jakarta date | one assertion, and it is what stops this regressing to UTC the next time a DSN is touched |

### What does NOT need changing, and why

| | |
| --- | --- |
| **~40 `time.Now()` calls in handlers** | they produce host-local instants, which is harmless for `TIMESTAMPTZ`. GORM writes a `time.Time` into a `type:date` column by letting **Postgres** truncate it in the session timezone — so once step 1 lands, `PostedOn: time.Now()` stores the Jakarta date with no Go change |
| **stored `TIMESTAMPTZ` values** | absolute instants. A session timezone changes rendering and date casts, never what is stored |
| **`.UTC().Format(time.RFC3339)`** in [inventory_service](../../../backend/services/inventory_service/inventory_v1/service.go#L265) | an RFC3339 wire value, correct as it is |

### ⛔ The one thing to decide before applying it

**A session-timezone change does not rewrite existing `DATE` values.** Rows written between 00:00 and
07:00 WIB carry a `posted_on` one day **earlier** than the standard now says they should.

- **Today that is almost certainly nothing**: `order_service → settlement` does not exist, so
  `initial_total` only exists where a person typed it, and `expense_records.occurred_at` is caller-supplied
  rather than defaulted.
- **→ Check the row counts and decide deliberately** — a backfill (`posted_on = (created_at AT TIME ZONE
  'Asia/Jakarta')::date`) is trivial now and impossible to do confidently once the tables are large.
- ⚠ **Do it before the daily report tables exist.** Once a fold has bucketed on the old dates, correcting
  them means a replay — and a replay cannot reach past the broker's retention
  ([the-replay-seeks-the-broker](../../business/settlement/context_decision.md#the-replay-seeks-the-broker)).

### Why it is urgent-ish despite being deferred

There are **exactly two `DATE` columns in the system** right now. That is the entire cost of the
migration, and it only grows. The settlement report tables will add two more, and their day boundary is
load-bearing — [what the replay deletes](../../business/settlement/analytic_context_clarify.md#what-the-replay-deletes--elaborated)
turns on the delete range and the seek instant meaning the same calendar.
