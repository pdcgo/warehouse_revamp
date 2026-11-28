//go:build raceaudit

// Concurrency audit for the PRODUCT TAGS (backlog #147): the products' own list with unique names
// (products-have-their-own-tag-list), a copy of the order tags' audit (selling order_tags_race_test.go). Two writers making
// the same new tag at the same second is the normal case on a shared list; an admin deleting a tag while a writer puts it
// on must never leave a product carrying a deleted tag; a product deleted while it is tagged must never answer Internal.
//
//   - create: INSERT … ON CONFLICT ((lower(name))) DO NOTHING, then read the winner — one tag, every caller answered it;
//   - put on twice / on and off at once: the link's key (product_id, tag_id) and ON CONFLICT DO NOTHING — one link at most,
//     never an error;
//   - put on vs tag delete: the put-on holds the tag FOR KEY SHARE (productTagHeld), the delete locks it FOR UPDATE first —
//     so the delete waits for a put-on in flight and takes it off with the rest, or the put-on finds no tag (NotFound);
//   - put on vs product delete: the put-on holds the PRODUCT FOR KEY SHARE (productOfTeam), so the delete waits and its
//     cascade takes the link, or the put-on finds no product (NotFound) — never a foreign-key error;
//   - two renames to one name: the unique index lets one through, the other is AlreadyExists.
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS. It empties the product tables (as the
// bundle audit does) and removes tags named "race-…" before and after; the app's seeded tag is never touched.
//
//	go test -tags raceaudit -p 1 -count=1 -run 'TestRace_ProductTag' -v ./backend/services/product_service/product_v1/
package product_v1_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// raceProductTagHarness is the product race harness (every product table emptied — the links go with their products), with
// this test's own tags — named "race-…" in any case — removed before and after it.
func raceProductTagHarness(t *testing.T) (*san_race.Harness, *product_v1.Service) {
	t.Helper()

	dropOwn := func(db *gorm.DB) {
		err := db.Exec(`DELETE FROM product_tags WHERE lower(name) LIKE 'race-%' AND app_task = ''`).Error
		if err != nil {
			t.Errorf("drop the race's product tags: %v", err)
		}
	}

	h := san_race.New(t, "product_tag_links", "bundle_products", "bundles", "product_images", "products")

	dropOwn(h.DB())
	t.Cleanup(func() { dropOwn(h.DB()) })

	return h, newService(t, h.DB())
}

func raceTaggedProduct(t *testing.T, db *gorm.DB, round int) uint64 {
	t.Helper()

	p := product_service_models.Product{TeamID: melati, ProductCode: fmt.Sprintf("RACE-TAG-%d-%d", round, time.Now().UnixNano()), Name: "Race Tag"}

	err := db.Create(&p).Error
	if err != nil {
		t.Fatalf("seed product: %v", err)
	}

	return p.ID
}

func raceTag(t *testing.T, db *gorm.DB, name, kind string) uint64 {
	t.Helper()

	tag := product_service_models.ProductTag{Name: name, Type: kind}

	err := db.Create(&tag).Error
	if err != nil {
		t.Fatal(err)
	}

	return tag.ID
}

// raceProductTagRows is how many products carry the tag, and whether the tag is still on the list.
func raceProductTagRows(t *testing.T, db *gorm.DB, tagID uint64) (carried, listed int64) {
	t.Helper()

	err := db.Model(&product_service_models.ProductTagLink{}).Where("tag_id = ?", tagID).Count(&carried).Error
	if err != nil {
		t.Fatal(err)
	}

	err = db.Model(&product_service_models.ProductTag{}).Where("id = ?", tagID).Count(&listed).Error
	if err != nil {
		t.Fatal(err)
	}

	return carried, listed
}

// EIGHT WRITERS MAKE ONE NEW TAG AT ONCE, each typing it their own way: every call succeeds, every one answers the same
// tag, exactly one says it made it, and the list holds one.
func TestRace_ProductTagCreate_OneNameIsOneTag(t *testing.T) {
	h, svc := raceProductTagHarness(t)

	const callers = 8

	for round := range 5 {
		name := fmt.Sprintf("race-Promo Pagi %d", round)

		var answers [callers]*productv1.ProductTagCreateResponse

		res := h.Race(t, callers, func(i int) error {
			typed, team := name, melati
			if i%2 == 1 {
				typed, team = "  "+strings.ToUpper(strings.ReplaceAll(name, " ", "   "))+" ", kenanga
			}

			out, err := svc.ProductTagCreate(ptCtx(uint64(100+i)), connect.NewRequest(&productv1.ProductTagCreateRequest{
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

		err := h.DB().Model(&product_service_models.ProductTag{}).Where("lower(name) = lower(?)", name).Count(&n).Error
		if err != nil || n != 1 {
			t.Fatalf("round %d: %d product tags named %q (%v), want 1", round, n, name, err)
		}
	}
}

// EIGHT WRITERS PUT ONE TAG ON ONE PRODUCT AT ONCE: every call succeeds, every answer carries the tag, one link.
func TestRace_ProductTagAdd_TwiceAtOnce(t *testing.T) {
	h, svc := raceProductTagHarness(t)

	const callers = 8

	for round := range 5 {
		product := raceTaggedProduct(t, h.DB(), round)
		tag := raceTag(t, h.DB(), fmt.Sprintf("race-Dua Kali %d", round), "custom")

		var answers [callers][]*productv1.ProductTag

		res := h.Race(t, callers, func(i int) error {
			out, err := svc.ProductTagAdd(ptCtx(uint64(100+i)), connect.NewRequest(&productv1.ProductTagAddRequest{
				TeamId: melati, ProductId: product, TagId: tag,
			}))
			if err != nil {
				return err
			}

			answers[i] = out.Msg.GetTags()

			return nil
		})

		for i, o := range res.Outcomes {
			if o.Err != nil {
				t.Fatalf("round %d: caller %d: %v", round, i, o.Err)
			}

			if len(answers[i]) != 1 || answers[i][0].GetId() != tag {
				t.Fatalf("round %d: caller %d answered %v — want the tag on", round, i, ptNames(answers[i]))
			}
		}

		if carried, _ := raceProductTagRows(t, h.DB(), tag); carried != 1 {
			t.Fatalf("round %d: %d links, want 1", round, carried)
		}
	}
}

// ONE WRITER PUTS A TAG ON WHILE ANOTHER TAKES IT OFF: both succeed, whichever lands last decides, and the product carries
// it once or not at all — never an error, never a second link. One side sleeps round%10 ms so both orders are hit.
func TestRace_ProductTagOnAndOff_AtOnce(t *testing.T) {
	h, svc := raceProductTagHarness(t)

	on, off := 0, 0

	for round := range 20 {
		product := raceTaggedProduct(t, h.DB(), round)
		tag := raceTag(t, h.DB(), fmt.Sprintf("race-Naik Turun %d", round), "custom")

		// It starts on, so the take-off has something to take.
		_, err := svc.ProductTagAdd(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductTagAddRequest{TeamId: melati, ProductId: product, TagId: tag}))
		if err != nil {
			t.Fatal(err)
		}

		res := h.Race(t, 2, func(i int) error {
			if i == round%2 {
				time.Sleep(time.Duration(round%10) * time.Millisecond)
			}

			if i == 0 {
				_, addErr := svc.ProductTagAdd(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductTagAddRequest{
					TeamId: melati, ProductId: product, TagId: tag,
				}))

				return addErr
			}

			_, removeErr := svc.ProductTagRemove(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductTagRemoveRequest{
				TeamId: melati, ProductId: product, TagId: tag,
			}))

			return removeErr
		})

		for i, o := range res.Outcomes {
			if o.Err != nil {
				t.Fatalf("round %d: caller %d: %v", round, i, o.Err)
			}
		}

		carried, _ := raceProductTagRows(t, h.DB(), tag)

		switch carried {
		case 0:
			off++
		case 1:
			on++
		default:
			t.Fatalf("round %d: %d links", round, carried)
		}
	}

	t.Logf("ended on %d, off %d", on, off)
}

// A WRITER PUTS A TAG ON WHILE AN ADMIN DELETES IT. Either order is fine; a product left carrying a deleted tag is not.
// The delete succeeds; the put-on either landed first — and the delete then took it off and says so (1 product) — or
// found no tag (NotFound, the delete said 0). One side sleeps round%10 ms so both orders are hit.
func TestRace_ProductTagAdd_VsDelete(t *testing.T) {
	h, svc := raceProductTagHarness(t)

	addedFirst, refused := 0, 0

	for round := range 20 {
		product := raceTaggedProduct(t, h.DB(), round)
		tag := raceTag(t, h.DB(), fmt.Sprintf("race-Hapus %d", round), "custom")

		var removed uint64

		res := h.Race(t, 2, func(i int) error {
			if i == 0 {
				if round%2 == 0 {
					time.Sleep(time.Duration(round%10) * time.Millisecond)
				}

				_, err := svc.ProductTagAdd(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductTagAddRequest{
					TeamId: melati, ProductId: product, TagId: tag,
				}))

				return err
			}

			if round%2 == 1 {
				time.Sleep(time.Duration(round%10) * time.Millisecond)
			}

			out, err := svc.ProductTagDelete(ptCtx(ptRoot), connect.NewRequest(&productv1.ProductTagDeleteRequest{TagId: tag}))
			if err != nil {
				return err
			}

			removed = out.Msg.GetProductCount()

			return nil
		})

		addErr, deleteErr := res.Outcomes[0].Err, res.Outcomes[1].Err

		if deleteErr != nil {
			t.Fatalf("round %d: the delete failed: %v", round, deleteErr)
		}

		switch {
		case addErr == nil && removed == 1:
			addedFirst++
		case connect.CodeOf(addErr) == connect.CodeNotFound && removed == 0:
			refused++
		default:
			t.Fatalf("round %d: the put-on answered %v, the delete took the tag off %d products — they disagree", round, addErr, removed)
		}

		carried, listed := raceProductTagRows(t, h.DB(), tag)
		if carried != 0 || listed != 0 {
			t.Fatalf("round %d: after the delete the tag is listed %d times and on %d products", round, listed, carried)
		}
	}

	t.Logf("put on first (then taken off) %d, refused NotFound %d", addedFirst, refused)
}

// A WRITER PUTS A TAG ON WHILE THE PRODUCT IS DELETED (a typo, no history). Either order is fine: the delete succeeds, and
// the put-on either landed first — the delete's cascade takes the link — or found no product (NotFound). Never a
// foreign-key error read as Internal: the put-on holds the product FOR KEY SHARE, so the delete waits.
func TestRace_ProductTagAdd_VsProductDelete(t *testing.T) {
	h, svc := raceProductTagHarness(t)

	tag := raceTag(t, h.DB(), "race-Produk Hilang", "custom")

	landed, refused := 0, 0

	for round := range 20 {
		product := raceTaggedProduct(t, h.DB(), round)

		res := h.Race(t, 2, func(i int) error {
			if i == round%2 {
				time.Sleep(time.Duration(round%10) * time.Millisecond)
			}

			if i == 0 {
				_, err := svc.ProductTagAdd(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductTagAddRequest{
					TeamId: melati, ProductId: product, TagId: tag,
				}))

				return err
			}

			_, err := svc.ProductDelete(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductDeleteRequest{TeamId: melati, ProductId: product}))

			return err
		})

		addErr, deleteErr := res.Outcomes[0].Err, res.Outcomes[1].Err

		if deleteErr != nil {
			t.Fatalf("round %d: the product delete failed: %v", round, deleteErr)
		}

		switch {
		case addErr == nil:
			landed++
		case connect.CodeOf(addErr) == connect.CodeNotFound:
			refused++
		default:
			t.Fatalf("round %d: the put-on answered %v (%v) — want success or NotFound", round, addErr, connect.CodeOf(addErr))
		}

		var links int64

		h.DB().Model(&product_service_models.ProductTagLink{}).Where("product_id = ?", product).Count(&links)

		if links != 0 {
			t.Fatalf("round %d: the deleted product still carries %d links", round, links)
		}
	}

	t.Logf("landed first (then cascaded) %d, refused NotFound %d", landed, refused)
}

// TWO ADMINS RENAME TWO TAGS TO ONE NEW NAME at once: one rename lands, the other is AlreadyExists — never two product
// tags with one name.
func TestRace_ProductTagRename_ToOneName(t *testing.T) {
	h, svc := raceProductTagHarness(t)

	for round := range 5 {
		a := raceTag(t, h.DB(), fmt.Sprintf("race-A %d", round), "custom")
		b := raceTag(t, h.DB(), fmt.Sprintf("race-B %d", round), "system")

		target := fmt.Sprintf("race-Satu Nama %d", round)
		ids := []uint64{a, b}

		res := h.Race(t, 2, func(i int) error {
			name := target
			if i == 1 {
				name = strings.ToUpper(target)
			}

			_, err := svc.ProductTagRename(ptCtx(ptRoot), connect.NewRequest(&productv1.ProductTagRenameRequest{TagId: ids[i], Name: name}))

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

		h.DB().Model(&product_service_models.ProductTag{}).Where("lower(name) = lower(?)", target).Count(&n)

		if ok != 1 || taken != 1 || n != 1 {
			t.Fatalf("round %d: %d renames landed, %d refused, %d tags carry the name — want 1, 1, 1", round, ok, taken, n)
		}
	}
}
