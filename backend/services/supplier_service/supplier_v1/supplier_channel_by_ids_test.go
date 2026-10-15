package supplier_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// A restock line names its store by id, and whoever sees the line reads the store's name: across teams (team B
// restocks from team A's store), DELETED ONES INCLUDED and marked (a-deleted-supplier-still-shows-with-a-badge), an
// unknown id simply absent.
func TestSupplierChannelByIds_CrossTeamDeletedIncluded(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	melati := insertSupplier(t, db, sellingA, "Melati")
	open := insertChannel(t, db, melati.ID, "shopee", "Toko Melati")
	closed := insertChannel(t, db, melati.ID, "tokopedia", "Melati Lama")
	softDelete(t, db, &supplier_service_models.SupplierChannel{}, closed.ID)
	unknown := closed.ID + 1000

	// Asked by the WAREHOUSE that is counting the box in — not the team that keeps the supplier.
	resp, err := svc.SupplierChannelByIds(context.Background(), connect.NewRequest(&supplierv1.SupplierChannelByIdsRequest{
		TeamId: warehouse,
		Ids:    []uint64{open.ID, closed.ID, unknown},
	}))
	if err != nil {
		t.Fatalf("SupplierChannelByIds: %v", err)
	}

	got := resp.Msg.GetChannels()
	if len(got) != 2 {
		t.Fatalf("answered %d ids, want 2", len(got))
	}

	if _, ok := got[unknown]; ok {
		t.Fatal("an unknown id must be absent")
	}

	if c := got[open.ID]; c.GetName() != "Toko Melati" || c.GetSupplierId() != melati.ID || c.GetDeleted() {
		t.Fatalf("the open store = %+v", c)
	}

	if c := got[closed.ID]; c.GetName() != "Melati Lama" || !c.GetDeleted() {
		t.Fatalf("a deleted store must come back marked, got %+v", c)
	}
}
