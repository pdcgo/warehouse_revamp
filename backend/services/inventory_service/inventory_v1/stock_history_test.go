package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

var (
	rootOutsideRole = role_basev1.Role_ROLE_UNSPECIFIED
	staffRole       = role_basev1.Role_ROLE_WAREHOUSE_STAFF
	sellerRole      = role_basev1.Role_ROLE_SELLING_ADMIN
)

// wantOverrideByActor checks a history's stamp row by row: Root's stock-in reads is_override, the staff's does not, and
// both kinds are on the page — so a read that dropped the field, or set it for everyone, fails.
func wantOverrideByActor(t *testing.T, read string, actors []uint64, overrides []bool) {
	t.Helper()

	var seenRoot, seenStaff bool

	for i, actor := range actors {
		want := actor == ovRoot
		if overrides[i] != want {
			t.Errorf("%s row %d by %d: is_override = %v, want %v", read, i, actor, overrides[i], want)
		}

		seenRoot = seenRoot || actor == ovRoot
		seenStaff = seenStaff || actor == 31
	}

	if !seenRoot || !seenStaff {
		t.Fatalf("%s rows by %v, want Root's stock-in and the staff's", read, actors)
	}
}

// THE PRODUCT'S STOCK HISTORY READS THE OVERRIDE STAMP (an-override-shows-a-platform-badge): a movement whose inventory
// transaction Root made from outside the warehouse says so — the "by Root team" badge in the By column.
func TestStockHistory_ReadsTheOverrideStamp(t *testing.T) {
	db := san_testdb.DB(t)
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, otFacts(), nil, nil)
	rack := newRack(t, svc, otWarehouse, "rak-a")

	// Root raises the first and the warehouse's staff count it in; the seller raises the second and Root, from outside
	// the warehouse, counts it in — so one stock-in transaction is the staff's and the other an override.
	restockAs(t, svc, ctxAs(ovRoot, otMelati, rootOutsideRole), ctxAs(31, otWarehouse, staffRole), rack)
	restockAs(t, svc, ctxAs(8, otMelati, sellerRole), ctxAs(ovRoot, otWarehouse, rootOutsideRole), rack)

	res, err := svc.StockHistory(ctxUser(1), connect.NewRequest(&inventoryv1.StockHistoryRequest{
		WarehouseId: otWarehouse,
		Filter:      &inventoryv1.StockHistoryFilter{ProductId: otKaosHitam},
		Page:        page1(),
	}))
	if err != nil {
		t.Fatalf("StockHistory: %v", err)
	}

	var (
		actors    []uint64
		overrides []bool
	)

	for _, m := range stockHistoryRows(res.Msg) {
		actors = append(actors, m.GetActorUserId())
		overrides = append(overrides, m.GetIsOverride())
	}

	wantOverrideByActor(t, "StockHistory", actors, overrides)
}
