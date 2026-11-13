package inventory_v1

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// WarehouseTransferReceivedCountCorrect is KOREKSI JUMLAH TERIMA on a transfer: warehouse B's Owner or Admin — or Root /
// the System Administrator, stamped an override — corrects an ACCEPTED transfer's arrived count, with a reason; it
// posts at once (the-warehouse-corrects-a-wrong-stock-in-alone). The rules are the restock's
// (RestockReceivedCountCorrect) with what was SENT as the line's ceiling.
//
// A transfer line may have several batches at B — one per source layer (the-receiver-mints-one-batch-per-source-batch)
// — so the units move AS IF THE COUNT HAD BEEN TYPED RIGHT AT THE ACCEPT: the good units fill the oldest layers, so
// units out leave the newest good layers' batches and units in fill the next layers' (the-system-fills-a-transfers-
// prices); a layer with no batch at B yet is minted at its own price, supplier and expiry. Each batch it moves is one
// correction row. At the batches' prices (a-stock-in-correction-keeps-the-batch-price).
//
// In ONE stock transaction, the transfer row locked first (the lock every transfer status change takes): the
// `adjustment` transaction and its batch and rack rows, the line's arrived count and the correction rows — and, through
// the batch rows, the Transfer metric's received on the CORRECTION's day, signed
// (a-received-count-correction-counts-on-its-own-day). No event: no supplier figure and no Team Balance reads a transfer
// door (the-selling-team-bears-broken-missing-and-lost).
func (s *Service) WarehouseTransferReceivedCountCorrect(
	ctx context.Context,
	req *connect.Request[inventoryv1.WarehouseTransferReceivedCountCorrectRequest],
) (*connect.Response[inventoryv1.WarehouseTransferReceivedCountCorrectResponse], error) {
	warehouseID := req.Msg.GetTeamId()

	reason, err := countReason(req.Msg.GetReason())
	if err != nil {
		return nil, transferCountErr(err)
	}

	err = countLines(req.Msg.GetLines())
	if err != nil {
		return nil, transferCountErr(err)
	}

	actor := actorFrom(ctx)
	override := overrideFrom(ctx)

	err = inventory_ledgers.StockTransaction(s.db.WithContext(ctx), func(tx *gorm.DB) error {
		// THE TRANSFER ROW, FOR UPDATE, as B — two corrections queue here; the second is judged stale.
		t, lockErr := lockTransfer(tx, req.Msg.GetTransferId(), warehouseID, sideReceiver)
		if lockErr != nil {
			return lockErr
		}

		if t.Status != models.TransferAccepted || t.OutboundTransactionID == nil || t.InboundTransactionID == nil {
			return fmt.Errorf("%w: this transfer is %s", errCountNotAccepted, t.Status)
		}

		var items []models.WarehouseTransferItem

		loadErr := tx.Where("transfer_id = ?", t.ID).Order("id").Find(&items).Error
		if loadErr != nil {
			return loadErr
		}

		byID := make(map[uint64]*models.WarehouseTransferItem, len(items))
		for i := range items {
			byID[items[i].ID] = &items[i]
		}

		broken, brokenErr := transferBroken(tx, t.ID)
		if brokenErr != nil {
			return brokenErr
		}

		racks := make([]uint64, 0, len(req.Msg.GetLines()))

		for _, line := range req.Msg.GetLines() {
			item := byID[line.GetItemId()]
			if item == nil {
				return errCountLineUnknown
			}

			judgeErr := judgeCountLine(line, item.ProductCode, item.ArrivedCount, broken[item.ProductID], item.Count, "sent")
			if judgeErr != nil {
				return judgeErr
			}

			racks = append(racks, line.GetPlacementId())
		}

		exists, rackErr := racksExist(tx, warehouseID, racks)
		if rackErr != nil {
			return rackErr
		}

		if !exists {
			return errRackMissing
		}

		layers, layerErr := transferLineLayers(tx, t, items, broken)
		if layerErr != nil {
			return layerErr
		}

		correction := inventory_mutations.CountCorrection{
			WarehouseID: t.ToWarehouseID,
			TeamID:      t.TeamID,
			ChangeType:  models.ChangeTransferCorrection,
			ActorID:     actor,
			IsOverride:  override,
			Reason:      reason,
		}

		for _, line := range req.Msg.GetLines() {
			item := byID[line.GetItemId()]
			b := broken[item.ProductID]

			correction.Lines = append(correction.Lines, inventory_mutations.CountLine{
				ProductID:   item.ProductID,
				PlacementID: line.GetPlacementId(),
				Pieces: inventory_mutations.TransferCorrectionPieces(layers[item.ProductID],
					item.ArrivedCount-b, line.GetReceivedCount()-b),
			})
		}

		posted, done, postErr := inventory_mutations.PostCountCorrection(tx, correction)
		if postErr != nil {
			return postErr
		}

		at := inventory_ledgers.TxNow(tx)

		var written []models.WarehouseTransferCountCorrection

		ids := make([]int64, 0, len(done))
		counts := make([]int64, 0, len(done))

		for i, line := range req.Msg.GetLines() {
			item := byID[line.GetItemId()]

			for _, piece := range done[i].Pieces {
				written = append(written, models.WarehouseTransferCountCorrection{
					TransferID:     t.ID,
					TransferItemID: item.ID,
					ProductID:      item.ProductID,
					WarehouseID:    t.ToWarehouseID,
					TeamID:         t.TeamID,
					TransactionID:  posted.ID,
					BatchID:        piece.BatchID,
					LayerBatchID:   piece.LayerBatchID,
					PlacementID:    line.GetPlacementId(),
					FromCount:      item.ArrivedCount,
					ToCount:        line.GetReceivedCount(),
					UnitsOut:       piece.UnitsOut,
					PriceUnit:      piece.PriceUnit,
					Total:          piece.Total,
					Reason:         reason,
					ActorUserID:    actor,
					IsOverride:     override,
					CreatedAt:      at,
				})
			}

			ids = append(ids, int64(item.ID))
			counts = append(counts, line.GetReceivedCount())
		}

		updateErr := tx.Exec(`
			UPDATE warehouse_transfer_items AS i
			SET arrived_count = v.arrived_count
			FROM unnest(CAST(? AS bigint[]), CAST(? AS bigint[])) AS v(id, arrived_count)
			WHERE i.id = v.id`,
			int64Array(ids), int64Array(counts),
		).Error
		if updateErr != nil {
			return updateErr
		}

		return tx.Create(&written).Error
	})
	if err != nil {
		return nil, transferCountErr(err)
	}

	wire, err := s.transferDetail(s.db.WithContext(ctx), req.Msg.GetTransferId(), warehouseID)
	if err != nil {
		return nil, transferErr(err)
	}

	return connect.NewResponse(&inventoryv1.WarehouseTransferReceivedCountCorrectResponse{Transfer: wire}), nil
}

// transferCountErr maps a transfer correction's refusal: its own first, then the transfer's.
func transferCountErr(err error) error {
	if mapped := countRefusal(err); mapped != nil {
		return mapped
	}

	return transferErr(err)
}

// transferBroken is each product's broken units at B's door — the accept's broken rows. ONE statement.
func transferBroken(tx *gorm.DB, transferID uint64) (map[uint64]int64, error) {
	var rows []struct {
		ProductID uint64
		Count     int64
	}

	err := tx.
		Table("warehouse_transfer_problem_items").
		Select("product_id, count").
		Where("transfer_id = ? AND problem_type = ?", transferID, models.TransferProblemBroken).
		Scan(&rows).
		Error
	if err != nil {
		return nil, err
	}

	out := make(map[uint64]int64, len(rows))
	for _, r := range rows {
		out[r.ProductID] += r.Count
	}

	return out, nil
}

// transferLineLayers is every line's layers with their batches at B (inventory_mutations.TransferLayers): the accept's
// good units per product — the first correction's "from" when the line was corrected, else its count now — and the
// batches earlier corrections minted for a layer. Three statements.
func transferLineLayers(
	tx *gorm.DB,
	t *models.WarehouseTransfer,
	items []models.WarehouseTransferItem,
	broken map[uint64]int64,
) (map[uint64][]inventory_mutations.LineLayer, error) {
	var prior []models.WarehouseTransferCountCorrection

	err := tx.Where("transfer_id = ?", t.ID).Order("id").Find(&prior).Error
	if err != nil {
		return nil, err
	}

	acceptArrived := map[uint64]int64{}
	corrected := map[uint64]map[uint64]uint64{}

	for _, row := range prior {
		if _, seen := acceptArrived[row.ProductID]; !seen {
			acceptArrived[row.ProductID] = row.FromCount
		}

		if corrected[row.ProductID] == nil {
			corrected[row.ProductID] = map[uint64]uint64{}
		}

		if _, seen := corrected[row.ProductID][row.LayerBatchID]; !seen {
			corrected[row.ProductID][row.LayerBatchID] = row.BatchID
		}
	}

	acceptGood := make(map[uint64]int64, len(items))

	for i := range items {
		arrived, ok := acceptArrived[items[i].ProductID]
		if !ok {
			arrived = items[i].ArrivedCount
		}

		acceptGood[items[i].ProductID] = arrived - broken[items[i].ProductID]
	}

	return inventory_mutations.TransferLayers(tx, *t.OutboundTransactionID, *t.InboundTransactionID, acceptGood, corrected)
}
