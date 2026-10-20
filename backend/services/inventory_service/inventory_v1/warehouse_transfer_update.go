package inventory_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// WarehouseTransferUpdate is the SELLING team replacing the shipping cost, its paying account and the note — until the
// transfer is accepted (the-shipping-expense-reaches-the-account-by-event). A courier prices by the packed weight, so the
// cost is often typed after A has packed. The lines are never edited (a-transfers-lines-are-never-edited), and an edit
// is not a status change, so it writes no trail row. An edit that moved money is announced after commit, carrying both
// sides.
func (s *Service) WarehouseTransferUpdate(
	ctx context.Context,
	req *connect.Request[inventoryv1.WarehouseTransferUpdateRequest],
) (*connect.Response[inventoryv1.WarehouseTransferUpdateResponse], error) {
	msg := req.Msg
	actor := actorFrom(ctx)

	if msg.GetShipmentCost() > 0 && msg.GetFinanceAccountId() == 0 {
		return nil, transferErr(errTransferAccountRequired)
	}

	account := msg.GetFinanceAccountId()
	if msg.GetShipmentCost() == 0 {
		account = 0
	}

	cost := msg.GetShipmentCost()

	var (
		t          *models.WarehouseTransfer
		oldAccount uint64
		oldCost    float64
		moved      bool
		at         = time.Now()
	)

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var lockErr error

		t, lockErr = lockTransfer(tx, msg.GetTransferId(), msg.GetTeamId(), sideOwner)
		if lockErr != nil {
			return lockErr
		}

		statusErr := requireStatus(t, "edited",
			models.TransferCreated, models.TransferProcess, models.TransferShipped, models.TransferArrived, models.TransferLost)
		if statusErr != nil {
			return statusErr
		}

		oldAccount, oldCost = t.FinanceAccountID, t.ShipmentCost
		moved = oldAccount != account || !san_money.Equal(oldCost, cost)

		updates := map[string]any{
			"shipment_cost":      cost,
			"finance_account_id": account,
			"note":               msg.GetNote(),
			"updated_at":         at,
		}

		if moved {
			t.CostRevision++
			updates["cost_revision"] = t.CostRevision
		}

		t.ShipmentCost, t.FinanceAccountID, t.Note = cost, account, msg.GetNote()

		return tx.Model(t).Updates(updates).Error
	})
	if err != nil {
		return nil, transferErr(err)
	}

	if moved {
		s.publishTransferEvent(ctx, transferUpdatedEvent(t, oldAccount, oldCost, actor, at))
	}

	wire, err := transferForWire(s.db.WithContext(ctx), t.ID)
	if err != nil {
		return nil, transferErr(err)
	}

	return connect.NewResponse(&inventoryv1.WarehouseTransferUpdateResponse{Transfer: wire}), nil
}
