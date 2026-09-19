package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// supplierFromByIds digs the Supplier row slice out of a by-ids response, or nil when the id is
// absent. Absent and present-but-empty are different answers, so the helper keeps them apart.
func supplierFromByIds(resp *inventoryv1.SupplierByIdsResponse, id uint64) *inventoryv1.Supplier {
	list, ok := resp.GetItems()[id]
	if !ok {
		return nil
	}

	for _, item := range list.GetItems() {
		row := item.GetSupplier()
		if row == nil {
			continue
		}

		if s, ok := row.GetMapData()[id]; ok {
			return s
		}
	}

	return nil
}

// The whole reason this RPC exists: a WAREHOUSE team resolves a SELLING team's supplier, which every
// other supplier read refuses. If this ever starts filtering by the caller's team, the accept screen
// silently goes back to showing "Supplier #2".
func TestSupplierByIds_ResolvesAnotherTeamsSupplier(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const sellingTeam, warehouseTeam = uint64(2), uint64(3)

	id := insertSupplier(t, db, sellingTeam, "Sinar Jaya Textile", "SJT")

	resp, err := svc.SupplierByIds(context.Background(), connect.NewRequest(&inventoryv1.SupplierByIdsRequest{
		TeamId: warehouseTeam,
		Filter: &inventoryv1.SupplierByIdsFilter{Ids: []uint64{id}},
	}))
	if err != nil {
		t.Fatalf("SupplierByIds: %v", err)
	}

	got := supplierFromByIds(resp.Msg, id)
	if got == nil {
		t.Fatalf("supplier %d absent — a warehouse must be able to name the vendor on the carton", id)
	}

	if got.GetName() != "Sinar Jaya Textile" || got.GetCode() != "SJT" {
		t.Fatalf("unexpected supplier: %+v", got)
	}

	// The row still declares who OWNS it — the caller's team is only the authorization scope.
	if got.GetTeamId() != sellingTeam {
		t.Fatalf("team_id = %d, want the owning team %d", got.GetTeamId(), sellingTeam)
	}
}

// An id that resolves to nothing is absent, never an error: one dead id must not blank a delivery.
func TestSupplierByIds_UnknownIdIsAbsentNotAnError(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	known := insertSupplier(t, db, 2, "Known", "KNW")
	const missing = uint64(9_999_999)

	resp, err := svc.SupplierByIds(context.Background(), connect.NewRequest(&inventoryv1.SupplierByIdsRequest{
		TeamId: 3,
		Filter: &inventoryv1.SupplierByIdsFilter{Ids: []uint64{known, missing}},
	}))
	if err != nil {
		t.Fatalf("SupplierByIds: %v", err)
	}

	if supplierFromByIds(resp.Msg, known) == nil {
		t.Fatalf("the known supplier should still resolve alongside a dead id")
	}

	if _, ok := resp.Msg.GetItems()[missing]; ok {
		t.Fatalf("id %d should be ABSENT from the map, not present-and-empty", missing)
	}
}

// A restock outlives its vendor record, so a retired supplier still gets named — with `deleted` on
// the wire so a caller that cares can tell. Mirrors ProductByIds returning soft-deleted products.
func TestSupplierByIds_ReturnsSoftDeletedSupplier(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertSupplier(t, db, 2, "Retired Vendor", "RET")

	err := db.
		Model(&inventory_service_models.Supplier{}).
		Where("id = ?", id).
		Update("deleted", true).
		Error
	if err != nil {
		t.Fatalf("soft-delete supplier: %v", err)
	}

	resp, err := svc.SupplierByIds(context.Background(), connect.NewRequest(&inventoryv1.SupplierByIdsRequest{
		TeamId: 3,
		Filter: &inventoryv1.SupplierByIdsFilter{Ids: []uint64{id}},
	}))
	if err != nil {
		t.Fatalf("SupplierByIds: %v", err)
	}

	got := supplierFromByIds(resp.Msg, id)
	if got == nil {
		t.Fatalf("a soft-deleted supplier must still be nameable — a past delivery still came from it")
	}

	if !got.GetDeleted() {
		t.Fatalf("deleted flag not on the wire: %+v", got)
	}
}

// The GENERAL slice is the cheap "just the name" shape, and an empty data_request defaults to the
// full SUPPLIER row rather than to nothing.
func TestSupplierByIds_DataRequestSlices(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	id := insertSupplier(t, db, 2, "Slice Vendor", "SLC")

	call := func(types []inventoryv1.SupplierByIdsDataType) *inventoryv1.SupplierByIdsResponse {
		t.Helper()

		resp, err := svc.SupplierByIds(context.Background(), connect.NewRequest(&inventoryv1.SupplierByIdsRequest{
			TeamId:      3,
			Filter:      &inventoryv1.SupplierByIdsFilter{Ids: []uint64{id}},
			DataRequest: types,
		}))
		if err != nil {
			t.Fatalf("SupplierByIds: %v", err)
		}

		return resp.Msg
	}

	if supplierFromByIds(call(nil), id) == nil {
		t.Fatalf("an empty data_request must default to the SUPPLIER row slice")
	}

	general := call([]inventoryv1.SupplierByIdsDataType{
		inventoryv1.SupplierByIdsDataType_SUPPLIER_BY_IDS_DATA_TYPE_GENERAL,
	})

	if supplierFromByIds(general, id) != nil {
		t.Fatalf("asking for GENERAL only must not carry the full row")
	}

	items := general.GetItems()[id].GetItems()
	if len(items) != 1 || items[0].GetGeneral().GetMapData()[id].GetName() != "Slice Vendor" {
		t.Fatalf("GENERAL slice did not carry the name: %+v", items)
	}
}
