package inventory_v1

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

var (
	errMoveToItself  = errors.New("a move never ends on the rack it leaves")
	errMoveLineTwice = errors.New("a move sends a product to a rack once")
)

// RackMove moves goods off ONE rack onto one or more racks of the same warehouse (a-move-is-one-rack-to-one-or-more-racks),
// on the decided ledgers: one `move` transaction per owning team, a row per rack touched, nothing in the batch ledger,
// all in one database transaction — all or nothing (a-move-writes-two-rack-rows-and-no-batch-row, a-move-is-all-or-nothing).
// Any warehouse member may move goods (any-warehouse-member-may-move-goods). ⚠ A rack being counted will refuse a move
// once opname is built (a-lock-stops-units-moving-not-sales).
func (s *Service) RackMove(
	ctx context.Context,
	req *connect.Request[inventoryv1.RackMoveRequest],
) (*connect.Response[inventoryv1.RackMoveResponse], error) {
	msg := req.Msg
	warehouseID := msg.GetTeamId()

	move := inventory_mutations.Move{
		WarehouseID:     warehouseID,
		FromPlacementID: msg.GetFromRackId(),
		ActorID:         actorFrom(ctx),
		Description:     msg.GetDescription(),
	}

	seen := map[inventory_ledgers.RackKey]struct{}{}
	racks := map[uint64]struct{}{msg.GetFromRackId(): {}}

	for _, line := range msg.GetLines() {
		if line.GetToRackId() == msg.GetFromRackId() {
			return nil, connect.NewError(connect.CodeInvalidArgument, errMoveToItself)
		}

		key := inventory_ledgers.RackKey{ProductID: line.GetProductId(), PlacementID: line.GetToRackId()}
		if _, dup := seen[key]; dup {
			return nil, connect.NewError(connect.CodeInvalidArgument, errMoveLineTwice)
		}

		seen[key] = struct{}{}
		racks[line.GetToRackId()] = struct{}{}

		move.Lines = append(move.Lines, inventory_mutations.MoveLine{
			ProductID: line.GetProductId(), Quantity: line.GetQuantity(), ToPlacementID: line.GetToRackId(),
		})
	}

	var posted []inventory_service_models.InventoryTransaction

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Every rack of THIS warehouse and not deleted — another warehouse's reads as NotFound.
		ids := make([]uint64, 0, len(racks))
		for rack := range racks {
			ids = append(ids, rack)
		}

		exists, checkErr := racksExist(tx, warehouseID, ids)
		if checkErr != nil {
			return checkErr
		}

		if !exists {
			return errRackMissing
		}

		var postErr error

		posted, postErr = inventory_mutations.PostMove(tx, move)

		return postErr
	})
	if err != nil {
		return nil, placementErr(err)
	}

	res := &inventoryv1.RackMoveResponse{}
	for _, t := range posted {
		res.Transactions = append(res.Transactions, &inventoryv1.RackTransaction{TransactionId: t.ID, TeamId: t.TeamID})
	}

	return connect.NewResponse(res), nil
}

// placementErr maps a move's or a sample's refusal to Connect: a rack that is not the warehouse's is NotFound; a product
// not on the rack, or more units than it holds, is FailedPrecondition naming the product and both numbers
// (a-shelf-never-goes-below-zero).
func placementErr(err error) error {
	var short *inventory_ledgers.NotEnoughStockError

	switch {
	case errors.Is(err, errRackMissing):
		return connect.NewError(connect.CodeNotFound, errRackMissing)
	case errors.Is(err, inventory_mutations.ErrNotOnTheRack):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.As(err, &short):
		return connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("product %d: %d wanted, the rack holds %d", short.ProductID, short.Wanted, short.Available))
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
