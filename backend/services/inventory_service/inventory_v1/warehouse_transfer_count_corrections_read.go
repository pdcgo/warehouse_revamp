package inventory_v1

import (
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// transferDetail is ONE transfer as `readerTeamID` reads it — Detail's answer and the correction's: transferForWire
// and its received-count corrections (transferCountCorrections).
func (s *Service) transferDetail(db *gorm.DB, transferID, readerTeamID uint64) (*inventoryv1.WarehouseTransfer, error) {
	wire, err := transferForWire(db, transferID)
	if err != nil {
		return nil, err
	}

	err = transferCountCorrections(db, wire, readerTeamID)
	if err != nil {
		return nil, err
	}

	return wire, nil
}

// transferCountCorrections fills a transfer's KOREKSI JUMLAH TERIMA on the wire, as restockCountCorrections does for a
// restock: each line's corrected_from, net units out and (owning team only) their value; one history row per line per
// correction — its batch pieces summed, the first batch named; and, for warehouse B on an accepted transfer, the form's
// facts: the batch a correction takes from first, the most it may take out (inventory_mutations.TransferMaxOut — the
// newest good layers' batches in turn) and the racks holding the product at B. One statement for the corrections; the
// form adds the layers (two), the batches' units and the racks (one each).
func transferCountCorrections(db *gorm.DB, wire *inventoryv1.WarehouseTransfer, readerTeamID uint64) error {
	var rows []models.WarehouseTransferCountCorrection

	err := db.Where("transfer_id = ?", wire.GetId()).Order("id").Find(&rows).Error
	if err != nil {
		return err
	}

	withMoney := readerTeamID == wire.GetTeamId()

	byItem := make(map[uint64]*inventoryv1.WarehouseTransferItem, len(wire.GetItems()))
	for _, item := range wire.GetItems() {
		byItem[item.GetId()] = item
	}

	totals := map[uint64]float64{}

	// One history row per (correction, line): the pieces are consecutive rows of one transaction and line.
	for start := 0; start < len(rows); {
		end := start
		for end < len(rows) && rows[end].TransactionID == rows[start].TransactionID &&
			rows[end].TransferItemID == rows[start].TransferItemID {
			end++
		}

		first := rows[start]

		var (
			units int64
			total float64
		)

		for _, r := range rows[start:end] {
			units += r.UnitsOut
			total += r.Total
		}

		wire.CountCorrections = append(wire.CountCorrections, correctionToProto(
			first.ID, first.TransferItemID, first.ProductID, first.FromCount, first.ToCount, units, first.BatchID,
			first.PlacementID, first.Reason, first.ActorUserID, first.IsOverride, first.CreatedAt.Unix(),
			first.TransactionID, total, withMoney))

		if item := byItem[first.TransferItemID]; item != nil {
			if item.CorrectedFrom == nil {
				from := first.FromCount
				item.CorrectedFrom = &from
			}

			item.MissingByCorrection += units
			totals[first.TransferItemID] += total
		}

		start = end
	}

	if withMoney {
		for id, total := range totals {
			value := total
			byItem[id].MissingByCorrectionTotal = &value
		}
	}

	// THE FORM'S FACTS — warehouse B only, an accepted transfer only.
	if readerTeamID != wire.GetToWarehouseId() ||
		wire.GetStatus() != inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_ACCEPTED ||
		wire.GetOutboundTransactionId() == 0 || wire.GetInboundTransactionId() == 0 {
		return nil
	}

	broken, err := transferBroken(db, wire.GetId())
	if err != nil {
		return err
	}

	t := &models.WarehouseTransfer{ID: wire.GetId()}
	out, in := wire.GetOutboundTransactionId(), wire.GetInboundTransactionId()
	t.OutboundTransactionID, t.InboundTransactionID = &out, &in

	items := make([]models.WarehouseTransferItem, 0, len(wire.GetItems()))
	products := make([]uint64, 0, len(wire.GetItems()))

	for _, item := range wire.GetItems() {
		items = append(items, models.WarehouseTransferItem{ID: item.GetId(), ProductID: item.GetProductId(), ArrivedCount: item.GetArrivedCount()})
		products = append(products, item.GetProductId())
	}

	layers, err := transferLineLayers(db, t, items, broken)
	if err != nil {
		return err
	}

	var ids []uint64

	for _, ls := range layers {
		for _, l := range ls {
			if l.BatchAtB != 0 {
				ids = append(ids, l.BatchAtB)
			}
		}
	}

	holds, err := batchHolds(db, ids)
	if err != nil {
		return err
	}

	shelves, err := lineShelves(db, wire.GetToWarehouseId(), wire.GetTeamId(), products)
	if err != nil {
		return err
	}

	for _, item := range wire.GetItems() {
		batch, maxOut := inventory_mutations.TransferMaxOut(layers[item.GetProductId()],
			item.GetArrivedCount()-broken[item.GetProductId()], holds)

		item.CorrectionFacts = &inventoryv1.ReceivedCountLineFacts{
			BatchId:    batch,
			BatchHolds: maxOut,
			Shelves:    shelves[item.GetProductId()],
		}
	}

	return nil
}
