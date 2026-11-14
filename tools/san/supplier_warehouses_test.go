package main

import (
	"bytes"
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// whRows is every restock report row as "day|supplier|product|team|warehouse" → units, value.
func whRows(t *testing.T, db *gorm.DB) map[string][2]float64 {
	t.Helper()

	var rows []supplier_service_models.SupplierProductDailyReport

	err := db.Find(&rows).Error
	if err != nil {
		t.Fatal(err)
	}

	out := map[string][2]float64{}
	for _, r := range rows {
		key := strings.Join([]string{
			r.Day.Format("2006-01-02"), u64(r.SupplierID), u64(r.ProductID), u64(r.TeamID), u64(r.WarehouseID),
		}, "|")
		out[key] = [2]float64{float64(r.RestockCount), r.RestockValuation}
	}

	return out
}

func u64(v uint64) string {
	return strconv.FormatUint(v, 10)
}

// `supplier backfill-warehouses`: restock figures folded before the reports carried the warehouse (collapsed under
// warehouse 0, as supplier_service 00006 left them) are re-folded into the warehouse each restock was received at, read
// from inventory's own accepts; every supplier's totals are printed equal BEFORE and AFTER; --dry-run writes nothing;
// a second run finds nothing to do.
func TestBackfillSupplierWarehouses_RefilesAndKeepsEveryTotal(t *testing.T) {
	db := san_testdb.DB(t)
	san := &San{db: db, suppliers: NewSupplierFigures(db, NewReleaseInventory(db)), target: "test"}
	ctx := context.Background()

	jakarta := time.FixedZone("WIB", 7*60*60)
	now := time.Now().In(jakarta)
	at := time.Date(now.Year(), now.Month(), now.Day(), 10, 0, 0, 0, jakarta).AddDate(0, 0, -3)
	day := at.Format("2006-01-02")

	// One supplier's product received at two warehouses on one day.
	atFive := seedLinesRestock(t, db, "accepted", at, lkItem{product: 100, supplier: lkID(31), ordered: 4, received: 4})
	atSix := seedLinesRestock(t, db, "accepted", at.Add(time.Hour), lkItem{product: 100, supplier: lkID(31), ordered: 2, received: 2})

	err := db.Model(&inventory_service_models.Restock{}).Where("id = ?", atSix).Update("warehouse_id", 6).Error
	if err != nil {
		t.Fatal(err)
	}

	// The live fold, as the broker would have delivered each accept.
	for _, id := range []uint64{atFive, atSix} {
		var restock inventory_service_models.Restock

		err = inventory_v1.AcceptedRestocks(db).Where("restocks.id = ?", id).Take(&restock).Error
		if err != nil {
			t.Fatalf("restock %d: %v", id, err)
		}

		err = san.suppliers.FoldHandler()(ctx, inventory_v1.RestockAcceptedEvent(&restock))
		if err != nil {
			t.Fatalf("fold %d: %v", id, err)
		}
	}

	want := whRows(t, db)
	if len(want) != 2 || want[day+"|31|100|12|5"][0] != 4 || want[day+"|31|100|12|6"][0] != 2 {
		t.Fatalf("folded rows = %v, want 4 units at warehouse 5 and 2 at 6", want)
	}

	// The shape 00006 found: one row per key, under warehouse 0.
	for _, stmt := range []string{
		`CREATE TEMP TABLE c_restock ON COMMIT DROP AS
SELECT day, supplier_id, product_id, team_id, SUM(restock_count) AS rc, SUM(restock_valuation) AS rv
FROM supplier_product_daily_reports GROUP BY day, supplier_id, product_id, team_id`,
		`DELETE FROM supplier_product_daily_reports`,
		`INSERT INTO supplier_product_daily_reports (day, supplier_id, product_id, team_id, warehouse_id, restock_count, restock_valuation)
SELECT day, supplier_id, product_id, team_id, 0, rc, rv FROM c_restock`,
	} {
		err = db.Exec(stmt).Error
		if err != nil {
			t.Fatal(err)
		}
	}

	collapsed := whRows(t, db)

	dry, err := san.BackfillSupplierWarehouses(ctx, true)
	if err != nil {
		t.Fatalf("dry run: %v", err)
	}

	if len(dry.Refolds) != 1 || len(dry.Moved()) != 0 || dry.After[31].UnplacedRows != 0 || dry.Before[31].UnplacedRows != 1 {
		t.Fatalf("dry run = %+v — want one supplier day re-folded, its totals unchanged, nothing left under 0", dry)
	}

	if got := whRows(t, db); len(got) != 1 || got[day+"|31|100|12|0"] != collapsed[day+"|31|100|12|0"] {
		t.Fatalf("the dry run wrote: %v", got)
	}

	done, err := san.BackfillSupplierWarehouses(ctx, false)
	if err != nil {
		t.Fatalf("backfill: %v", err)
	}

	if len(done.Refolds) != 1 || len(done.Moved()) != 0 {
		t.Fatalf("backfill = %+v", done)
	}

	if got := whRows(t, db); len(got) != len(want) || got[day+"|31|100|12|5"] != want[day+"|31|100|12|5"] ||
		got[day+"|31|100|12|6"] != want[day+"|31|100|12|6"] {
		t.Fatalf("after the backfill = %v, want %v", got, want)
	}

	var out bytes.Buffer

	printWarehouseBackfill(&out, "test", done)

	for _, line := range []string{
		"supplier backfill-warehouses · written",
		"supplier-restock-daily · supplier 31 · " + day,
		"supplier 31  = unchanged",
		"rows under no warehouse 1",
		"✓ every supplier's totals are unchanged",
	} {
		if !strings.Contains(out.String(), line) {
			t.Fatalf("output lacks %q:\n%s", line, out.String())
		}
	}

	again, err := san.BackfillSupplierWarehouses(ctx, false)
	if err != nil {
		t.Fatalf("second run: %v", err)
	}

	if len(again.Refolds) != 0 || again.Parts.Orders != 0 {
		t.Fatalf("second run = %+v, want nothing to do", again)
	}
}
