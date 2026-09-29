//go:build raceaudit

// Concurrency audit for ShopUserSetPrimary (the audit-sql skill), and its interplay with ShopUserAdd and
// ShopUserRemove. The race team, the cleanup and the helpers are in shop_user_add_race_test.go.
//
//	go test -tags raceaudit -run 'TestRace_ShopUserSetPrimary|TestInterleave_ShopUserSetPrimary' -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
)

// N Make primary calls at once, each naming a different granted user: every call succeeds, exactly one
// primary is left, and the partial unique index never surfaces as an error.
func TestRace_ShopUserSetPrimary_ManyUsersAtOnce(t *testing.T) {
	h := shopRaceHarness(t)
	svc := newService(t, h.DB())

	const n = 8

	for round := range 10 {
		shopID := raceShop(t, h.DB(), fmt.Sprintf("SET-%d", round))

		for i := range n {
			grant(t, svc, raceShopTeam, shopID, uint64(100+i)) // 100, the first, is the primary
		}

		codes := make([]connect.Code, n)

		res := h.Race(t, n, func(i int) error {
			_, err := raceSetPrimary(svc, shopID, uint64(100+i))
			codes[i] = connect.CodeOf(err)

			return err
		})

		if round == 0 {
			res.Report(t)
		}

		for i, o := range res.Outcomes {
			if o.Err != nil {
				t.Fatalf("round %d: caller %d got %v (%s, %v)", round, i, codes[i], o.Kind, o.Err)
			}
		}

		primaries := racePrimaries(t, h.DB(), shopID)
		if len(primaries) != 1 {
			t.Fatalf("round %d: primaries %v — want exactly one", round, primaries)
		}

		t.Logf("round %d: primary %d", round, primaries[0])
	}
}

// THE PROOF THAT lockShop HOLDS for Make primary, and that B RE-READS after it. A moves the primary to
// 102 and has not committed; B's move to 103 must wait on the shop row, and then clear A's 102 — not the
// 101 it would have seen before the lock — or the partial unique index refuses B's flag.
func TestInterleave_ShopUserSetPrimary_SecondWaitsAndReReads(t *testing.T) {
	h := shopRaceHarness(t)
	svc := newService(t, h.DB())
	shopID := raceShop(t, h.DB(), "SET-WAIT")

	for _, user := range []uint64{101, 102, 103} {
		grant(t, svc, raceShopTeam, shopID, user) // 101 is the primary
	}

	setPrimary := func(user uint64) func(tx *gorm.DB) error {
		return func(tx *gorm.DB) error {
			_, err := raceSetPrimary(newService(t, tx), shopID, user)

			return err
		}
	}

	const second = "B makes 103 primary"

	sched := h.Interleave(t,
		san_race.Do("A", "A makes 102 primary — lockShop holds the shop row", setPrimary(102)),
		san_race.Block("B", second, setPrimary(103)),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	b := sched.Get(second)
	if !b.Blocked || !b.Released {
		t.Fatalf("B did not wait on the shop row (blocked=%v released=%v)", b.Blocked, b.Released)
	}

	if b.Err != nil {
		t.Fatalf("B failed after the wait — it cleared the primary it saw BEFORE the lock: %v", b.Err)
	}

	primaries := racePrimaries(t, h.DB(), shopID)
	if len(primaries) != 1 || primaries[0] != 103 {
		t.Fatalf("primaries %v, want [103]", primaries)
	}
}

// Make primary and a grant share the one lock: a grant landing while Make primary holds the shop waits,
// then sees the primary Make primary set and leaves its own grant unflagged.
func TestInterleave_ShopUserSetPrimary_HoldsBackAGrant(t *testing.T) {
	h := shopRaceHarness(t)
	svc := newService(t, h.DB())
	shopID := raceShop(t, h.DB(), "SET-ADD")

	grant(t, svc, raceShopTeam, shopID, 101) // the primary
	grant(t, svc, raceShopTeam, shopID, 102)

	const grantStep = "B grants user 103"

	sched := h.Interleave(t,
		san_race.Do("A", "A makes 102 primary — lockShop holds the shop row", func(tx *gorm.DB) error {
			_, err := raceSetPrimary(newService(t, tx), shopID, 102)

			return err
		}),
		san_race.Block("B", grantStep, func(tx *gorm.DB) error {
			return raceAdd(newService(t, tx), shopID, 103)
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	b := sched.Get(grantStep)
	if !b.Blocked || !b.Released || b.Err != nil {
		t.Fatalf("the grant: blocked=%v released=%v err=%v — want it held back until A commits",
			b.Blocked, b.Released, b.Err)
	}

	primaries := racePrimaries(t, h.DB(), shopID)
	if len(primaries) != 1 || primaries[0] != 102 {
		t.Fatalf("primaries %v, want [102]", primaries)
	}
}

// THE FINDING — Make primary's "is this user granted?" check is not protected against ShopUserRemove,
// which takes no shop lock.
//
// A removes 102's grant and has not committed. B makes 102 primary: its check still sees the grant (A is
// uncommitted), it clears 101, and its flag UPDATE then waits on the row A deleted. A commits; the UPDATE
// finds nothing — and B does not look, so it commits and reports success.
//
// A committed FIRST, so the serial answer is "Make primary is refused — 102 has no grant — and 101 keeps
// its flag". What B commits instead — the old primary cleared and nobody set — is not the effect of ANY
// successful Make primary: B read the grant before A's delete and wrote after it, a dependency cycle no
// serial order has.
//
// ⚠ This test FAILS while the finding stands; it is the regression test for the fix.
func TestInterleave_ShopUserSetPrimary_GrantRemovedMeanwhile(t *testing.T) {
	h := shopRaceHarness(t)
	svc := newService(t, h.DB())
	shopID := raceShop(t, h.DB(), "SET-REMOVE")

	grant(t, svc, raceShopTeam, shopID, 101) // the primary
	grant(t, svc, raceShopTeam, shopID, 102)

	var (
		replied *sellingv1.Shop
		errB    error
	)

	const makePrimary = "B makes 102 primary — its flag UPDATE waits on the row A deleted"

	sched := h.Interleave(t,
		san_race.Do("A", "A removes 102's grant", func(tx *gorm.DB) error {
			return raceRemove(newService(t, tx), shopID, 102)
		}),
		san_race.Block("B", makePrimary, func(tx *gorm.DB) error {
			replied, errB = raceSetPrimary(newService(t, tx), shopID, 102)

			return errB
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	b := sched.Get(makePrimary)
	if !b.Blocked || !b.Released {
		t.Fatalf("B did not wait on the deleted row (blocked=%v released=%v) — the schedule's premise failed",
			b.Blocked, b.Released)
	}

	primaries := racePrimaries(t, h.DB(), shopID)
	granted := raceGranted(t, h.DB(), shopID)

	t.Logf("after both commits: B's error %v, B's reply primary_user_id=%d, grants %v, primaries %v",
		errB, replied.GetPrimaryUserId(), granted, primaries)

	if errB == nil {
		t.Fatalf("FINDING: Make primary 102 committed AFTER 102's grant was removed and reported success "+
			"(primary_user_id=%d), but it set nobody — the shop is left with primaries %v and the old "+
			"primary 101 lost its flag. The serial outcome is FailedPrecondition with 101 still primary.",
			replied.GetPrimaryUserId(), primaries)
	}

	if connect.CodeOf(errB) != connect.CodeFailedPrecondition {
		t.Fatalf("B got %v, want FailedPrecondition (no grant): %v", connect.CodeOf(errB), errB)
	}

	if len(primaries) != 1 || primaries[0] != 101 {
		t.Fatalf("B was refused, but primaries are %v — 101 must keep its flag", primaries)
	}
}

// Make primary, grants and removals all at once on one shop — removals aimed at the very users Make
// primary names. Whatever interleaving happens: at most ONE primary, and no error but the expected
// refusal of a Make primary whose user has just been removed. No deadlock, no unique violation.
//
// A smoke test: a green run proves nothing on its own — the Interleaves above are the proofs.
func TestRace_ShopUserSetPrimary_AgainstGrantsAndRemovals(t *testing.T) {
	h := shopRaceHarness(t)
	svc := newService(t, h.DB())

	const n = 12

	for round := range 10 {
		shopID := raceShop(t, h.DB(), fmt.Sprintf("MIX-%d", round))

		for i := range 6 {
			grant(t, svc, raceShopTeam, shopID, uint64(100+i)) // 100 is the primary
		}

		res := h.Race(t, n, func(i int) error {
			switch i % 3 {
			case 0:
				_, err := raceSetPrimary(svc, shopID, uint64(100+i%6)) // 100, 103, 100, 103

				return err
			case 1:
				return raceAdd(svc, shopID, uint64(200+i))
			default:
				return raceRemove(svc, shopID, uint64(100+(i+1)%6)) // 103, 100, 103, 100
			}
		})

		if round == 0 {
			res.Report(t)
		}

		for _, o := range res.Outcomes {
			if o.Err == nil {
				continue
			}

			if o.I%3 == 0 && connect.CodeOf(o.Err) == connect.CodeFailedPrecondition {
				continue
			}

			t.Fatalf("round %d: caller %d (kind %d) got %v — %s: %v",
				round, o.I, o.I%3, connect.CodeOf(o.Err), o.Kind, o.Err)
		}

		primaries := racePrimaries(t, h.DB(), shopID)
		if len(primaries) > 1 {
			t.Fatalf("round %d: primaries %v", round, primaries)
		}

		t.Logf("round %d: grants %v, primaries %v, refused %d", round,
			raceGranted(t, h.DB(), shopID), primaries, res.Failed())
	}
}
