package main

import (
	"context"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// lkItem is one restock line to seed: its product, supplier and store (nil = not named), what came and what broke.
type lkItem struct {
	product           uint64
	supplier, channel *uint64
	ordered, received int64
	broken            int64
}

// seedLinesRestock writes one restock as inventory_service stores it, its lines naming their own supplier and store,
// accepted at `acceptedAt` when it is "accepted".
func seedLinesRestock(t *testing.T, db *gorm.DB, status string, acceptedAt time.Time, items ...lkItem) uint64 {
	t.Helper()

	rr := inventory_service_models.Restock{TeamID: 12, WarehouseID: 5, Status: status}

	for _, item := range items {
		rr.Items = append(rr.Items, inventory_service_models.RestockItem{
			ProductID: item.product, ProductCode: "SKU", Name: "Kaos", Count: item.ordered, Total: float64(item.ordered) * 1_000,
			PriceUnit: 1_000, ReceivedCount: item.received, SupplierID: item.supplier, SupplierChannelID: item.channel,
		})

		if item.broken > 0 {
			rr.Problems = append(rr.Problems, inventory_service_models.RestockProblemItem{
				ProductID: item.product, Count: item.broken, Note: "crushed", ProblemType: "broken",
			})
		}
	}

	if status == "accepted" {
		rr.AcceptedAt = &acceptedAt
	}

	err := db.Create(&rr).Error
	if err != nil {
		t.Fatalf("seed restock: %v", err)
	}

	return rr.ID
}

func lkID(v uint64) *uint64 {
	return &v
}

func lkCount(t *testing.T, db *gorm.DB, model any) int64 {
	t.Helper()

	var n int64

	err := db.Model(model).Count(&n).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	return n
}

// `supplier backfill-links` links every accepted line naming a supplier — under its store, or under the supplier with
// no store; a line naming none links nothing — and re-folds the figures of a restock mixing suppliers, which the fold
// credited to nobody before it read each line's own supplier. --dry-run writes nothing; a second run changes nothing.
func TestBackfillSupplierLinks_LinksAndRefoldsTheMixedRestock(t *testing.T) {
	db := san_testdb.DB(t)
	san := &San{db: db, suppliers: NewSupplierFigures(db, NewReleaseInventory(db)), target: "test"}
	ctx := context.Background()

	jakarta := time.FixedZone("WIB", 7*60*60)
	now := time.Now().In(jakarta)
	mixedAt := time.Date(now.Year(), now.Month(), now.Day(), 10, 0, 0, 0, jakarta).AddDate(0, 0, -3)
	mixedDay := mixedAt.Format("2006-01-02")

	// A restock mixing suppliers: Melati's Shopee store (31 · 5), Budi's stall (32, all 3 broken), and a line naming none.
	mixed := seedLinesRestock(t, db, "accepted", mixedAt,
		lkItem{product: 100, supplier: lkID(31), channel: lkID(5), ordered: 4, received: 4},
		lkItem{product: 200, supplier: lkID(32), ordered: 3, received: 3, broken: 3},
		lkItem{product: 300, ordered: 2, received: 2},
	)
	// One supplier's restock, later — its figures were the fold's all along; only its link is new.
	single := seedLinesRestock(t, db, "accepted", mixedAt.Add(24*time.Hour),
		lkItem{product: 100, supplier: lkID(31), channel: lkID(5), ordered: 1, received: 1})
	// Not accepted: never read.
	seedLinesRestock(t, db, "ongoing", mixedAt, lkItem{product: 400, supplier: lkID(31), ordered: 1, received: 0})

	dry, err := san.BackfillSupplierLinks(ctx, true)
	if err != nil {
		t.Fatalf("dry run: %v", err)
	}

	for name, model := range map[string]any{
		"link":   &supplier_service_models.SupplierChannelProduct{},
		"figure": &supplier_service_models.SupplierProductDailyReport{},
		"claim":  &supplier_service_models.SupplierEventLog{},
	} {
		if n := lkCount(t, db, model); n != 0 {
			t.Fatalf("the dry run wrote %d %s rows", n, name)
		}
	}

	if l := dry.Links; l.Accepts != 2 || l.Lines != 3 || l.Links != 2 || l.Inserted != 2 || l.Moved != 0 || len(l.Switched) != 1 ||
		l.Switched[0].RestockID != mixed || l.Switched[0].Day != mixedDay {
		t.Fatalf("dry run links = %+v — want 2 accepts, 3 lines, 2 new links, the mixed restock switched on %s", l, mixedDay)
	}

	if len(dry.Refolds) != 2 || dry.Refolds[0].In.SupplierID != 31 || dry.Refolds[1].In.SupplierID != 32 ||
		dry.Refolds[0].Result.Claimed != 1 || !dry.Refolds[0].Result.Changed() || !dry.Refolds[1].Result.Changed() {
		t.Fatalf("dry run re-folds = %+v — want Melati's and Budi's day, the mixed accept claimed and counted", dry.Refolds)
	}

	done, err := san.BackfillSupplierLinks(ctx, false)
	if err != nil {
		t.Fatalf("backfill: %v", err)
	}

	if done.Links.Inserted != 2 || len(done.Refolds) != 2 {
		t.Fatalf("backfill = %+v, want what the dry run said", done)
	}

	var links []supplier_service_models.SupplierChannelProduct

	err = db.Order("supplier_id").Find(&links).Error
	if err != nil {
		t.Fatal(err)
	}

	if len(links) != 2 ||
		links[0].SupplierID != 31 || links[0].ChannelID == nil || *links[0].ChannelID != 5 || links[0].ProductID != 100 ||
		!links[0].FirstRestockedAt.Equal(mixedAt) || !links[0].LastRestockedAt.Equal(mixedAt.Add(24*time.Hour)) ||
		links[0].LastRestockID != single ||
		links[1].SupplierID != 32 || links[1].ChannelID != nil || links[1].ProductID != 200 || links[1].LastRestockID != mixed {
		t.Fatalf("links = %+v — want Melati·Shopee·100 (first the mixed accept, last the single one) and Budi·no store·200", links)
	}

	// The mixed restock's figures, each line under its own supplier — the line naming none credits nobody.
	figures := []struct {
		SupplierID          uint64
		ProductID           uint64
		RestockCount        int64
		ShippingBrokenCount int64
	}{}

	err = db.Raw(`SELECT supplier_id, product_id, restock_count, shipping_broken_count FROM supplier_product_daily_reports
WHERE day = CAST(? AS date) ORDER BY supplier_id`, mixedDay).Scan(&figures).Error
	if err != nil {
		t.Fatal(err)
	}

	if len(figures) != 2 || figures[0].SupplierID != 31 || figures[0].RestockCount != 4 ||
		figures[1].SupplierID != 32 || figures[1].RestockCount != 0 || figures[1].ShippingBrokenCount != 3 {
		t.Fatalf("the mixed day's figures = %+v — want Melati 4 good, Budi 3 broken", figures)
	}

	again, err := san.BackfillSupplierLinks(ctx, false)
	if err != nil {
		t.Fatalf("second run: %v", err)
	}

	if again.Links.Inserted != 0 || again.Links.Moved != 0 || again.Links.Unchanged != 2 ||
		again.Refolds[0].Result.Changed() || again.Refolds[1].Result.Changed() || again.Refolds[0].Result.Claimed != 0 {
		t.Fatalf("second run = %+v — want nothing written", again)
	}

	var out strings.Builder

	printLinkBackfill(&out, "test", again)

	for _, want := range []string{
		"supplier backfill-links · written",
		"links: 0 new · 0 dates moved · 2 already right",
		"restocks mixing suppliers: 1",
		"supplier 32 · " + mixedDay + ": events counted 1 · lost and now claimed 0 · in flight 0 · rows changed 0",
	} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("output lacks %q:\n%s", want, out.String())
		}
	}
}
