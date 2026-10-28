//go:build raceaudit

// Concurrency audit for ProductReturnMapCreate (the audit-sql skill) — the write is a PHANTOM INSERT ("no map for this
// product yet" → insert one), closed by the unique (team_id, shared_product_id) index and ON CONFLICT DO NOTHING, then a
// read of the row that stands. Two people mapping the same borrowed product at the same second must end with ONE row,
// and BOTH must be handed that row (the-map-is-unique-on-its-source, a-return-map-is-written-once).
//
// ⚠ san_race.New is given NO tables: other audits share warehouse_test, so every row here belongs to one race team and
// is deleted by that scope.
//
//	go test -tags raceaudit -run 'TestRace_ProductReturnMapCreate|TestInterleave_ProductReturnMapCreate' -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"testing"

	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
)

// raceMapTeam is the team every map of these audits belongs to — the scope they are cleaned by.
const raceMapTeam uint64 = 7_700_002

// raceMapCatalog: products 1000–1099 are team 9's (borrowed), 2000–2099 the race team's own.
func raceMapCatalog() *fakeCatalog {
	owners := map[uint64]uint64{}

	for i := range uint64(100) {
		owners[1000+i] = 9
		owners[2000+i] = raceMapTeam
	}

	return &fakeCatalog{owners: owners}
}

func returnMapRaceHarness(t *testing.T) *san_race.Harness {
	t.Helper()

	h := san_race.New(t)

	clean := func() {
		err := h.DB().Exec(`DELETE FROM product_return_maps WHERE team_id = ?`, raceMapTeam).Error
		if err != nil {
			t.Errorf("cleaning the race team's maps: %v", err)
		}
	}

	clean()
	t.Cleanup(clean)

	return h
}

// N callers map the same borrowed product at once, each to a DIFFERENT own product: exactly one row, exactly one caller
// told created = true, nobody refused — and every caller handed back the SAME pair, the one that stands.
func TestRace_ProductReturnMapCreate_ManyPicksOfOneProduct(t *testing.T) {
	h := returnMapRaceHarness(t)
	svc := newServiceWithCatalog(t, h.DB(), raceMapCatalog())

	const n = 8

	for round := range 10 {
		shared := uint64(1000 + round)
		got := make([]*sellingv1.ProductReturnMapCreateResponse, n)

		res := h.Race(t, n, func(i int) error {
			resp, err := createReturnMap(svc, raceMapTeam, shared, uint64(2000+i))
			got[i] = resp

			return err
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

		rows := returnMapRows(t, h.DB(), raceMapTeam)

		var standing []uint64

		for _, row := range rows {
			if row.SharedProductID == shared {
				standing = append(standing, row.OwnProductID)
			}
		}

		if len(standing) != 1 {
			t.Fatalf("round %d: %d rows for product %d (%v) — want exactly one", round, len(standing), shared, standing)
		}

		created := 0

		for i, resp := range got {
			if resp.GetCreated() {
				created++
			}

			if resp.GetMap().GetOwnProductId() != standing[0] {
				t.Fatalf("round %d: caller %d was handed → %d, but → %d stands",
					round, i, resp.GetMap().GetOwnProductId(), standing[0])
			}
		}

		if created != 1 {
			t.Fatalf("round %d: %d callers were told created = true, want exactly one", round, created)
		}

		t.Logf("round %d: product %d → %d, one row, %d callers handed it", round, shared, standing[0], n)
	}
}

// THE PROOF. A maps the product and has not committed; B's map of the same product must WAIT on the unique index —
// and once A commits, B must come back with A's pair and created = false, not an error and not a second row.
func TestInterleave_ProductReturnMapCreate_SecondPickWaitsAndGetsTheFirst(t *testing.T) {
	h := returnMapRaceHarness(t)

	const shared uint64 = 1050

	create := func(own uint64, out **sellingv1.ProductReturnMapCreateResponse) func(tx *gorm.DB) error {
		return func(tx *gorm.DB) error {
			resp, err := createReturnMap(newServiceWithCatalog(t, tx, raceMapCatalog()), raceMapTeam, shared, own)
			*out = resp

			return err
		}
	}

	var a, b *sellingv1.ProductReturnMapCreateResponse

	const second = "B maps the same product to 2002 — the insert waits on A's uncommitted row"

	sched := h.Interleave(t,
		san_race.Do("A", "A maps the product to 2001 — inserted, not committed", create(2001, &a)),
		san_race.Block("B", second, create(2002, &b)),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	step := sched.Get(second)
	if !step.Blocked || !step.Released {
		t.Fatalf("B did not wait on the unique index (blocked=%v released=%v)", step.Blocked, step.Released)
	}

	if step.Err != nil {
		t.Fatalf("B failed after the wait: %v — the second pick must get the standing pair, not an error", step.Err)
	}

	if !a.GetCreated() || b.GetCreated() {
		t.Fatalf("created: A=%v B=%v — want A true, B false", a.GetCreated(), b.GetCreated())
	}

	if b.GetMap().GetOwnProductId() != 2001 {
		t.Fatalf("B was handed → %d, want A's standing → 2001", b.GetMap().GetOwnProductId())
	}

	rows := returnMapRows(t, h.DB(), raceMapTeam)
	if len(rows) != 1 || rows[0].OwnProductID != 2001 {
		t.Fatalf("rows = %+v, want the one pair → 2001", rows)
	}

	t.Logf("B waited, then read A's pair → %d with created = false", b.GetMap().GetOwnProductId())
}
