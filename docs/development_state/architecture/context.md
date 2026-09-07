# Development state — architecture

Cross-cutting decisions that are **taken but not applied**. One entry per owed change, so the next agent
finds it without having to re-read every decision log.

## Jakarta time — DECIDED, NOT APPLIED

**Decision:** [the-system-runs-on-jakarta-time](../../technical/architecture/context_decision.md#the-system-runs-on-jakarta-time)
(2026-09-02) — WIB (UTC+7) is the system's calendar. Every `DATE`, every day boundary, every report
window. **The owner asked for it to be fixed later**, so nothing below has been done.

**Today the system is on UTC**, silently: the DSN sets no timezone and the Postgres image defaults to
UTC.

### The change list, in order

| | what | ⚠ |
| --- | --- | --- |
| **1** | `TimeZone=Asia/Jakarta` in [`san_dbtarget.LocalDSN`](backend/pkgs/san_dbtarget/target.go#L49) **and** `ProductionDSN` | this one line is the whole standard for every service at once — do it first and most of the rest verifies itself |
| **2** | the same in [`san_testdb`](backend/pkgs/san_testdb/) | ⛔ **skip this and tests pass on a different calendar than production** — the worst possible outcome, because it makes the bug invisible where it would be caught |
| **3** | `settlement_logs.posted_on` — a column comment saying it is a Jakarta date | the migration's `DEFAULT CURRENT_DATE` becomes Jakarta automatically once 1 is done. **No DDL change is needed** |
| **4** | `expense_records.occurred_at` — the only other `DATE` in the system | it is **caller-supplied**, so check what the frontend sends: a native date input gives the browser's local date, which is already Jakarta for users in Indonesia |
| **5** | a test asserting `CURRENT_DATE` equals the Jakarta date | one assertion, and it is what stops this regressing to UTC the next time a DSN is touched |

### What does NOT need changing, and why

| | |
| --- | --- |
| **~40 `time.Now()` calls in handlers** | they produce host-local instants, which is harmless for `TIMESTAMPTZ`. GORM writes a `time.Time` into a `type:date` column by letting **Postgres** truncate it in the session timezone — so once step 1 lands, `PostedOn: time.Now()` stores the Jakarta date with no Go change |
| **stored `TIMESTAMPTZ` values** | absolute instants. A session timezone changes rendering and date casts, never what is stored |
| **`.UTC().Format(time.RFC3339)`** in [inventory_service](backend/services/inventory_service/inventory_v1/service.go#L265) | an RFC3339 wire value, correct as it is |

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
