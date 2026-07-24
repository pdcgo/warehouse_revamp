package inventory_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// StockTransfer moves stock from one warehouse to another: a −out from the (scoped) source and a
// +in to the destination, in ONE transaction. If the source cannot cover the quantity the CHECK
// fails and the whole transfer rolls back — neither side moves.
func (s *Service) StockTransfer(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockTransferRequest],
) (*connect.Response[inventoryv1.StockTransferResponse], error) {
	from := req.Msg.GetFromWarehouseId()
	to := req.Msg.GetToWarehouseId()
	productID := req.Msg.GetProductId()
	qty := req.Msg.GetQuantity()

	if to == from {
		return nil, connect.NewError(connect.CodeInvalidArgument,
			errors.New("cannot transfer to the same warehouse"))
	}

	actor := actorFrom(ctx)

	var outMv, inMv *inventory_service_models.StockMovement

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Both legs move UNPLACED stock (#135): a transfer between warehouses says the goods left one
		// building and entered another, which is a different fact from which shelf they sat on at
		// either end. Taking it off a named rack at the source is put-away's business (#136), and
		// this deliberately does not guess a shelf for the goods it has just delivered.
		outBalance, err := applyDelta(tx, from, productID, unplaced, -qty)
		if err != nil {
			return err
		}

		outMv, err = appendMovement(tx, from, productID, unplaced, nil, -qty, outBalance,
			inventoryv1.MovementKind_MOVEMENT_KIND_TRANSFER_OUT, req.Msg.GetReason(), "", actor)
		if err != nil {
			return err
		}

		inBalance, err := applyDelta(tx, to, productID, unplaced, qty)
		if err != nil {
			return err
		}

		inMv, err = appendMovement(tx, to, productID, unplaced, nil, qty, inBalance,
			inventoryv1.MovementKind_MOVEMENT_KIND_TRANSFER_IN, req.Msg.GetReason(), "", actor)

		return err
	})
	if err != nil {
		return nil, writeError(err)
	}

	return connect.NewResponse(&inventoryv1.StockTransferResponse{
		OutMovement: movementToProto(outMv),
		InMovement:  movementToProto(inMv),
	}), nil
}
