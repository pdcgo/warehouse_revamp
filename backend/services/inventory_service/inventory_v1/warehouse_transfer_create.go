package inventory_v1

import (
	"context"
	"fmt"
	"log/slog"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// WarehouseTransferCreate is the SELLING team opening a transfer of its own goods from A to B
// (the-team-opens-the-sender-ships-the-receiver-accepts, a-warehouse-asks-the-team-to-open-a-transfer). The out-leg is
// written in the same database transaction — A's batches oldest first, its racks holding the fewest first — and too
// few at A fails the create, writing nothing (a-transfer-takes-from-the-sender-at-create). Every price is filled from
// what the out-leg took (the-system-fills-a-transfers-prices); the products are linked to B first, outside the
// transaction (a-transfer-links-its-products-to-the-receiver). After commit, the shipping expense is announced.
func (s *Service) WarehouseTransferCreate(
	ctx context.Context,
	req *connect.Request[inventoryv1.WarehouseTransferCreateRequest],
) (*connect.Response[inventoryv1.WarehouseTransferCreateResponse], error) {
	msg := req.Msg
	teamID := msg.GetTeamId()
	actor := actorFrom(ctx)

	// The rules that span fields, which protovalidate cannot express — checked before anything else.
	if msg.GetFromWarehouseId() == msg.GetToWarehouseId() {
		return nil, transferErr(errTransferToItself)
	}

	if msg.GetShipmentCost() > 0 && msg.GetFinanceAccountId() == 0 {
		return nil, transferErr(errTransferAccountRequired)
	}

	ids := make([]uint64, 0, len(msg.GetLines()))
	seen := map[uint64]bool{}

	for _, line := range msg.GetLines() {
		if seen[line.GetProductId()] {
			return nil, transferErr(errTransferProductTwice)
		}

		seen[line.GetProductId()] = true
		ids = append(ids, line.GetProductId())
	}

	// A transfer moves the team's OWN goods. Asked before the transaction: a call to another service never runs under
	// a lock.
	facts, err := s.products.Facts(ctx, teamID, ids)
	if err != nil {
		return nil, transferErr(fmt.Errorf("ask product facts: %w", err))
	}

	for _, id := range ids {
		fact, ok := facts[id]
		if !ok || fact.TeamID != teamID {
			return nil, transferErr(fmt.Errorf("%w: product %d", errTransferProductNotOwned, id))
		}
	}

	// B's crew can find what is coming. Not critical: an upsert BEFORE the transaction that never fails the create — a
	// link says B handles the product, not that it holds any (a-transfer-links-its-products-to-the-receiver).
	linkErr := linkWarehouseProductIDs(s.db.WithContext(ctx), msg.GetToWarehouseId(), ids)
	if linkErr != nil {
		slog.WarnContext(ctx, "warehouse transfer: products not linked to the receiving warehouse",
			"warehouse_id", msg.GetToWarehouseId(),
			"error", linkErr,
		)
	}

	// The account is kept only with a cost (a-transfer-names-its-paying-account).
	account := msg.GetFinanceAccountId()
	if msg.GetShipmentCost() == 0 {
		account = 0
	}

	t := models.WarehouseTransfer{
		TeamID:           teamID,
		FromWarehouseID:  msg.GetFromWarehouseId(),
		ToWarehouseID:    msg.GetToWarehouseId(),
		Status:           models.TransferCreated,
		Note:             msg.GetNote(),
		ShipmentCost:     msg.GetShipmentCost(),
		FinanceAccountID: account,
		CreatedByUserID:  actor,
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// The row first, so the out-leg can name it; a refused take rolls it back with everything else.
		createErr := tx.Create(&t).Error
		if createErr != nil {
			return createErr
		}

		out := inventory_mutations.TransferOut{
			WarehouseID: t.FromWarehouseID,
			TeamID:      teamID,
			ActorID:     actor,
			Description: transferLegDescription(t.ID),
		}

		for _, line := range msg.GetLines() {
			out.Lines = append(out.Lines, inventory_mutations.TransferLine{ProductID: line.GetProductId(), Quantity: line.GetCount()})
		}

		leg, taken, postErr := inventory_mutations.PostTransferOut(tx, out)
		if postErr != nil {
			return postErr
		}

		value := map[uint64]float64{}
		for _, line := range taken {
			value[line.ProductID] = line.Value
			t.Total += line.Value
		}

		items := make([]models.WarehouseTransferItem, 0, len(msg.GetLines()))
		for _, line := range msg.GetLines() {
			total := value[line.GetProductId()]

			items = append(items, models.WarehouseTransferItem{
				TransferID: t.ID,
				ProductID:  line.GetProductId(),
				SKU:        facts[line.GetProductId()].SKU,
				Name:       facts[line.GetProductId()].Name,
				Count:      line.GetCount(),
				PriceUnit:  total / float64(line.GetCount()),
				Total:      total,
			})
		}

		createErr = tx.Create(&items).Error
		if createErr != nil {
			return createErr
		}

		t.OutboundTransactionID = &leg.ID

		updateErr := tx.Model(&t).Updates(map[string]any{
			"outbound_transaction_id": leg.ID,
			"total":                   t.Total,
		}).Error
		if updateErr != nil {
			return updateErr
		}

		return appendTransferLog(tx, t.ID, "", models.TransferCreated, actor, "")
	})
	if err != nil {
		return nil, transferErr(err)
	}

	s.publishTransferEvent(ctx, transferCreatedEvent(&t))

	wire, err := transferForWire(s.db.WithContext(ctx), t.ID)
	if err != nil {
		return nil, transferErr(err)
	}

	return connect.NewResponse(&inventoryv1.WarehouseTransferCreateResponse{Transfer: wire}), nil
}
