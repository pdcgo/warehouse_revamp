# `san_table_mirroring`

Finds the rows of a Postgres table that changed since you last handled them (new, modified or deleted),
so a scheduled job can copy only those into another database. It is built to mirror the old system's
database into revamp during the migration.

- **Spec:** [docs/technical/packages/table_mirroring/context.md](../../../docs/technical/packages/table_mirroring/context.md) (owner-written)
- **Decisions:** [context_decision.md](../../../docs/technical/packages/table_mirroring/context_decision.md), 9 of them
- **State:** [docs/development_state/packages/table_mirroring.md](../../../docs/development_state/packages/table_mirroring.md)
- **Runnable examples:** [examples/](examples/). `go build ./...` compiles them, and they run against the local docker Postgres

```go
import "github.com/pdcgo/warehouse_revamp/backend/pkgs/san_table_mirroring"
```

---

## Quick start

```go
type User struct {
    ID       uint64 // must map the table's primary key column
    Name     string
    Username string
}

err := san_table_mirroring.TrackTable[*User](ctx, oldDB, "public.users",
    func(ctx context.Context, change san_table_mirroring.Change[*User]) error {
        // 1. write the change on your side: upsert change.Data by change.ID,
        //    or delete change.ID when change.Change is ChangeTypeDeleted
        err := writeToRevamp(ctx, change)
        if err != nil {
            return err // not acknowledged: the run stops, and this change comes again next run
        }

        // 2. only then acknowledge it, on the OLD database, where the track tables live
        return change.Ack(oldDB)
    })
```

The first run sends every row as `new`. After that, a run sends only what changed since each row's last `Ack`,
and a run with nothing changed sends nothing. [examples/basic](examples/basic/main.go) shows exactly this.

---

## How it finds changes

Every row is hashed with `hashtext(row::text)`. That hash is compared with the one stored when the row was last
acknowledged, in `<schema>_track.<table>_track`. The hash covers **every column** of the row, including columns your
`T` doesn't map, so an edit to any column sends the row:

| The row | Is sent as |
| --- | --- |
| is not in the track table | `new` |
| has a different hash | `modified`. A **soft delete** (setting `deleted_at`) is an edit, so it arrives as this |
| is in the track table but gone from the source (a **hard delete**) | `deleted` |

One `TrackTable` call (one **run**) does this, in order:

1. **First call for a table:** creates its track tables, in their own committed transaction.
2. **Per-table lock:** if an earlier run still holds it, returns `ErrStillRunning` and touches nothing.
3. **Pins the session settings that change how a row prints:** `TimeZone`, `DateStyle`, `IntervalStyle`,
   `extra_float_digits`, `bytea_output`, `lc_monetary`. Without this, a connection with another time zone would
   see every `timestamptz` row as changed.
4. **Delete guard:** counts the deleted rows *before sending anything* (see [Errors](#errors--what-a-scheduler-does)).
5. **New and modified rows:** in pages of 1,000 keys, in ID order.
6. **Deleted rows:** in ID order.

A run is one READ COMMITTED transaction on `db` that only reads. The lock lives in that transaction, so a crashed
run never blocks the next one.

---

## What the handler gets: `Change[T]`

| Field | |
| --- | --- |
| `ID uint64` | the source row's primary key |
| `Change` | `ChangeTypeNew`, `ChangeTypeModified` or `ChangeTypeDeleted` |
| `CurrentHash int` | the row's hash now; `0` for deleted |
| `LastHash int` | the hash stored by the last `Ack`; `0` for new |
| `Data T` | **the row as it is now**; the zero `T` for deleted |

The package keeps **no earlier version** of a row: only its id, hash and time. If you need the "before" (to diff or
to audit), keep your own copy. Usually that's the mirrored row you already wrote on your side. For a deleted change,
`ID` is all there is.

---

## Acknowledging

- **Ack only after your write succeeded.** Return the error without acking and the change is sent again next run.
- **Ack on the tracked (old) database**, the one you gave `TrackTable`, or a transaction on it.
- **Delivery is at least once.** Your write and the `Ack` go to different databases, so a crash between them sends
  the change again. Write so that repeating is harmless: an upsert by ID, and a delete by ID that ignores
  "already gone".
- `Ack` stores the hash read **when the change was sent**, never a fresh one. A row edited while your handler ran
  still differs next time, so it is sent again rather than lost.

### `Ack` or `AckAll`

`Ack` is one round trip per change (≈1 ms on the local docker). That's fine for a run with a few thousand changes.
A **first run over a big table** sends every row, and one-by-one acks would take about 17 minutes for a million rows.
For that, collect the changes, write each batch on your side, then acknowledge it with one `AckAll`:

```go
var pending []san_table_mirroring.Change[*User]

flush := func() error {
    if len(pending) == 0 {
        return nil
    }
    err := writeBatchToRevamp(ctx, pending) // one transaction on your side
    if err == nil {
        err = san_table_mirroring.AckAll(oldDB, pending)
    }
    pending = pending[:0]
    return err
}

err := san_table_mirroring.TrackTable[*User](ctx, oldDB, "public.users",
    func(ctx context.Context, change san_table_mirroring.Change[*User]) error {
        pending = append(pending, change)
        if len(pending) < 1000 {
            return nil
        }
        return flush()
    })

// The LAST, partial batch is still pending here. Flush it, or those changes come again next run.
err = errors.Join(err, flush())
```

`AckAll` takes changes from several tables at once. If the same row appears twice, the later change wins. The full
program is [examples/batched](examples/batched/main.go): 50,000 rows mirrored in about 5 s on the local docker.

---

## Errors — what a scheduler does

| `TrackTable` returns | It means | The scheduler should |
| --- | --- | --- |
| `nil` | everything changed was sent | nothing |
| `ErrStillRunning` | the previous run on this table hasn't finished (a slow run, or two instances or crons at once). Nothing was touched | **skip**: log it, the next tick picks it up. Not a failure |
| `*TooManyDeletesError` (matches `ErrTooManyDeletes`) | more than **50** rows AND more than **`max_delete_percent`** (default 10) of the tracked rows are gone. **Nothing at all was sent**, not even the new and modified rows | **alert a person**. Usually the table was caught half-empty (being truncated and refilled, or restored) and the next tick is fine. A real purge is let through by hand ([Operations](#operations)). The error has `Table`, `Deletions`, `Tracked`, `LimitPercent` and `ConfigTable` |
| `ErrUnsupportedTable`, `ErrTableNotFound` | the table can never be tracked as listed (see [Which tables](#which-tables)). Nothing was created | **fix the job's table list**. Retrying won't help |
| your handler's error (wrapped: `errors.Is` works) | your write failed. The run stopped at that change | log it. What was acked stays acked; the rest comes next tick |
| any other error | the old database failed, or `max_delete_percent` isn't a number | log it, retry next tick |

The guard examples: 30 of 40 deleted passes (under the floor of 50); 60 of 600 passes (exactly 10% is not *over*
10%); 60 of 120 stops the run.

[examples/scheduled](examples/scheduled/main.go) is a ticker over a list of tables with this `switch`, and plays a
mass delete, the alert, and an operator letting it through.

---

## Which tables

| | |
| --- | --- |
| **Supported** | a table whose primary key is **one** `smallint`, `integer` or `bigint` column |
| **Refused** (`ErrUnsupportedTable`) | a key of two or more columns (join tables such as `user_teams`), a text or uuid key, no primary key, and a schema or table name longer than 57 bytes (its `_track` name would pass Postgres's 63-byte limit) |
| **The name** | `"schema.table"`, or a bare `"table"` found through the connection's `search_path` |
| **`T`** | a struct, or a pointer to one, with a field GORM maps to the key column (`ID` → `id`). Other columns are optional; columns `T` doesn't have are ignored |

A join table's rows are invisible to the package: neither its memberships nor its hard deletes are seen, and they
don't change the parent row's hash either. Mirror such tables some other way (decision
[only-single-column-keys-are-supported](../../../docs/technical/packages/table_mirroring/context_decision.md#only-single-column-keys-are-supported)).

---

## What it creates in the tracked database

For a tracked schema `S`, inside the same database, on the first call for each table:

| Table | Columns | |
| --- | --- | --- |
| `S_track.configurations` | `id`, `name` (unique), `value` | holds `max_delete_percent`, seeded as `10` |
| `S_track.tracked_tables` | `id`, `table_name` (unique) | one row per table ever tracked; nothing reads it yet |
| `S_track.<table>_track` | `id` (the source row's id), `last_hash integer`, `last_change timestamptz` | one row per acknowledged row. `last_change` is the time of the **ack**, not of the source edit |

These live in the tracked database, not in revamp's, so they are not in
[docs/database-schema.md](../../../docs/database-schema.md).

---

## Operations

**The database role** the job connects with needs to read the tracked tables, and to create the track schema on the
first call:

```sql
GRANT CREATE ON DATABASE <old_db> TO <mirror_role>;   -- creates S_track on the first call
GRANT USAGE ON SCHEMA public TO <mirror_role>;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO <mirror_role>;
```

**Let a real purge through** (after a `TooManyDeletesError` you have checked):

```sql
UPDATE public_track.configurations SET value = '100' WHERE name = 'max_delete_percent';
-- wait for ONE run, then:
UPDATE public_track.configurations SET value = '10' WHERE name = 'max_delete_percent';
```

The value is a percentage from 0 up. If the row is absent, the limit is 10. Every run reads and checks the value, so
a typo (`'ten'`) fails the very next run of every table in that schema. It never silently turns the guard off.

**See where a table stands:**

```sql
SELECT count(*) AS tracked, max(last_change) AS last_ack FROM public_track.users_track;
```

**Start a table over** (every row is sent as `new` on the next run, so your writes must be upserts):

```sql
DROP TABLE public_track.users_track;
```

**Stop tracking a table:** drop its `_track` table and delete its row from `tracked_tables`.

**Expect a whole-table resend**, where every row arrives `modified` once, when:
- a column is added to or dropped from a source table;
- one of the pinned settings is changed in the package;
- the old database moves to a Postgres major version that changes `hashtext`.

Nothing is lost, and the delete guard doesn't stop it, but it costs a first-run's worth of writes.

---

## Performance

`TestPerf_TrackTable` (`-tags perfaudit`), one table of 200,000 rows on the local docker Postgres 17:

| | |
| --- | --- |
| first run, acked with `AckAll` per 1,000 | 15.2 s |
| nothing changed | 0.6 s |
| 1% changed, `Ack` one by one | 2.7 s |
| 1% deleted, `Ack` one by one | 3.1 s |

A run is one pass over the table. Each page of 1,000 keys walks the primary key index, and each row looks up its
track row by key. The probe fails if either page query's plan contains a seq scan: an earlier version used a join,
which re-read the whole track table for every page.

---

## Limits

- **Postgres only** (`hashtext`, `to_regclass`, advisory locks).
- **The hash is 32-bit.** It is only ever compared with the same row's previous hash, so the one risk is an edit that
  keeps the same hash: about 1 in 4.3 billion edits, missed without a sign (decision
  [hashtext-stays-and-the-settings-are-pinned](../../../docs/technical/packages/table_mirroring/context_decision.md#hashtext-stays-and-the-settings-are-pinned)).
- **Rows changing during a run:**
  - a row deleted between its page's hash and its data read is skipped, and reported deleted next run;
  - a row edited in between arrives with newer `Data` and the older hash, so it is sent again next run.

---

## Tests

```bash
go test ./backend/pkgs/san_table_mirroring/                       # 15 tests, real Postgres (skips without one)
go test -tags perfaudit -run TestPerf_ -v ./backend/pkgs/san_table_mirroring/
go run ./backend/pkgs/san_table_mirroring/examples/basic           # and batched, scheduled
```

The tests COMMIT. Locks and `Ack` on another connection only behave for real across independent connections, so
each test works in its own `stm_<random>` schema and drops it, and its `_track` twin, at the end.
