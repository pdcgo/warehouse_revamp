package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The warehouse signing for the box (a-late-lost-box-is-signed-for-as-arrived) is in the contract but has no column to
// write yet: until the restock backend step it answers Unimplemented, and it must not quietly succeed by doing nothing.
func TestRestockRequestArrive_IsUnimplementedUntilTheBackendStep(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.RestockRequestArrive(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestArriveRequest{
		TeamId: 5, RequestId: 1,
	}))
	if connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("arrive = %v, want Unimplemented", connect.CodeOf(err))
	}
}
