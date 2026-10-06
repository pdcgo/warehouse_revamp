//go:build raceaudit

package user_v1

import (
	"context"
	"fmt"
	"testing"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_caches"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// The concurrency audit of RevokeRoot (audit-sql). "Never the last Root" is a COUNT, and a count is the classic
// check-then-act: two removals of the last two Roots would each count two and leave none. RevokeRoot counts under a
// lock on every Root's membership row; these prove that lock holds and that the count is taken after it.

// seedRoots commits two extra Roots and removes exactly them afterwards — never user 1, whom the rest of the suite needs.
func seedRoots(t *testing.T, db *gorm.DB) (uint64, uint64) {
	t.Helper()

	suffix := time.Now().UnixNano() % 1_000_000_000

	mk := func(name string) uint64 {
		u := user_service_models.User{Username: fmt.Sprintf("raceroot%s%d", name, suffix), Password: "x"}

		err := db.Create(&u).Error
		if err != nil {
			t.Fatalf("seed %s: %v", name, err)
		}

		err = db.Create(&user_service_models.UserTeamRole{
			TeamID: san_auth.RootTeamID, UserID: u.ID, Role: int32(role_basev1.Role_ROLE_ROOT),
		}).Error
		if err != nil {
			t.Fatalf("seed %s's Root: %v", name, err)
		}

		return u.ID
	}

	a, b := mk("a"), mk("b")

	t.Cleanup(func() {
		ids := []uint64{a, b}
		db.Where("user_id IN ?", ids).Delete(&user_service_models.TeamMemberLog{})
		db.Where("user_id IN ?", ids).Delete(&user_service_models.UserTeamRole{})
		db.Where("id IN ?", ids).Delete(&user_service_models.User{})
	})

	return a, b
}

func lockedRoots(tx *gorm.DB) ([]uint64, error) {
	var roots []uint64

	err := tx.
		Model(&user_service_models.UserTeamRole{}).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("team_id = ? AND role = ?", san_auth.RootTeamID, int32(role_basev1.Role_ROLE_ROOT)).
		Order("user_id").
		Pluck("user_id", &roots).
		Error

	return roots, err
}

// Interleave: A removes Root a and has not committed; B's count of the Roots MUST wait, and once A commits it must
// see one fewer. Blocking alone is not enough — a count read before the wait would let two removals leave none.
func TestInterleave_RevokeRoot_TheSecondCountsAfterTheFirst(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()
	a, b := seedRoots(t, db)

	var before, seenByB []uint64

	sched := h.Interleave(t,
		san_race.Do("A", "A locks a's row, counts the Roots and removes a", func(tx *gorm.DB) error {
			_, err := lockMembership(tx, a, san_auth.RootTeamID)
			if err != nil {
				return err
			}

			before, err = lockedRoots(tx)
			if err != nil {
				return err
			}

			return tx.Where("team_id = ? AND user_id = ?", san_auth.RootTeamID, a).Delete(&user_service_models.UserTeamRole{}).Error
		}),
		san_race.Do("B", "B locks b's row", func(tx *gorm.DB) error {
			_, err := lockMembership(tx, b, san_auth.RootTeamID)
			return err
		}),
		san_race.Block("B", "B counts the Roots", func(tx *gorm.DB) error {
			var err error
			seenByB, err = lockedRoots(tx)
			return err
		}),
		san_race.Commit("A"),
		san_race.Rollback("B"),
	)
	sched.Report(t)

	count := sched.Get("B counts the Roots")
	if !count.Blocked || !count.Released {
		t.Fatalf("B's count did not wait for A (blocked=%v released=%v) — the Roots are not locked", count.Blocked, count.Released)
	}

	if len(seenByB) != len(before)-1 {
		t.Fatalf("B counted %d Roots after A removed one of %d — the count is not re-read under the lock", len(seenByB), len(before))
	}
}

// Race: the two extra Roots removed at once, many rounds — never a deadlock, never an unexpected error, and user 1
// stays Root throughout.
func TestRace_RevokeRoot_TwoAtOnce(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()

	svc := NewService(db, nil,
		access_interceptors.NewDBRoleResolver(db, san_caches.NewSkipCacheManager()),
		raceTeams{}, nil, san_caches.NewSkipCacheManager(), event_source.EmptySender)

	for round := 0; round < 20; round++ {
		a, b := seedRoots(t, db)
		ids := []uint64{a, b}

		res := h.Race(t, 2, func(i int) error {
			return svc.RevokeRoot(context.Background(), ids[i], "san")
		})

		if res.Failed() > 0 {
			res.Report(t)
			t.Fatalf("round %d: %d removals failed", round, res.Failed())
		}
	}

	var root int64

	db.Model(&user_service_models.UserTeamRole{}).
		Where("team_id = ? AND user_id = 1 AND role = ?", san_auth.RootTeamID, int32(role_basev1.Role_ROLE_ROOT)).
		Count(&root)

	if root != 1 {
		t.Fatalf("user 1 is no longer Root")
	}
}
