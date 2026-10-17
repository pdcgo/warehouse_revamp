package inventory_v1

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// WarehouseTransferAccept is warehouse B counting the box in: shipped or arrived → accepted, once
// (a-transfer-is-locked-before-any-status-change). Accepting IS the count — every line exactly once: what is in the box,
// how many of those are broken, where the good units went. Sent but not in the box is MISSING
// (broken-and-missing-at-the-door-are-problem-rows); both are the selling team's
// (the-selling-team-bears-broken-missing-and-lost).
//
// In one database transaction, after the transfer row's lock: the in-leg mints one batch at B per source batch
// (the-receiver-mints-one-batch-per-source-batch), the problem rows are priced from the layers they came off, and the
// courier's charge is saved on the transfer. After commit, Warehouse Transfer Accepted carries the charge to balance
// (balance-posts-the-transfers-on-site-debt-from-the-event) — the accept never writes balance itself.
func (s *Service) WarehouseTransferAccept(
	ctx context.Context,
	req *connect.Request[inventoryv1.WarehouseTransferAcceptRequest],
) (*connect.Response[inventoryv1.WarehouseTransferAcceptResponse], error) {
	msg := req.Msg
	warehouseID := msg.GetTeamId()
	actor := actorFrom(ctx)

	charge := msg.GetWarehouseAdditionalCost()
	if charge > 0 && msg.GetWarehouseAdditionalCostNote() == "" {
		return nil, transferErr(errTransferChargeNoteNeeded)
	}

	counted := make(map[uint64]*inventoryv1.WarehouseTransferCountedLine, len(msg.GetLines()))
	for _, line := range msg.GetLines() {
		if counted[line.GetItemId()] != nil {
			return nil, transferErr(errTransferCountEveryLine)
		}

		counted[line.GetItemId()] = line
	}

	var t *models.WarehouseTransfer

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var lockErr error

		t, lockErr = lockTransfer(tx, msg.GetTransferId(), warehouseID, sideReceiver)
		if lockErr != nil {
			return lockErr
		}

		// From lost the box is signed for first (a-transfer-is-locked-before-any-status-change).
		statusErr := requireStatus(t, "accepted", models.TransferShipped, models.TransferArrived)
		if statusErr != nil {
			return statusErr
		}

		var items []models.WarehouseTransferItem

		loadErr := tx.Where("transfer_id = ?", t.ID).Order("id").Find(&items).Error
		if loadErr != nil {
			return loadErr
		}

		in, problemNotes, buildErr := countedLines(tx, warehouseID, items, counted)
		if buildErr != nil {
			return buildErr
		}

		in.WarehouseID = warehouseID
		in.TeamID = t.TeamID
		if t.OutboundTransactionID == nil {
			return fmt.Errorf("transfer %d has no out-leg", t.ID)
		}

		in.OutboundTransactionID = *t.OutboundTransactionID
		in.ActorID = actor
		in.Description = transferLegDescription(t.ID)

		leg, problems, postErr := inventory_mutations.PostTransferIn(tx, in)
		if postErr != nil {
			return postErr
		}

		// Every line's count in ONE statement.
		ids := make([]int64, 0, len(items))
		arrived := make([]int64, 0, len(items))

		for i := range items {
			items[i].ArrivedCount = counted[items[i].ID].GetArrivedCount()
			ids = append(ids, int64(items[i].ID))
			arrived = append(arrived, items[i].ArrivedCount)
		}

		updateErr := tx.Exec(`
			UPDATE warehouse_transfer_items AS i
			SET arrived_count = v.arrived_count
			FROM unnest(CAST(? AS bigint[]), CAST(? AS bigint[])) AS v(id, arrived_count)
			WHERE i.id = v.id`,
			int64Array(ids), int64Array(arrived),
		).Error
		if updateErr != nil {
			return updateErr
		}

		if len(problems) > 0 {
			rows := make([]models.WarehouseTransferProblemItem, 0, len(problems))
			for _, p := range problems {
				rows = append(rows, models.WarehouseTransferProblemItem{
					TransferID:  t.ID,
					ProductID:   p.ProductID,
					ProblemType: p.Type,
					Note:        problemNotes[problemKey{p.ProductID, p.Type}],
					Count:       p.Count,
					PriceUnit:   p.Total / float64(p.Count),
					Total:       p.Total,
				})
			}

			createErr := tx.Create(&rows).Error
			if createErr != nil {
				return createErr
			}
		}

		t.InboundTransactionID = &leg.ID
		t.WarehouseAdditionalCost = charge
		t.WarehouseAdditionalCostNote = msg.GetWarehouseAdditionalCostNote()

		return moveTransfer(tx, t, models.TransferAccepted, actor, "", map[string]any{
			"inbound_transaction_id":         leg.ID,
			"warehouse_additional_cost":      t.WarehouseAdditionalCost,
			"warehouse_additional_cost_note": t.WarehouseAdditionalCostNote,
		})
	})
	if err != nil {
		return nil, transferErr(err)
	}

	s.publishTransferEvent(ctx, transferAcceptedEvent(t))

	wire, err := transferForWire(s.db.WithContext(ctx), t.ID)
	if err != nil {
		return nil, transferErr(err)
	}

	return connect.NewResponse(&inventoryv1.WarehouseTransferAcceptResponse{Transfer: wire}), nil
}

type problemKey struct {
	productID uint64
	kind      models.TransferProblemType
}

// countedLines checks B's count against the transfer's lines — every line exactly once, never more in the box than was
// sent, never more broken than arrived, the good units all put away on B's own racks — and turns it into the in-leg's
// lines and the problem rows' notes.
func countedLines(
	tx *gorm.DB,
	warehouseID uint64,
	items []models.WarehouseTransferItem,
	counted map[uint64]*inventoryv1.WarehouseTransferCountedLine,
) (inventory_mutations.TransferIn, map[problemKey]string, error) {
	var in inventory_mutations.TransferIn

	notes := map[problemKey]string{}

	if len(counted) != len(items) {
		return in, nil, errTransferCountEveryLine
	}

	racks := map[uint64]bool{}

	for _, item := range items {
		line := counted[item.ID]
		if line == nil {
			return in, nil, errTransferCountEveryLine
		}

		arrived, broken := line.GetArrivedCount(), line.GetBrokenCount()

		if arrived > item.Count {
			return in, nil, fmt.Errorf("%w: %s — %d in the box, %d sent", errTransferCountInvalid, item.SKU, arrived, item.Count)
		}

		if broken > arrived {
			return in, nil, fmt.Errorf("%w: %s — %d broken, %d in the box", errTransferCountInvalid, item.SKU, broken, arrived)
		}

		good := arrived - broken

		out := inventory_mutations.TransferInLine{
			ProductID: item.ProductID,
			Good:      good,
			Broken:    broken,
			Missing:   item.Count - arrived,
		}

		var placed int64
		for _, p := range line.GetPlacements() {
			placed += p.GetQuantity()
			racks[p.GetPlacementId()] = true

			out.Placements = append(out.Placements, inventory_mutations.RestockPlacement{
				PlacementID: p.GetPlacementId(), Count: p.GetQuantity(),
			})
		}

		if placed != good {
			return in, nil, fmt.Errorf("%w: %s — %d good units, %d put away", errTransferCountInvalid, item.SKU, good, placed)
		}

		notes[problemKey{item.ProductID, models.TransferProblemBroken}] = line.GetBrokenNote()
		notes[problemKey{item.ProductID, models.TransferProblemMissing}] = line.GetMissingNote()

		in.Lines = append(in.Lines, out)
	}

	// Every rack is B's and in use — another warehouse's reads as NotFound. One statement for all of them.
	ids := make([]uint64, 0, len(racks))
	for rack := range racks {
		ids = append(ids, rack)
	}

	exists, err := racksExist(tx, warehouseID, ids)
	if err != nil {
		return in, nil, err
	}

	if !exists {
		return in, nil, errRackMissing
	}

	return in, notes, nil
}
