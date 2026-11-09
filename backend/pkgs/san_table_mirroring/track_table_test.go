package san_table_mirroring

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"gorm.io/gorm"
)

// These tests COMMIT: the package's lock and its "Ack on another connection" only behave for real
// across independent connections, which san_testdb.DB's one rolled-back transaction cannot give. So
// each test works in its own throwaway schema (stm_<random>) and drops it, and its _track twin, at the
// end. They touch no service's tables.

type user struct {
	ID        uint64
	Name      string
	Username  string
	DeletedAt *time.Time
}

func scratch(t *testing.T) (*gorm.DB, string) {
	t.Helper()

	db := san_testdb.Pool(t)

	buf := make([]byte, 5)
	_, _ = rand.Read(buf)
	schema := "stm_" + hex.EncodeToString(buf)

	t.Cleanup(func() {
		db.Exec(`DROP SCHEMA IF EXISTS ` + schema + ` CASCADE`)
		db.Exec(`DROP SCHEMA IF EXISTS ` + schema + `_track CASCADE`)
	})

	exec(t, db, `CREATE SCHEMA `+schema)

	return db, schema
}

func exec(t *testing.T, db *gorm.DB, sql string, args ...any) {
	t.Helper()

	err := db.Exec(sql, args...).Error
	if err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

func scalar[V any](t *testing.T, db *gorm.DB, sql string, args ...any) V {
	t.Helper()

	var v V

	err := db.Raw(sql, args...).Scan(&v).Error
	if err != nil {
		t.Fatalf("query %q: %v", sql, err)
	}

	return v
}

// usersTable creates <schema>.users with n rows, ids 1..n.
func usersTable(t *testing.T, db *gorm.DB, schema string, n int) string {
	t.Helper()

	name := schema + ".users"
	exec(t, db, `CREATE TABLE `+name+` (id bigint PRIMARY KEY, name text NOT NULL, username text NOT NULL, deleted_at timestamptz)`)

	if n > 0 {
		exec(t, db, `INSERT INTO `+name+` (id, name, username) SELECT g, 'name '||g, 'user'||g FROM generate_series(1, ?) AS g`, n)
	}

	return name
}

// track runs TrackTable once, collecting every change; ack decides whether each is acknowledged.
func track[T any](t *testing.T, db *gorm.DB, table string, ack bool) ([]Change[T], error) {
	t.Helper()

	var got []Change[T]

	err := TrackTable[T](context.Background(), db, table, func(ctx context.Context, c Change[T]) error {
		got = append(got, c)
		if !ack {
			return nil
		}

		return c.Ack(db)
	})

	return got, err
}

func mustTrack[T any](t *testing.T, db *gorm.DB, table string) []Change[T] {
	t.Helper()

	got, err := track[T](t, db, table, true)
	if err != nil {
		t.Fatalf("TrackTable(%s): %v", table, err)
	}

	return got
}

func summary[T any](changes []Change[T]) string {
	parts := make([]string, 0, len(changes))
	for _, c := range changes {
		parts = append(parts, fmt.Sprintf("%s:%d", c.Change, c.ID))
	}

	return strings.Join(parts, " ")
}

func TestFirstRunSendsEveryRowNewThenNothing(t *testing.T) {
	db, schema := scratch(t)
	table := usersTable(t, db, schema, 3)

	got := mustTrack[*user](t, db, table)

	if s := summary(got); s != "new:1 new:2 new:3" {
		t.Fatalf("first run = %q, want every row new in id order", s)
	}

	if got[1].Data == nil || got[1].Data.Name != "name 2" || got[1].Data.Username != "user2" || got[1].LastHash != 0 {
		t.Fatalf("change 2 = %+v (data %+v), want the row now and LastHash 0", got[1], got[1].Data)
	}

	if again := mustTrack[*user](t, db, table); len(again) != 0 {
		t.Fatalf("second run = %q, want nothing — every row was acked", summary(again))
	}

	// the-package-creates-its-track-schema: everything exists, in <schema>_track.
	if v := scalar[string](t, db, `SELECT value FROM `+schema+`_track.configurations WHERE name = 'max_delete_percent'`); v != "10" {
		t.Fatalf("max_delete_percent = %q, want the seeded 10", v)
	}

	if n := scalar[int64](t, db, `SELECT count(*) FROM `+schema+`_track.tracked_tables WHERE table_name = 'users'`); n != 1 {
		t.Fatalf("tracked_tables rows for users = %d, want 1", n)
	}

	if n := scalar[int64](t, db, `SELECT count(*) FROM `+schema+`_track.users_track`); n != 3 {
		t.Fatalf("users_track rows = %d, want 3", n)
	}
}

func TestAnEditAndASoftDeleteAreSentAsModified(t *testing.T) {
	db, schema := scratch(t)
	table := usersTable(t, db, schema, 3)

	first := mustTrack[*user](t, db, table)

	exec(t, db, `UPDATE `+table+` SET name = 'renamed' WHERE id = 2`)
	exec(t, db, `UPDATE `+table+` SET deleted_at = now() WHERE id = 3`)

	got := mustTrack[*user](t, db, table)

	if s := summary(got); s != "modified:2 modified:3" {
		t.Fatalf("after an edit and a soft delete = %q, want modified:2 modified:3", s)
	}

	if got[0].Data.Name != "renamed" || got[0].LastHash != first[1].CurrentHash || got[0].CurrentHash == got[0].LastHash {
		t.Fatalf("modified 2 = %+v, want the new name and LastHash = the acked hash %d", got[0], first[1].CurrentHash)
	}

	if got[1].Data.DeletedAt == nil {
		t.Fatal("the soft-deleted row came without its deleted_at")
	}
}

func TestAnUnackedChangeIsSentAgain(t *testing.T) {
	db, schema := scratch(t)
	table := usersTable(t, db, schema, 2)

	for run := 1; run <= 2; run++ {
		got, err := track[*user](t, db, table, false)
		if err != nil {
			t.Fatal(err)
		}

		if s := summary(got); s != "new:1 new:2" {
			t.Fatalf("run %d without acks = %q, want new:1 new:2 again", run, s)
		}
	}
}

func TestAHardDeleteIsSentAsDeletedAndItsAckForgetsTheRow(t *testing.T) {
	db, schema := scratch(t)
	table := usersTable(t, db, schema, 3)

	first := mustTrack[*user](t, db, table)

	exec(t, db, `DELETE FROM `+table+` WHERE id = 2`)

	got := mustTrack[*user](t, db, table)

	if s := summary(got); s != "deleted:2" {
		t.Fatalf("after a hard delete = %q, want deleted:2", s)
	}

	if got[0].Data != nil || got[0].CurrentHash != 0 || got[0].LastHash != first[1].CurrentHash {
		t.Fatalf("deleted change = %+v, want no Data, CurrentHash 0, LastHash = the acked hash", got[0])
	}

	if n := scalar[int64](t, db, `SELECT count(*) FROM `+schema+`_track.users_track WHERE id = 2`); n != 0 {
		t.Fatal("the ack of a deleted change left its track row")
	}

	exec(t, db, `INSERT INTO `+table+` (id, name, username) VALUES (2, 'back', 'back')`)

	if s := summary(mustTrack[*user](t, db, table)); s != "new:2" {
		t.Fatalf("the same id coming back = %q, want new:2", s)
	}
}

func TestAMassDeleteStopsTheRunBeforeAnythingIsSent(t *testing.T) {
	db, schema := scratch(t)
	table := usersTable(t, db, schema, 120)
	mustTrack[*user](t, db, table)

	exec(t, db, `DELETE FROM `+table+` WHERE id <= 60`)
	exec(t, db, `UPDATE `+table+` SET name = 'edited' WHERE id = 100`)
	exec(t, db, `INSERT INTO `+table+` (id, name, username) VALUES (1000, 'new', 'new')`)

	got, err := track[*user](t, db, table, true)

	var tooMany *TooManyDeletesError
	if !errors.As(err, &tooMany) || !errors.Is(err, ErrTooManyDeletes) {
		t.Fatalf("60 of 120 deleted: err = %v, want a TooManyDeletesError", err)
	}

	if tooMany.Deletions != 60 || tooMany.Tracked != 120 || tooMany.LimitPercent != 10 {
		t.Fatalf("error = %+v, want 60 of 120 over 10", tooMany)
	}

	if len(got) != 0 {
		t.Fatalf("the stopped run sent %q, want nothing at all — not even the new and modified rows", summary(got))
	}

	// A genuine purge goes through by raising the limit for one run.
	exec(t, db, `UPDATE `+schema+`_track.configurations SET value = '60' WHERE name = 'max_delete_percent'`)

	got = mustTrack[*user](t, db, table)

	var deleted, other int
	for _, c := range got {
		if c.Change == ChangeTypeDeleted {
			deleted++
		} else {
			other++
		}
	}

	if deleted != 60 || other != 2 {
		t.Fatalf("with the limit raised: %d deleted and %d others, want 60 and 2", deleted, other)
	}
}

func TestTheGuardsFloorAndItsExactLimit(t *testing.T) {
	db, schema := scratch(t)

	// 30 of 40 is 75%, but 50 deletions or fewer never stop a run.
	small := usersTable(t, db, schema, 40)
	mustTrack[*user](t, db, small)
	exec(t, db, `DELETE FROM `+small+` WHERE id <= 30`)

	got, err := track[*user](t, db, small, true)
	if err != nil || len(got) != 30 {
		t.Fatalf("30 of 40 deleted: %d changes, err %v — want 30 deleted, no stop", len(got), err)
	}

	// 60 of 600 is exactly 10%: over the floor, but not OVER the limit.
	exec(t, db, `CREATE TABLE `+schema+`.big (id integer PRIMARY KEY, v text)`)
	exec(t, db, `INSERT INTO `+schema+`.big SELECT g, 'v' FROM generate_series(1, 600) AS g`)

	type big struct {
		ID int32
		V  string
	}

	mustTrack[big](t, db, schema+".big")
	exec(t, db, `DELETE FROM `+schema+`.big WHERE id <= 60`)

	gotBig, err := track[big](t, db, schema+".big", true)
	if err != nil || len(gotBig) != 60 {
		t.Fatalf("60 of 600 deleted (exactly 10%%): %d changes, err %v — want 60 deleted, no stop", len(gotBig), err)
	}
}

func TestAMissingOrBadLimit(t *testing.T) {
	db, schema := scratch(t)
	table := usersTable(t, db, schema, 120)
	mustTrack[*user](t, db, table)
	exec(t, db, `DELETE FROM `+table+` WHERE id <= 60`)

	// Absent → 10.
	exec(t, db, `DELETE FROM `+schema+`_track.configurations WHERE name = 'max_delete_percent'`)

	_, err := track[*user](t, db, table, true)
	if !errors.Is(err, ErrTooManyDeletes) {
		t.Fatalf("no max_delete_percent row: err = %v, want the default 10 to stop 60 of 120", err)
	}

	// A typo must not switch the guard off.
	exec(t, db, `INSERT INTO `+schema+`_track.configurations (name, value) VALUES ('max_delete_percent', 'ten')`)

	got, err := track[*user](t, db, table, true)
	if err == nil || errors.Is(err, ErrTooManyDeletes) || !strings.Contains(err.Error(), "max_delete_percent") || len(got) != 0 {
		t.Fatalf("max_delete_percent = 'ten': err = %v, sent %d — want a 'not a percentage' error and nothing sent", err, len(got))
	}

	// ...and on any run of any table in that schema, even one with NO deletions — not only when the
	// guard is needed, which would hide the typo until the one mass delete it was meant to stop.
	exec(t, db, `CREATE TABLE `+schema+`.quiet (id bigint PRIMARY KEY, v text)`)
	exec(t, db, `INSERT INTO `+schema+`.quiet VALUES (1, 'a')`)

	got, err = track[*user](t, db, schema+".quiet", true)
	if err == nil || !strings.Contains(err.Error(), "max_delete_percent") || len(got) != 0 {
		t.Fatalf("a run with no deletions under a bad limit: err = %v, sent %d — want the same error", err, len(got))
	}
}

func TestUnsupportedTablesAreRefusedBeforeAnythingIsCreated(t *testing.T) {
	db, schema := scratch(t)

	exec(t, db, `CREATE TABLE `+schema+`.user_teams (user_id bigint, team_id bigint, PRIMARY KEY (user_id, team_id))`)
	exec(t, db, `CREATE TABLE `+schema+`.codes (code text PRIMARY KEY)`)
	exec(t, db, `CREATE TABLE `+schema+`.uuids (id uuid PRIMARY KEY)`)
	exec(t, db, `CREATE TABLE `+schema+`.logs (id bigint, line text)`)

	long := strings.Repeat("x", 60)
	exec(t, db, `CREATE TABLE `+schema+`.`+long+` (id bigint PRIMARY KEY)`)

	for _, name := range []string{"user_teams", "codes", "uuids", "logs", long} {
		_, err := track[*user](t, db, schema+"."+name, true)
		if !errors.Is(err, ErrUnsupportedTable) {
			t.Errorf("%s: err = %v, want ErrUnsupportedTable", name, err)
		}
	}

	_, err := track[*user](t, db, schema+".nothing_here", true)
	if !errors.Is(err, ErrTableNotFound) {
		t.Errorf("a missing table: err = %v, want ErrTableNotFound", err)
	}

	// A T with no field for the key column is refused too.
	exec(t, db, `CREATE TABLE `+schema+`.things (thing_no bigint PRIMARY KEY)`)

	_, err = track[*user](t, db, schema+".things", true)
	if err == nil || !strings.Contains(err.Error(), "thing_no") {
		t.Errorf("T without a thing_no field: err = %v, want it named", err)
	}

	if n := scalar[int64](t, db, `SELECT count(*) FROM pg_namespace WHERE nspname = ?`, schema+"_track"); n != 0 {
		t.Fatal("a refused table still got a track schema")
	}
}

func TestAnOverlappingRunSkipsTheTable(t *testing.T) {
	db, schema := scratch(t)
	table := usersTable(t, db, schema, 2)

	started := make(chan struct{})
	release := make(chan struct{})

	var (
		wg       sync.WaitGroup
		firstErr error
		once     sync.Once
	)

	wg.Add(1)

	go func() {
		defer wg.Done()

		firstErr = TrackTable[*user](context.Background(), db, table, func(ctx context.Context, c Change[*user]) error {
			once.Do(func() { close(started) })
			<-release

			return c.Ack(db)
		})
	}()

	<-started

	got, err := track[*user](t, db, table, true)
	if !errors.Is(err, ErrStillRunning) || len(got) != 0 {
		t.Fatalf("a run during another: err = %v, sent %d — want ErrStillRunning and nothing sent", err, len(got))
	}

	close(release)
	wg.Wait()

	if firstErr != nil {
		t.Fatalf("the first run: %v", firstErr)
	}

	// The lock went with the first run's transaction.
	if again := mustTrack[*user](t, db, table); len(again) != 0 {
		t.Fatalf("after the first run = %q, want nothing left", summary(again))
	}
}

func TestTheHashDoesNotFollowTheSessionTimeZone(t *testing.T) {
	db, schema := scratch(t)

	table := schema + ".events"
	exec(t, db, `CREATE TABLE `+table+` (id bigint PRIMARY KEY, at timestamptz NOT NULL, amount float8 NOT NULL)`)
	exec(t, db, `INSERT INTO `+table+` VALUES (1, '2026-11-04 10:00+07', 0.1), (2, '2026-01-01 00:00+00', 12.5)`)

	type event struct {
		ID     int64
		At     time.Time
		Amount float64
	}

	// runIn runs TrackTable on one connection whose SESSION TimeZone is zone, acking on the pool, and
	// returns what was sent plus the raw, unpinned hash of row 1 in that session.
	runIn := func(zone string) ([]Change[event], int) {
		var (
			got []Change[event]
			raw int
		)

		err := db.Connection(func(conn *gorm.DB) error {
			defer conn.Exec(`RESET TimeZone`)

			err := conn.Exec(`SELECT set_config('TimeZone', ?, false)`, zone).Error
			if err != nil {
				return err
			}

			err = conn.Raw(`SELECT hashtext(e::text) FROM ` + table + ` AS e WHERE id = 1`).Scan(&raw).Error
			if err != nil {
				return err
			}

			return TrackTable[event](context.Background(), conn, table, func(ctx context.Context, c Change[event]) error {
				got = append(got, c)

				return c.Ack(db)
			})
		})
		if err != nil {
			t.Fatalf("run in %s: %v", zone, err)
		}

		return got, raw
	}

	first, rawUTC := runIn("UTC")
	if len(first) != 2 {
		t.Fatalf("first run = %q, want 2 new", summary(first))
	}

	again, rawJakarta := runIn("Asia/Jakarta")

	// The control: unpinned, the same row hashes differently in the two sessions — so a run that did
	// not pin would have sent both rows again.
	if rawUTC == rawJakarta {
		t.Fatal("control failed: the unpinned hash did not change with TimeZone, so this test proves nothing")
	}

	if len(again) != 0 {
		t.Fatalf("a run in Asia/Jakarta after one in UTC = %q, want nothing", summary(again))
	}
}

func TestPagesCoverEveryRowOnce(t *testing.T) {
	old := pageSize
	pageSize = 2

	t.Cleanup(func() { pageSize = old })

	db, schema := scratch(t)

	table := schema + ".items"
	exec(t, db, `CREATE TABLE `+table+` (id serial PRIMARY KEY, v text NOT NULL)`)
	exec(t, db, `INSERT INTO `+table+` (v) SELECT 'v'||g FROM generate_series(1, 7) AS g`)

	type item struct {
		ID int
		V  string
	}

	if s := summary(mustTrack[item](t, db, table)); s != "new:1 new:2 new:3 new:4 new:5 new:6 new:7" {
		t.Fatalf("first run over pages of 2 = %q", s)
	}

	// Changes on pages 1 and 3 only — page 2 has none and must still move the cursor.
	exec(t, db, `UPDATE `+table+` SET v = 'edited' WHERE id IN (2, 6)`)
	exec(t, db, `DELETE FROM `+table+` WHERE id IN (1, 4, 7)`)

	if s := summary(mustTrack[item](t, db, table)); s != "modified:2 modified:6 deleted:1 deleted:4 deleted:7" {
		t.Fatalf("second run over pages of 2 = %q", s)
	}

	if again := mustTrack[item](t, db, table); len(again) != 0 {
		t.Fatalf("third run = %q, want nothing", summary(again))
	}
}

func TestAHandlerErrorStopsTheRun(t *testing.T) {
	db, schema := scratch(t)
	table := usersTable(t, db, schema, 3)

	boom := errors.New("boom")

	err := TrackTable[*user](context.Background(), db, table, func(ctx context.Context, c Change[*user]) error {
		if c.ID == 2 {
			return boom
		}

		return c.Ack(db)
	})
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want the handler's error", err)
	}

	if s := summary(mustTrack[*user](t, db, table)); s != "new:2 new:3" {
		t.Fatalf("the next run = %q, want new:2 new:3 — row 1 was acked before the error", s)
	}
}

func TestABareNameFollowsTheSearchPath(t *testing.T) {
	db, schema := scratch(t)
	usersTable(t, db, schema, 1)

	var got []Change[user]

	err := db.Connection(func(conn *gorm.DB) error {
		defer conn.Exec(`RESET search_path`)

		err := conn.Exec(`SELECT set_config('search_path', ?, false)`, schema).Error
		if err != nil {
			return err
		}

		return TrackTable[user](context.Background(), conn, "users", func(ctx context.Context, c Change[user]) error {
			got = append(got, c)

			return c.Ack(db)
		})
	})
	if err != nil {
		t.Fatal(err)
	}

	if len(got) != 1 || got[0].Data.Name != "name 1" {
		t.Fatalf("bare name, value T: %+v, want row 1", got)
	}

	if n := scalar[int64](t, db, `SELECT count(*) FROM `+schema+`_track.users_track`); n != 1 {
		t.Fatalf("the track table landed elsewhere: %s_track.users_track has %d rows", schema, n)
	}
}

func TestAckOfAChangeTrackTableDidNotSend(t *testing.T) {
	err := Change[user]{ID: 1, Change: ChangeTypeNew}.Ack(nil)
	if !errors.Is(err, ErrNotFromTrackTable) {
		t.Fatalf("err = %v, want ErrNotFromTrackTable", err)
	}
}

func TestAckAllWritesWhatAckWould(t *testing.T) {
	db, schema := scratch(t)
	users := usersTable(t, db, schema, 5)

	exec(t, db, `CREATE TABLE `+schema+`.teams (id bigint PRIMARY KEY, name text NOT NULL)`)
	exec(t, db, `INSERT INTO `+schema+`.teams VALUES (1, 'a'), (2, 'b')`)

	// Two tables in one AckAll, and the same change listed twice.
	gotUsers, err := track[*user](t, db, users, false)
	if err != nil {
		t.Fatal(err)
	}

	gotTeams, err := track[*user](t, db, schema+".teams", false)
	if err != nil {
		t.Fatal(err)
	}

	err = AckAll(db, append(append(gotUsers, gotUsers[0]), gotTeams...))
	if err != nil {
		t.Fatalf("AckAll: %v", err)
	}

	if again := mustTrack[*user](t, db, users); len(again) != 0 {
		t.Fatalf("users after AckAll = %q, want nothing", summary(again))
	}

	if again := mustTrack[*user](t, db, schema+".teams"); len(again) != 0 {
		t.Fatalf("teams after AckAll = %q, want nothing", summary(again))
	}

	// A modified and a deleted change in one batch.
	exec(t, db, `UPDATE `+users+` SET name = 'edited' WHERE id = 1`)
	exec(t, db, `DELETE FROM `+users+` WHERE id = 5`)

	mixed, err := track[*user](t, db, users, false)
	if err != nil {
		t.Fatal(err)
	}

	if s := summary(mixed); s != "modified:1 deleted:5" {
		t.Fatalf("mixed = %q", s)
	}

	err = AckAll(db, mixed)
	if err != nil {
		t.Fatalf("AckAll mixed: %v", err)
	}

	if again := mustTrack[*user](t, db, users); len(again) != 0 {
		t.Fatalf("after AckAll mixed = %q, want nothing", summary(again))
	}

	if n := scalar[int64](t, db, `SELECT count(*) FROM `+schema+`_track.users_track`); n != 4 {
		t.Fatalf("users_track rows = %d, want 4", n)
	}

	err = AckAll(db, []Change[*user]{{ID: 1, Change: ChangeTypeNew}})
	if !errors.Is(err, ErrNotFromTrackTable) {
		t.Fatalf("AckAll of a hand-made change: err = %v, want ErrNotFromTrackTable", err)
	}
}
