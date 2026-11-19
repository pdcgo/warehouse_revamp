//go:build raceaudit

// Concurrency audit for the RESTOCK TAGS (backlog #87): one app-wide list with unique names
// (custom-tags-are-shared-system-tags-are-the-admins-and-the-apps). Two people making the same new tag at the same second
// is the normal case on a shared list — the add box offers *Buat tag* to both — and an admin deleting a tag while a
// warehouse puts it on a restock must never leave a restock carrying a deleted tag.
//
//   - create: INSERT … ON CONFLICT ((lower(name))) DO NOTHING, then read the winner — one tag, every caller answered it;
//   - put on vs delete: the put-on holds the tag FOR KEY SHARE (tagHeld), the delete locks it FOR UPDATE first — so the
//     delete waits for a put-on in flight and takes it off with the rest, or the put-on finds no tag (NotFound);
//   - two renames to one name: the unique index lets one through, the other is AlreadyExists.
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS. The migration's own tags (the app's
// problem tags) are never deleted here: `tags` is not in the harness's table list; each test removes its own by name.
//
//	go test -tags raceaudit -p 1 -count=1 -run 'TestRace_RestockTag' -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// raceTagHarness is the harness over the restock tables and `restock_tags`, with this test's own tags — named
// "race-…" in any case (a caller types it upper-cased, and may be the one that lands) — removed before and after it.
func raceTagHarness(t *testing.T) (*san_race.Harness, *inventory_v1.Service) {
	t.Helper()

	h := san_race.New(t, append([]string{"restock_tags"}, raceRestockTables...)...)

	dropOwn := func() {
		err := h.DB().Exec(`DELETE FROM tags WHERE lower(name) LIKE 'race-%' AND app_task = ''`).Error
		if err != nil {
			t.Errorf("drop the race's tags: %v", err)
		}
	}

	dropOwn()
	t.Cleanup(dropOwn)

	return h, inventory_v1.NewService(h.DB(), nil, nil, nil, nil, nil, nil, nil, nil, nil)
}

// EIGHT PEOPLE MAKE ONE NEW TAG AT ONCE — each typing it their own way: every call succeeds, every one answers the same
// tag, exactly one says it made it, and the list holds one.
func TestRace_RestockTagCreate_OneNameIsOneTag(t *testing.T) {
	h, svc := raceTagHarness(t)

	const callers = 8

	for round := range 5 {
		name := fmt.Sprintf("race-Lebaran %d", round)

		var answers [callers]*inventoryv1.RestockTagCreateResponse

		res := h.Race(t, callers, func(i int) error {
			typed := name
			if i%2 == 1 {
				typed = "  " + strings.ToUpper(strings.ReplaceAll(name, " ", "   ")) + " "
			}

			out, err := svc.RestockTagCreate(ctxUser(uint64(100+i)), connect.NewRequest(&inventoryv1.RestockTagCreateRequest{
				TeamId: raceRestockTeam, Name: typed,
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
				t.Fatalf("round %d: caller %d answered tag %d, caller 0 tag %d — a twin", round, i, answers[i].GetTag().GetId(), answers[0].GetTag().GetId())
			}

			if answers[i].GetCreated() {
				made++
			}
		}

		if made != 1 {
			t.Fatalf("round %d: %d callers say they made the tag, want 1", round, made)
		}

		var n int64

		err := h.DB().Model(&inventory_service_models.Tag{}).Where("lower(name) = lower(?)", name).Count(&n).Error
		if err != nil || n != 1 {
			t.Fatalf("round %d: %d tags named %q (%v), want 1", round, n, name, err)
		}
	}
}

// raceTagRows is how many restocks carry the tag, and whether the tag is still on the list.
func raceTagRows(t *testing.T, db *gorm.DB, tagID uint64) (carried, listed int64) {
	t.Helper()

	err := db.Model(&inventory_service_models.RestockTag{}).Where("tag_id = ?", tagID).Count(&carried).Error
	if err != nil {
		t.Fatal(err)
	}

	err = db.Model(&inventory_service_models.Tag{}).Where("id = ?", tagID).Count(&listed).Error
	if err != nil {
		t.Fatal(err)
	}

	return carried, listed
}

// A WAREHOUSE PUTS A TAG ON WHILE AN ADMIN DELETES IT. Either order is fine; a restock left carrying a deleted tag is
// not. Whichever goes first: the delete succeeds; the put-on either landed first — and the delete then took it off and
// says so (it came off 1 restock) — or found no tag (NotFound, the delete said 0). Never a row left behind. One side
// sleeps round%10 ms so both orders are hit.
func TestRace_RestockTagAdd_VsDelete(t *testing.T) {
	h, svc := raceTagHarness(t)

	addedFirst, refused := 0, 0

	for round := range 20 {
		restock := raceRestockSeed(t, h.DB())

		tag := inventory_service_models.Tag{Name: fmt.Sprintf("race-Hapus %d", round), Type: "custom"}

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

				_, err := svc.RestockRequestTagAdd(ctxUser(31), connect.NewRequest(&inventoryv1.RestockRequestTagAddRequest{
					TeamId: raceRestockWarehouse, RequestId: restock, TagId: tag.ID,
				}))

				return err
			}

			if round%2 == 1 {
				time.Sleep(time.Duration(round%10) * time.Millisecond)
			}

			out, err := svc.RestockTagDelete(ctxUser(901), connect.NewRequest(&inventoryv1.RestockTagDeleteRequest{TagId: tag.ID}))
			if err != nil {
				return err
			}

			off = out.Msg.GetRestockCount()

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
			t.Fatalf("round %d: the put-on answered %v, the delete took the tag off %d restocks — they disagree", round, addErr, off)
		}

		carried, listed := raceTagRows(t, h.DB(), tag.ID)
		if carried != 0 || listed != 0 {
			t.Fatalf("round %d: after the delete the tag is listed %d times and on %d restocks", round, listed, carried)
		}
	}

	t.Logf("put on first (then taken off) %d, refused NotFound %d", addedFirst, refused)
}

// TWO ADMINS RENAME TWO TAGS TO ONE NEW NAME at once: one rename lands, the other is AlreadyExists — never two tags with
// one name.
func TestRace_RestockTagRename_ToOneName(t *testing.T) {
	h, svc := raceTagHarness(t)

	for round := range 5 {
		a := inventory_service_models.Tag{Name: fmt.Sprintf("race-A %d", round), Type: "custom"}
		b := inventory_service_models.Tag{Name: fmt.Sprintf("race-B %d", round), Type: "system"}

		for _, tag := range []*inventory_service_models.Tag{&a, &b} {
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

			_, err := svc.RestockTagRename(ctxUser(901), connect.NewRequest(&inventoryv1.RestockTagRenameRequest{TagId: ids[i], Name: name}))

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

		h.DB().Model(&inventory_service_models.Tag{}).Where("lower(name) = lower(?)", target).Count(&n)

		if ok != 1 || taken != 1 || n != 1 {
			t.Fatalf("round %d: %d renames landed, %d refused, %d tags carry the name — want 1, 1, 1", round, ok, taken, n)
		}
	}
}
