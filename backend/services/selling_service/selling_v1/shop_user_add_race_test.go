//go:build raceaudit

// Concurrency audit for ShopUserAdd (the audit-sql skill) — and for lockShop, the shop-row lock it
// shares with ShopUserSetPrimary, against the orders foreign key that takes a lock on the same row.
//
// ⚠ san_race.New is given NO tables. Other audits run against the same warehouse_test at the same
// time, and a DELETE FROM shops would take every selling row with it. Every row here belongs to one race
// team and is deleted by that scope instead. No order is ever committed: the order inserts below all end
// in a ROLLBACK.
//
//	go test -tags raceaudit -run 'TestRace_ShopUserAdd|TestInterleave_ShopUserAdd|TestInterleave_LockShop' -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// raceShopTeam is the team every row of these audits belongs to — the scope they are cleaned by.
const raceShopTeam uint64 = 7_700_001

// shopRaceHarness is a committing harness whose cleanup is the race team's shops and grants only.
func shopRaceHarness(t *testing.T) *san_race.Harness {
	t.Helper()

	h := san_race.New(t)

	clean := func() {
		// Children before parents — shop_users would go by ON DELETE CASCADE, but say it.
		err := h.DB().
			Exec(`DELETE FROM shop_users WHERE shop_id IN (SELECT id FROM shops WHERE team_id = ?)`, raceShopTeam).
			Error
		if err == nil {
			err = h.DB().Exec(`DELETE FROM shops WHERE team_id = ?`, raceShopTeam).Error
		}

		if err != nil {
			t.Errorf("cleaning the race team's shops: %v", err)
		}
	}

	clean()
	t.Cleanup(clean)

	return h
}

// raceShop seeds an active shop in the race team — no grants, so no primary.
func raceShop(t *testing.T, db *gorm.DB, code string) uint64 {
	t.Helper()

	return insertShop(t, db, raceShopTeam, "Race "+code, code, "shopee")
}

// racePrimaries is who the COMMITTED state flags primary on a shop, by user id.
func racePrimaries(t *testing.T, db *gorm.DB, shopID uint64) []uint64 {
	t.Helper()

	var users []uint64

	err := db.
		Model(&selling_service_models.ShopUser{}).
		Where("shop_id = ? AND is_primary", shopID).
		Order("user_id").
		Pluck("user_id", &users).
		Error
	if err != nil {
		t.Fatalf("read the primaries of shop %d: %v", shopID, err)
	}

	return users
}

// raceGranted is every user the COMMITTED state grants on a shop, by user id.
func raceGranted(t *testing.T, db *gorm.DB, shopID uint64) []uint64 {
	t.Helper()

	var users []uint64

	err := db.
		Model(&selling_service_models.ShopUser{}).
		Where("shop_id = ?", shopID).
		Order("user_id").
		Pluck("user_id", &users).
		Error
	if err != nil {
		t.Fatalf("read the grants of shop %d: %v", shopID, err)
	}

	return users
}

func raceAdd(svc *selling_v1.Service, shopID, userID uint64) error {
	_, err := svc.ShopUserAdd(context.Background(), connect.NewRequest(&sellingv1.ShopUserAddRequest{
		TeamId: raceShopTeam, ShopId: shopID, UserId: userID,
	}))

	return err
}

func raceRemove(svc *selling_v1.Service, shopID, userID uint64) error {
	_, err := svc.ShopUserRemove(context.Background(), connect.NewRequest(&sellingv1.ShopUserRemoveRequest{
		TeamId: raceShopTeam, ShopId: shopID, UserId: userID,
	}))

	return err
}

func raceSetPrimary(svc *selling_v1.Service, shopID, userID uint64) (*sellingv1.Shop, error) {
	resp, err := svc.ShopUserSetPrimary(context.Background(), connect.NewRequest(&sellingv1.ShopUserSetPrimaryRequest{
		TeamId: raceShopTeam, ShopId: shopID, UserId: userID,
	}))
	if err != nil {
		return nil, err
	}

	return resp.Msg.GetShop(), nil
}

// raceOrderOn inserts an order row on a shop — enough for the orders FK check, which takes KEY SHARE
// on the shop's row. Every caller ends the transaction in a ROLLBACK.
func raceOrderOn(shopID uint64) func(tx *gorm.DB) error {
	return func(tx *gorm.DB) error {
		return tx.Create(&selling_service_models.Order{
			TeamID:       raceShopTeam,
			ShopID:       shopID,
			WarehouseID:  testWarehouse,
			Status:       "placed",
			CustomerName: "Race",
		}).Error
	}
}

// N different users granted at once on a shop with no primary: every grant lands, EXACTLY ONE becomes
// the primary, and no caller sees an error.
func TestRace_ShopUserAdd_ManyUsersOnAShopWithNoPrimary(t *testing.T) {
	h := shopRaceHarness(t)
	svc := newService(t, h.DB())

	const n = 8

	for round := range 10 {
		shopID := raceShop(t, h.DB(), fmt.Sprintf("ADD-%d", round))

		res := h.Race(t, n, func(i int) error {
			return raceAdd(svc, shopID, uint64(100+i))
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() != 0 {
			for _, o := range res.Outcomes {
				if o.Err != nil {
					t.Fatalf("round %d: caller %d got %v (%s)", round, o.I, o.Err, o.Kind)
				}
			}
		}

		granted := raceGranted(t, h.DB(), shopID)
		if len(granted) != n {
			t.Fatalf("round %d: %d grants, want %d", round, len(granted), n)
		}

		primaries := racePrimaries(t, h.DB(), shopID)
		if len(primaries) != 1 {
			t.Fatalf("round %d: primaries %v — want exactly one", round, primaries)
		}

		t.Logf("round %d: %d grants, primary %d", round, len(granted), primaries[0])
	}
}

// The same user granted N times at once: one grant, it is the primary, and every call succeeds — the
// idempotent re-add under the lock.
func TestRace_ShopUserAdd_SameUserAtOnce(t *testing.T) {
	h := shopRaceHarness(t)
	svc := newService(t, h.DB())

	for round := range 10 {
		shopID := raceShop(t, h.DB(), fmt.Sprintf("SAME-%d", round))

		res := h.Race(t, 8, func(int) error {
			return raceAdd(svc, shopID, 100)
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() != 0 {
			t.Fatalf("round %d: %d callers failed", round, res.Failed())
		}

		granted := raceGranted(t, h.DB(), shopID)
		primaries := racePrimaries(t, h.DB(), shopID)

		if len(granted) != 1 || len(primaries) != 1 || primaries[0] != 100 {
			t.Fatalf("round %d: grants %v primaries %v — want one grant, and it primary", round, granted, primaries)
		}
	}
}

// THE PROOF THAT lockShop HOLDS. A grants user 101 and has not committed; B's grant on the same shop must
// WAIT on the shop row, and after A commits it must RE-READ — find 101 primary and leave 102 unflagged.
// A third transaction names the lock B is waiting on.
func TestInterleave_ShopUserAdd_SecondGrantWaitsForTheFirst(t *testing.T) {
	h := shopRaceHarness(t)
	shopID := raceShop(t, h.DB(), "ADD-WAIT")

	add := func(user uint64) func(tx *gorm.DB) error {
		return func(tx *gorm.DB) error {
			return raceAdd(newService(t, tx), shopID, user)
		}
	}

	var waiting []san_race.Waiter

	const second = "B grants user 102 on the same shop"

	sched := h.Interleave(t,
		san_race.Do("A", "A grants user 101 — lockShop holds the shop row", add(101)),
		san_race.Block("B", second, add(102)),
		san_race.Do("C", "C reads pg_blocking_pids", func(tx *gorm.DB) error {
			var err error

			waiting, err = san_race.Waiters(tx)

			return err
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
		san_race.Rollback("C"),
	)
	sched.Report(t)

	b := sched.Get(second)
	if !b.Blocked || !b.Released {
		t.Fatalf("B did not wait on the shop row (blocked=%v released=%v)", b.Blocked, b.Released)
	}

	if b.Err != nil {
		t.Fatalf("B failed after the wait: %v", b.Err)
	}

	named := false

	for _, w := range waiting {
		if strings.Contains(w.Waiting, `FROM "shops"`) && strings.Contains(w.Waiting, "FOR UPDATE") {
			named = true

			t.Logf("B (pid %d) waits on pid %d in: %s", w.BlockedPID, w.BlockedBy, strings.Join(strings.Fields(w.Waiting), " "))
		}
	}

	if !named {
		t.Fatalf("no backend was waiting on lockShop's SELECT … FOR UPDATE: %+v", waiting)
	}

	primaries := racePrimaries(t, h.DB(), shopID)
	if len(primaries) != 1 || primaries[0] != 101 {
		t.Fatalf("primaries %v, want [101] — B must re-read after the lock and find A's primary", primaries)
	}
}

// Removing the primary while a grant lands. ShopUserRemove takes NO shop lock, so B does not wait: its
// NOT EXISTS reads the primary's row as it was before A's delete, and leaves 103 unflagged.
//
// NOT a finding — the history is serializable as "B, then A": B read the row A deleted, and nothing B
// read or wrote depends on A. The shop ends with no primary, which is what removing the primary's grant
// leaves (the-primary-cs-is-a-flag-on-a-grant). The assertion is that the end state is one of the two
// serial outcomes.
func TestInterleave_ShopUserAdd_WhileThePrimaryIsRemoved(t *testing.T) {
	h := shopRaceHarness(t)
	svc := newService(t, h.DB())
	shopID := raceShop(t, h.DB(), "ADD-REMOVE")

	grant(t, svc, raceShopTeam, shopID, 101) // the primary
	grant(t, svc, raceShopTeam, shopID, 102)

	const grantStep = "B grants user 103"

	sched := h.Interleave(t,
		san_race.Do("A", "A removes the primary's grant (101)", func(tx *gorm.DB) error {
			return raceRemove(newService(t, tx), shopID, 101)
		}),
		san_race.Do("B", grantStep, func(tx *gorm.DB) error {
			return raceAdd(newService(t, tx), shopID, 103)
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	if sched.Get(grantStep).Err != nil {
		t.Fatalf("B failed: %v", sched.Get(grantStep).Err)
	}

	primaries := racePrimaries(t, h.DB(), shopID)
	granted := raceGranted(t, h.DB(), shopID)

	// "B, then A" leaves none; "A, then B" would flag 103. Anything else is not a serial outcome.
	if len(primaries) > 1 || (len(primaries) == 1 && primaries[0] != 103) {
		t.Fatalf("primaries %v — neither serial order gives that", primaries)
	}

	t.Logf("grants %v, primaries %v — the \"B, then A\" outcome", granted, primaries)
}

// lockShop's FOR UPDATE conflicts with the KEY SHARE the orders foreign key takes on the shop's row, so
// an order being placed on the shop WAITS while a grant change holds the row.
func TestInterleave_LockShop_HoldsBackAnOrderOnTheShop(t *testing.T) {
	h := shopRaceHarness(t)
	shopID := raceShop(t, h.DB(), "LOCK-ORDER")

	const insert = "B inserts an order on the shop — the FK check takes KEY SHARE on its row"

	sched := h.Interleave(t,
		san_race.Do("A", "A grants user 101 — lockShop holds the shop row FOR UPDATE", func(tx *gorm.DB) error {
			return raceAdd(newService(t, tx), shopID, 101)
		}),
		san_race.Block("B", insert, raceOrderOn(shopID)),
		san_race.Commit("A"),
		san_race.Rollback("B"),
	)
	sched.Report(t)

	b := sched.Get(insert)
	if !b.Blocked || !b.Released || b.Err != nil {
		t.Fatalf("the order insert: blocked=%v released=%v err=%v — want it held back until A commits",
			b.Blocked, b.Released, b.Err)
	}
}

// …and the other way round: a grant change WAITS for an order placement that is still open — which
// holds its transaction across the inventory call (placeOrder's stock.Pick).
func TestInterleave_LockShop_WaitsForAnOrderInFlight(t *testing.T) {
	h := shopRaceHarness(t)
	shopID := raceShop(t, h.DB(), "LOCK-INFLIGHT")

	const grantStep = "B grants user 101 — lockShop waits for A's KEY SHARE"

	sched := h.Interleave(t,
		san_race.Do("A", "A inserts an order on the shop and has not committed (mid stock pick)", raceOrderOn(shopID)),
		san_race.Block("B", grantStep, func(tx *gorm.DB) error {
			return raceAdd(newService(t, tx), shopID, 101)
		}),
		san_race.Rollback("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	b := sched.Get(grantStep)
	if !b.Blocked || !b.Released || b.Err != nil {
		t.Fatalf("the grant: blocked=%v released=%v err=%v — want it held back until the order ends",
			b.Blocked, b.Released, b.Err)
	}
}

// The alternative, proved on raw SQL: FOR NO KEY UPDATE still serialises two grant changes on one shop,
// but does NOT conflict with the orders FK's KEY SHARE — the order goes straight through.
func TestInterleave_LockShop_NoKeyUpdateLetsTheOrderThrough(t *testing.T) {
	h := shopRaceHarness(t)
	shopID := raceShop(t, h.DB(), "LOCK-NOKEY")

	lock := func(tx *gorm.DB) error {
		var ids []uint64

		return tx.
			Raw(`SELECT id FROM shops WHERE id = ? AND team_id = ? AND deleted = false FOR NO KEY UPDATE`, shopID, raceShopTeam).
			Scan(&ids).
			Error
	}

	const (
		insert = "B inserts an order on the shop"
		second = "C takes the shop row FOR NO KEY UPDATE too"
	)

	sched := h.Interleave(t,
		san_race.Do("A", "A takes the shop row FOR NO KEY UPDATE", lock),
		san_race.Do("B", insert, raceOrderOn(shopID)),
		san_race.Block("C", second, lock),
		san_race.Rollback("B"),
		san_race.Rollback("A"),
		san_race.Rollback("C"),
	)
	sched.Report(t)

	b := sched.Get(insert)
	if b.Blocked || b.Err != nil {
		t.Fatalf("the order insert: blocked=%v err=%v — KEY SHARE should not wait on NO KEY UPDATE", b.Blocked, b.Err)
	}

	c := sched.Get(second)
	if !c.Blocked || !c.Released || c.Err != nil {
		t.Fatalf("the second lock: blocked=%v released=%v err=%v — two grant changes must still serialise",
			c.Blocked, c.Released, c.Err)
	}
}
