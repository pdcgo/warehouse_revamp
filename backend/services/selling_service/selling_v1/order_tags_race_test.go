//go:build raceaudit

// Concurrency audit for the ORDER TAGS (backlog #100): the orders' own list with unique names
// (orders-have-their-own-tag-list). Two people making the same new tag at the same second is the normal case on a shared
// list — the add box offers *Buat tag* to the seller and the warehouse alike — and an admin deleting a tag while a
// warehouse puts it on an order must never leave an order carrying a deleted tag.
//
//   - create: INSERT … ON CONFLICT ((lower(name))) DO NOTHING, then read the winner — one tag, every caller answered it;
//   - put on vs delete: the put-on holds the tag FOR KEY SHARE (orderTagHeld), the delete locks it FOR UPDATE first — so
//     the delete waits for a put-on in flight and takes it off with the rest, or the put-on finds no tag (NotFound);
//   - two renames to one name: the unique index lets one through, the other is AlreadyExists.
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS. Every row is the race team's or a tag
// named "race-…", removed before and after.
//
//	go test -tags raceaudit -p 1 -count=1 -run 'TestRace_OrderTag' -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// raceOrderTagHarness is the order race harness (the race team's orders, shops and return configuration cleaned), with
// this test's own tags — named "race-…" in any case — removed before and after it. The links go with their orders and
// their tags (ON DELETE CASCADE).
func raceOrderTagHarness(t *testing.T) (*san_race.Harness, *selling_v1.Service) {
	t.Helper()

	dropOwn := func(db *gorm.DB) {
		err := db.Exec(`DELETE FROM order_tags WHERE lower(name) LIKE 'race-%'`).Error
		if err != nil {
			t.Errorf("drop the race's order tags: %v", err)
		}
	}

	h := orderRaceHarness(t)

	dropOwn(h.DB())
	t.Cleanup(func() { dropOwn(h.DB()) })

	return h, newService(t, h.DB())
}

// EIGHT PEOPLE MAKE ONE NEW TAG AT ONCE — the seller's and the warehouse's crew, each typing it their own way: every call
// succeeds, every one answers the same tag, exactly one says it made it, and the list holds one.
func TestRace_OrderTagCreate_OneNameIsOneTag(t *testing.T) {
	h, svc := raceOrderTagHarness(t)

	const callers = 8

	for round := range 5 {
		name := fmt.Sprintf("race-Kirim Pagi %d", round)

		var answers [callers]*sellingv1.OrderTagCreateResponse

		res := h.Race(t, callers, func(i int) error {
			typed, team := name, raceOrderTeam
			if i%2 == 1 {
				typed, team = "  "+strings.ToUpper(strings.ReplaceAll(name, " ", "   "))+" ", testWarehouse
			}

			out, err := svc.OrderTagCreate(otCtx(uint64(100+i)), connect.NewRequest(&sellingv1.OrderTagCreateRequest{
				TeamId: team, Name: typed,
			}))
			if err != nil {
				return err
			}

			answers[i] = out.Msg

			return nil
		})

		made := 0

		for i, o := range res.Outcomes {
			if o.Err != nil {
				t.Fatalf("round %d: caller %d: %v", round, i, o.Err)
			}

			if answers[i].GetTag().GetId() != answers[0].GetTag().GetId() {
				t.Fatalf("round %d: caller %d answered tag %d, caller 0 tag %d — a twin", round, i, answers[i].GetTag().GetId(),
					answers[0].GetTag().GetId())
			}

			if answers[i].GetCreated() {
				made++
			}
		}

		if made != 1 {
			t.Fatalf("round %d: %d callers say they made the tag, want 1", round, made)
		}

		var n int64

		err := h.DB().Model(&selling_service_models.OrderTag{}).Where("lower(name) = lower(?)", name).Count(&n).Error
		if err != nil || n != 1 {
			t.Fatalf("round %d: %d order tags named %q (%v), want 1", round, n, name, err)
		}
	}
}

// raceOrderTagRows is how many orders carry the tag, and whether the tag is still on the list.
func raceOrderTagRows(t *testing.T, db *gorm.DB, tagID uint64) (carried, listed int64) {
	t.Helper()

	err := db.Model(&selling_service_models.OrderTagLink{}).Where("tag_id = ?", tagID).Count(&carried).Error
	if err != nil {
		t.Fatal(err)
	}

	err = db.Model(&selling_service_models.OrderTag{}).Where("id = ?", tagID).Count(&listed).Error
	if err != nil {
		t.Fatal(err)
	}

	return carried, listed
}

// THE WAREHOUSE PUTS A TAG ON WHILE AN ADMIN DELETES IT. Either order is fine; an order left carrying a deleted tag is
// not. Whichever goes first: the delete succeeds; the put-on either landed first — and the delete then took it off and
// says so (it came off 1 order) — or found no tag (NotFound, the delete said 0). Never a row left behind. One side
// sleeps round%10 ms so both orders are hit.
func TestRace_OrderTagAdd_VsDelete(t *testing.T) {
	h, svc := raceOrderTagHarness(t)
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Tags", "RT-1", "shopee")

	addedFirst, refused := 0, 0

	for round := range 20 {
		orderID := raceOrder(t, svc, shopID)

		tag := selling_service_models.OrderTag{Name: fmt.Sprintf("race-Hapus %d", round), Type: "custom"}

		err := h.DB().Create(&tag).Error
		if err != nil {
			t.Fatal(err)
		}

		var off uint64

		res := h.Race(t, 2, func(i int) error {
			if i == 0 {
				if round%2 == 0 {
					time.Sleep(time.Duration(round%10) * time.Millisecond)
				}

				_, err := svc.OrderTagAdd(otCtx(otWarehouse), connect.NewRequest(&sellingv1.OrderTagAddRequest{
					TeamId: testWarehouse, OrderId: orderID, TagId: tag.ID,
				}))

				return err
			}

			if round%2 == 1 {
				time.Sleep(time.Duration(round%10) * time.Millisecond)
			}

			out, err := svc.OrderTagDelete(otCtx(otRoot), connect.NewRequest(&sellingv1.OrderTagDeleteRequest{TagId: tag.ID}))
			if err != nil {
				return err
			}

			off = out.Msg.GetOrderCount()

			return nil
		})

		addErr, deleteErr := res.Outcomes[0].Err, res.Outcomes[1].Err

		if deleteErr != nil {
			t.Fatalf("round %d: the delete failed: %v", round, deleteErr)
		}

		switch {
		case addErr == nil && off == 1:
			addedFirst++
		case connect.CodeOf(addErr) == connect.CodeNotFound && off == 0:
			refused++
		default:
			t.Fatalf("round %d: the put-on answered %v, the delete took the tag off %d orders — they disagree", round, addErr, off)
		}

		carried, listed := raceOrderTagRows(t, h.DB(), tag.ID)
		if carried != 0 || listed != 0 {
			t.Fatalf("round %d: after the delete the tag is listed %d times and on %d orders", round, listed, carried)
		}
	}

	t.Logf("put on first (then taken off) %d, refused NotFound %d", addedFirst, refused)
}

// TWO ADMINS RENAME TWO TAGS TO ONE NEW NAME at once: one rename lands, the other is AlreadyExists — never two order tags
// with one name.
func TestRace_OrderTagRename_ToOneName(t *testing.T) {
	h, svc := raceOrderTagHarness(t)

	for round := range 5 {
		a := selling_service_models.OrderTag{Name: fmt.Sprintf("race-A %d", round), Type: "custom"}
		b := selling_service_models.OrderTag{Name: fmt.Sprintf("race-B %d", round), Type: "system"}

		for _, tag := range []*selling_service_models.OrderTag{&a, &b} {
			err := h.DB().Create(tag).Error
			if err != nil {
				t.Fatal(err)
			}
		}

		target := fmt.Sprintf("race-Satu Nama %d", round)
		ids := []uint64{a.ID, b.ID}

		res := h.Race(t, 2, func(i int) error {
			name := target
			if i == 1 {
				name = strings.ToUpper(target)
			}

			_, err := svc.OrderTagRename(otCtx(otRoot), connect.NewRequest(&sellingv1.OrderTagRenameRequest{TagId: ids[i], Name: name}))

			return err
		})

		ok, taken := 0, 0

		for _, o := range res.Outcomes {
			switch {
			case o.Err == nil:
				ok++
			case connect.CodeOf(o.Err) == connect.CodeAlreadyExists:
				taken++
			default:
				t.Fatalf("round %d: a rename failed: %v", round, o.Err)
			}
		}

		var n int64

		h.DB().Model(&selling_service_models.OrderTag{}).Where("lower(name) = lower(?)", target).Count(&n)

		if ok != 1 || taken != 1 || n != 1 {
			t.Fatalf("round %d: %d renames landed, %d refused, %d tags carry the name — want 1, 1, 1", round, ok, taken, n)
		}
	}
}
