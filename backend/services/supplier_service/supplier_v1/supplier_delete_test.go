package supplier_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// a-deleted-supplier-is-kept-for-its-figures: the row stays, marked; its stores are not touched.
func TestSupplierDelete_IsSoftAndKeepsTheStores(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mine := insertSupplier(t, db, sellingA, "Sumber")
	store := insertChannel(t, db, mine.ID, "shopee", "Sumber Official")

	_, err := svc.SupplierDelete(context.Background(), connect.NewRequest(&supplierv1.SupplierDeleteRequest{
		TeamId: sellingA, SupplierId: mine.ID,
	}))
	if err != nil {
		t.Fatalf("SupplierDelete: %v", err)
	}

	if row := loadSupplier(t, db, mine.ID); row.DeletedAt == nil {
		t.Fatal("the supplier row must stay, marked deleted")
	}

	if ch := loadChannel(t, db, store.ID); ch.DeletedAt != nil {
		t.Fatal("deleting a supplier must not mark its stores — they hide with it")
	}

	_, err = svc.SupplierDelete(context.Background(), connect.NewRequest(&supplierv1.SupplierDeleteRequest{
		TeamId: sellingA, SupplierId: mine.ID,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("second delete = %v, want NotFound", connect.CodeOf(err))
	}
}

func TestSupplierDelete_AnotherTeamsSupplierIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	theirs := insertSupplier(t, db, sellingB, "Theirs")

	_, err := svc.SupplierDelete(context.Background(), connect.NewRequest(&supplierv1.SupplierDeleteRequest{
		TeamId: sellingA, SupplierId: theirs.ID,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team delete = %v, want NotFound", connect.CodeOf(err))
	}

	if row := loadSupplier(t, db, theirs.ID); row.DeletedAt != nil {
		t.Fatal("a refused delete marked another team's supplier")
	}

	if n := countRows(t, db, &supplier_service_models.Supplier{}); n != 1 {
		t.Fatalf("rows = %d, want 1", n)
	}
}
