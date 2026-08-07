package san_race_test

import (
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The harness's own tests run against a table nothing else owns, so they never collide with the
// service tests sharing `warehouse_test`. It is created on demand and left in place — dropping it
// buys nothing, and `go run ./cmd/tool db reset-test` clears it with everything else.
const selftest = "san_race_selftest"

func newHarness(t *testing.T) *san_race.Harness {
	t.Helper()

	err := san_testdb.Pool(t).Exec(
		`CREATE TABLE IF NOT EXISTS ` + selftest + ` (id bigint PRIMARY KEY, n bigint NOT NULL)`).Error
	if err != nil {
		t.Fatalf("create %s: %v", selftest, err)
	}

	h := san_race.New(t, selftest)

	err = h.DB().Exec(`INSERT INTO ` + selftest + ` (id, n) VALUES (1, 0), (2, 0)`).Error
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	return h
}

func total(t *testing.T, h *san_race.Harness, id int) int64 {
	t.Helper()

	var n int64

	err := h.DB().Raw(`SELECT n FROM `+selftest+` WHERE id = ?`, id).Scan(&n).Error
	if err != nil {
		t.Fatalf("read n: %v", err)
	}

	return n
}

// readModifyWrite is the classic bug: read a number, add to it in Go, write it back. Whether it is
// safe depends entirely on `lock`.
func readModifyWrite(h *san_race.Harness, lock string) func(int) error {
	return func(int) error {
		return h.DB().Transaction(func(tx *gorm.DB) error {
			var n int64

			err := tx.Raw(`SELECT n FROM ` + selftest + ` WHERE id = 1 ` + lock).Scan(&n).Error
			if err != nil {
				return err
			}

			// Widen the window deliberately. A race test that relies on the window being hit by
			// luck reports "no bug" on a fast machine and "bug" on a slow one.
			time.Sleep(20 * time.Millisecond)

			return tx.Exec(`UPDATE `+selftest+` SET n = ? WHERE id = 1`, n+1).Error
		})
	}
}

// The harness must FIND a lost update — if this passes, every other race test in the repo is
// meaningless, because the tool cannot see the thing it exists to see.
func TestRace_FindsALostUpdate(t *testing.T) {
	h := newHarness(t)

	res := h.Race(t, 8, readModifyWrite(h, ""))
	res.Report(t)

	if res.Failed() != 0 {
		t.Fatalf("no caller should error without a lock, got %d", res.Failed())
	}

	got := total(t, h, 1)
	if got >= 8 {
		t.Fatalf("expected increments to be LOST (n < 8), got n = %d — the harness is not "+
			"actually running these concurrently", got)
	}

	t.Logf("8 concurrent increments, no lock → n = %d (%d lost)", got, 8-got)
}

func TestRace_ForUpdateFixesIt(t *testing.T) {
	h := newHarness(t)

	res := h.Race(t, 8, readModifyWrite(h, "FOR UPDATE"))
	res.Report(t)

	if res.Failed() != 0 {
		t.Fatalf("FOR UPDATE should serialize, not fail: %d errors", res.Failed())
	}

	got := total(t, h, 1)
	if got != 8 {
		t.Fatalf("expected n = 8 under FOR UPDATE, got %d", got)
	}
}

// Two transactions taking the same two rows in opposite orders — the canonical deadlock. The
// harness must classify it as Deadlock and not as a generic error.
func TestRace_ClassifiesADeadlock(t *testing.T) {
	h := newHarness(t)

	order := [][2]int{{1, 2}, {2, 1}}

	res := h.Race(t, 2, func(i int) error {
		ids := order[i]

		return h.DB().Transaction(func(tx *gorm.DB) error {
			err := tx.Exec(`UPDATE `+selftest+` SET n = n + 1 WHERE id = ?`, ids[0]).Error
			if err != nil {
				return err
			}

			time.Sleep(100 * time.Millisecond)

			return tx.Exec(`UPDATE `+selftest+` SET n = n + 1 WHERE id = ?`, ids[1]).Error
		})
	})
	res.Report(t)

	if res.Count(san_race.Deadlock) != 1 {
		t.Fatalf("expected exactly one deadlock victim, got %d (outcomes: %+v)",
			res.Count(san_race.Deadlock), res.Outcomes)
	}
}

// Interleave must show a row lock actually holding: B's write blocks until A commits.
func TestInterleave_SeesTheBlockAndTheRelease(t *testing.T) {
	h := newHarness(t)

	lock := func(tx *gorm.DB) error {
		var n int64

		return tx.Raw(`SELECT n FROM ` + selftest + ` WHERE id = 1 FOR UPDATE`).Scan(&n).Error
	}

	sched := h.Interleave(t,
		san_race.Do("A", "A locks row 1", lock),
		san_race.Block("B", "B wants row 1", lock),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	b := sched.Get("B wants row 1")

	if !b.Blocked {
		t.Fatal("B should have blocked on A's row lock — the harness is not using separate connections")
	}

	if !b.Released {
		t.Fatal("B should have been released by A's COMMIT")
	}

	if b.Err != nil {
		t.Fatalf("B should succeed once released, got %v", b.Err)
	}
}

// A Block step that does NOT block is the finding an audit is looking for — the harness must record
// it rather than fail on it, so the report can say "the lock you assumed is not held".
func TestInterleave_RecordsAnUnblockedBlockStep(t *testing.T) {
	h := newHarness(t)

	sched := h.Interleave(t,
		san_race.Do("A", "A reads row 1 without a lock", func(tx *gorm.DB) error {
			var n int64
			return tx.Raw(`SELECT n FROM ` + selftest + ` WHERE id = 1`).Scan(&n).Error
		}),
		san_race.Block("B", "B reads row 1", func(tx *gorm.DB) error {
			var n int64
			return tx.Raw(`SELECT n FROM ` + selftest + ` WHERE id = 1`).Scan(&n).Error
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	b := sched.Get("B reads row 1")

	if b.Blocked {
		t.Fatal("a plain SELECT must not block — the harness is inventing a lock")
	}

	if b.Err != nil {
		t.Fatalf("unexpected error: %v", b.Err)
	}
}
