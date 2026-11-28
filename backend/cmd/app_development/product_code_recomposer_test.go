package main

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/team_service/team_v1"
)

// THE TEAM CODE EDIT THROUGH THE REAL SEAM (backlog #149, a-team-code-change-recomposes-its-product-codes): team_service's
// TeamCodeUpdate → this root's productCodeRecomposer → product_service's set-based recompose, which asks inventory's own
// placements (productStockNarrower.StockSitsAmong) — on ONE transaction. The acceptance's given 1/2 scene
// (docs/acceptances/teams/team_code.md): team ABC → XYZ, 2 products, past restocks, 1 warehouse holding stock.

// codeEditWorld is the three services wired as the app wires them, on the test's transaction.
type codeEditWorld struct {
	teams     *team_v1.Service
	products  *product_v1.Service
	inventory *inventory_v1.Service
}

func newCodeEditWorld(db *gorm.DB) codeEditWorld {
	products := product_v1.NewService(db, nil, nil, NewProductStockNarrower(db), nil)

	return codeEditWorld{
		teams:     team_v1.NewService(db, nil, NewProductCodeRecomposer(products)),
		products:  products,
		inventory: inventory_v1.NewService(db, nil, nil, nil, nil, NewInventoryProductReader(products), nil, nil, nil, nil),
	}
}

func sellingTeam(t *testing.T, db *gorm.DB, name, code string) uint64 {
	t.Helper()

	team := team_service_models.Team{Type: "selling", Name: name, TeamCode: code}

	err := db.Create(&team).Error
	if err != nil {
		t.Fatal(err)
	}

	return team.ID
}

// asOwnerOf is the selling Owner (user 77) inside their own team.
func asOwnerOf(team uint64) context.Context {
	ctx := san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: 77})
	ctx = san_auth.WithScope(ctx, team)

	return san_auth.WithCallerRole(ctx, role_basev1.Role_ROLE_SELLING_OWNER)
}

func productCodeOf(t *testing.T, db *gorm.DB, id uint64) string {
	t.Helper()

	var code string

	err := db.Raw("SELECT product_code FROM products WHERE id = ?", id).Scan(&code).Error
	if err != nil {
		t.Fatal(err)
	}

	return code
}

func TestTeamCodeUpdate_RecomposesThroughTheRealSeam(t *testing.T) {
	const (
		warehouse uint64 = 9_000_149
		elsewhere uint64 = 9_000_150
	)

	db := san_testdb.DB(t)
	w := newCodeEditWorld(db)

	team := sellingTeam(t, db, "Toko Anggrek E149", "E149-ABC")

	shoe := insertCatalogue(t, db, team, "E149-ABC-SHOE-42", "Sepatu", false)
	bag := insertCatalogue(t, db, team, "E149-ABC-TAS-01", "Tas", false)
	// Archived WITH stock on a shelf (archive is allowed so): it takes the new code and is tagged where its stock sits (⚠2).
	old := insertCatalogue(t, db, team, "E149-ABC-LAMA", "Lama", false)
	// Nothing on a shelf anywhere: takes the new code, never tagged (⚠4) — one never stocked, one whose shelf is empty now.
	unstocked := insertCatalogue(t, db, team, "E149-ABC-BARU", "Baru", false)
	soldOut := insertCatalogue(t, db, team, "E149-ABC-HABIS", "Habis", false)

	stockHeld(t, w.inventory, team, warehouse, shoe, 3)
	stockHeld(t, w.inventory, team, warehouse, bag, 2)
	stockHeld(t, w.inventory, team, elsewhere, old, 1)
	stockHeld(t, w.inventory, team, warehouse, soldOut, 4)

	err := db.Exec("UPDATE products SET archived = TRUE WHERE id = ?", old).Error
	if err != nil {
		t.Fatal(err)
	}

	// Its units all went (the shelf row stays, at 0).
	err = db.Exec("UPDATE product_placements SET stock_count = 0 WHERE product_id = ?", soldOut).Error
	if err != nil {
		t.Fatal(err)
	}

	var restockCodes []string

	err = db.Raw("SELECT product_code FROM restock_items WHERE product_id IN ? ORDER BY id", []uint64{shoe, bag, old}).
		Scan(&restockCodes).Error
	if err != nil {
		t.Fatal(err)
	}

	resp, err := w.teams.TeamCodeUpdate(asOwnerOf(team), connect.NewRequest(&teamv1.TeamCodeUpdateRequest{TeamId: team, TeamCode: "E149-XYZ"}))
	if err != nil {
		t.Fatalf("TeamCodeUpdate: %v", err)
	}

	// then: team code becomes XYZ.
	if resp.Msg.GetTeam().GetTeamCode() != "E149-XYZ" || resp.Msg.GetProductsRecomposed() != 5 || resp.Msg.GetProductsTagged() != 3 {
		t.Fatalf("answer = %+v, want E149-XYZ, 5 recomposed, 3 tagged", resp.Msg)
	}

	// then: codes of the products start with XYZ — archived and unstocked too.
	for id, want := range map[uint64]string{
		shoe: "E149-XYZ-SHOE-42", bag: "E149-XYZ-TAS-01", old: "E149-XYZ-LAMA", unstocked: "E149-XYZ-BARU", soldOut: "E149-XYZ-HABIS",
	} {
		if got := productCodeOf(t, db, id); got != want {
			t.Errorf("product %d = %q, want %q", id, got, want)
		}
	}

	// then: the products some warehouse holds are tagged need_reprint_code — and the owner's list filtered by it shows them.
	reprint := w.reprintTag(t)

	listed, err := w.products.ProductList(asOwnerOf(team), connect.NewRequest(&productv1.ProductListRequest{
		TeamId: team,
		Filter: &productv1.ProductListFilter{TagIds: []uint64{reprint}},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatal(err)
	}

	ids := listed.Msg.GetIds()
	slices.Sort(ids)

	if want := []uint64{shoe, bag}; !slices.Equal(ids, want) {
		t.Errorf("the active list filtered by need_reprint_code = %v, want %v (the archived one is on the archive tab)", ids, want)
	}

	// The reprint waits — per warehouse holding stock.
	var waits []struct {
		ProductID   uint64
		WarehouseID uint64
	}

	err = db.Raw("SELECT product_id, warehouse_id FROM product_reprint_waits WHERE product_id IN ? ORDER BY product_id",
		[]uint64{shoe, bag, old, unstocked, soldOut}).Scan(&waits).Error
	if err != nil {
		t.Fatal(err)
	}

	if len(waits) != 3 || waits[0].WarehouseID != warehouse || waits[1].WarehouseID != warehouse || waits[2].WarehouseID != elsewhere {
		t.Errorf("waits = %+v, want shoe and bag at the warehouse, the archived one elsewhere", waits)
	}

	// then: product history shows old code and new code.
	history, err := w.products.ProductLogList(asOwnerOf(team), connect.NewRequest(&productv1.ProductLogListRequest{
		TeamId: team, ProductId: shoe, Page: &commonv1.CommonPagination{Page: 1, Limit: 10},
	}))
	if err != nil {
		t.Fatal(err)
	}

	if logs := history.Msg.GetLogs(); len(logs) != 1 || logs[0].GetOldCode() != "E149-ABC-SHOE-42" ||
		logs[0].GetNewCode() != "E149-XYZ-SHOE-42" || logs[0].GetActorId() != 77 || logs[0].GetIsOverride() {
		t.Errorf("history = %+v, want E149-ABC-SHOE-42 → E149-XYZ-SHOE-42 by 77", logs)
	}

	// then: past restocks keep the code they were written with.
	var restockCodesAfter []string

	err = db.Raw("SELECT product_code FROM restock_items WHERE product_id IN ? ORDER BY id", []uint64{shoe, bag, old}).
		Scan(&restockCodesAfter).Error
	if err != nil {
		t.Fatal(err)
	}

	if len(restockCodes) != 3 || !slices.Equal(restockCodes, restockCodesAfter) {
		t.Errorf("restock lines read %v, then %v — want unchanged", restockCodes, restockCodesAfter)
	}

	// then: the warehouse holding stock sees need_reprint_code on its Products list.
	stocked, err := w.inventory.WarehouseStockList(context.Background(), connect.NewRequest(&inventoryv1.WarehouseStockListRequest{
		WarehouseId: warehouse,
		Filter:      &inventoryv1.WarehouseStockListFilter{TagIds: []uint64{reprint}},
		Page:        &commonv1.CommonPagination{Page: 1, Limit: 10},
	}))
	if err != nil {
		t.Fatal(err)
	}

	got := stocked.Msg.GetIds()
	slices.Sort(got)

	if want := []uint64{shoe, bag}; !slices.Equal(got, want) {
		t.Errorf("the warehouse's list filtered by need_reprint_code = %v, want %v", got, want)
	}

	// then: other teams see the new codes (ProductByIds reads the live code).
	byIds, err := w.products.ProductByIds(context.Background(), connect.NewRequest(&productv1.ProductByIdsRequest{
		TeamId:      1,
		Filter:      &productv1.ProductByIdsFilter{Ids: []uint64{shoe}},
		DataRequest: []productv1.ProductByIdsDataType{productv1.ProductByIdsDataType_PRODUCT_BY_IDS_DATA_TYPE_PRODUCT},
	}))
	if err != nil {
		t.Fatal(err)
	}

	seen := ""

	for _, list := range byIds.Msg.GetItems() {
		for _, item := range list.GetItems() {
			if row := item.GetProduct().GetMapData()[shoe]; row != nil {
				seen = row.GetProductCode()
			}
		}
	}

	if seen != "E149-XYZ-SHOE-42" {
		t.Errorf("ProductByIds (another team's read) shows %q, want E149-XYZ-SHOE-42", seen)
	}
}

// A clash with ANOTHER team's product (only a dash makes one) refuses the whole change — AlreadyExists naming the product —
// and the team, its former codes and every product code stay as they were.
func TestTeamCodeUpdate_AClashLeavesEverythingAsItWas(t *testing.T) {
	db := san_testdb.DB(t)
	w := newCodeEditWorld(db)

	team := sellingTeam(t, db, "Toko Q E149", "E149Q")
	other := sellingTeam(t, db, "Toko AB E149", "E149AB")

	// Q-1 under the new code AB-C composes AB-C-1 — team AB's part C-1 already composed it.
	mine := insertCatalogue(t, db, team, "E149Q-1", "Satu", false)
	theirs := insertCatalogue(t, db, other, "E149AB-C-1", "Punya mereka", false)

	_, err := w.teams.TeamCodeUpdate(asOwnerOf(team), connect.NewRequest(&teamv1.TeamCodeUpdateRequest{TeamId: team, TeamCode: "E149AB-C"}))

	var connectErr *connect.Error
	if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeAlreadyExists || !strings.Contains(err.Error(), "E149AB-C-1") {
		t.Fatalf("err = %v, want AlreadyExists naming E149AB-C-1", err)
	}

	var codes []string

	err = db.Raw("SELECT team_code FROM teams WHERE id = ? UNION ALL SELECT team_code FROM team_former_codes WHERE team_id = ?", team, team).
		Scan(&codes).Error
	if err != nil {
		t.Fatal(err)
	}

	if !slices.Equal(codes, []string{"E149Q"}) || productCodeOf(t, db, mine) != "E149Q-1" || productCodeOf(t, db, theirs) != "E149AB-C-1" {
		t.Errorf("after the refusal: team codes %v, products %q / %q — want all unchanged", codes,
			productCodeOf(t, db, mine), productCodeOf(t, db, theirs))
	}
}

func (w codeEditWorld) reprintTag(t *testing.T) uint64 {
	t.Helper()

	tags, err := w.products.ProductTagList(context.Background(), connect.NewRequest(&productv1.ProductTagListRequest{
		TeamId: 1, Q: "need_reprint_code", Page: &commonv1.CommonPagination{Page: 1, Limit: 5},
	}))
	if err != nil {
		t.Fatal(err)
	}

	for _, tag := range tags.Msg.GetTags() {
		if tag.GetAppTask() == product_v1.AppTaskReprintCode {
			return tag.GetId()
		}
	}

	t.Fatal("need_reprint_code is not on the list")

	return 0
}
