package supplier_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// another-team-sees-everything-of-a-supplier: the Discover detail reads another team's supplier.
func TestSupplierDetail_ReadsAnotherTeamsSupplier(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	theirs := insertSupplier(t, db, sellingB, "Theirs")

	resp, err := svc.SupplierDetail(context.Background(), connect.NewRequest(&supplierv1.SupplierDetailRequest{
		TeamId: sellingA, SupplierId: theirs.ID,
	}))
	if err != nil {
		t.Fatalf("SupplierDetail: %v", err)
	}

	got := resp.Msg.GetSupplier()
	if got.GetId() != theirs.ID || got.GetTeamId() != sellingB || got.GetName() != "Theirs" {
		t.Fatalf("unexpected supplier: %+v", got)
	}
}

func TestSupplierDetail_DeletedOrUnknownIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	gone := insertSupplier(t, db, sellingA, "Gone")
	softDelete(t, db, &supplier_service_models.Supplier{}, gone.ID)

	for _, id := range []uint64{gone.ID, gone.ID + 1000} {
		_, err := svc.SupplierDetail(context.Background(), connect.NewRequest(&supplierv1.SupplierDetailRequest{
			TeamId: sellingA, SupplierId: id,
		}))
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("detail of %d = %v, want NotFound", id, connect.CodeOf(err))
		}
	}
}
