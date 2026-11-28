package main

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// PRODUCT TAGS THROUGH THE REAL WIRING (backlog #147 — products-have-their-own-tag-list, its 🔄 *who sees*: the owning
// team and every warehouse holding the product's stock): the warehouse's Products list (inventory's WarehouseStockList →
// the composition root's reader → product_service's SearchAmong) carries each held product's tags and narrows by the Tag
// filter in product_service's one statement; and ProductTagsByIds asks inventory's own batches, through the stock
// narrower, which products a warehouse holds. The only place the two halves meet a database together.

func seamTag(t *testing.T, db *gorm.DB, products *product_v1.Service, team, product uint64, name string) uint64 {
	t.Helper()

	made, err := products.ProductTagCreate(context.Background(), connect.NewRequest(&productv1.ProductTagCreateRequest{TeamId: team, Name: name}))
	if err != nil {
		t.Fatalf("make %q: %v", name, err)
	}

	_, err = products.ProductTagAdd(context.Background(), connect.NewRequest(&productv1.ProductTagAddRequest{
		TeamId: team, ProductId: product, TagId: made.Msg.GetTag().GetId(),
	}))
	if err != nil {
		t.Fatalf("put %q on %d: %v", name, product, err)
	}

	return made.Msg.GetTag().GetId()
}

func TestWarehouseStockList_TagsThroughTheRealReader(t *testing.T) {
	const (
		melati    uint64 = 9_000_050
		sinar     uint64 = 9_000_051
		warehouse uint64 = 9_000_052
		elsewhere uint64 = 9_000_053
	)

	db := san_testdb.DB(t)
	products := product_v1.NewService(db, nil, nil, nil, nil)
	inventory := inventory_v1.NewService(db, nil, nil, nil, nil, NewInventoryProductReader(products), nil, nil, nil, nil)

	kaosMelati := insertCatalogue(t, db, melati, "E6-KAOS-01", "Kaos Temuan", false)
	kaosSinar := insertCatalogue(t, db, sinar, "E7-KAOS-01", "Kaos Temuan", false)
	away := insertCatalogue(t, db, sinar, "E7-KAOS-09", "Kaos Cabang", false)

	stockHeld(t, inventory, melati, warehouse, kaosMelati, 3)
	stockHeld(t, inventory, sinar, warehouse, kaosSinar, 2)
	stockHeld(t, inventory, sinar, elsewhere, away, 5)

	laris := seamTag(t, db, products, melati, kaosMelati, "Seam Laris")
	seamTag(t, db, products, sinar, kaosSinar, "Seam Promo")

	_, err := products.ProductTagAdd(context.Background(), connect.NewRequest(&productv1.ProductTagAddRequest{
		TeamId: sinar, ProductId: away, TagId: laris,
	}))
	if err != nil {
		t.Fatal(err)
	}

	list := func(tagIDs ...uint64) *inventoryv1.WarehouseStockListResponse {
		res, listErr := inventory.WarehouseStockList(context.Background(), connect.NewRequest(&inventoryv1.WarehouseStockListRequest{
			WarehouseId: warehouse,
			Filter:      &inventoryv1.WarehouseStockListFilter{TagIds: tagIDs},
			Page:        &commonv1.CommonPagination{Page: 1, Limit: 10},
		}))
		if listErr != nil {
			t.Fatalf("WarehouseStockList: %v", listErr)
		}

		return res.Msg
	}

	res := list()

	var rows map[uint64]*inventoryv1.WarehouseProductSearchItem

	for _, item := range res.GetItems() {
		if p := item.GetProduct(); p != nil {
			rows = p.GetMapData()
		}
	}

	if !slices.Equal(res.GetIds(), []uint64{kaosMelati, kaosSinar}) {
		t.Fatalf("ids = %v", res.GetIds())
	}

	if tags := rows[kaosMelati].GetTags(); len(tags) != 1 || tags[0].GetName() != "Seam Laris" {
		t.Fatalf("Melati's row carries %v", tags)
	}

	if tags := rows[kaosSinar].GetTags(); len(tags) != 1 || tags[0].GetName() != "Seam Promo" {
		t.Fatalf("Sinar's row carries %v", tags)
	}

	filtered := list(laris)
	if !slices.Equal(filtered.GetIds(), []uint64{kaosMelati}) || filtered.GetPageInfo().GetTotalItems() != 1 {
		t.Fatalf("Seam Laris = %v (%d), want Melati's alone — never the Kaos Cabang held in another building",
			filtered.GetIds(), filtered.GetPageInfo().GetTotalItems())
	}
}

func TestProductTagsByIds_AWarehouseReadsWhatItHolds(t *testing.T) {
	const (
		melati    uint64 = 9_000_060
		warehouse uint64 = 9_000_062
		elsewhere uint64 = 9_000_063
	)

	db := san_testdb.DB(t)
	products := product_v1.NewService(db, nil, nil, NewProductStockNarrower(db), nil)
	inventory := inventory_v1.NewService(db, nil, nil, nil, nil, NewInventoryProductReader(products), nil, nil, nil, nil)

	here := insertCatalogue(t, db, melati, "E8-KAOS-01", "Kaos Di Sini", false)
	there := insertCatalogue(t, db, melati, "E8-KAOS-02", "Kaos Di Sana", false)

	stockHeld(t, inventory, melati, warehouse, here, 1)
	stockHeld(t, inventory, melati, elsewhere, there, 1)

	seamTag(t, db, products, melati, here, "Seam Sini")
	seamTag(t, db, products, melati, there, "Seam Sana")

	read := func(team uint64) map[uint64]*productv1.ProductTagSet {
		res, err := products.ProductTagsByIds(context.Background(), connect.NewRequest(&productv1.ProductTagsByIdsRequest{
			TeamId: team, ProductIds: []uint64{here, there},
		}))
		if err != nil {
			t.Fatalf("team %d: %v", team, err)
		}

		return res.Msg.GetItems()
	}

	got := read(warehouse)
	if len(got) != 1 || len(got[here].GetTags()) != 1 || got[here].GetTags()[0].GetName() != "Seam Sini" {
		t.Fatalf("the warehouse reads %v — want only the product it holds", got)
	}

	if got := read(melati); len(got) != 2 {
		t.Fatalf("the owner reads %v — want both", got)
	}

	// HeldAmong itself: the ids asked that the building has held, nothing else.
	held, err := inventory_v1.HeldAmong(context.Background(), db, elsewhere, []uint64{here, there})
	if err != nil || !slices.Equal(held, []uint64{there}) {
		t.Fatalf("held elsewhere = %v, %v", held, err)
	}
}
