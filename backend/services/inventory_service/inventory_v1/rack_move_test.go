package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// RackMove is a prototype until design_accept: it must answer Unimplemented, and never quietly succeed by doing
// nothing. The backend step replaces this test with the real one.
func TestRackMove_IsUnimplementedUntilTheBackendStep(t *testing.T) {
	svc := inventory_v1.NewService(nil, nil, nil, nil, nil)

	_, err := svc.RackMove(context.Background(), connect.NewRequest(&inventoryv1.RackMoveRequest{}))
	if connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("RackMove: want Unimplemented, got %v", err)
	}
}
