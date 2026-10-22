package inventory_v1

import (
	"context"
	"errors"
	"math"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// BatchReceipt is the goods-received document for ONE delivery (#219): every product line that arrived
// on it — arrived / damaged / accepted / unit cost / line cost / rack — plus the two actors (who raised
// the restock, who accepted it). It is assembled from the batches the delivery's accept minted (batches whose
// transaction is the restock's): the stock service owns the acceptance and the cost, so it owns the receipt.
//
// A delivery of another warehouse reads NotFound, so its id cannot probe another building's receipts.
func (s *Service) BatchReceipt(
	ctx context.Context,
	req *connect.Request[inventoryv1.BatchReceiptRequest],
) (*connect.Response[inventoryv1.BatchReceiptResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	deliveryID := req.Msg.GetDeliveryId()

	var rows []batchRow

	err := batchQuery(s.db.WithContext(ctx)).
		Select(batchSelect).
		Where("r.id = ? AND b.warehouse_id = ?", deliveryID, warehouseID).
		Order("b.id ASC").
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if len(rows) == 0 {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("delivery not found"))
	}

	// WHERE EACH PRODUCT WAS PUT AWAY at the accept (a-batch-shows-the-racks-it-was-put-on) — the restock's own rack
	// rows. A rack counts units per product, never per batch, so this is history, not where they sit now.
	var putAway []struct {
		ProductID uint64
		RackID    uint64
	}

	err = s.db.
		WithContext(ctx).
		Table("product_placement_logs AS l").
		Joins("JOIN restocks r ON r.transaction_id = l.transaction_id").
		Select("l.product_id, l.placement_id AS rack_id").
		Where("r.id = ? AND l.stock_change > 0", deliveryID).
		Order("l.placement_id ASC").
		Scan(&putAway).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	racksByProduct := make(map[uint64][]uint64, len(rows))
	for _, p := range putAway {
		racksByProduct[p.ProductID] = append(racksByProduct[p.ProductID], p.RackID)
	}

	lines := make([]*inventoryv1.BatchReceiptLine, 0, len(rows))

	var totalAccepted, totalValue int64

	for i := range rows {
		r := &rows[i]

		// Accepted = arrived − damaged: the good units the batch was minted with.
		damaged := r.Broken + r.Lost
		arrived := r.InitStockCount + damaged
		lineCost := int64(math.Round(float64(arrived) * r.PriceUnit))

		totalAccepted += r.InitStockCount
		totalValue += lineCost

		lines = append(lines, &inventoryv1.BatchReceiptLine{
			BatchId:   r.ID,
			ProductId: r.ProductID,
			Sku:       r.SKU,
			Name:      r.Name,
			Arrived:   arrived,
			Damaged:   damaged,
			Accepted:  r.InitStockCount,
			UnitCost:  int64(math.Round(r.PriceUnit)),
			CostKnown: true,
			LineCost:  lineCost,
			RackIds:   racksByProduct[r.ProductID],
		})
	}

	// The header fields are the delivery's, shared by every line — read off the first.
	first := rows[0]

	return connect.NewResponse(&inventoryv1.BatchReceiptResponse{
		DeliveryId:    deliveryID,
		ReceiptNo:     first.ReceiptNo,
		SupplierId:    first.SupplierID,
		WarehouseId:   warehouseID,
		ArrivedAtUnix: first.CreatedAt.Unix(),
		CreatedBy:     first.CreatedBy,
		AcceptedBy:    first.AcceptedBy,
		Lines:         lines,
		TotalAccepted: totalAccepted,
		TotalValue:    totalValue,
	}), nil
}
