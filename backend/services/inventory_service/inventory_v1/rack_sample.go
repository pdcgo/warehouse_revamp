package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RackSample records a sample taken from one rack and handed to a person at the warehouse
// (a-sample-is-handed-over-at-the-warehouse), on the decided ledgers: a stock-out at batch value from the owner's stock,
// no money moved (a-sample-is-a-stock-out-at-batch-value); the request's rack, never one the system chooses
// (a-sample-names-the-rack-it-was-taken-from); one `sample` transaction per owning team, carrying the recipient
// (a-sample-keeps-its-recipient); never rolled back (a-handed-over-sample-is-final).
func (s *Service) RackSample(
	ctx context.Context,
	req *connect.Request[inventoryv1.RackSampleRequest],
) (*connect.Response[inventoryv1.RackSampleResponse], error) {
	msg := req.Msg
	warehouseID := msg.GetTeamId()

	sample := inventory_mutations.Sample{
		WarehouseID: warehouseID,
		PlacementID: msg.GetRackId(),
		ActorID:     actorFrom(ctx),
		Recipient:   msg.GetRecipient(),
		Description: msg.GetDescription(),
	}

	for _, line := range msg.GetLines() {
		sample.Lines = append(sample.Lines, inventory_mutations.SampleLine{ProductID: line.GetProductId(), Quantity: line.GetQuantity()})
	}

	var posted []inventory_service_models.InventoryTransaction

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		exists, checkErr := rackExists(tx, warehouseID, msg.GetRackId())
		if checkErr != nil {
			return checkErr
		}

		if !exists {
			return errRackMissing
		}

		var postErr error

		posted, postErr = inventory_mutations.PostSample(tx, sample)

		return postErr
	})
	if err != nil {
		return nil, placementErr(err)
	}

	res := &inventoryv1.RackSampleResponse{}
	for _, t := range posted {
		res.Transactions = append(res.Transactions, &inventoryv1.RackTransaction{TransactionId: t.ID, TeamId: t.TeamID})
	}

	return connect.NewResponse(res), nil
}
