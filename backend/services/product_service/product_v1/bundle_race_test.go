//go:build raceaudit

// Concurrency audit for BundleService's writes (the audit-sql skill, docs/business/product/product_bundle.md).
//
// BundleUpdate and BundleDelete take ONE lock — the bundle's row, FOR UPDATE — before they touch its lines. These tests
// prove it holds: saves of one bundle never interleave their lines, a delete never leaves lines behind, and a save that
// waited reads the lines the save before it wrote. BundleCreate shares no row with anything, so it is raced only to
// show creates stay independent. Each claim of safety is closed by an Interleave that shows the step BLOCKING.
//
//	go test -tags raceaudit -run 'TestRace_Bundle|TestInterleave_Bundle' -count=1 -v ./backend/services/product_service/product_v1/
package product_v1_test

import (
	"fmt"
	"sort"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

func bundleRaceHarness(t *testing.T) *san_race.Harness {
	t.Helper()

	// Children before parents.
	return san_race.New(t, "bundle_products", "bundles", "product_images", "products")
}

func raceProducts(t *testing.T, db *gorm.DB, teamID uint64, n int) []uint64 {
	t.Helper()

	ids := make([]uint64, 0, n)
	for i := range n {
		p := product_service_models.Product{TeamID: teamID, SKU: fmt.Sprintf("RACE-%d-%d", teamID, i), Name: fmt.Sprintf("Race %d", i)}

		err := db.Create(&p).Error
		if err != nil {
			t.Fatalf("seed product: %v", err)
		}
		ids = append(ids, p.ID)
	}

	return ids
}

func saveLines(svc *product_v1.Service, bundleID uint64, ls []*productv1.BundleLine) error {
	_, err := svc.BundleUpdate(asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER), connect.NewRequest(&productv1.BundleUpdateRequest{
		TeamId: melati, BundleId: bundleID, Name: "Race", Lines: ls,
	}))

	return err
}

type storedLine struct {
	ProductID uint64
	Quantity  uint32
}

func storedLines(t *testing.T, db *gorm.DB, bundleID uint64) []storedLine {
	t.Helper()

	var out []storedLine

	err := db.Table("bundle_products").Select("product_id", "quantity").Where("bundle_id = ?", bundleID).Order("product_id").Scan(&out).Error
	if err != nil {
		t.Fatalf("read lines: %v", err)
	}

	return out
}

// ── saves of one bundle never mix ───────────────────────────────────────────────────────────────

// Eight saves of ONE bundle at the same instant, each replacing every line with its own pair. Afterwards the bundle
// holds exactly one caller's pair — never a mix of two, never four lines, never a unique violation half-way.
func TestRace_BundleUpdate_EightSavesNeverMix(t *testing.T) {
	h := bundleRaceHarness(t)
	svc := product_v1.NewService(h.DB())
	p := raceProducts(t, h.DB(), melati, 17)
	b := createBundle(t, svc, asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER), melati, "Race", lines(p[16], 1))

	res := h.Race(t, 8, func(i int) error {
		return saveLines(svc, b.GetId(), lines(p[2*i], uint64(i+1), p[2*i+1], uint64(i+1)))
	})
	res.Report(t)

	if res.Failed() > 0 {
		t.Fatalf("%d saves failed — a save of one bundle must wait, not fail", res.Failed())
	}

	got := storedLines(t, h.DB(), b.GetId())
	if len(got) != 2 {
		t.Fatalf("lines = %+v, want exactly one caller's pair", got)
	}

	// Both lines from ONE caller: products 2i and 2i+1, both at quantity i+1.
	sort.Slice(got, func(a, b int) bool { return got[a].ProductID < got[b].ProductID })
	i := int(got[0].Quantity) - 1
	if got[0].ProductID != p[2*i] || got[1].ProductID != p[2*i+1] || got[1].Quantity != got[0].Quantity {
		t.Fatalf("lines = %+v — a mix of two saves", got)
	}
}

// The lock, shown: B's save of the same bundle WAITS for A's, and once released it reads A's lines as the bundle's —
// so a product A added and its owner locked a moment later is KEPT by B rather than refused as newly added.
func TestInterleave_BundleUpdate_ASecondSaveWaitsAndReadsTheFirst(t *testing.T) {
	h := bundleRaceHarness(t)
	own := raceProducts(t, h.DB(), melati, 1)
	borrowed := raceProducts(t, h.DB(), kenanga, 1)
	b := createBundle(t, product_v1.NewService(h.DB()), asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER), melati, "Race", lines(own[0], 1))

	const bSaves = "B saves the same bundle, keeping the borrowed line"

	sched := h.Interleave(t,
		san_race.Do("A", "A adds the borrowed product", func(tx *gorm.DB) error {
			return saveLines(product_v1.NewService(tx), b.GetId(), lines(own[0], 1, borrowed[0], 1))
		}),
		san_race.Do("C", "its owner locks it", func(tx *gorm.DB) error {
			return tx.Exec("UPDATE products SET cross_locked = TRUE WHERE id = ?", borrowed[0]).Error
		}),
		san_race.Commit("C"),
		san_race.Block("B", bSaves, func(tx *gorm.DB) error {
			return saveLines(product_v1.NewService(tx), b.GetId(), lines(own[0], 2, borrowed[0], 2))
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	step := sched.Get(bSaves)
	if !step.Released {
		t.Fatal("B did not wait for A — the bundle's lock is not held")
	}
	if step.Err != nil {
		t.Fatalf("B was refused (%v) — it judged the lines against what it read BEFORE the lock, not A's", step.Err)
	}

	got := storedLines(t, h.DB(), b.GetId())
	if len(got) != 2 || got[0].Quantity != 2 || got[1].Quantity != 2 {
		t.Fatalf("lines = %+v, want B's two lines at quantity 2", got)
	}
}

// ── a delete never leaves lines behind ──────────────────────────────────────────────────────────

// Saves and deletes of one bundle at once: the bundle ends deleted with NO lines left over — a save that lost the race
// is NotFound, never a set of orphaned lines written after the delete.
func TestRace_BundleUpdateAndDelete_NoOrphanLines(t *testing.T) {
	h := bundleRaceHarness(t)
	svc := product_v1.NewService(h.DB())
	p := raceProducts(t, h.DB(), melati, 8)
	b := createBundle(t, svc, asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER), melati, "Race", lines(p[0], 1))

	res := h.Race(t, 8, func(i int) error {
		if i%2 == 0 {
			_, err := svc.BundleDelete(asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER), connect.NewRequest(&productv1.BundleDeleteRequest{
				TeamId: melati, BundleId: b.GetId(),
			}))
			return err
		}

		return saveLines(svc, b.GetId(), lines(p[i], 1))
	})
	res.Report(t)

	for _, o := range res.Outcomes {
		if o.Err != nil && connect.CodeOf(o.Err) != connect.CodeNotFound {
			t.Fatalf("caller %d: %v — the only failure a lost race may give is NotFound", o.I, o.Err)
		}
	}

	var bundles, orphans int64
	h.DB().Table("bundles").Where("id = ?", b.GetId()).Count(&bundles)
	h.DB().Table("bundle_products").Where("bundle_id = ?", b.GetId()).Count(&orphans)
	if bundles != 0 || orphans != 0 {
		t.Fatalf("after the race: %d bundles, %d lines — want 0 and 0", bundles, orphans)
	}
}

// ── creates are independent ─────────────────────────────────────────────────────────────────────

// Eight creates of one name over the same products at once: eight bundles, each with exactly its own lines. A create
// shares no row with another, and a name may repeat (bundle-names-may-repeat) — so nothing here should wait or fail.
func TestRace_BundleCreate_EightCreatesAreIndependent(t *testing.T) {
	h := bundleRaceHarness(t)
	svc := product_v1.NewService(h.DB())
	p := raceProducts(t, h.DB(), melati, 2)

	res := h.Race(t, 8, func(int) error {
		_, err := svc.BundleCreate(asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER), connect.NewRequest(&productv1.BundleCreateRequest{
			TeamId: melati, Name: "Paket Hemat", Lines: lines(p[0], 1, p[1], 2),
		}))
		return err
	})
	res.Report(t)

	if res.Failed() > 0 {
		t.Fatalf("%d creates failed", res.Failed())
	}

	var bundles, lineRows int64
	h.DB().Table("bundles").Where("team_id = ?", melati).Count(&bundles)
	h.DB().Table("bundle_products").Count(&lineRows)
	if bundles != 8 || lineRows != 16 {
		t.Fatalf("%d bundles, %d lines — want 8 and 16", bundles, lineRows)
	}
}
