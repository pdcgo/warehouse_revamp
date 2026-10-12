//go:build raceaudit

package user_v1

import (
	"context"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	userv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/user/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_caches"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
)

// The concurrency audit of one account per phone (a-phone-or-email-belongs-to-one-account, audit-sql). It is a
// PHANTOM INSERT: refuseTakenContact reads "nobody has this number", then the write happens — and two saves at the
// same moment can both read nobody. FOR UPDATE cannot help (there is no row to lock yet); the unique index
// `users_phone_unique` (00008) is what makes it safe, and the second save is refused with AlreadyExists.

// phoneRaceCleanup removes exactly the accounts a race made, never the other packages' rows in `users`.
func phoneRaceCleanup(t *testing.T, db *gorm.DB, prefix string) {
	t.Cleanup(func() {
		db.Where("username LIKE ?", prefix+"%").Delete(&user_service_models.User{})
	})
}

// Race: eight people created at once with one number, written eight ways. Exactly one account may hold it.
func TestRace_CreateUser_OnePhoneOneAccount(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()

	svc := NewService(db, nil,
		access_interceptors.NewDBRoleResolver(db, san_caches.NewSkipCacheManager()),
		raceTeams{}, nil, san_caches.NewSkipCacheManager(), event_source.EmptySender)

	written := []string{
		"0812-7000-1000", "0812 7000 1000", "+62 812 7000 1000", "62-812-7000-1000",
		"+62 (812) 7000-1000", "081270001000", "+6281270001000", "0812.7000.1000",
	}

	for round := 0; round < 20; round++ {
		prefix := fmt.Sprintf("racephone%d%d", time.Now().UnixNano()%1_000_000, round)
		phoneRaceCleanup(t, db, prefix)

		res := h.Race(t, len(written), func(i int) error {
			// Teamless (team 0): no caller is resolved, so the race is the insert alone.
			_, err := svc.CreateUser(context.Background(), connect.NewRequest(&userv1.CreateUserRequest{
				Username: fmt.Sprintf("%s%d", prefix, i), Password: "password123", Name: "Race", PhoneNumber: written[i],
			}))

			return err
		})

		var holders int64

		db.Model(&user_service_models.User{}).Where("phone_number = ?", "+6281270001000").Count(&holders)

		if holders != 1 {
			res.Report(t)
			t.Fatalf("round %d: %d accounts hold one number", round, holders)
		}

		db.Where("phone_number = ?", "+6281270001000").Delete(&user_service_models.User{})
	}
}

// Interleave: A has inserted the number and not committed; B's insert of the same number MUST wait on the unique
// index, and fail once A commits. That wait is the proof the check-then-insert gap is closed.
func TestInterleave_CreateUser_TheSecondWaitsThenIsRefused(t *testing.T) {
	h := san_race.New(t)
	db := h.DB()

	prefix := fmt.Sprintf("ilphone%d", time.Now().UnixNano()%1_000_000)
	phoneRaceCleanup(t, db, prefix)

	insert := func(name string) func(tx *gorm.DB) error {
		return func(tx *gorm.DB) error {
			// What CreateUser does inside its transaction: check, then write.
			err := refuseTakenContact(tx, 0, "", "+6281270002000")
			if err != nil {
				return err
			}

			return tx.Create(&user_service_models.User{Username: prefix + name, Password: "x", PhoneNumber: "+6281270002000"}).Error
		}
	}

	sched := h.Interleave(t,
		san_race.Do("A", "A checks and inserts the number", insert("a")),
		san_race.Block("B", "B checks and inserts the same number", insert("b")),
		san_race.Commit("A"),
		san_race.Rollback("B"),
	)
	sched.Report(t)

	second := sched.Get("B checks and inserts the same number")
	if !second.Blocked || !second.Released {
		t.Fatalf("B did not wait for A (blocked=%v released=%v) — the unique index is not holding", second.Blocked, second.Released)
	}

	if san_race.Classify(second.Err) != san_race.UniqueViolation {
		t.Fatalf("B ended with %v, want a unique violation", second.Err)
	}

	db.Where("phone_number = ?", "+6281270002000").Delete(&user_service_models.User{})
}
