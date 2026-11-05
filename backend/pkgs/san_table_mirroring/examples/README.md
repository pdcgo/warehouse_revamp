# `san_table_mirroring` examples

Three runnable programs, from the simplest to the shape of the real migration job. Each one mirrors a demo "old"
schema (`stm_example_old`) into a "new" one (`stm_example_new`) on the **local docker Postgres**. In the real
migration those are two databases, the old system's and revamp's. Here they're two schemas of one, so nothing
else needs setting up.

```bash
docker compose up -d          # or: go run ./tools/san dev setup
go run ./backend/pkgs/san_table_mirroring/examples/basic
go run ./backend/pkgs/san_table_mirroring/examples/batched
go run ./backend/pkgs/san_table_mirroring/examples/scheduled
```

- Each run starts clean and drops its schemas at the end. Pass `-keep` to leave them in place and look at them,
  including the `stm_example_old_track` schema the package creates.
- They use the dev database (`localhost:5433`, `postgres`). `EXAMPLE_DATABASE_URL` points them elsewhere, but only
  at **this machine**: any other host is refused, because the examples create and drop schemas.
- `go build ./...` compiles them, so they can't drift from the package's API.

| Example | Shows |
| --- | --- |
| [basic](basic/main.go) | one change at a time: write it, then `Ack`. The first run sends every row as new, then only what changed, then nothing |
| [batched](batched/main.go) | a big first run: collect changes, write a batch in one transaction, `AckAll` it, and **flush the last partial batch** after `TrackTable` returns |
| [scheduled](scheduled/main.go) | a ticker over a list of tables, and what to do with each error: skip, alert, fix the config. It plays a mass delete that the guard stops, and an operator letting it through |

Shared setup (connect, create the demo tables, the upsert / delete into the mirror) is in
[internal/demo](internal/demo/demo.go).

---

## basic

```text
run 1 — the first run sends every row as new:
  new      id=1 User 1
  new      id=2 User 2
  new      id=3 User 3

in the old database: user 2 renamed, user 3 soft-deleted, user 1 hard-deleted, user 4 added

run 2 — only what changed (a soft delete is just an edit, so it arrives as modified):
  modified id=2 Renamed
  modified id=3 User 3
  new      id=4 User 4
  deleted  id=1

run 3 — nothing changed, nothing sent:
  (nothing)

the mirror now:
  id=2  Renamed  soft-deleted=false
  id=3  User 3   soft-deleted=true
  id=4  User 4   soft-deleted=false
```

New and modified rows come first, in ID order, then deleted ones. A deleted change carries only its `ID`: the row is
gone from the old database, so there is nothing else to read.

## batched

```text
run 1 — first run over 50000 rows   50000 upserted,    0 deleted, in 50 batches, 5.165s
run 2 — 1% edited, 0.1% deleted       500 upserted,   50 deleted, in 1 batches, 322ms
run 3 — nothing changed                 0 upserted,    0 deleted, in 0 batches, 121ms

old table 49950 rows, mirror 49950 rows
```

`-rows` and `-batch` change the size. The handler never writes a row by itself. It appends to `pending`, and every
1,000 changes `flush` does two things:
1. writes the batch on the new side in one transaction (a GORM upsert plus a `DELETE … IN`);
2. acknowledges it with one `AckAll`.

If the write fails, nothing is acknowledged and the batch comes again next run. Forget the final `flush()` after
`TrackTable` returns and the last partial batch also comes again next run. Nothing is lost, but it's written twice.

## scheduled

```text
tick 1
  ok      stm_example_old.users (281ms)
  CONFIG  stm_example_old.user_teams: san_table_mirroring: table not supported: stm_example_old.user_teams's primary key is (user_id, team_id); only a one-column integer key is supported

(between ticks: 80 of the 100 users are deleted in the old database)

tick 2
  ALERT   stm_example_old.users: 80 of 100 tracked rows are gone, over max_delete_percent 10. Nothing was sent.
          If the purge is real: UPDATE "stm_example_old_track"."configurations" SET value = '100' WHERE name = 'max_delete_percent';
          wait for one run, then set it back to '10'.
  CONFIG  stm_example_old.user_teams: ...

(an operator confirms the purge is real and lets it through for ONE run)

tick 3
  ok      stm_example_old.users (163ms)
  CONFIG  stm_example_old.user_teams: ...

(the operator sets the limit back)

the mirror holds 20 users, like the old table
```

`runJob`'s `switch` is the part to copy:

| Error | The job does |
| --- | --- |
| `ErrStillRunning` | **skip**: the previous run on that table hasn't finished; the next tick picks it up |
| `*TooManyDeletesError` | **alert** a person: nothing was sent for that table. Usually it's a table caught half-empty, and the next tick is fine |
| `ErrUnsupportedTable`, `ErrTableNotFound` | **fix the table list**: that table can never be tracked as listed |
| anything else | log it: what was acknowledged stays, the rest comes next tick |

One table's error never stops the others. `ErrStillRunning` doesn't appear in this output: it needs two runs on the
same table at once (two instances, or an overlapping cron), and one ticker in one process never overlaps itself.
`TestAnOverlappingRunSkipsTheTable` covers it.
