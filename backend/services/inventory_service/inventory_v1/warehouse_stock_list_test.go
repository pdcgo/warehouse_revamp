package inventory_v1_test

import (
	"context"
	"errors"
	"slices"
	"sort"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE STOCK SCREEN LISTS WHAT THE WAREHOUSE HAS HELD (the-stock-screen-lists-what-the-warehouse-has-held) —
// Inventories ▸ Stock.
//
//	Gudang 5   Melati's Kaos Temuan   10 — 6 on Rak A, 4 on Rak B
//	           Sinar's  Kaos Temuan    3 — the same name, another owner
//	           Sinar's  Kaos Polos     held, and at 0 now — every unit taken by an order
//	           Melati's Kemeja Lama    2 — archived by Melati since
//	Gudang 6   Sinar's  Kaos Kuning    4 — another building's
//	nowhere    Sinar's  Kaos Ungu      in the catalogue, never stocked
//
// product_service's half — naming, searching and ordering the held ids — is played by wslCatalogue below; the real one
// is product_v1.SearchAmong (product_search_among_test.go), wired at the composition root (product_reader_test.go).

const (
	wslKaosMelati uint64 = 801
	wslKaosSinar  uint64 = 802
	wslKaosPolos  uint64 = 803
	wslKemeja     uint64 = 804
	wslKaosUngu   uint64 = 805
	wslKaosKuning uint64 = 806

	wslOther uint64 = 6
	wslEmpty uint64 = 77
)

// wslCatalogue plays product_service for this test: who owns each product (Facts, for the restock and the take), and
// SearchAmong over the names — among the ids given only, by name or code anywhere, case-insensitive, by name then code
// then id; an empty term lists them all; archived ones in, flagged.
type wslCatalogue map[uint64]inventory_v1.ProductMatch

func (c wslCatalogue) Facts(_ context.Context, _ uint64, ids []uint64) (map[uint64]inventory_v1.ProductFact, error) {
	out := make(map[uint64]inventory_v1.ProductFact, len(ids))

	for _, id := range ids {
		if p, ok := c[id]; ok {
			out[id] = inventory_v1.ProductFact{TeamID: p.TeamID, ProductCode: p.ProductCode, Name: p.Name}
		}
	}

	return out, nil
}

func (c wslCatalogue) Search(_ context.Context, _ uint64, search inventory_v1.ProductSearch) (inventory_v1.ProductSearchPage, error) {
	term := strings.ToLower(strings.TrimSpace(search.Q))

	var matches []inventory_v1.ProductMatch

	for _, id := range search.ProductIDs {
		p, ok := c[id]
		if !ok {
			continue
		}

		if !strings.Contains(strings.ToLower(p.Name), term) && !strings.Contains(strings.ToLower(p.ProductCode), term) {
			continue
		}

		matches = append(matches, p)
	}

	sort.Slice(matches, func(i, j int) bool {
		if matches[i].Name != matches[j].Name {
			return matches[i].Name < matches[j].Name
		}

		if matches[i].ProductCode != matches[j].ProductCode {
			return matches[i].ProductCode < matches[j].ProductCode
		}

		return matches[i].ID < matches[j].ID
	})

	start := min(search.Offset, len(matches))
	end := min(start+search.Limit, len(matches))

	return inventory_v1.ProductSearchPage{Products: matches[start:end], Total: int64(len(matches))}, nil
}

func wslProducts() wslCatalogue {
	return wslCatalogue{
		wslKaosMelati: {ID: wslKaosMelati, TeamID: otMelati, ProductCode: "MEL-KT-01", Name: "Kaos Temuan"},
		wslKaosSinar:  {ID: wslKaosSinar, TeamID: otSinar, ProductCode: "SIN-KT-01", Name: "Kaos Temuan"},
		wslKaosPolos:  {ID: wslKaosPolos, TeamID: otSinar, ProductCode: "SIN-KP-01", Name: "Kaos Polos"},
		wslKemeja:     {ID: wslKemeja, TeamID: otMelati, ProductCode: "MEL-KL-01", Name: "Kemeja Lama", Archived: true},
		wslKaosUngu:   {ID: wslKaosUngu, TeamID: otSinar, ProductCode: "SIN-KU-01", Name: "Kaos Ungu"},
		wslKaosKuning: {ID: wslKaosKuning, TeamID: otSinar, ProductCode: "SIN-KK-01", Name: "Kaos Kuning"},
	}
}

func wslStocked(t *testing.T) *inventory_v1.Service {
	t.Helper()

	db := san_testdb.DB(t)
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, wslProducts())

	rakA := newRack(t, svc, otWarehouse, "rak-a")
	rakB := newRack(t, svc, otWarehouse, "rak-b")

	otRestock(t, svc, otMelati, wslKaosMelati, 10, 100000, []*inventoryv1.RestockPlacement{
		{PlacementId: rakA, Quantity: 6}, {PlacementId: rakB, Quantity: 4},
	})
	otRestock(t, svc, otSinar, wslKaosSinar, 3, 30000, []*inventoryv1.RestockPlacement{{PlacementId: rakA, Quantity: 3}})
	otRestock(t, svc, otSinar, wslKaosPolos, 4, 40000, []*inventoryv1.RestockPlacement{{PlacementId: rakB, Quantity: 4}})
	otRestock(t, svc, otMelati, wslKemeja, 2, 20000, []*inventoryv1.RestockPlacement{{PlacementId: rakA, Quantity: 2}})

	// Every Kaos Polos leaves on an order: held here, at 0 now.
	_, err := take(svc, "order:wsl-1", line(wslKaosPolos, 4))
	if err != nil {
		t.Fatalf("take every Kaos Polos: %v", err)
	}

	// Another building's stock: Gudang 6 holds Kaos Kuning.
	rakOther := newRack(t, svc, wslOther, "rak-z")

	created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: otSinar, WarehouseId: wslOther,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: wslKaosKuning, ProductCode: "SIN-KK-01", Name: "Kaos Kuning", Count: 4, Total: 40000}},
	}))
	if err != nil {
		t.Fatalf("restock Gudang 6: %v", err)
	}

	r := created.Msg.GetRequest()

	_, err = svc.RestockRequestAccept(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: wslOther, RequestId: r.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId: r.GetItems()[0].GetId(), ReceivedCount: 4,
			Placements: []*inventoryv1.RestockPlacement{{PlacementId: rakOther, Quantity: 4}},
		}},
	}))
	if err != nil {
		t.Fatalf("accept Gudang 6: %v", err)
	}

	return svc
}

// wslRow is one row of the Stock screen: the product slice and its units on hand here.
type wslRow struct {
	product *inventoryv1.WarehouseProductSearchItem
	onHand  *inventoryv1.StockLevel
}

func wslListRaw(
	svc *inventory_v1.Service,
	warehouse uint64,
	q string,
	page, limit uint32,
	types ...inventoryv1.WarehouseStockListDataType,
) (*inventoryv1.WarehouseStockListResponse, error) {
	res, err := svc.WarehouseStockList(ctxAs(41, warehouse, role_basev1.Role_ROLE_WAREHOUSE_STAFF), connect.NewRequest(
		&inventoryv1.WarehouseStockListRequest{
			WarehouseId: warehouse,
			Filter:      &inventoryv1.WarehouseStockListFilter{Q: q},
			DataRequest: types,
			Page:        &commonv1.CommonPagination{Page: page, Limit: limit},
		},
	))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// wslList is one page of the screen, as staff of the warehouse read it: the rows in order, and the page info.
func wslList(t *testing.T, svc *inventory_v1.Service, warehouse uint64, q string, page, limit uint32) ([]uint64, map[uint64]wslRow, *commonv1.PageInfo) {
	t.Helper()

	res, err := wslListRaw(svc, warehouse, q, page, limit)
	if err != nil {
		t.Fatalf("list %q in %d: %v", q, warehouse, err)
	}

	var (
		products map[uint64]*inventoryv1.WarehouseProductSearchItem
		stock    map[uint64]*inventoryv1.StockLevel
	)

	for _, item := range res.GetItems() {
		if p := item.GetProduct(); p != nil {
			products = p.GetMapData()
		}

		if s := item.GetStock(); s != nil {
			stock = s.GetMapData()
		}
	}

	rows := make(map[uint64]wslRow, len(res.GetIds()))
	for _, id := range res.GetIds() {
		rows[id] = wslRow{product: products[id], onHand: stock[id]}
	}

	return res.GetIds(), rows, res.GetPageInfo()
}

// With nothing typed the screen lists EVERY product held here, by name: what it holds, what it held and has run out of
// (at 0, so it can still be found and adjusted), and what its seller archived (flagged) — each with its owner and its
// units on hand summed over its racks. Never a product only another building has had, never one stocked nowhere.
func TestWarehouseStockList_ListsEveryProductHeldHere(t *testing.T) {
	svc := wslStocked(t)

	ids, rows, info := wslList(t, svc, otWarehouse, "", 1, 20)

	want := []uint64{wslKaosPolos, wslKaosMelati, wslKaosSinar, wslKemeja}
	if !slices.Equal(ids, want) {
		t.Fatalf("Gudang 5 lists %v, want %v — by name, then code: Kaos Polos, Melati's then Sinar's Kaos Temuan, Kemeja Lama", ids, want)
	}

	if info.GetTotalItems() != 4 {
		t.Fatalf("total = %d, want 4", info.GetTotalItems())
	}

	for id, want := range map[uint64]int64{wslKaosPolos: 0, wslKaosMelati: 10, wslKaosSinar: 3, wslKemeja: 2} {
		level := rows[id].onHand
		if level == nil || level.GetOnHand() != want || level.GetWarehouseId() != otWarehouse || level.GetProductId() != id {
			t.Errorf("product %d on hand = %v, want %d in Gudang 5", id, level, want)
		}
	}

	// Two teams' same-named products, each with its owner.
	if rows[wslKaosMelati].product.GetTeamId() != otMelati || rows[wslKaosSinar].product.GetTeamId() != otSinar {
		t.Fatalf("Kaos Temuan owners = %d, %d — want Melati's and Sinar's told apart",
			rows[wslKaosMelati].product.GetTeamId(), rows[wslKaosSinar].product.GetTeamId())
	}

	if p := rows[wslKaosSinar].product; p.GetProductCode() != "SIN-KT-01" || p.GetName() != "Kaos Temuan" || p.GetId() != wslKaosSinar {
		t.Fatalf("Sinar's Kaos Temuan reads %v", p)
	}

	// Only the archived one is flagged.
	for id, row := range rows {
		if row.product.GetArchived() != (id == wslKemeja) {
			t.Errorf("product %d archived = %v", id, row.product.GetArchived())
		}
	}

	// StockList's figure for the same product — one formula, so the two screens agree.
	levels, err := svc.StockList(ctxAs(41, otWarehouse, role_basev1.Role_ROLE_WAREHOUSE_STAFF), connect.NewRequest(&inventoryv1.StockListRequest{
		WarehouseId: otWarehouse,
		Page:        &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}

	for _, item := range levels.Msg.GetItems() {
		for id, level := range item.GetStock().GetMapData() {
			if row, ok := rows[id]; ok && row.onHand.GetOnHand() != level.GetOnHand() {
				t.Errorf("product %d: Stock screen %d, StockList %d", id, row.onHand.GetOnHand(), level.GetOnHand())
			}
		}
	}

	// Gudang 6 lists its own Kaos Kuning — and nothing of Gudang 5's.
	other, otherRows, _ := wslList(t, svc, wslOther, "", 1, 20)
	if !slices.Equal(other, []uint64{wslKaosKuning}) || otherRows[wslKaosKuning].onHand.GetOnHand() != 4 {
		t.Fatalf("Gudang 6 lists %v, want only Kaos Kuning with 4", other)
	}
}

// The search runs on the server, by name or by code, anywhere, case-insensitive — among what is held here only.
func TestWarehouseStockList_SearchesByNameAndCode(t *testing.T) {
	svc := wslStocked(t)

	byName, _, info := wslList(t, svc, otWarehouse, "TEMUAN", 1, 20)
	if !slices.Equal(byName, []uint64{wslKaosMelati, wslKaosSinar}) || info.GetTotalItems() != 2 {
		t.Fatalf("temuan = %v (total %d), want both Kaos Temuan", byName, info.GetTotalItems())
	}

	byCode, rows, _ := wslList(t, svc, otWarehouse, " sin-k ", 1, 20)
	if !slices.Equal(byCode, []uint64{wslKaosPolos, wslKaosSinar}) {
		t.Fatalf("sin-k = %v, want Sinar's Kaos Polos then Kaos Temuan", byCode)
	}

	if rows[wslKaosPolos].onHand.GetOnHand() != 0 {
		t.Fatalf("Kaos Polos found by code reads %d, want 0", rows[wslKaosPolos].onHand.GetOnHand())
	}

	// Kaos Ungu is in the catalogue and matches, but was never here; Kaos Kuning is another building's.
	for _, q := range []string{"ungu", "kuning"} {
		never, _, info := wslList(t, svc, otWarehouse, q, 1, 20)
		if len(never) != 0 || info.GetTotalItems() != 0 {
			t.Fatalf("%s = %v (total %d), want nothing — never held here", q, never, info.GetTotalItems())
		}
	}
}

// Pages walk the list in order; the total counts every product held here.
func TestWarehouseStockList_Pages(t *testing.T) {
	svc := wslStocked(t)

	first, _, info := wslList(t, svc, otWarehouse, "", 1, 3)
	second, _, _ := wslList(t, svc, otWarehouse, "", 2, 3)
	past, _, pastInfo := wslList(t, svc, otWarehouse, "", 3, 3)

	if !slices.Equal(first, []uint64{wslKaosPolos, wslKaosMelati, wslKaosSinar}) || !slices.Equal(second, []uint64{wslKemeja}) {
		t.Fatalf("pages = %v then %v, want the first three by name, then Kemeja Lama", first, second)
	}

	if info.GetTotalItems() != 4 || info.GetTotalPage() != 2 || info.GetCurrentPage() != 1 {
		t.Fatalf("page info = %+v, want 4 items over 2 pages", info)
	}

	if len(past) != 0 || pastInfo.GetTotalItems() != 4 {
		t.Fatalf("page 3 = %v (total %d), want nothing of 4", past, pastInfo.GetTotalItems())
	}
}

// A warehouse that has held nothing lists nothing. A term of one character is refused, spaces or not; spaces alone are
// no term, and list everything.
func TestWarehouseStockList_NothingHeldAndTooShort(t *testing.T) {
	svc := wslStocked(t)

	ids, _, info := wslList(t, svc, wslEmpty, "", 1, 20)
	if len(ids) != 0 || info.GetTotalItems() != 0 {
		t.Fatalf("an empty warehouse lists %v (total %d), want nothing", ids, info.GetTotalItems())
	}

	_, err := wslListRaw(svc, otWarehouse, " k ", 1, 20)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("\" k \" = %v, want InvalidArgument", err)
	}

	all, _, _ := wslList(t, svc, otWarehouse, "   ", 1, 20)
	if len(all) != 4 {
		t.Fatalf("spaces alone list %v, want all 4", all)
	}
}

// A row is the PRODUCT and STOCK slices by default; asked for one slice, only that one comes back.
func TestWarehouseStockList_Slices(t *testing.T) {
	svc := wslStocked(t)

	res, err := wslListRaw(svc, otWarehouse, "temuan", 1, 20, inventoryv1.WarehouseStockListDataType_WAREHOUSE_STOCK_LIST_DATA_TYPE_GENERAL)
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	if len(res.GetItems()) != 1 || res.GetItems()[0].GetGeneral().GetMapData()[wslKaosSinar].GetName() != "Kaos Temuan" {
		t.Fatalf("GENERAL only = %v, want the general slice alone", res.GetItems())
	}

	res, err = wslListRaw(svc, otWarehouse, "temuan", 1, 20)
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	if len(res.GetItems()) != 2 || res.GetItems()[0].GetProduct() == nil || res.GetItems()[1].GetStock() == nil {
		t.Fatalf("default slices = %v, want PRODUCT then STOCK", res.GetItems())
	}
}

// With no product_service to ask, the list fails loudly rather than reading as "nothing stocked here".
func TestWarehouseStockList_NoProductServiceIsUnavailable(t *testing.T) {
	db := san_testdb.DB(t)
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, nil)

	rak := newRack(t, svc, otWarehouse, "rak-a")
	otRestock(t, svc, otMelati, otKaosHitam, 1, 10000, []*inventoryv1.RestockPlacement{{PlacementId: rak, Quantity: 1}})

	_, err := wslListRaw(svc, otWarehouse, "", 1, 20)

	var connectErr *connect.Error
	if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeUnavailable {
		t.Fatalf("err = %v, want Unavailable", err)
	}
}

// WHO reads the Stock screen: Root, the Administrator and the warehouse's Owner, Admin and Staff — scoped to the
// warehouse, a read, so the admin team's monitor and an agent may too. No selling role: a seller reads its own stock on
// its product screens.
func TestWarehouseStockList_PolicyIsTheWarehouses(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.WarehouseStockListRequest")
	if err != nil {
		t.Fatalf("descriptor: %v", err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatalf("WarehouseStockListRequest has no policy")
	}

	got := policy.GetRoles()

	for _, role := range []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	} {
		if !slices.Contains(got, role) {
			t.Errorf("WarehouseStockList is closed to %s", role)
		}
	}

	for _, role := range []role_basev1.Role{
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
		role_basev1.Role_ROLE_SELLING_CS,
	} {
		if slices.Contains(got, role) {
			t.Errorf("WarehouseStockList is open to %s", role)
		}
	}

	scope, ok := san_auth.ScopeOf(&inventoryv1.WarehouseStockListRequest{WarehouseId: otWarehouse})
	if !ok || scope != otWarehouse {
		t.Fatalf("scope = %d, %v — want the warehouse_id", scope, ok)
	}

	method := inventoryv1.File_warehouse_inventory_v1_inventory_proto.
		Services().
		ByName("InventoryService").
		Methods().
		ByName("WarehouseStockList")

	options, _ := method.Options().(*descriptorpb.MethodOptions)
	if options.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatalf("WarehouseStockList is not marked NO_SIDE_EFFECTS — staff, the monitor and an agent read it")
	}
}
