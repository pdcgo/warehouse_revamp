package inventory_v1_test

import (
	"os"
	"regexp"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// TERIMA PUTS THE PROBLEM TAGS ON (a-restock-problem-is-a-system-tag, the owner's "A": one tag per kind): when the count
// records MISSING units the app puts *Barang kurang* on, BROKEN units *Barang rusak* — in the accept's own transaction,
// put on by the app (0); the restock stays accepted. A box counted whole carries neither; a refused count puts nothing
// on. The migration's data step tags the restocks counted in before it the same way.

// tgCount is a count of arrLines' two lines: each line's (received, broken), the good units on the staging placement.
func tgCount(t *testing.T, r *inventoryv1.RestockRequest, place uint64, counts ...[2]int64) []*inventoryv1.RestockRequestReceivedLine {
	t.Helper()

	lines := make([]*inventoryv1.RestockRequestReceivedLine, 0, len(r.GetItems()))
	for i, item := range r.GetItems() {
		received, broken := counts[i][0], counts[i][1]

		line := &inventoryv1.RestockRequestReceivedLine{ItemId: item.GetId(), ReceivedCount: received, BrokenCount: broken}
		if good := received - broken; good > 0 {
			line.Placements = placedOn(place, good)
		}

		lines = append(lines, line)
	}

	return lines
}

func TestRestockRequestAccept_PutsTheProblemTagsOn(t *testing.T) {
	for _, c := range []struct {
		name   string
		counts [][2]int64 // Kaos (10 ordered), Celana (5 ordered): received, broken
		want   []string
	}{
		{"counted whole", [][2]int64{{10, 0}, {5, 0}}, nil},
		{"two missing", [][2]int64{{8, 0}, {5, 0}}, []string{"Barang kurang"}},
		{"three broken", [][2]int64{{10, 3}, {5, 0}}, []string{"Barang rusak"}},
		{"missing and broken on two lines", [][2]int64{{10, 1}, {4, 0}}, []string{"Barang kurang", "Barang rusak"}},
		{"missing and broken on one line", [][2]int64{{7, 2}, {5, 0}}, []string{"Barang kurang", "Barang rusak"}},
		{"nothing came", [][2]int64{{0, 0}, {0, 0}}, []string{"Barang kurang"}},
	} {
		t.Run(c.name, func(t *testing.T) {
			db := san_testdb.DB(t)
			svc := tgService(t, db)

			raised := nsRaise(t, svc, "")

			// A custom tag the seller put on before the box came — Terima leaves it.
			lebaran := seedTag(t, db, "Lebaran 2026", "custom")

			_, err := tgAdd(svc, tgSeller, arrSellingTeam, raised.GetId(), lebaran)
			if err != nil {
				t.Fatal(err)
			}

			counts := make([][2]int64, len(c.counts))
			copy(counts, c.counts)

			res, err := svc.RestockRequestAccept(ctxUser(arrCounter), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
				TeamId: arrWarehouse, RequestId: raised.GetId(),
				Lines: tgCount(t, raised, stagingPlacement(t, db, arrWarehouse), counts...),
			}))
			if err != nil {
				t.Fatalf("accept: %v", err)
			}

			if res.Msg.GetRequest().GetStatus() != accepted {
				t.Fatalf("the restock is %v after Terima, want accepted — a problem is a tag, not a status", res.Msg.GetRequest().GetStatus())
			}

			want := append(slices.Clone(c.want), "Lebaran 2026")

			for _, team := range []uint64{arrSellingTeam, arrWarehouse} {
				if got := tgDetailAs(t, svc, team, raised.GetId()); !slices.Equal(got, want) {
					t.Fatalf("team %d's Detail reads %v, want %v", team, got, want)
				}

				if got := tgListRowAs(t, svc, team, raised.GetId()); !slices.Equal(got, want) {
					t.Fatalf("team %d's List row reads %v, want %v", team, got, want)
				}
			}

			// Put on by the app — nobody's name — at the accept.
			var rows []inventory_service_models.RestockTag

			err = db.Where("restock_id = ? AND tag_id <> ?", raised.GetId(), lebaran).Find(&rows).Error
			if err != nil {
				t.Fatal(err)
			}

			for _, row := range rows {
				if row.AddedByUserID != 0 || row.AddedByIsOverride || row.AddedAt.IsZero() {
					t.Fatalf("a problem tag reads put on by %d (override %v) at %v, want the app", row.AddedByUserID, row.AddedByIsOverride, row.AddedAt)
				}
			}
		})
	}
}

// A REFUSED COUNT PUTS NOTHING ON — the tags go on only with an accept that commits: a count refused (an expiry that is
// not a day on the calendar) leaves the restock untagged, its problems unrecorded. (It was a courier's charge with no
// note until that became optional — the-couriers-charge-note-is-optional — so a refusal of the count itself stands in.)
func TestRestockRequestAccept_ARefusedCountPutsNoTagOn(t *testing.T) {
	db := san_testdb.DB(t)
	svc := tgService(t, db)

	raised := nsRaise(t, svc, "")

	lines := tgCount(t, raised, stagingPlacement(t, db, arrWarehouse), [2]int64{8, 1}, [2]int64{5, 0})
	// The shape passes the contract; the day is not on the calendar — refused as the count is read.
	lines[0].ExpiresOn = "2026-02-30"

	_, err := svc.RestockRequestAccept(ctxUser(arrCounter), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: arrWarehouse, RequestId: raised.GetId(),
		Lines: lines,
	}))
	if err == nil {
		t.Fatal("the accept went through — the test needs a refused one")
	}

	if n := tagRowsOf(t, db, raised.GetId()); n != 0 {
		t.Fatalf("a refused count left %d tags on", n)
	}
}

// THE MIGRATION'S DATA STEP (00055) — run here on accepted restocks counted before it: missing rows → *Barang kurang*,
// broken rows → *Barang rusak*, both → both, none → none, a restock already carrying one is not tagged twice, and only an
// accepted restock is read. The statement is read from the migration file itself, so this tests what ships.
func TestRestockTagsMigration_TagsTheRestocksCountedBefore(t *testing.T) {
	db := san_testdb.DB(t)

	sql, err := os.ReadFile("../db_migrations/00055_restock_tags.sql")
	if err != nil {
		t.Fatal(err)
	}

	step := regexp.MustCompile(`(?s)INSERT INTO restock_tags .*?DO NOTHING;`).Find(sql)
	if step == nil {
		t.Fatal("the data step is not in 00055")
	}

	acceptedAt := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)

	seed := func(status string, problems ...string) uint64 {
		t.Helper()

		r := inventory_service_models.Restock{TeamID: arrSellingTeam, WarehouseID: arrWarehouse, Status: status}
		if status == "accepted" {
			r.AcceptedAt = &acceptedAt
		}

		err := db.Create(&r).Error
		if err != nil {
			t.Fatal(err)
		}

		for i, kind := range problems {
			product := uint64(100 + i)

			err = db.Create(&inventory_service_models.RestockItem{RestockID: r.ID, ProductID: product, Count: 5}).Error
			if err != nil {
				t.Fatal(err)
			}

			err = db.Create(&inventory_service_models.RestockProblemItem{
				RestockID: r.ID, ProductID: product, ProblemType: kind, Count: 1,
			}).Error
			if err != nil {
				t.Fatal(err)
			}
		}

		return r.ID
	}

	missing := seed("accepted", "missing")
	broken := seed("accepted", "broken", "broken")
	both := seed("accepted", "missing", "broken")
	clean := seed("accepted")
	open := seed("ongoing")
	already := seed("accepted", "missing")

	kurang := appTagID(t, db, taskMissing)
	rusak := appTagID(t, db, taskBroken)

	tagOn(t, db, already, kurang)

	res := db.Exec(string(step))
	if res.Error != nil {
		t.Fatalf("the data step: %v", res.Error)
	}

	if res.RowsAffected != 4 {
		t.Fatalf("the data step wrote %d rows, want 4 (missing, broken, both × 2)", res.RowsAffected)
	}

	want := map[uint64][]uint64{missing: {kurang}, broken: {rusak}, both: {kurang, rusak}, clean: nil, open: nil, already: {kurang}}

	for id, tags := range want {
		var got []uint64

		err = db.Model(&inventory_service_models.RestockTag{}).Where("restock_id = ?", id).Order("tag_id").Pluck("tag_id", &got).Error
		if err != nil {
			t.Fatal(err)
		}

		slices.Sort(tags)

		if !slices.Equal(got, tags) {
			t.Fatalf("restock %d carries %v, want %v", id, got, tags)
		}
	}

	var row inventory_service_models.RestockTag

	err = db.Where("restock_id = ?", missing).Take(&row).Error
	if err != nil || row.AddedByUserID != 0 || !row.AddedAt.Equal(acceptedAt) {
		t.Fatalf("the backfilled tag reads put on by %d at %v (%v), want the app at the accept", row.AddedByUserID, row.AddedAt, err)
	}
}
