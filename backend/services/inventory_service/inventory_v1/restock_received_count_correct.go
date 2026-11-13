package inventory_v1

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockReceivedCountCorrect is KOREKSI JUMLAH TERIMA on a restock: the receiving warehouse's Owner or Admin — or Root /
// the System Administrator, stamped an override — corrects an ACCEPTED restock's received count, with a reason, and it
// posts at once (the-warehouse-corrects-a-wrong-stock-in-alone). Per line, at the batch's price
// (a-stock-in-correction-keeps-the-batch-price):
//
//	too many typed (20 → 18)   the 2 phantom units leave the line's batch and the rack named; they are MISSING at the
//	                           door (koreksi), borne by the selling team — never a warehouse loss, no Team Balance post
//	too few typed (20 → 22)    the 2 real units go into the same batch, onto the rack named; a line that arrived with
//	                           no good unit has no batch yet — one is minted at the line's landed price
//
// In ONE stock transaction, the restock row locked first (the lock accept and cancel take): the `adjustment` transaction
// and its batch and rack rows (inventory_mutations.PostCountCorrection), the line's received count, one correction row
// per line, the door's missing signed on the CORRECTION's day, and — through the batch rows — the Restock metric's
// accepted units and value on that day too (a-received-count-correction-counts-on-its-own-day). The accept's day never
// moves. After the commit, RestockReceivedCountCorrected tells supplier_service, which moves the supplier's restock
// figures on the same day.
func (s *Service) RestockReceivedCountCorrect(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockReceivedCountCorrectRequest],
) (*connect.Response[inventoryv1.RestockReceivedCountCorrectResponse], error) {
	warehouseID := req.Msg.GetTeamId()

	reason, err := countReason(req.Msg.GetReason())
	if err != nil {
		return nil, restockCountErr(err)
	}

	err = countLines(req.Msg.GetLines())
	if err != nil {
		return nil, restockCountErr(err)
	}

	actor := actorFrom(ctx)
	override := overrideFrom(ctx)

	var (
		rr      models.Restock
		posted  models.InventoryTransaction
		written []models.RestockCountCorrection
	)

	err = inventory_ledgers.StockTransaction(s.db.WithContext(ctx), func(tx *gorm.DB) error {
		// THE RESTOCK ROW, FOR UPDATE — the lock accept and cancel take, so two corrections of one restock queue here and
		// the second judges the first's count (and is refused as stale).
		loadErr := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
			Where("id = ? AND warehouse_id = ?", req.Msg.GetRequestId(), warehouseID).
			First(&rr).
			Error
		if loadErr != nil {
			return loadErr
		}

		if rr.Status != restockStatusAccepted {
			return fmt.Errorf("%w: this restock is %s", errCountNotAccepted, rr.Status)
		}

		items := make(map[uint64]*models.RestockItem, len(rr.Items))
		products := make([]uint64, 0, len(rr.Items))

		for i := range rr.Items {
			items[rr.Items[i].ID] = &rr.Items[i]
			products = append(products, rr.Items[i].ProductID)
		}

		broken, brokenErr := restockBroken(tx, rr.ID)
		if brokenErr != nil {
			return brokenErr
		}

		racks := make([]uint64, 0, len(req.Msg.GetLines()))

		for _, line := range req.Msg.GetLines() {
			item := items[line.GetItemId()]
			if item == nil {
				return errCountLineUnknown
			}

			judgeErr := judgeCountLine(line, item.ProductCode, item.ReceivedCount, broken[item.ProductID], item.Count, "ordered")
			if judgeErr != nil {
				return judgeErr
			}

			racks = append(racks, line.GetPlacementId())
		}

		// Racks of THIS warehouse only — another's reads as NotFound, and is never given a shelf row here.
		exists, rackErr := racksExist(tx, warehouseID, racks)
		if rackErr != nil {
			return rackErr
		}

		if !exists {
			return errRackMissing
		}

		batchOf, batchErr := restockLineBatches(tx, &rr, products)
		if batchErr != nil {
			return batchErr
		}

		// The landed price over every unit ORDERED (all-qty-is-every-unit-ordered) — a minted batch's price, the same a
		// good unit landed at; the costs stay spread over the original count (no re-pricing).
		var allQty int64
		for i := range rr.Items {
			allQty += rr.Items[i].Count
		}

		freight := rr.ShipmentCost + rr.WarehouseAdditionalCost

		correction := inventory_mutations.CountCorrection{
			WarehouseID: rr.WarehouseID,
			TeamID:      rr.TeamID,
			ChangeType:  models.ChangeRestockCorrection,
			ActorID:     actor,
			IsOverride:  override,
			Reason:      reason,
		}

		for _, line := range req.Msg.GetLines() {
			item := items[line.GetItemId()]

			correction.Lines = append(correction.Lines, inventory_mutations.CountLine{
				ProductID:   item.ProductID,
				PlacementID: line.GetPlacementId(),
				Pieces: []inventory_mutations.CountPiece{{
					BatchID:  batchOf[item.ID],
					UnitsOut: item.ReceivedCount - line.GetReceivedCount(),
					Mint: inventory_mutations.CountMint{
						PriceUnit:         inventory_mutations.LandedPrice(item.Total, item.Count, freight, allQty),
						SupplierID:        derefID(item.SupplierID),
						SupplierChannelID: derefID(item.SupplierChannelID),
					},
				}},
			})
		}

		var (
			done    []inventory_mutations.CorrectedLine
			postErr error
		)

		posted, done, postErr = inventory_mutations.PostCountCorrection(tx, correction)
		if postErr != nil {
			return postErr
		}

		at := inventory_ledgers.TxNow(tx)

		ids := make([]int64, 0, len(done))
		counts := make([]int64, 0, len(done))
		door := make([]inventory_ledgers.DoorRow, 0, len(done))

		for i, line := range req.Msg.GetLines() {
			item := items[line.GetItemId()]
			piece := done[i].Pieces[0]

			written = append(written, models.RestockCountCorrection{
				RestockID:     rr.ID,
				RestockItemID: item.ID,
				ProductID:     item.ProductID,
				WarehouseID:   rr.WarehouseID,
				TeamID:        rr.TeamID,
				TransactionID: posted.ID,
				BatchID:       piece.BatchID,
				PlacementID:   line.GetPlacementId(),
				FromCount:     item.ReceivedCount,
				ToCount:       line.GetReceivedCount(),
				UnitsOut:      piece.UnitsOut,
				PriceUnit:     piece.PriceUnit,
				Total:         piece.Total,
				Reason:        reason,
				ActorUserID:   actor,
				IsOverride:    override,
				CreatedAt:     at,
			})

			ids = append(ids, int64(item.ID))
			counts = append(counts, line.GetReceivedCount())

			// THE DOOR, signed, on the correction's day: units out are missing +N, units back −N.
			door = append(door, inventory_ledgers.DoorRow{
				WarehouseID: rr.WarehouseID,
				TeamID:      rr.TeamID,
				ProductID:   item.ProductID,
				SupplierID:  derefID(item.SupplierID),
				Source:      inventory_ledgers.DoorRestock,
				Missing:     piece.UnitsOut,
			})

			item.ReceivedCount = line.GetReceivedCount()
		}

		updateErr := tx.Exec(`
			UPDATE restock_items AS i
			SET received_count = v.received_count, updated_at = NOW()
			FROM unnest(CAST(? AS bigint[]), CAST(? AS bigint[])) AS v(id, received_count)
			WHERE i.id = v.id`,
			int64Array(ids), int64Array(counts),
		).Error
		if updateErr != nil {
			return updateErr
		}

		createErr := tx.Create(&written).Error
		if createErr != nil {
			return createErr
		}

		return inventory_ledgers.NoteDoorCorrection(tx, door...)
	})
	if err != nil {
		return nil, restockCountErr(err)
	}

	// AFTER the commit, never inside: the supplier's fold must not be able to fail the correction.
	s.publishCountCorrected(ctx, &rr, posted, written)

	wire, err := s.restockDetail(ctx, req.Msg.GetRequestId(), warehouseID)
	if err != nil {
		return nil, restockErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockReceivedCountCorrectResponse{Request: wire}), nil
}

// restockCountErr maps a restock correction's refusal: its own first, then the restock's.
func restockCountErr(err error) error {
	if mapped := countRefusal(err); mapped != nil {
		return mapped
	}

	return restockErr(err)
}

// restockBroken is each product's broken units at the door — the accept's broken rows. ONE statement.
func restockBroken(tx *gorm.DB, restockID uint64) (map[uint64]int64, error) {
	var rows []struct {
		ProductID uint64
		Count     int64
	}

	err := tx.
		Table("restock_problem_items").
		Select("product_id, count").
		Where("restock_id = ? AND problem_type = ?", restockID, restockProblemBroken).
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

// restockLineBatches is each line's batch here, by line id: the one its accept minted (one batch per line with good
// units — one-batch-per-line), else the one an earlier correction minted for it; absent when the line has none yet.
// Two statements, by the accept's transaction and the restock's corrections.
func restockLineBatches(db *gorm.DB, rr *models.Restock, products []uint64) (map[uint64]uint64, error) {
	out := map[uint64]uint64{}

	byProduct := map[uint64]uint64{}

	if rr.TransactionID != 0 && len(products) > 0 {
		var minted []struct {
			ID        uint64
			ProductID uint64
		}

		err := db.
			Table("batches").
			Select("id, product_id").
			Where("transaction_id = ? AND product_id IN ?", rr.TransactionID, products).
			Order("id").
			Scan(&minted).
			Error
		if err != nil {
			return nil, err
		}

		for _, b := range minted {
			if _, seen := byProduct[b.ProductID]; !seen {
				byProduct[b.ProductID] = b.ID
			}
		}
	}

	var corrected []struct {
		RestockItemID uint64
		BatchID       uint64
	}

	err := db.Raw(`
		SELECT DISTINCT ON (restock_item_id) restock_item_id, batch_id
		FROM restock_count_corrections
		WHERE restock_id = ?
		ORDER BY restock_item_id, id`, rr.ID).
		Scan(&corrected).
		Error
	if err != nil {
		return nil, err
	}

	for i := range rr.Items {
		if id, ok := byProduct[rr.Items[i].ProductID]; ok {
			out[rr.Items[i].ID] = id
		}
	}

	for _, c := range corrected {
		if _, ok := out[c.RestockItemID]; !ok {
			out[c.RestockItemID] = c.BatchID
		}
	}

	return out, nil
}
