package main

import (
	"context"
	"fmt"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// THE TERJUAL BAND UNDER THE GUDANG FILTER (docs/business/supplier/context_decision.md —
// the-terjual-band-reads-the-daily-sold-fold): SupplierList — own and Discover, with no warehouse and with each
// warehouse picked, under every Terjual pill — answers the same suppliers, total and order whether the band reads
// inventory's daily sold fold (the seam today) or the `order` rows of the ledger (ledgerTerjualBand, the query it
// replaced). The takes go through inventory's real stock writes, on three days. With a warehouse picked the band still
// tests the supplier's WHOLE Terjual (the-warehouse-filter-narrows-only-the-rows): the warehouse only narrows the
// candidates.

// ledgerBandReader is the composition root's reader with the Terjual band read as it was before the fold.
type ledgerBandReader struct {
	*supplierGoodsReader
}

func (r ledgerBandReader) SupplierIDsByFigure(ctx context.Context, figure supplier_v1.GoodsFigure, lo, hi int64) ([]uint64, error) {
	if figure != supplier_v1.GoodsSold {
		return r.supplierGoodsReader.SupplierIDsByFigure(ctx, figure, lo, hi)
	}

	return ledgerTerjualBand(ctx, r.db, lo, hi)
}

// ledgerTerjualBand is inventory's Sold branch as it read before the fold (HEAD e61daa66), verbatim.
func ledgerTerjualBand(ctx context.Context, db *gorm.DB, lo, hi int64) ([]uint64, error) {
	query := db.
		WithContext(ctx).
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

	return ids, err
}

// everySupplierLive lets a restock line name any supplier — the suppliers are this test's own rows.
type everySupplierLive struct{}

func (everySupplierLive) SupplierIsLive(context.Context, uint64, uint64) (bool, error) {
	return true, nil
}

func (everySupplierLive) Stores(context.Context, uint64, []uint64) (map[uint64]inventory_v1.SupplierStore, error) {
	return map[uint64]inventory_v1.SupplierStore{}, nil
}

func TestSupplierList_TheTerjualBandFromTheFoldEqualsTheLedgerUnderTheGudangFilter(t *testing.T) {
	db := san_testdb.DB(t)
	ctx := context.Background()

	const (
		melati  uint64 = 12
		sinar   uint64 = 13
		gudang5 uint64 = 9_540_005
		gudang6 uint64 = 9_540_006
	)

	supplier := func(team uint64, name string) uint64 {
		t.Helper()

		row := supplier_service_models.Supplier{TeamID: team, Name: name}

		err := db.Create(&row).Error
		if err != nil {
			t.Fatalf("supplier %s: %v", name, err)
		}

		return row.ID
	}

	besar := supplier(melati, "Besar Seribu Lima Ratus") // 1 500: 1 100 at Gudang 5 by Melati, 400 at Gudang 6 by Sinar
	tengah := supplier(sinar, "Tengah Lima Ratus Dua")   // 520 at Gudang 5; a take of 30 cancelled two days later
	lima := supplier(melati, "Lima Ratus Pas")           // 500 exactly, at Gudang 6
	kecil := supplier(melati, "Kecil Tiga")              // 3, at Gudang 5
	diam := supplier(melati, "Diam Belum Laku")          // received at Gudang 6, never sold
	ours := []uint64{besar, tengah, lima, kecil, diam}

	inventory := inventory_v1.NewService(db, nil, nil, everySupplierLive{}, nil, nil, nil, nil, nil, nil)

	racks := map[uint64]uint64{}

	for _, warehouse := range []uint64{gudang5, gudang6} {
		rack, err := inventory.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{
			TeamId: warehouse, Code: fmt.Sprintf("rak-%d", warehouse), Name: "Rak",
		}))
		if err != nil {
			t.Fatalf("rack: %v", err)
		}

		racks[warehouse] = rack.Msg.GetRack().GetId()
	}

	restock := func(team, warehouse, product uint64, count int64, supplierID uint64) {
		t.Helper()

		created, err := inventory.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: team, WarehouseId: warehouse,
			Items: []*inventoryv1.RestockRequestItem{{
				ProductId: product, ProductCode: "SKU", Name: "Barang", Count: count, Total: float64(count * 1000),
				SupplierId: supplierID,
			}},
		}))
		if err != nil {
			t.Fatalf("restock create: %v", err)
		}

		r := created.Msg.GetRequest()

		_, err = inventory.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
			TeamId: warehouse, RequestId: r.GetId(),
			Lines: []*inventoryv1.RestockRequestReceivedLine{{
				ItemId: r.GetItems()[0].GetId(), ReceivedCount: count,
				Placements: []*inventoryv1.RestockPlacement{{PlacementId: racks[warehouse], Quantity: count}},
			}},
		}))
		if err != nil {
			t.Fatalf("restock accept: %v", err)
		}
	}

	restock(melati, gudang5, 9_540_901, 1200, besar)
	restock(sinar, gudang6, 9_540_902, 700, besar)
	restock(sinar, gudang5, 9_540_903, 600, tengah)
	restock(melati, gudang6, 9_540_904, 600, lima)
	restock(melati, gudang5, 9_540_905, 10, kecil)
	restock(melati, gudang6, 9_540_906, 20, diam)

	daysAgo := func(n int) context.Context {
		return inventory_ledgers.WithNow(ctx, time.Now().AddDate(0, 0, -n))
	}

	take := func(on context.Context, team, warehouse, product uint64, qty int64, key string) {
		t.Helper()

		_, err := inventory.OrderTransactionCreate(on, connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
			TeamId: team, IdempotencyKey: key, WarehouseId: warehouse,
			Lines: []*inventoryv1.OrderTransactionLine{{ProductId: product, Quantity: qty}},
		}))
		if err != nil {
			t.Fatalf("take %s: %v", key, err)
		}
	}

	take(daysAgo(2), melati, gudang5, 9_540_901, 1100, "band-1")
	take(ctx, sinar, gudang6, 9_540_902, 400, "band-2")
	take(daysAgo(1), sinar, gudang5, 9_540_903, 520, "band-3")
	take(daysAgo(2), sinar, gudang5, 9_540_903, 30, "band-4")
	take(ctx, melati, gudang6, 9_540_904, 500, "band-5")
	take(ctx, melati, gudang5, 9_540_905, 3, "band-6")

	_, err := inventory.OrderTransactionRelease(ctx, connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
		TeamId: sinar, IdempotencyKey: "band-4",
	}))
	if err != nil {
		t.Fatalf("release band-4: %v", err)
	}

	fold := &supplierGoodsReader{inventory: inventory, db: db}
	now := supplier_v1.NewService(db, nil, nil, fold, nil, nil)
	before := supplier_v1.NewService(db, nil, nil, ledgerBandReader{fold}, nil, nil)

	list := func(svc *supplier_v1.Service, scope supplierv1.SupplierListScope, warehouse uint64, band *supplierv1.SupplierFigureBand) ([]uint64, uint64) {
		t.Helper()

		resp, err := svc.SupplierList(ctx, connect.NewRequest(&supplierv1.SupplierListRequest{
			TeamId: melati,
			Filter: &supplierv1.SupplierListFilter{Scope: scope, WarehouseId: warehouse, Sold: band},
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 100},
		}))
		if err != nil {
			t.Fatalf("SupplierList(%v, %d, %v): %v", scope, warehouse, band, err)
		}

		return resp.Msg.GetIds(), resp.Msg.GetPageInfo().GetTotalItems()
	}

	own := supplierv1.SupplierListScope_SUPPLIER_LIST_SCOPE_OWN
	every := supplierv1.SupplierListScope_SUPPLIER_LIST_SCOPE_EVERY_TEAM

	// The pills (frontend figureRanges.ts), and no pill.
	bands := []*supplierv1.SupplierFigureBand{nil, {Min: 0, Max: 500}, {Min: 500, Max: 1000}, {Min: 1000, Max: 2500},
		{Min: 2500, Max: 5000}, {Min: 5000, Max: 0}}

	ourIDs := func(ids []uint64) []uint64 {
		var kept []uint64

		for _, id := range ours {
			if slices.Contains(ids, id) {
				kept = append(kept, id)
			}
		}

		return kept
	}

	// What the fixture puts where — so an equal answer is never two empty ones.
	want := map[string][]uint64{
		"OWN/0/[0,500)":                  {kecil, diam},
		"OWN/9540006/[0,500)":            {diam},
		"EVERY_TEAM/9540005/[500,1000)":  {tengah},
		"EVERY_TEAM/9540006/[500,1000)":  {lima},
		"EVERY_TEAM/0/[1000,2500)":       {besar},
		"EVERY_TEAM/9540006/[1000,2500)": {besar}, // 400 of it sold AT Gudang 6 — the band tests the whole 1 500
		"OWN/9540005/[2500,5000)":        nil,
	}

	cases := 0

	for _, warehouse := range []uint64{0, gudang5, gudang6} {
		for _, scope := range []supplierv1.SupplierListScope{own, every} {
			for _, band := range bands {
				oldIDs, oldTotal := list(before, scope, warehouse, band)
				newIDs, newTotal := list(now, scope, warehouse, band)

				if !slices.Equal(oldIDs, newIDs) || oldTotal != newTotal {
					t.Fatalf("%v at %d, band %v: ledger %v (%d), fold %v (%d)", scope, warehouse, band, oldIDs, oldTotal,
						newIDs, newTotal)
				}

				name := fmt.Sprintf("%s/%d/[%d,%d)", scope.String()[len("SUPPLIER_LIST_SCOPE_"):], warehouse,
					band.GetMin(), band.GetMax())
				if expected, ok := want[name]; ok && !slices.Equal(ourIDs(newIDs), expected) {
					t.Fatalf("%s keeps %v of ours, want %v", name, ourIDs(newIDs), expected)
				}

				cases++
			}
		}
	}

	t.Logf("%d lists (3 warehouse choices × own / Discover × no pill + 5 pills): the fold answers the ledger's", cases)
}
