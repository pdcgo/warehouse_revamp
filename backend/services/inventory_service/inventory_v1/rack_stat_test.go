package inventory_v1_test

import (
	"context"
	"slices"
	"testing"
	"time"

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

// rackStat is the read under test, sugar for the request.
func rackStat(t *testing.T, svc *inventory_v1.Service, warehouse uint64, q string) *inventoryv1.RackPreview {
	t.Helper()

	res, err := svc.RackStat(context.Background(), connect.NewRequest(&inventoryv1.RackStatRequest{
		TeamId: warehouse,
		Filter: &inventoryv1.RackListFilter{Q: q},
	}))
	if err != nil {
		t.Fatalf("RackStat %q: %v", q, err)
	}

	return res.Msg.GetPreview()
}

// pagedFigures walks RackList page by page, as the screen would, and adds up what each page's STOCK slice says — the
// figures the strip showed before RackStat, but over every page. RackStat must equal them exactly.
func pagedFigures(t *testing.T, svc *inventory_v1.Service, warehouse uint64, q string) (racks, filled, stock int64) {
	t.Helper()

	for page := uint32(1); ; page++ {
		res, err := svc.RackList(context.Background(), connect.NewRequest(&inventoryv1.RackListRequest{
			TeamId: warehouse,
			Filter: &inventoryv1.RackListFilter{Q: q},
			DataRequest: []inventoryv1.RackListDataType{
				inventoryv1.RackListDataType_RACK_LIST_DATA_TYPE_RACK,
				inventoryv1.RackListDataType_RACK_LIST_DATA_TYPE_STOCK,
			},
			Page: &commonv1.CommonPagination{Page: page, Limit: 20},
		}))
		if err != nil {
			t.Fatalf("RackList page %d: %v", page, err)
		}

		totals := rackStockTotals(res.Msg)
		for _, id := range res.Msg.GetIds() {
			racks++
			if totals[id].stock > 0 {
				filled++
			}
			stock += totals[id].stock
		}

		if uint64(page)*20 >= res.Msg.GetPageInfo().GetTotalItems() {
			return racks, filled, stock
		}
	}
}

// THE FIGURES ARE THE WHOLE LIST'S, NOT THE PAGE'S (the-rack-list-leads-with-its-figures). 23 racks, 20 a page: a rack
// with stock on page 2 is in Terisi and Stok di rak, the empties on page 2 are in Kosong. A level that fell to 0 leaves
// its rack empty; another warehouse's racks and stock, and a deleted rack, are never in them.
func TestRackStat_FiguresOverTheWholeList(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const warehouse uint64 = 5

	full := insertRack(t, db, warehouse, "A-01-1")
	zeroed := insertRack(t, db, warehouse, "A-01-2")
	for _, code := range []string{
		"B-01-1", "B-01-2", "B-01-3", "B-01-4", "B-01-5", "B-01-6", "B-01-7", "B-01-8", "B-01-9", "B-02-1",
		"B-02-2", "B-02-3", "B-02-4", "B-02-5", "B-02-6", "B-02-7", "B-02-8", "B-02-9", "B-03-1", "B-03-2",
	} {
		insertRack(t, db, warehouse, code)
	}
	// Past the first page of 20, ordered by code.
	last := insertRack(t, db, warehouse, "Z-99-1")
	elsewhere := insertRack(t, db, 6, "A-01-1")

	seedLevel(t, db, warehouse, 71, &full, 12)
	seedLevel(t, db, warehouse, 73, &full, 5)
	seedLevel(t, db, warehouse, 74, &zeroed, 0)
	seedLevel(t, db, warehouse, 75, &last, 7)
	seedLevel(t, db, 6, 71, &elsewhere, 40)

	// A rack taken out of use is not a rack of the list.
	gone := insertRack(t, db, warehouse, "C-00-1")
	err := db.Exec("UPDATE placements SET deleted_at = ? WHERE id = ?", time.Now(), gone).Error
	if err != nil {
		t.Fatalf("delete rack: %v", err)
	}

	got := rackStat(t, svc, warehouse, "")

	if got.GetRackCount() != 23 || got.GetFilledCount() != 2 || got.GetEmptyCount() != 21 || got.GetStockCount() != 24 {
		t.Fatalf("stat = %+v, want 23 racks · 2 filled · 21 empty · 24 pcs", got)
	}

	// The page the screen used to sum held only the first 20 — the stat must not be that.
	first, err := svc.RackList(context.Background(), connect.NewRequest(&inventoryv1.RackListRequest{
		TeamId:      warehouse,
		DataRequest: []inventoryv1.RackListDataType{inventoryv1.RackListDataType_RACK_LIST_DATA_TYPE_STOCK},
		Page:        &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("RackList: %v", err)
	}
	if int64(first.Msg.GetPageInfo().GetTotalItems()) != got.GetRackCount() {
		t.Fatalf("rack_count %d, want the list's total %d", got.GetRackCount(), first.Msg.GetPageInfo().GetTotalItems())
	}

	// Every page of the list, summed as the screen summed one: the same three figures.
	racks, filled, stock := pagedFigures(t, svc, warehouse, "")
	if racks != got.GetRackCount() || filled != got.GetFilledCount() || stock != got.GetStockCount() {
		t.Fatalf("stat = %+v, the list's pages summed = %d racks · %d filled · %d pcs", got, racks, filled, stock)
	}
}

// A SEARCH NARROWS THE FIGURES TOO — they describe the list as it is shown, by the same code-or-name match.
func TestRackStat_TheSearchNarrowsThem(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const warehouse uint64 = 5

	full := insertRack(t, db, warehouse, "A-01-1")
	insertRack(t, db, warehouse, "A-01-2")
	bulk := insertRack(t, db, warehouse, "B-02-1")

	err := db.Exec("UPDATE placements SET name = 'Bulk shelf' WHERE id = ?", bulk).Error
	if err != nil {
		t.Fatalf("name rack: %v", err)
	}

	seedLevel(t, db, warehouse, 71, &full, 12)
	seedLevel(t, db, warehouse, 72, &bulk, 9)

	cases := []struct {
		q                            string
		racks, filled, empty, pieces int64
	}{
		{"a-01", 2, 1, 1, 12},
		{"BULK", 1, 1, 0, 9},
		{"zzz", 0, 0, 0, 0},
		{"", 3, 2, 1, 21},
	}

	for _, c := range cases {
		got := rackStat(t, svc, warehouse, c.q)
		if got.GetRackCount() != c.racks || got.GetFilledCount() != c.filled || got.GetEmptyCount() != c.empty ||
			got.GetStockCount() != c.pieces {
			t.Fatalf("q %q: stat = %+v, want %d racks · %d filled · %d empty · %d pcs",
				c.q, got, c.racks, c.filled, c.empty, c.pieces)
		}

		racks, filled, stock := pagedFigures(t, svc, warehouse, c.q)
		if racks != got.GetRackCount() || filled != got.GetFilledCount() || stock != got.GetStockCount() {
			t.Fatalf("q %q: stat = %+v, the list's pages summed = %d · %d · %d", c.q, got, racks, filled, stock)
		}
	}
}

// A warehouse with no racks reads zeros — not an error.
func TestRackStat_NoRacksIsZero(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	got := rackStat(t, svc, 5, "")
	if got.GetRackCount() != 0 || got.GetFilledCount() != 0 || got.GetEmptyCount() != 0 || got.GetStockCount() != 0 {
		t.Fatalf("stat = %+v, want all zero", got)
	}
}

// Who may ask: exactly RackList's readers — whoever reads the list reads its figures. A read: an agent and the monitor
// may call it.
func TestRackStat_Policy(t *testing.T) {
	roles := func(name protoreflect.FullName) []role_basev1.Role {
		desc, err := protoregistry.GlobalFiles.FindDescriptorByName(name)
		if err != nil {
			t.Fatal(err)
		}

		policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
		if policy == nil {
			t.Fatalf("%s has no policy", name)
		}

		return policy.GetRoles()
	}

	stat := roles("warehouse.inventory.v1.RackStatRequest")
	list := roles("warehouse.inventory.v1.RackListRequest")
	if !slices.Equal(stat, list) {
		t.Fatalf("RackStat roles = %v, want RackList's %v", stat, list)
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.RackService.RackStat")
	if err != nil {
		t.Fatal(err)
	}

	opts, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatal("RackStat must be marked NO_SIDE_EFFECTS")
	}
}
