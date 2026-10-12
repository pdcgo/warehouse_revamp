package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The selling team giving a parcel up (lost-is-set-only-before-the-box-arrives) is in the contract but has no column to
// write yet: until the restock backend step it answers Unimplemented, and it must not quietly succeed by doing nothing.
func TestRestockRequestMarkLost_IsUnimplementedUntilTheBackendStep(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.RestockRequestMarkLost(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestMarkLostRequest{
		TeamId: 2, RequestId: 1,
	}))
	if connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("mark lost = %v, want Unimplemented", connect.CodeOf(err))
	}
}
