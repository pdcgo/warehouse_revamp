package inventory_v1

import (
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// restockCountCorrections fills a restock's KOREKSI JUMLAH TERIMA on the wire, as `readerTeamID` reads it
// (the-received-count-prototype-is-accepted — the result):
//
//	each line      corrected_from (the accept's count, once corrected — "18 · dikoreksi dari 20"), the net units the
//	               corrections took out (Kurang (koreksi)), and their value for the OWNING team only
//	               (a-warehouse-sees-no-seller-money)
//	the restock    count_corrections — one history row per line per correction, oldest first, beside the trail
//	the form       correction_facts — the line's batch, what a correction may take out of it, and the racks holding the
//	               product — for the RECEIVING warehouse on an accepted restock only
//
// One statement for the corrections; the form's facts add the line batches (two, by the accept's transaction) and the
// batches' and racks' units (one each). A restock with no correction read by the selling team costs the one statement.
func restockCountCorrections(db *gorm.DB, rr *models.Restock, wire *inventoryv1.RestockRequest, readerTeamID uint64) error {
	var rows []models.RestockCountCorrection

	err := db.Where("restock_id = ?", rr.ID).Order("id").Find(&rows).Error
	if err != nil {
		return err
	}

	withMoney := readerTeamID == rr.TeamID

	byItem := make(map[uint64]*inventoryv1.RestockRequestItem, len(wire.GetItems()))
	for _, item := range wire.GetItems() {
		byItem[item.GetId()] = item
	}

	totals := map[uint64]float64{}

	for i := range rows {
		r := &rows[i]

		wire.CountCorrections = append(wire.CountCorrections, correctionToProto(
			r.ID, r.RestockItemID, r.ProductID, r.FromCount, r.ToCount, r.UnitsOut, r.BatchID, r.PlacementID, r.Reason,
			r.ActorUserID, r.IsOverride, r.CreatedAt.Unix(), r.TransactionID, r.Total, withMoney))

		item := byItem[r.RestockItemID]
		if item == nil {
			continue
		}

		if item.CorrectedFrom == nil {
			from := r.FromCount
			item.CorrectedFrom = &from
		}

		item.MissingByCorrection += r.UnitsOut
		totals[r.RestockItemID] += r.Total
	}

	if withMoney {
		for id, total := range totals {
			value := total
			byItem[id].MissingByCorrectionTotal = &value
		}
	}

	// THE FORM'S FACTS — the receiving warehouse only, an accepted restock only.
	if readerTeamID != rr.WarehouseID || rr.Status != restockStatusAccepted {
		return nil
	}

	products := make([]uint64, 0, len(rr.Items))
	for i := range rr.Items {
		products = append(products, rr.Items[i].ProductID)
	}

	batchOf, err := restockLineBatches(db, rr, products)
	if err != nil {
		return err
	}

	ids := make([]uint64, 0, len(batchOf))
	for _, id := range batchOf {
		ids = append(ids, id)
	}

	holds, err := batchHolds(db, ids)
	if err != nil {
		return err
	}

	shelves, err := lineShelves(db, rr.WarehouseID, rr.TeamID, products)
	if err != nil {
		return err
	}

	for i := range rr.Items {
		item := byItem[rr.Items[i].ID]
		if item == nil {
			continue
		}

		batch := batchOf[rr.Items[i].ID]
		item.CorrectionFacts = &inventoryv1.ReceivedCountLineFacts{
			BatchId:    batch,
			BatchHolds: holds[batch],
			Shelves:    shelves[rr.Items[i].ProductID],
		}
	}

	return nil
}
