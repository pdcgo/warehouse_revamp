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
>
> ✅ **Fixed 2026-11-07 (backlog #37) — the screens' date windows.** Every range filter cut its days at the VIEWER's
> midnight (`windowOf` and four copies: resolveRange → local `toDateInputValue`), so a laptop on UTC asked for
> yesterday's window 00:00–07:00 WIB and one in Makassar for tomorrow's from 23:00 WIB. ONE helper now,
> `frontend/src/lib/jakartaDay.ts` — fixed UTC+7 arithmetic on the instant, never the browser's zone:
> `jakartaWindowOf(range, now)` (inclusive Jakarta `yyyy-mm-dd`), `jakartaUnixWindowOf` (00:00 / 23:59:59 WIB bounds),
> `jakartaToday`, `jakartaDayOfUnix`, `addDays`, `sameDayMonthsBack`, `firstOfMonthBack`, `jakartaDaysSince`.
> `features/settlement/window.ts` is deleted. Day-string screens: Analytic, supplier statistics + report, financial
> account detail + report, the settlement list, report and Shop Entries, Team Balance (`liabilityPeriod`), the daily
> statement (window + its month/year presets). Unix-bound lists through `resolveRange` (now `jakartaUnixWindowOf`):
> orders (seller, warehouse), pick queue, restocks (both), returns, batches + batch history. Also Jakarta now:
> `lib/datetime` `dateInputToUnix` / `unixToDateInput` (a DatePicker's label read a day early in WITA/WIT),
> `daysSinceUnix`, `todayWibDateInput`; the range calendar's *today* cell; the settlement entry form's default day
> (`OrderLedgerPanel` took the UTC `toISOString` day — yesterday 00:00–07:00 WIB even on a WIB machine). Fixtures
> `dayKey`, `dayAgo`, `wibDayKey`, the analytic sample's spine and story `ResolveRangeRules` count Jakarta days.
> Test `src/lib/jakartaDay.test.ts` (`npm run test:unit`, 34): 23:30 / 23:59:59 / 00:00 / 00:30 WIB, 31 Mar, 1 Dec and
> 1 Jan edges, each run with Node's zone stubbed to UTC, America/Los_Angeles, Asia/Makassar, Asia/Jayapura and Jakarta;
> the viewer-midnight mutant fails 6 and a local `dateInputToUnix` fails 4 ON THIS WIB MACHINE.
> ⚠ **Still viewer-local, not windows (listed, not changed):** the `datetime-local` inputs (order form's order time,
> `DateTimeRangePicker` absolute — no page uses it), forms' *today* limits/defaults (`todayDateInput` in the order form
> and ExtraInfoCard; `toDateInputValue(new Date())` in the four financial account dialogs), `toLocaleDateString` with no
> `timeZone` in batches, batch detail/receipt, warehouse product, restock accept/labels, returns + return detail, rack
> detail, shipment channels and the unrouted balance mock; elapsed-hours cuts (returns' "received in 30 × 24 h", batch
> "14 × 24 h") — no calendar involved.

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

## 2026-11-11 — generated downloads are swept after seven days (backlog #38)

[generated-files-are-kept-seven-days](../../technical/architecture/context_decision.md#generated-files-are-kept-seven-days)
is BUILT. Flow: [document rpc.md](../../services/document_service/rpc.md#the-generated-file-sweep--a-download-is-kept-seven-days-not-an-rpc).

| | |
| --- | --- |
| scheduling | nothing in the app scheduled a job before (no cron, no ticker in `backend/cmd`), so the daily sweep is a ticker in the process that runs document_service: `App.Run` starts `document_v1.SweepGeneratedFilesEvery(ctx, 1 min, cfg.GeneratedFileSweepEvery)`; `GENERATED_FILE_SWEEP_EVERY` default `24h`, `0` or less = off. The next run is timed from the END of the last one, so runs never overlap in one process; two instances are kept apart by the sweep's advisory lock (the second stops with `ErrSweepRunning`, logged at info). `NewApp` gained `documents` + `cfg` (wire regenerated) |
| the sweep | `document_v1/generated_file_sweep.go` `SweepGeneratedFiles(ctx, GeneratedSweepInput{Now, Limit, DryRun})` → `{Cutoff, Swept, Bytes, More}`: `order_labels` / `table_export` / `order_export` (LITERALS in the SQL, for the partial index), `created_at < now − 7 days`, no share row; oldest first; at most `Limit` (default 1 000) a run, 100 per transaction: advisory xact lock → pick `FOR UPDATE SKIP LOCKED` → `DELETE … AND NOT EXISTS (share) RETURNING` → store deletes (object + thumbnail) → commit. A store error rolls the batch's rows back; a missing object is fine. Not an RPC — no proto change |
| `san` | `san document sweep-generated [--dry-run] [--limit N]` (`tools/san/document.go`) → the same method; san's config gained `DOCUMENT_STORAGE_DIR` (the server's variable and default) and its graph `NewDocuments` (wire regenerated). [san.md](../../tools/san.md#document-sweep-generated) |
| index | document `00012_generated_files_created_index.sql` — `documents_generated_created_idx (created_at, id) WHERE resource_type IN (the three)`, a pure index ([a-pure-index-is-added-without-asking](../../technical/architecture/context_decision.md#a-pure-index-is-added-without-asking)): a 2 000-file run 1.03 s → 0.14 s at 316 000 documents ([audit](../../../audits/services/document_service/performances/SweepGeneratedFiles.md)). ⚠ Not applied to the DEV database yet — `go run ./tools/san dev setup` does it |
| tests | `generated_file_sweep_test.go` (11): an old label PDF / table export / order export swept (object, thumbnail, row); a StoreOrderLabels file swept 8 days on, kept 6 days on; fresh (0, 6, exactly 7 days) kept; every upload type of the same age kept with its thumbnail; a shared one kept; a second run a no-op (ctid unchanged); bounded (limit 2 → More, oldest first); 130 files across two batches; dry run deletes nothing; a missing object still takes its row; the ticker's timing. Mutation-checked (all types / `<=`). `tools/san/document_test.go` (2). Race (`raceaudit`, 5): four sweeps at once, a download racing it (link or NotFound), a share racing it (both orderings), the share-in-flight SKIPPED and the share-after-pick refused, as schedules — safe ([lock-order](../../../audits/services/document_service/concurrency/lock-order.md)). Perf `TestPerf_SweepGeneratedFiles` |
| checks (2026-11-11, the batch #38 #39 #41 #42) | gofmt on the changed files; `buf lint` + `buf generate` (drift: the 3 inventory gen files only); root `go build`/`vet` (+ `raceaudit`, `perfaudit`)/`test -count=1 -p 1 ./...` green (47 packages); raceaudit document_service green; `npm run typecheck`, `test:unit` 97, stories order-detail/order-create/orders/order-settlement/rack-detail/MarketplaceInfoForm green, `lint:mermaid` 1658; FULL e2e in 8 name-ordered batches — 225 passed, 2 skipped, 0 failed |
| noted, not changed | a share that loses to the sweep answers `Internal` (the FK violation), not NotFound — no screen shares a generated file. A deployment that scales to zero runs no ticker while idle; `san document sweep-generated` (or a scheduler calling it) covers that until the deploy story says otherwise |
