package inventory_v1_test

import (
	"context"
	"fmt"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE TERJUAL BAND READS THE DAILY SOLD FOLD (docs/business/supplier/context_decision.md —
// the-terjual-band-reads-the-daily-sold-fold): SupplierIDsByFigure's Sold branch sums `inventory_stock_daily_changes`
// instead of the `order` rows of `batch_logs`, and its answers must stay EQUAL to the old query's. ledgerSoldIDs is that
// old query, kept here verbatim as the guard; every check runs both on ONE fixture written through the real stock
// writes (restock accepts, takes, a cancel, a return).

// ledgerSoldIDs is the Sold branch as it read before the fold (HEAD e61daa66): every `order` row of `batch_logs`,
// joined to its batch for the supplier, netted per supplier.
func ledgerSoldIDs(t testing.TB, db *gorm.DB, lo, hi int64) []uint64 {
	t.Helper()

	query := db.
		Table("batch_logs AS l").
		Joins("JOIN batches b ON b.id = l.batch_id").
		Where("l.change_type = ?", "order").
		Select("b.supplier_id").
		Where("b.supplier_id <> 0").
		Group("b.supplier_id").
		Having("-SUM(l.change_count) >= ?", lo)

	if hi > 0 {
		query = query.Having("-SUM(l.change_count) < ?", hi)
	}

	var ids []uint64

	err := query.
		Order("b.supplier_id").
		Pluck("b.supplier_id", &ids).
		Error
	if err != nil {
		t.Fatalf("ledger Terjual [%d, %d): %v", lo, hi, err)
	}

	return ids
}

const (
	tfBesar  uint64 = 41 // 5 230 — Melati's and Sinar's goods, two warehouses
	tfTengah uint64 = 42 // 2 500 exactly — a take cancelled on a later day, a borrowed line
	tfSeribu uint64 = 43 // 1 000 exactly — 3 of them returned, still sold
	tfLima   uint64 = 44 // 500 exactly — 2 of them drawn FIFO behind Kecil's batch
	tfKecil  uint64 = 45 // 10
	tfDiam   uint64 = 46 // restocked, never sold
	tfPenuh  uint64 = 47 // 5 000 exactly — its batch emptied
	tfBatal  uint64 = 48 // sold 300, all cancelled the next day: 0, with order rows

	tfP1 uint64 = 851 // Melati's, from Besar
	tfP2 uint64 = 852 // Sinar's, from Besar
	tfP3 uint64 = 853 // Sinar's, from Tengah — Melati borrows it
	tfP4 uint64 = 854 // Melati's, from Seribu
	tfP5 uint64 = 855 // Melati's, from Lima
	tfP6 uint64 = 856 // Sinar's, from Kecil then Lima
	tfP7 uint64 = 857 // Melati's, from nobody
	tfP8 uint64 = 858 // Melati's, from Diam
	tfP9 uint64 = 859 // Sinar's, from Penuh
	tfP0 uint64 = 860 // Melati's, from Batal
)

// tfSuppliers are the fixture's suppliers (nobody aside).
var tfSuppliers = []uint64{tfBesar, tfTengah, tfSeribu, tfLima, tfKecil, tfDiam, tfPenuh, tfBatal}

// tfSold writes the fixture: two selling teams, two warehouses, takes on three different days, cancels on a later day
// than their takes (one leaving its supplier at 0), a borrowed line, a FIFO draw across two suppliers' batches, a
// return, a batch from nobody.
func tfSold(t *testing.T) sgFixture {
	t.Helper()

	db := san_testdb.DB(t)
	known := fakeSuppliers{}

	for _, id := range tfSuppliers {
		known[id] = true
	}

	facts := fakeFacts{
		tfP1: {TeamID: sgMelati}, tfP2: {TeamID: sgSinar}, tfP3: {TeamID: sgSinar, CrossMarkupBps: 1000},
		tfP4: {TeamID: sgMelati}, tfP5: {TeamID: sgMelati}, tfP6: {TeamID: sgSinar}, tfP7: {TeamID: sgMelati},
		tfP8: {TeamID: sgMelati}, tfP9: {TeamID: sgSinar}, tfP0: {TeamID: sgMelati},
	}
	svc := inventory_v1.NewService(db, nil, nil, fakeSupplierService{fakeSuppliers: known}, nil, facts, nil, nil, nil, nil)
	f := sgFixture{svc: svc, db: db}

	rak5 := newRack(t, svc, sgGudang5, "rak-tf-5")
	rak6 := newRack(t, svc, sgGudang6, "rak-tf-6")

	for _, r := range []struct {
		team, warehouse, rack, product uint64
		count                          int64
		supplier                       uint64
	}{
		{sgMelati, sgGudang5, rak5, tfP1, 6000, tfBesar},
		{sgSinar, sgGudang6, rak6, tfP2, 100, tfBesar},
		{sgSinar, sgGudang5, rak5, tfP3, 3000, tfTengah},
		{sgMelati, sgGudang6, rak6, tfP4, 1500, tfSeribu},
		{sgMelati, sgGudang5, rak5, tfP5, 800, tfLima},
		{sgSinar, sgGudang6, rak6, tfP6, 10, tfKecil},
		{sgSinar, sgGudang6, rak6, tfP6, 700, tfLima},
		{sgMelati, sgGudang5, rak5, tfP7, 6000, 0},
		{sgMelati, sgGudang6, rak6, tfP8, 20, tfDiam},
		{sgSinar, sgGudang5, rak5, tfP9, 5000, tfPenuh},
		{sgMelati, sgGudang6, rak6, tfP0, 300, tfBatal},
	} {
		sgRestock(t, svc, r.team, r.warehouse, r.rack, r.product, r.count, r.supplier, 0)
	}

	today := time.Now()
	day := func(n int) context.Context {
		return inventory_ledgers.WithNow(ctxUser(8), today.AddDate(0, 0, n))
	}

	sell := func(ctx context.Context, team, warehouse, product uint64, qty int64, key string) uint64 {
		t.Helper()

		res, err := svc.OrderTransactionCreate(ctx, connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
			TeamId: team, IdempotencyKey: key, WarehouseId: warehouse,
			Lines: []*inventoryv1.OrderTransactionLine{{ProductId: product, Quantity: qty}},
		}))
		if err != nil {
			t.Fatalf("take %s: %v", key, err)
		}

		return res.Msg.GetTransactionId()
	}

	sell(day(-2), sgMelati, sgGudang5, tfP1, 5200, "tf-1")
	sell(day(-1), sgSinar, sgGudang6, tfP2, 30, "tf-2")
	sell(day(-2), sgSinar, sgGudang5, tfP3, 2460, "tf-3")
	sell(day(-1), sgMelati, sgGudang5, tfP3, 40, "tf-4") // Melati's order, Sinar's goods
	sell(day(-2), sgSinar, sgGudang5, tfP3, 200, "tf-5")
	sell(day(-2), sgMelati, sgGudang6, tfP4, 997, "tf-6")
	returned := sell(day(-1), sgMelati, sgGudang6, tfP4, 3, "tf-6r")
	sell(day(-1), sgMelati, sgGudang5, tfP5, 498, "tf-7")
	sell(day(0), sgSinar, sgGudang6, tfP6, 12, "tf-8") // 10 from Kecil's batch, 2 from Lima's (FIFO)
	sell(day(0), sgMelati, sgGudang5, tfP7, 5100, "tf-9")
	sell(day(-1), sgSinar, sgGudang5, tfP9, 5000, "tf-10")
	sell(day(-2), sgMelati, sgGudang6, tfP0, 300, "tf-11")

	// Each cancelled on a later day than its take: the fold rows sit on two days and still net to 0.
	for _, c := range []struct {
		team uint64
		key  string
		on   int
	}{{sgSinar, "tf-5", 0}, {sgMelati, "tf-11", -1}} {
		_, err := svc.OrderTransactionRelease(day(c.on), connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
			TeamId: c.team, IdempotencyKey: c.key,
		}))
		if err != nil {
			t.Fatalf("release %s: %v", c.key, err)
		}
	}

	// tf-6r's 3 of Seribu's 1 000 come back, whole, to Gudang 5: minted as a `return`, so the order rows — and
	// Terjual — stay.
	_, err := svc.OrderTransactionReturn(day(0), connect.NewRequest(&inventoryv1.OrderTransactionReturnRequest{
		TeamId: sgGudang5, SellingTeamId: sgMelati, TakeTransactionId: returned, Description: "return of tf-6r",
		Lines: []*inventoryv1.OrderTransactionReturnLine{{
			ProductId: tfP4, ReturnProductId: tfP4, Sound: 3,
			Placements: []*inventoryv1.OrderTransactionReturnPlacement{{PlacementId: rak5, Quantity: 3}},
		}},
	}))
	if err != nil {
		t.Fatalf("return tf-6r: %v", err)
	}

	return f
}

// The fixed pills (frontend figureRanges.ts, the-range-pills-are-a-fixed-set) — `hi` 0 open-ended.
var tfPills = [][2]int64{{0, 500}, {500, 1000}, {1000, 2500}, {2500, 5000}, {5000, 0}}

// EVERY BAND, through the seam: the five pills (the 0-start one asked as SupplierList asks it — its complement, the ids
// at or above its top), then every band whose edges sit on, just under or just over a fixture total or a pill edge.
func TestSupplierIDsByFigure_TerjualFromTheFoldEqualsTheLedger(t *testing.T) {
	f := tfSold(t)
	ctx := context.Background()

	fold := func(lo, hi int64) []uint64 {
		t.Helper()

		ids, err := f.svc.SupplierIDsByFigure(ctx, inventory_v1.SupplierFigureSold, lo, hi)
		if err != nil {
			t.Fatalf("SupplierIDsByFigure [%d, %d): %v", lo, hi, err)
		}

		return ids
	}

	// The pills, each with the suppliers the fixture puts in it — so no pill passes by being empty on both sides.
	want := map[[2]int64][]uint64{
		{0, 500}:     {tfKecil, tfDiam, tfBatal},
		{500, 1000}:  {tfLima},
		{1000, 2500}: {tfSeribu},
		{2500, 5000}: {tfTengah},
		{5000, 0}:    {tfBesar, tfPenuh},
	}

	for _, pill := range tfPills {
		lo, hi, complement := pill[0], pill[1], pill[0] == 0
		if complement {
			lo, hi = pill[1], 0
		}

		old, now := ledgerSoldIDs(t, f.db, lo, hi), fold(lo, hi)
		if !slices.Equal(old, now) {
			t.Fatalf("pill %v (asked [%d, %d)): ledger %v, fold %v", pill, lo, hi, old, now)
		}

		var kept []uint64

		for _, id := range tfSuppliers {
			if slices.Contains(now, id) != complement {
				kept = append(kept, id)
			}
		}

		if !slices.Equal(kept, want[pill]) {
			t.Fatalf("pill %v keeps %v of the fixture, want %v (asked [%d, %d) → %v)", pill, kept, want[pill], lo, hi, now)
		}
	}

	edges := []int64{0, 1, 2, 9, 10, 11, 499, 500, 501, 999, 1000, 1001, 2499, 2500, 2501, 4999, 5000, 5001, 5099, 5100,
		5101, 5229, 5230, 5231}

	bands := 0

	for _, lo := range edges {
		for _, hi := range append([]int64{0}, edges...) {
			if hi != 0 && hi <= lo {
				continue
			}

			old, now := ledgerSoldIDs(t, f.db, lo, hi), fold(lo, hi)
			if !slices.Equal(old, now) {
				t.Fatalf("[%d, %d): ledger %v, fold %v", lo, hi, old, now)
			}

			bands++
		}
	}

	t.Logf("%d pills and %d edge bands: the fold answers the ledger's ids", len(tfPills), bands)
}

// PER SUPPLIER, PER WAREHOUSE, PER TEAM: the fold's −Σ change_count of the `order` rows equals the ledger's for every
// key the ledger has (a fully cancelled one included, at 0) and no other — the band's figure, and the same figure cut by
// the warehouse a take drew from or the team that owned the goods. (The Gudang filter does not cut the band — it tests
// the supplier's WHOLE Terjual, the-warehouse-filter-narrows-only-the-rows — so this is the fold's exactness per
// warehouse, not a second code path.) A take draws only from its own warehouse's batches, so the log row's warehouse
// is the batch's.
func TestSupplierIDsByFigure_TheFoldNetsLikeTheLedgerPerWarehouseAndTeam(t *testing.T) {
	f := tfSold(t)

	var strays int64

	err := f.db.Raw(`SELECT COUNT(*) FROM batch_logs l JOIN batches b ON b.id = l.batch_id
		WHERE l.change_type = 'order' AND l.warehouse_id <> b.warehouse_id`).Scan(&strays).Error
	if err != nil || strays != 0 {
		t.Fatalf("order rows naming another warehouse than their batch's: %d, %v", strays, err)
	}

	// The fixture's takes and cancels really sit on three days of the fold — the netting is across rows, not in one.
	var days int64

	err = f.db.Raw(`SELECT COUNT(DISTINCT day) FROM inventory_stock_daily_changes WHERE change_type = 'order'`).Scan(&days).Error
	if err != nil || days != 3 {
		t.Fatalf("the fold's order rows sit on %d days, want 3 (%v)", days, err)
	}

	type sold struct {
		SupplierID uint64
		K          uint64
		Sold       int64
	}

	read := func(sql string) map[[2]uint64]int64 {
		t.Helper()

		var rows []sold

		err := f.db.Raw(sql).Scan(&rows).Error
		if err != nil {
			t.Fatalf("%s: %v", sql, err)
		}

		out := make(map[[2]uint64]int64, len(rows))
		for _, r := range rows {
			out[[2]uint64{r.SupplierID, r.K}] = r.Sold
		}

		return out
	}

	for _, key := range []struct{ name, ledger, fold string }{
		{"supplier", "0", "0"},
		{"supplier × warehouse", "l.warehouse_id", "warehouse_id"},
		{"supplier × team", "l.team_id", "team_id"},
	} {
		ledger := read(fmt.Sprintf(`SELECT b.supplier_id, %s AS k, -SUM(l.change_count) AS sold
			FROM batch_logs l JOIN batches b ON b.id = l.batch_id
			WHERE l.change_type = 'order' AND b.supplier_id <> 0 GROUP BY 1, 2`, key.ledger))
		fold := read(fmt.Sprintf(`SELECT supplier_id, %s AS k, -SUM(change_count) AS sold
			FROM inventory_stock_daily_changes
			WHERE change_type = 'order' AND supplier_id <> 0 GROUP BY 1, 2`, key.fold))

		if len(ledger) == 0 || fmt.Sprint(ledger) != fmt.Sprint(fold) {
			t.Fatalf("per %s: ledger %v, fold %v", key.name, ledger, fold)
		}

		t.Logf("per %s: %d keys equal — %v", key.name, len(ledger), ledger)
	}
}
