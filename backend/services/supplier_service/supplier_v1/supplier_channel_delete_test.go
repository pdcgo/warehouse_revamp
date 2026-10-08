package supplier_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// a-store-delete-is-soft-too: the row stays, marked; a second delete is NotFound.
func TestSupplierChannelDelete_IsSoft(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	s := insertSupplier(t, db, sellingA, "Sumber")
	store := insertChannel(t, db, s.ID, "shopee", "Sumber Official")

	req := func() *connect.Request[supplierv1.SupplierChannelDeleteRequest] {
		return connect.NewRequest(&supplierv1.SupplierChannelDeleteRequest{TeamId: sellingA, ChannelId: store.ID})
	}

	_, err := svc.SupplierChannelDelete(context.Background(), req())
	if err != nil {
		t.Fatalf("SupplierChannelDelete: %v", err)
	}

	if row := loadChannel(t, db, store.ID); row.DeletedAt == nil {
		t.Fatal("the store row must stay, marked deleted")
	}

	_, err = svc.SupplierChannelDelete(context.Background(), req())
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("second delete = %v, want NotFound", connect.CodeOf(err))
	}
}

func TestSupplierChannelDelete_AnotherTeamsStoreIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	theirs := insertSupplier(t, db, sellingB, "Theirs")
	store := insertChannel(t, db, theirs.ID, "shopee", "Theirs")

	_, err := svc.SupplierChannelDelete(context.Background(), connect.NewRequest(&supplierv1.SupplierChannelDeleteRequest{
		TeamId: sellingA, ChannelId: store.ID,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team delete = %v, want NotFound", connect.CodeOf(err))
	}

	if row := loadChannel(t, db, store.ID); row.DeletedAt != nil {
		t.Fatal("a refused delete marked another team's store")
	}
}
