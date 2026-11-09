# State — `packages/table_mirroring`

Written for the next agent. Sources:
[technical/packages/table_mirroring/context.md](../../technical/packages/table_mirroring/context.md) (owner) and its
[decisions](../../technical/packages/table_mirroring/context_decision.md) (9, all 2026-11-04).

## What exists

| | |
| --- | --- |
| [san_table_mirroring.go](../../../backend/pkgs/san_table_mirroring/san_table_mirroring.go) | ✅ package doc, `ChangeType`, `Change[T]`, `Ack`, `AckAll`, the errors (`ErrStillRunning`, `ErrUnsupportedTable`, `ErrTableNotFound`, `ErrTooManyDeletes` + `*TooManyDeletesError`, `ErrNotFromTrackTable`) |
| [track_table.go](../../../backend/pkgs/san_table_mirroring/track_table.go) | ✅ `TrackTable[T]`: lock → pinned settings → delete guard → new/modified pages → deleted pages; `changedQuery`, `deletedQuery` |
| [setup.go](../../../backend/pkgs/san_table_mirroring/setup.go) | ✅ `resolveTable` (refusals), `ensureTrack` (creates the track schema), `idReader` (reads the key out of a `T`) |
| [track_table_test.go](../../../backend/pkgs/san_table_mirroring/track_table_test.go) | ✅ 15 tests, real Postgres via `san_testdb.Pool`, each in its own `stm_<random>` schema, dropped at the end |
| [perf_test.go](../../../backend/pkgs/san_table_mirroring/perf_test.go) | ✅ `TestPerf_TrackTable` (`-tags perfaudit`): 200.000 rows, timings and both page plans |
| [README.md](../../../backend/pkgs/san_table_mirroring/README.md) | ✅ usage, how a run works, `Ack` vs `AckAll`, the errors and what a scheduler does with each, which tables, what it creates, operator steps (grants, letting a purge through, starting a table over), performance, limits |
| [examples/](../../../backend/pkgs/san_table_mirroring/examples/) | ✅ three `go run` programs on the local docker Postgres — `basic` (one change at a time), `batched` (`AckAll` + the final flush), `scheduled` (a ticker and the error `switch`, with a mass delete stopped and let through) — and their real output in [examples/README.md](../../../backend/pkgs/san_table_mirroring/examples/README.md). They refuse any host but this machine |

No caller yet: the scheduled migration job that uses it is not built.

## How it is used

```go
var batch []san_table_mirroring.Change[*User]

err = san_table_mirroring.TrackTable[*User](ctx, oldDB, "public.users",
	func(ctx context.Context, change san_table_mirroring.Change[*User]) error {
		// upsert change.Data by change.ID on the revamp side (or remove it when deleted), then
		return change.Ack(oldDB) // or collect into batch and AckAll(oldDB, batch) every N
	})
```

## Behaviour worth knowing

- **At least once.** The handler writes elsewhere and `Ack` writes to the old database, so a crash between them resends the change. Handlers must be safe to repeat.
- **One run is one READ COMMITTED transaction that only reads.** It holds the per-table lock; no snapshot is kept between its statements. A row deleted between a page's hash and its data read is skipped (reported deleted next run); a row edited in between arrives with newer `Data` and the older `CurrentHash`, so it is resent next run. A handler error stops the run; earlier acks stay.
- **Whole-table resends** (every row `modified` once — a resend, not a loss, and the delete guard does not stop it): a column added or dropped in a source table, a change to a pinned setting, a Postgres major upgrade that changes `hashtext`.
- **The track tables live in the TRACKED database**, not in revamp's, so they are not in [database-schema.md](../../database-schema.md). The role the job connects with must be allowed to create a schema there — an operations step.
- `max_delete_percent` is read and checked on EVERY run (2026-11-05), so a typo fails the next run of every table in that schema instead of waiting for the one mass delete it was meant to stop.
- `tracked_tables` is written on setup and read by nothing yet. `last_change` is the time of the ack, not of the source edit.
- Postgres only (`hashtext`, `to_regclass`, advisory locks).

## Measured (`go test -tags perfaudit -run TestPerf_ ./backend/pkgs/san_table_mirroring/`, local Docker Postgres 17)

| 200.000 rows | |
| --- | --- |
| first run, `AckAll` per 1.000 | 15.2 s |
| nothing changed | 0.6 s |
| 1% changed, `Ack` one by one | 2.7 s (≈1 ms per `Ack`) |
| 1% deleted, `Ack` one by one | 3.1 s |

Both page plans probe by key (`Index Scan … rows_track_pkey`, `Index Only Scan … rows_pkey`) under a `Limit` on the key's index — no seq scan. The first draft joined instead and hashed the whole track table once per page (2.8 s for an unchanged run, growing with the square of the table).

## Checks run

`go build ./... && go vet ./...`, `go vet -tags perfaudit|raceaudit` on the package, `go test -count=1 -p 1 ./...` (repo-wide, green), the package's 15 tests, the perf probe, and a mutation check: with the settings pin removed, `TestTheHashDoesNotFollowTheSessionTimeZone` fails (the Asia/Jakarta run re-sent both rows).
