package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// The warehouse transfer is a prototype until design_accept: every RPC must answer Unimplemented, and none may quietly
// succeed by doing nothing. The backend step deletes the prototype and this test with it.
func TestWarehouseTransfer_IsUnimplementedUntilTheBackendStep(t *testing.T) {
	svc := inventory_v1.WarehouseTransferPrototype{}
	ctx := context.Background()

	calls := map[string]func() error{
		"Create": func() error {
			_, err := svc.WarehouseTransferCreate(ctx, connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{}))
			return err
		},
		"List": func() error {
			_, err := svc.WarehouseTransferList(ctx, connect.NewRequest(&inventoryv1.WarehouseTransferListRequest{}))
			return err
		},
		"Detail": func() error {
			_, err := svc.WarehouseTransferDetail(ctx, connect.NewRequest(&inventoryv1.WarehouseTransferDetailRequest{}))
			return err
		},
		"Update": func() error {
			_, err := svc.WarehouseTransferUpdate(ctx, connect.NewRequest(&inventoryv1.WarehouseTransferUpdateRequest{}))
			return err
		},
		"Cancel": func() error {
			_, err := svc.WarehouseTransferCancel(ctx, connect.NewRequest(&inventoryv1.WarehouseTransferCancelRequest{}))
			return err
		},
		"MarkLost": func() error {
			_, err := svc.WarehouseTransferMarkLost(ctx, connect.NewRequest(&inventoryv1.WarehouseTransferMarkLostRequest{}))
			return err
		},
		"Process": func() error {
			_, err := svc.WarehouseTransferProcess(ctx, connect.NewRequest(&inventoryv1.WarehouseTransferProcessRequest{}))
			return err
		},
		"Ship": func() error {
			_, err := svc.WarehouseTransferShip(ctx, connect.NewRequest(&inventoryv1.WarehouseTransferShipRequest{}))
			return err
		},
		"Arrive": func() error {
			_, err := svc.WarehouseTransferArrive(ctx, connect.NewRequest(&inventoryv1.WarehouseTransferArriveRequest{}))
			return err
		},
		"Accept": func() error {
			_, err := svc.WarehouseTransferAccept(ctx, connect.NewRequest(&inventoryv1.WarehouseTransferAcceptRequest{}))
			return err
		},
	}

	for name, call := range calls {
		err := call()
		if connect.CodeOf(err) != connect.CodeUnimplemented {
			t.Errorf("%s = %v, want Unimplemented", name, connect.CodeOf(err))
		}
	}
}
