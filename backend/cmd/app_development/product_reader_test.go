package main

import (
	"context"
	"fmt"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// THE WAREHOUSE'S PICKER THROUGH THE REAL WIRING (a-warehouse-picks-only-what-it-has-held): inventory's
// WarehouseProductSearch reads the batch ledger for what has been here, and the composition root's reader hands those
// ids to product_service's SearchAmong. The only place the two halves meet a database together.
func TestInventoryProductReader_SearchesWhatTheWarehouseHasHeld(t *testing.T) {
	const (
		melati    uint64 = 9_000_030
		sinar     uint64 = 9_000_031
		warehouse uint64 = 9_000_032
		elsewhere uint64 = 9_000_033
	)

	db := san_testdb.DB(t)
	inventory := inventory_v1.NewService(db, nil, nil, nil, nil, NewInventoryProductReader(product_v1.NewService(db, nil, nil)))

	kaosMelati := insertCatalogue(t, db, melati, "E2-KAOS-01", "Kaos Temuan", false)
	kaosSinar := insertCatalogue(t, db, sinar, "E3-KAOS-01", "Kaos Temuan", false)
	old := insertCatalogue(t, db, sinar, "E3-KAOS-OLD", "Kaos Temuan Lama", false)
	away := insertCatalogue(t, db, sinar, "E3-KAOS-09", "Kaos Temuan Cabang", false)
	insertCatalogue(t, db, sinar, "E3-KAOS-NEW", "Kaos Temuan Baru", false) // stocked nowhere

	stockHeld(t, inventory, melati, warehouse, kaosMelati, 3)
	stockHeld(t, inventory, sinar, warehouse, kaosSinar, 2)
	stockHeld(t, inventory, sinar, warehouse, old, 1)
	stockHeld(t, inventory, sinar, elsewhere, away, 5)

	// The old pack is archived since — still offered here, flagged, since it was held here
	// (an-archived-product-held-here-can-be-picked).
	err := db.Exec(`UPDATE products SET archived = TRUE WHERE id = ?`, old).Error
	if err != nil {
		t.Fatalf("archive: %v", err)
	}

	res, err := inventory.WarehouseProductSearch(context.Background(), connect.NewRequest(&inventoryv1.WarehouseProductSearchRequest{
		WarehouseId: warehouse,
		Filter:      &inventoryv1.WarehouseProductSearchFilter{Q: "kaos tem"},
		Page:        &commonv1.CommonPagination{Page: 1, Limit: 10},
	}))
	if err != nil {
		t.Fatalf("WarehouseProductSearch: %v", err)
	}

	if !slices.Equal(res.Msg.GetIds(), []uint64{kaosMelati, kaosSinar, old}) {
		t.Fatalf("ids = %v, want Melati's then Sinar's Kaos Temuan, then the archived Lama (by name, then code)", res.Msg.GetIds())
	}

	if res.Msg.GetPageInfo().GetTotalItems() != 3 {
		t.Fatalf("total = %d, want 3", res.Msg.GetPageInfo().GetTotalItems())
	}

	var rows map[uint64]*inventoryv1.WarehouseProductSearchItem

	for _, item := range res.Msg.GetItems() {
		if p := item.GetProduct(); p != nil {
			rows = p.GetMapData()
		}
	}

	if rows[kaosMelati].GetTeamId() != melati || rows[kaosSinar].GetTeamId() != sinar {
		t.Fatalf("owners = %d, %d — two teams' same-named products must be told apart",
			rows[kaosMelati].GetTeamId(), rows[kaosSinar].GetTeamId())
	}

	if !rows[old].GetArchived() || rows[kaosSinar].GetArchived() {
		t.Fatalf("archived = %v (old), %v (Sinar's) — want only the old pack flagged", rows[old].GetArchived(), rows[kaosSinar].GetArchived())
	}

	if rows[kaosSinar].GetProductCode() != "E3-KAOS-01" || rows[kaosSinar].GetName() != "Kaos Temuan" {
		t.Fatalf("Sinar's reads %q %q", rows[kaosSinar].GetProductCode(), rows[kaosSinar].GetName())
	}
}

// insertCatalogue writes a product row as product_service stores it — the test owns no product_service writer here.
func insertCatalogue(t *testing.T, db *gorm.DB, team uint64, code, name string, archived bool) uint64 {
	t.Helper()

	var id uint64

	err := db.Raw(`INSERT INTO products (team_id, product_code, name, archived) VALUES (?, ?, ?, ?) RETURNING id`,
		team, code, name, archived).Scan(&id).Error
	if err != nil {
		t.Fatalf("insert product %s: %v", code, err)
	}

	return id
}

// stockHeld receives a team's product into a warehouse on a rack of its own — a batch there, so the product is held.
// The restock's own-products check runs through the real reader, so the team must own the product.
func stockHeld(t *testing.T, inventory *inventory_v1.Service, team, warehouse, product uint64, count int64) {
	t.Helper()

	ctx := context.Background()

	rack, err := inventory.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{
		TeamId: warehouse, Code: fmt.Sprintf("rak-%d", product), Name: "Rak",
	}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}

	created, err := inventory.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: team, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: product, ProductCode: "SKU", Name: "Kaos", Count: count, Total: float64(count * 10000)}},
	}))
	if err != nil {
		t.Fatalf("restock create: %v", err)
	}

	r := created.Msg.GetRequest()

	_, err = inventory.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: r.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId: r.GetItems()[0].GetId(), ReceivedCount: count,
			Placements: []*inventoryv1.RestockPlacement{{PlacementId: rack.Msg.GetRack().GetId(), Quantity: count}},
		}},
	}))
	if err != nil {
		t.Fatalf("restock accept: %v", err)
	}
}
