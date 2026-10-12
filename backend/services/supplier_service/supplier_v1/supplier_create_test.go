package supplier_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

func TestSupplierCreate_CreatesInASellingTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	resp, err := svc.SupplierCreate(context.Background(), connect.NewRequest(&supplierv1.SupplierCreateRequest{
		TeamId: sellingA, Name: "PT Sumber Makmur", Contact: "0812", Address: "Jl. 1, Bandung", Description: "kain",
	}))
	if err != nil {
		t.Fatalf("SupplierCreate: %v", err)
	}

	got := resp.Msg.GetSupplier()
	if got.GetId() == 0 || got.GetTeamId() != sellingA || got.GetName() != "PT Sumber Makmur" || got.GetDeleted() {
		t.Fatalf("unexpected supplier: %+v", got)
	}

	if got.GetContact() != "0812" || got.GetAddress() != "Jl. 1, Bandung" || got.GetDescription() != "kain" {
		t.Fatalf("fields did not round-trip: %+v", got)
	}

	row := loadSupplier(t, db, got.GetId())
	if row.DeletedAt != nil {
		t.Fatalf("a new supplier must be live, got deleted_at %v", row.DeletedAt)
	}
}

// only-a-selling-team-has-suppliers — Root and the Administrator bypass the scope, so the handler asks.
func TestSupplierCreate_RefusesANonSellingTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.SupplierCreate(context.Background(), connect.NewRequest(&supplierv1.SupplierCreateRequest{
		TeamId: warehouse, Name: "Nope",
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("warehouse team create = %v, want FailedPrecondition", connect.CodeOf(err))
	}

	if n := countRows(t, db, &supplier_service_models.Supplier{}); n != 0 {
		t.Fatalf("a refused create wrote %d suppliers", n)
	}
}

// A team service that cannot answer refuses the create — it is never read as "selling".
func TestSupplierCreate_TeamServiceDownWritesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := supplier_v1.NewService(db, sellingTeams{err: errTeamServiceDown}, nil)

	_, err := svc.SupplierCreate(context.Background(), connect.NewRequest(&supplierv1.SupplierCreateRequest{
		TeamId: sellingA, Name: "Sumber",
	}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("team service down = %v, want Internal", connect.CodeOf(err))
	}

	if n := countRows(t, db, &supplier_service_models.Supplier{}); n != 0 {
		t.Fatalf("a refused create wrote %d suppliers", n)
	}
}

// With no team service wired at all, every create is refused rather than trusted.
func TestSupplierCreate_NoTeamServiceRefuses(t *testing.T) {
	db := san_testdb.DB(t)
	svc := supplier_v1.NewService(db, nil, nil)

	_, err := svc.SupplierCreate(context.Background(), connect.NewRequest(&supplierv1.SupplierCreateRequest{
		TeamId: sellingA, Name: "Sumber",
	}))
	if err == nil {
		t.Fatal("a create with no team service to ask must be refused")
	}
}
