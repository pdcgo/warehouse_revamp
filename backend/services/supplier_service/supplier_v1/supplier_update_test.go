package supplier_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// An absent field is left alone; a present one — even an empty string — is written.
func TestSupplierUpdate_WritesOnlyWhatIsSent(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	seed := supplier_service_models.Supplier{TeamID: sellingA, Name: "Sumber", Contact: "0812", Address: "Bandung"}
	if err := db.Create(&seed).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	resp, err := svc.SupplierUpdate(context.Background(), connect.NewRequest(&supplierv1.SupplierUpdateRequest{
		TeamId: sellingA, SupplierId: seed.ID, Name: proto.String("Sumber Makmur"), Contact: proto.String(""),
	}))
	if err != nil {
		t.Fatalf("SupplierUpdate: %v", err)
	}

	got := resp.Msg.GetSupplier()
	if got.GetName() != "Sumber Makmur" || got.GetContact() != "" || got.GetAddress() != "Bandung" {
		t.Fatalf("unexpected supplier after update: %+v", got)
	}
}

// Another team may READ a supplier, never write it — its update is NotFound, and nothing changes.
func TestSupplierUpdate_AnotherTeamsSupplierIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	theirs := insertSupplier(t, db, sellingB, "Theirs")

	_, err := svc.SupplierUpdate(context.Background(), connect.NewRequest(&supplierv1.SupplierUpdateRequest{
		TeamId: sellingA, SupplierId: theirs.ID, Name: proto.String("Mine now"),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team update = %v, want NotFound", connect.CodeOf(err))
	}

	if row := loadSupplier(t, db, theirs.ID); row.Name != "Theirs" {
		t.Fatalf("a refused update changed the name to %q", row.Name)
	}
}

func TestSupplierUpdate_DeletedSupplierIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	gone := insertSupplier(t, db, sellingA, "Gone")
	softDelete(t, db, &supplier_service_models.Supplier{}, gone.ID)

	_, err := svc.SupplierUpdate(context.Background(), connect.NewRequest(&supplierv1.SupplierUpdateRequest{
		TeamId: sellingA, SupplierId: gone.ID, Name: proto.String("Back"),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("deleted supplier update = %v, want NotFound", connect.CodeOf(err))
	}
}

// Sending no field at all still answers with the record — and still checks the scope.
func TestSupplierUpdate_NoFieldsReturnsTheRecord(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mine := insertSupplier(t, db, sellingA, "Sumber")

	resp, err := svc.SupplierUpdate(context.Background(), connect.NewRequest(&supplierv1.SupplierUpdateRequest{
		TeamId: sellingA, SupplierId: mine.ID,
	}))
	if err != nil {
		t.Fatalf("empty update: %v", err)
	}

	if resp.Msg.GetSupplier().GetName() != "Sumber" {
		t.Fatalf("empty update returned %+v", resp.Msg.GetSupplier())
	}

	_, err = svc.SupplierUpdate(context.Background(), connect.NewRequest(&supplierv1.SupplierUpdateRequest{
		TeamId: sellingB, SupplierId: mine.ID,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("empty cross-team update = %v, want NotFound", connect.CodeOf(err))
	}
}
