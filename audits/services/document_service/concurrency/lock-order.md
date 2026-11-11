# document_service — lock order

The service-wide matrix the `audit-sql` skill writes unconditionally. Not a finding — the reference the next
write handler is checked against.

**Verdict: no handler takes a row lock — the generated-file sweep (not a handler) is the one writer that does.**
Every delete is by id. Raced: **safe** for `ProfilePictureErase` and for `SweepGeneratedFiles` against itself, a download
and a share; the rest below are listed, not raced in this pass.

| Handler | What it writes | Notes |
| --- | --- | --- |
| `ProfilePictureErase` | the stored files (outside any transaction) → one transaction: `document_shares` delete, `documents` delete, by id | idempotent: a missing file and a missing row are both nothing to do |
| `RequestUpload`, `ConfirmUpload` | one `documents` row; ConfirmUpload moves its object | ⚠ not raced in this pass |
| `ShareDocument` | one `document_shares` row — its FK check takes `FOR KEY SHARE` on the document row | ⚠ not raced alone; raced against the sweep below |
| `SweepGeneratedFiles` (Go method — the daily ticker, `san document sweep-generated`) | per batch of 100, ONE transaction: `pg_try_advisory_xact_lock(document_service, generated-file-sweep)` → the oldest eligible `documents` rows `FOR UPDATE SKIP LOCKED` → `DELETE … AND NOT EXISTS (a share)` → the objects in the store (inside the transaction) → COMMIT | lock order: the advisory lock, then `documents` rows in `created_at, id` order. A row a share holds is SKIPPED, never waited on, so nothing waits on the sweep except a share that comes after its pick |

Evidence: [`profile_picture_erase_race_test.go`](../../../../backend/services/document_service/document_v1/profile_picture_erase_race_test.go),
[`generated_file_sweep_race_test.go`](../../../../backend/services/document_service/document_v1/generated_file_sweep_race_test.go) (`raceaudit`).

| proved | how |
| --- | --- |
| four erases of one person at once all succeed and leave nothing | 30 runs × 20 rounds of four simultaneous calls over three photos, one shared → no row, no file, no thumbnail, no error |
| four sweeps at once (two instances' tickers and an operator) all end cleanly and every old file goes once | `TestRace_SweepGeneratedFiles_FourSweepsAtOnce`: 10 rounds × 4 → one sweeps, the others stop on the lock or find nothing; no file survives, no error |
| a download racing the sweep gets a link or NotFound, never an error | `TestRace_SweepGeneratedFiles_ADownloadRacingTheSweep`: 30 rounds, both orderings — 27 links (to a file about to go: what an expired download answers anyway), 33 NotFound; row and file always gone |
| a share racing the sweep never leaves a share on a deleted file | `TestRace_SweepGeneratedFiles_AShareRacingTheSweep`: 40 rounds, both orderings — 20 shares landed first (row, file and share kept), 20 lost to the sweep (no row, no file, no share) |
| a share in flight is skipped, not waited on | `TestInterleave_SweepGeneratedFiles_AShareInFlightIsSkipped`: B's share insert holds the row → A's pick returns without it, not blocked |
| a share after the pick waits and is refused | `TestInterleave_SweepGeneratedFiles_AShareAfterThePickWaitsAndIsRefused`: B's insert BLOCKS on A's row lock, A deletes and commits → B gets 23503 |

**Observed, not a finding:** a share that loses to the sweep (the schedule above) surfaces as `ShareDocument`'s
**Internal** (the FK violation), not NotFound — 8 of the 20 losers; the other 12 read NotFound before inserting. No data
is wrong and no screen shares a generated file, so it is left as is.

**Found and fixed by it:** the local store's delete failed for the second of two simultaneous deletes of one file on
Windows (*Access is denied*, the file still mid-delete). `LocalStore.Delete` now retries briefly, and
`TestLocalStore_DeleteTwiceAtOnce` pins it. A cloud store's delete is idempotent by itself.

| History | |
| --- | --- |
| 2026-10-06 | first matrix — `ProfilePictureErase` |
| 2026-11-11 | `SweepGeneratedFiles` (generated-files-are-kept-seven-days) — raced against itself, a download and a share: safe |
