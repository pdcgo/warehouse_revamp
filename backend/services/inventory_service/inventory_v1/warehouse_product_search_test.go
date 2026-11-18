package inventory_v1_test

import (
	"context"
	"errors"
	"slices"
	"sort"
	"strings"
	"testing"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	_ "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A WAREHOUSE PICKS ONLY WHAT IT HAS HELD (a-warehouse-picks-only-what-it-has-held) — the picker behind Report Found, a
// count's product plan and a count's found.
//
//	Gudang 5   Melati's Kaos Hitam   10 on the shelf (two batches)
//	           Sinar's  Kaos Polos   held, and at 0 now — every unit taken by an order
//	Gudang 6   Sinar's  Kaos Kuning  4 — another building's
//	nowhere    Sinar's  Kaos Ungu    in the catalogue, never stocked
//
// product_service's half — the names and codes, searched among the held ids — is played by the fakes below; the real one
// is product_v1.SearchAmong (product_search_among_test.go), wired at the composition root.

const (
	wpsOther     uint64 = 6
	wpsKaosKunin uint64 = 709
)

// Search plays product_service's SearchAmong over the fake catalogue: among the ids given only, by name or code anywhere,
// case-insensitive, by name then code.
func (f fakeFacts) Search(_ context.Context, _ uint64, search inventory_v1.ProductSearch) (inventory_v1.ProductSearchPage, error) {
	term := strings.ToLower(strings.TrimSpace(search.Q))

	var matches []inventory_v1.ProductMatch

	for _, id := range search.ProductIDs {
		fact, ok := f[id]
		if !ok {
			continue
		}

		if !strings.Contains(strings.ToLower(fact.Name), term) && !strings.Contains(strings.ToLower(fact.ProductCode), term) {
			continue
		}

		matches = append(matches, inventory_v1.ProductMatch{ID: id, TeamID: fact.TeamID, ProductCode: fact.ProductCode, Name: fact.Name})
	}

	sort.Slice(matches, func(i, j int) bool {
		if matches[i].Name != matches[j].Name {
			return matches[i].Name < matches[j].Name
		}

		return matches[i].ProductCode < matches[j].ProductCode
	})

	total := int64(len(matches))
	start := min(search.Offset, len(matches))
	end := min(start+search.Limit, len(matches))

	return inventory_v1.ProductSearchPage{Products: matches[start:end], Total: total}, nil
}

// Search: the owners fake knows no names, so it matches nothing.
func (fakeOwners) Search(context.Context, uint64, inventory_v1.ProductSearch) (inventory_v1.ProductSearchPage, error) {
	return inventory_v1.ProductSearchPage{}, nil
}

func wpsFacts() fakeFacts {
	return fakeFacts{
		otKaosHitam:  {TeamID: otMelati, ProductCode: "KH-01", Name: "Kaos Hitam"},
		otKaosPolos:  {TeamID: otSinar, ProductCode: "KP-01", Name: "Kaos Polos"},
		opKaosUngu:   {TeamID: otSinar, ProductCode: "KU-01", Name: "Kaos Ungu"},
		wpsKaosKunin: {TeamID: otSinar, ProductCode: "KK-01", Name: "Kaos Kuning"},
	}
}

func wpsStocked(t *testing.T) *inventory_v1.Service {
	t.Helper()

	db := san_testdb.DB(t)
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, wpsFacts(), nil, nil, nil, nil)

	rakA := newRack(t, svc, otWarehouse, "rak-a")
	otRestock(t, svc, otMelati, otKaosHitam, 8, 80000, []*inventoryv1.RestockPlacement{{PlacementId: rakA, Quantity: 8}})
	otRestock(t, svc, otMelati, otKaosHitam, 2, 24000, []*inventoryv1.RestockPlacement{{PlacementId: rakA, Quantity: 2}})
	otRestock(t, svc, otSinar, otKaosPolos, 4, 80000, []*inventoryv1.RestockPlacement{{PlacementId: rakA, Quantity: 4}})

	// Every Kaos Polos leaves on an order: held here, at 0 now.
	_, err := take(svc, "key-wps-1", line(otKaosPolos, 4))
	if err != nil {
		t.Fatalf("take every Kaos Polos: %v", err)
	}

	var left int64

	err = db.
		Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM batches WHERE warehouse_id = ? AND product_id = ?`, otWarehouse, otKaosPolos).
		Scan(&left).
		Error
	if err != nil || left != 0 {
		t.Fatalf("Kaos Polos left in Gudang 5 = %d (%v), want 0", left, err)
	}

	// Another building's stock: Gudang 6 holds Kaos Kuning.
	rakOther := newRack(t, svc, wpsOther, "rak-z")

	created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: otSinar, WarehouseId: wpsOther,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: wpsKaosKunin, ProductCode: "KK-01", Name: "Kaos Kuning", Count: 4, Total: 40000}},
	}))
	if err != nil {
		t.Fatalf("restock Gudang 6: %v", err)
	}

	r := created.Msg.GetRequest()

	_, err = svc.RestockRequestAccept(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: wpsOther, RequestId: r.GetId(),
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

// wpsSearch is one page of the picker, as staff of the warehouse read it: the products in order.
func wpsSearch(
	t *testing.T,
	svc *inventory_v1.Service,
	warehouse uint64,
	q string,
	page, limit uint32,
) ([]*inventoryv1.WarehouseProductSearchItem, *commonv1.PageInfo) {
	t.Helper()

	res, err := svc.WarehouseProductSearch(ctxAs(41, warehouse, role_basev1.Role_ROLE_WAREHOUSE_STAFF), connect.NewRequest(
		&inventoryv1.WarehouseProductSearchRequest{
			WarehouseId: warehouse,
			Filter:      &inventoryv1.WarehouseProductSearchFilter{Q: q},
			Page:        &commonv1.CommonPagination{Page: page, Limit: limit},
		},
	))
	if err != nil {
		t.Fatalf("search %q in %d: %v", q, warehouse, err)
	}

	var rows map[uint64]*inventoryv1.WarehouseProductSearchItem

	for _, item := range res.Msg.GetItems() {
		if p := item.GetProduct(); p != nil {
			rows = p.GetMapData()
		}
	}

	out := make([]*inventoryv1.WarehouseProductSearchItem, 0, len(res.Msg.GetIds()))
	for _, id := range res.Msg.GetIds() {
		out = append(out, rows[id])
	}

	return out, res.Msg.GetPageInfo()
}

func wpsIDs(items []*inventoryv1.WarehouseProductSearchItem) []uint64 {
	ids := make([]uint64, 0, len(items))
	for _, it := range items {
		ids = append(ids, it.GetId())
	}

	return ids
}

// Staff typing "kaos" find what this warehouse holds AND what it held and has run out of — never a product only another
// building has had, never one stocked nowhere. Each with its owner, so two teams' goods are told apart.
func TestWarehouseProductSearch_FindsOnlyWhatThisWarehouseHasHeld(t *testing.T) {
	svc := wpsStocked(t)

	items, info := wpsSearch(t, svc, otWarehouse, "kaos", 1, 20)

	got := wpsIDs(items)
	if !slices.Equal(got, []uint64{otKaosHitam, otKaosPolos}) {
		t.Fatalf("kaos in Gudang 5 = %v, want [Kaos Hitam, Kaos Polos] by name", got)
	}

	if info.GetTotalItems() != 2 {
		t.Fatalf("total = %d, want 2", info.GetTotalItems())
	}

	if items[0].GetTeamId() != otMelati || items[1].GetTeamId() != otSinar {
		t.Fatalf("owners = %d, %d — want Melati's Kaos Hitam and Sinar's Kaos Polos", items[0].GetTeamId(), items[1].GetTeamId())
	}

	if items[1].GetProductCode() != "KP-01" || items[1].GetName() != "Kaos Polos" {
		t.Fatalf("Kaos Polos reads %q %q, want its code and name", items[1].GetProductCode(), items[1].GetName())
	}

	// Gudang 6 sees its own Kaos Kuning — and nothing of Gudang 5's.
	other, _ := wpsSearch(t, svc, wpsOther, "kaos", 1, 20)
	if !slices.Equal(wpsIDs(other), []uint64{wpsKaosKunin}) {
		t.Fatalf("kaos in Gudang 6 = %v, want only Kaos Kuning", wpsIDs(other))
	}
}

// A product held at 0 is found by its code as well as its name.
func TestWarehouseProductSearch_ByCodeAndAtZero(t *testing.T) {
	svc := wpsStocked(t)

	items, _ := wpsSearch(t, svc, otWarehouse, "kp-0", 1, 20)
	if !slices.Equal(wpsIDs(items), []uint64{otKaosPolos}) {
		t.Fatalf("kp-0 = %v, want Kaos Polos — held here, at 0 now", wpsIDs(items))
	}

	// Kaos Ungu is in the catalogue and matches, but was never here.
	never, info := wpsSearch(t, svc, otWarehouse, "ungu", 1, 20)
	if len(never) != 0 || info.GetTotalItems() != 0 {
		t.Fatalf("ungu = %v (total %d), want nothing — never stocked here", wpsIDs(never), info.GetTotalItems())
	}
}

// Pages of one walk the matches in order; the total counts them all.
func TestWarehouseProductSearch_Pages(t *testing.T) {
	svc := wpsStocked(t)

	first, info := wpsSearch(t, svc, otWarehouse, "kaos", 1, 1)
	second, _ := wpsSearch(t, svc, otWarehouse, "kaos", 2, 1)
	past, _ := wpsSearch(t, svc, otWarehouse, "kaos", 3, 1)

	if !slices.Equal(wpsIDs(first), []uint64{otKaosHitam}) || !slices.Equal(wpsIDs(second), []uint64{otKaosPolos}) {
		t.Fatalf("pages = %v then %v, want Kaos Hitam then Kaos Polos", wpsIDs(first), wpsIDs(second))
	}

	if len(past) != 0 {
		t.Fatalf("page 3 = %v, want nothing", wpsIDs(past))
	}

	if info.GetTotalItems() != 2 || info.GetTotalPage() != 2 || info.GetCurrentPage() != 1 {
		t.Fatalf("page info = %+v, want 2 items over 2 pages", info)
	}
}

// A warehouse that has held nothing answers nothing — whatever is typed, and with nothing typed.
func TestWarehouseProductSearch_NothingHeld(t *testing.T) {
	svc := wpsStocked(t)

	const empty uint64 = 77

	for _, q := range []string{"kaos", "k", ""} {
		items, info := wpsSearch(t, svc, empty, q, 1, 20)
		if len(items) != 0 || info.GetTotalItems() != 0 {
			t.Fatalf("an empty warehouse found %v for %q (total %d), want nothing", wpsIDs(items), q, info.GetTotalItems())
		}
	}
}

// NO TWO-LETTER MINIMUM (a-product-picker-needs-no-two-letters). Opened with nothing typed, the picker lists its first
// page — everything this warehouse has held, by name, and only that (Gudang 6's Kaos Kuning and the never-stocked Kaos
// Ungu stay out); spaces alone are nothing typed. ONE letter is a search: "p" narrows to Kaos Polos, padded or not.
func TestWarehouseProductSearch_NoTwoLetterMinimum(t *testing.T) {
	svc := wpsStocked(t)

	for _, q := range []string{"", "   "} {
		items, info := wpsSearch(t, svc, otWarehouse, q, 1, 20)
		if !slices.Equal(wpsIDs(items), []uint64{otKaosHitam, otKaosPolos}) {
			t.Fatalf("%q in Gudang 5 = %v, want its whole held set by name — Kaos Hitam, Kaos Polos", q, wpsIDs(items))
		}

		if info.GetTotalItems() != 2 {
			t.Fatalf("%q total = %d, want 2", q, info.GetTotalItems())
		}
	}

	// The first page is a page: one at a time walks the held set in order.
	first, info := wpsSearch(t, svc, otWarehouse, "", 1, 1)
	if !slices.Equal(wpsIDs(first), []uint64{otKaosHitam}) || info.GetTotalPage() != 2 {
		t.Fatalf("first page of 1 = %v over %d pages, want Kaos Hitam of 2", wpsIDs(first), info.GetTotalPage())
	}

	for _, q := range []string{"p", " p "} {
		items, info := wpsSearch(t, svc, otWarehouse, q, 1, 20)
		if !slices.Equal(wpsIDs(items), []uint64{otKaosPolos}) || info.GetTotalItems() != 1 {
			t.Fatalf("%q = %v (total %d), want Kaos Polos alone — one letter searches", q, wpsIDs(items), info.GetTotalItems())
		}
	}

	// One letter matching both, by name.
	both, _ := wpsSearch(t, svc, otWarehouse, "k", 1, 20)
	if !slices.Equal(wpsIDs(both), []uint64{otKaosHitam, otKaosPolos}) {
		t.Fatalf("k = %v, want Kaos Hitam, Kaos Polos", wpsIDs(both))
	}

	// Gudang 6, opened empty, lists its own and nothing of Gudang 5's.
	other, _ := wpsSearch(t, svc, wpsOther, "", 1, 20)
	if !slices.Equal(wpsIDs(other), []uint64{wpsKaosKunin}) {
		t.Fatalf("Gudang 6 opened empty = %v, want only Kaos Kuning", wpsIDs(other))
	}
}

// The CONTRACT agrees: the request's validation (the interceptor's, run here directly) takes an empty term and one
// letter, and still refuses a term past 100 characters.
func TestWarehouseProductSearch_ContractTakesAnyShortTerm(t *testing.T) {
	request := func(q string) *inventoryv1.WarehouseProductSearchRequest {
		return &inventoryv1.WarehouseProductSearchRequest{
			WarehouseId: otWarehouse,
			Filter:      &inventoryv1.WarehouseProductSearchFilter{Q: q},
			Page:        &commonv1.CommonPagination{Page: 1, Limit: 10},
		}
	}

	for _, q := range []string{"", "k"} {
		err := protovalidate.GlobalValidator.Validate(request(q))
		if err != nil {
			t.Fatalf("%q refused by the contract: %v", q, err)
		}
	}

	err := protovalidate.GlobalValidator.Validate(request(strings.Repeat("k", 101)))
	if err == nil {
		t.Fatal("a 101-character term passed the contract, want it refused")
	}
}

// With no product_service to ask, the search fails loudly rather than reading as "held none of it".
func TestWarehouseProductSearch_NoProductServiceIsUnavailable(t *testing.T) {
	db := san_testdb.DB(t)
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	rak := newRack(t, svc, otWarehouse, "rak-a")
	otRestock(t, svc, otMelati, otKaosHitam, 1, 10000, []*inventoryv1.RestockPlacement{{PlacementId: rak, Quantity: 1}})

	_, err := svc.WarehouseProductSearch(ctxAs(41, otWarehouse, role_basev1.Role_ROLE_WAREHOUSE_STAFF), connect.NewRequest(
		&inventoryv1.WarehouseProductSearchRequest{
			WarehouseId: otWarehouse,
			Filter:      &inventoryv1.WarehouseProductSearchFilter{Q: "kaos"},
			Page:        &commonv1.CommonPagination{Page: 1, Limit: 20},
		},
	))

	var connectErr *connect.Error
	if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeUnavailable {
		t.Fatalf("err = %v, want Unavailable", err)
	}
}

// WHO may pick (a-warehouse-picks-only-what-it-has-held): Root, the Administrator and the warehouse's Owner, Admin and
// Staff — scoped to the warehouse, a read. No selling role: a seller has ProductDiscover. And ProductDiscover is NOT
// widened to the warehouse roles.
func TestWarehouseProductSearch_PolicyIsTheWarehouses(t *testing.T) {
	policyOf := func(name string) []role_basev1.Role {
		t.Helper()

		desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName(name))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
		if policy == nil {
			t.Fatalf("%s has no policy", name)
		}

		return policy.GetRoles()
	}

	got := policyOf("warehouse.inventory.v1.WarehouseProductSearchRequest")

	for _, role := range []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	} {
		if !slices.Contains(got, role) {
			t.Errorf("WarehouseProductSearch is closed to %s", role)
		}
	}

	for _, role := range []role_basev1.Role{
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
		role_basev1.Role_ROLE_SELLING_CS,
	} {
		if slices.Contains(got, role) {
			t.Errorf("WarehouseProductSearch is open to %s — a seller discovers, it does not pick a warehouse's", role)
		}
	}

	discover := policyOf("warehouse.product.v1.ProductDiscoverRequest")
	for _, role := range []role_basev1.Role{
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	} {
		if slices.Contains(discover, role) {
			t.Errorf("ProductDiscover was widened to %s — a warehouse never browses every team's catalogue", role)
		}
	}

	scope, ok := san_auth.ScopeOf(&inventoryv1.WarehouseProductSearchRequest{WarehouseId: otWarehouse})
	if !ok || scope != otWarehouse {
		t.Fatalf("scope = %d, %v — want the warehouse_id", scope, ok)
	}

	method := inventoryv1.File_warehouse_inventory_v1_inventory_proto.
		Services().
		ByName("InventoryService").
		Methods().
		ByName("WarehouseProductSearch")

	options, _ := method.Options().(*descriptorpb.MethodOptions)
	if options.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatalf("WarehouseProductSearch is not marked NO_SIDE_EFFECTS — staff, the monitor and an agent read it")
	}
}
