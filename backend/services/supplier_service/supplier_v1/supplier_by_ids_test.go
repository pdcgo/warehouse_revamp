package supplier_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// A restock names its vendor by id: ByIds answers across teams and DELETED ONES INCLUDED, marked — and an
// unknown id is simply absent.
func TestSupplierByIds_CrossTeamDeletedIncluded(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	theirs := insertSupplier(t, db, sellingB, "Theirs")
	gone := insertSupplier(t, db, sellingA, "Gone")
	softDelete(t, db, &supplier_service_models.Supplier{}, gone.ID)
	unknown := gone.ID + 1000

	resp, err := svc.SupplierByIds(context.Background(), connect.NewRequest(&supplierv1.SupplierByIdsRequest{
		TeamId: warehouse,
		Filter: &supplierv1.SupplierByIdsFilter{Ids: []uint64{theirs.ID, gone.ID, unknown}},
	}))
	if err != nil {
		t.Fatalf("SupplierByIds: %v", err)
	}

	items := resp.Msg.GetItems()
	if len(items) != 2 {
		t.Fatalf("answered %d ids, want 2", len(items))
	}

	if _, ok := items[unknown]; ok {
		t.Fatal("an unknown id must be absent")
	}

	row := func(id uint64) *supplierv1.Supplier {
		return items[id].GetItems()[0].GetSupplier().GetMapData()[id]
	}

	if r := row(theirs.ID); r.GetName() != "Theirs" || r.GetDeleted() {
		t.Fatalf("theirs = %+v", r)
	}

	if r := row(gone.ID); r.GetName() != "Gone" || !r.GetDeleted() {
		t.Fatalf("a deleted supplier must come back marked, got %+v", r)
	}
}

func TestSupplierByIds_GeneralSlice(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	s := insertSupplier(t, db, sellingA, "Sumber")

	resp, err := svc.SupplierByIds(context.Background(), connect.NewRequest(&supplierv1.SupplierByIdsRequest{
		TeamId:      sellingA,
		Filter:      &supplierv1.SupplierByIdsFilter{Ids: []uint64{s.ID}},
		DataRequest: []supplierv1.SupplierByIdsDataType{supplierv1.SupplierByIdsDataType_SUPPLIER_BY_IDS_DATA_TYPE_GENERAL},
	}))
	if err != nil {
		t.Fatalf("SupplierByIds: %v", err)
	}

	general := resp.Msg.GetItems()[s.ID].GetItems()[0].GetGeneral().GetMapData()[s.ID]
	if general.GetName() != "Sumber" {
		t.Fatalf("general slice = %+v", general)
	}
}
