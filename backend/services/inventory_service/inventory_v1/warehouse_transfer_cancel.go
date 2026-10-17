package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// WarehouseTransferCancel is the SELLING team calling a transfer off — only while created, before A confirms
// (cancel-before-processed-lost-only-in-transit). The out-leg is rolled back under the same lock: every unit returns to
// the batch and the rack it left (a-rollback-reverses-its-log-rows). After commit, whatever was posted for the trip is
// returned to the account that paid it.
func (s *Service) WarehouseTransferCancel(
	ctx context.Context,
	req *connect.Request[inventoryv1.WarehouseTransferCancelRequest],
) (*connect.Response[inventoryv1.WarehouseTransferCancelResponse], error) {
	msg := req.Msg
	actor := actorFrom(ctx)

	var t *models.WarehouseTransfer

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var lockErr error

		t, lockErr = lockTransfer(tx, msg.GetTransferId(), msg.GetTeamId(), sideOwner)
		if lockErr != nil {
			return lockErr
		}

		statusErr := requireStatus(t, "cancelled", models.TransferCreated)
		if statusErr != nil {
			return statusErr
		}

		// The transfer row first, then the leg's batches, then its racks (batches-lock-before-shelves-by-id).
		if t.OutboundTransactionID != nil {
			_, rollbackErr := inventory_mutations.RollbackTake(tx, *t.OutboundTransactionID, actor)
			if rollbackErr != nil {
				return rollbackErr
			}
		}

		return moveTransfer(tx, t, models.TransferCancel, actor, msg.GetDescription(), nil)
	})
	if err != nil {
		return nil, transferErr(err)
	}

	s.publishTransferEvent(ctx, transferCancelledEvent(t))

	wire, err := transferForWire(s.db.WithContext(ctx), t.ID)
	if err != nil {
		return nil, transferErr(err)
	}

	return connect.NewResponse(&inventoryv1.WarehouseTransferCancelResponse{Transfer: wire}), nil
}
