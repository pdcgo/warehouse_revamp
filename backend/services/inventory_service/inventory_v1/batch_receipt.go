package inventory_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// BatchReceipt is the goods-received document for ONE delivery (#219): every product line that arrived
// on it — arrived / damaged / accepted / unit cost / line cost / rack — plus the two actors (who raised
// the restock, who accepted it). It is assembled from the delivery's batches (stock_batches grouped by
// delivery_id): the stock service owns the acceptance/cost projection, so it owns the receipt.
//
// A delivery of another warehouse reads NotFound, so its id cannot probe another building's receipts.
func (s *Service) BatchReceipt(
	ctx context.Context,
	req *connect.Request[inventoryv1.BatchReceiptRequest],
) (*connect.Response[inventoryv1.BatchReceiptResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	deliveryID := req.Msg.GetDeliveryId()

	type row struct {
		ID         uint64
		ProductID  uint64
		SKU        string
		Name       string
		SupplierID uint64
		ReceiptNo  string
		UnitCost   *int64
		Arrived    int64
		Damaged    int64
		AcceptedAt time.Time
		CreatedBy  uint64
		AcceptedBy uint64
	}

	var rows []row

	err := s.db.
		WithContext(ctx).
		Table("stock_batches AS b").
		Joins("JOIN restock_request_items i ON i.id = b.restock_request_item_id").
		Joins("JOIN restock_requests r ON r.id = b.delivery_id").
		Select(`
			b.id, b.product_id, i.sku, i.name, COALESCE(r.supplier_id, 0) AS supplier_id,
			r.receipt AS receipt_no, b.unit_cost, b.arrived_qty AS arrived, b.damaged_qty AS damaged,
			b.accepted_at, b.created_by, b.accepted_by`).
		Where("b.delivery_id = ? AND b.warehouse_id = ?", deliveryID, warehouseID).
		Order("b.id ASC").
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if len(rows) == 0 {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("delivery not found"))
	}

	// Where each batch's units were put away — one query for the whole delivery. A line can span
	// shelves; 0 = the unplaced pile.
	batchIDs := make([]uint64, len(rows))
	for i := range rows {
		batchIDs[i] = rows[i].ID
	}

	type shelfRow struct {
		BatchID uint64
		RackID  *uint64
	}

	var shelves []shelfRow

	err = s.db.
		WithContext(ctx).
		Table("stock_shelf_batches AS sb").
		Select("sb.batch_id, sb.rack_id").
		Where("sb.batch_id IN ? AND sb.qty > 0", batchIDs).
		Order("sb.rack_id ASC NULLS LAST").
		Scan(&shelves).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	racksByBatch := make(map[uint64][]uint64, len(rows))
	for _, sh := range shelves {
		var rackID uint64
		if sh.RackID != nil {
			rackID = *sh.RackID
		}
		racksByBatch[sh.BatchID] = append(racksByBatch[sh.BatchID], rackID)
	}

	lines := make([]*inventoryv1.BatchReceiptLine, 0, len(rows))

	var totalAccepted, totalValue int64

	for i := range rows {
		r := &rows[i]

		costKnown := r.UnitCost != nil
		var unitCost int64
		if costKnown {
			unitCost = *r.UnitCost
		}

		// Accepted = arrived − damaged: only accepted units entered stock and froze their cost.
		accepted := r.Arrived - r.Damaged
		lineCost := r.Arrived * unitCost

		totalAccepted += accepted
		if costKnown {
			totalValue += lineCost
		}

		lines = append(lines, &inventoryv1.BatchReceiptLine{
			BatchId:   r.ID,
			ProductId: r.ProductID,
			Sku:       r.SKU,
			Name:      r.Name,
			Arrived:   r.Arrived,
			Damaged:   r.Damaged,
			Accepted:  accepted,
			UnitCost:  unitCost,
			CostKnown: costKnown,
			LineCost:  lineCost,
			RackIds:   racksByBatch[r.ID],
		})
	}

	// The header fields are the delivery's, shared by every line — read off the first.
	first := rows[0]

	return connect.NewResponse(&inventoryv1.BatchReceiptResponse{
		DeliveryId:    deliveryID,
		ReceiptNo:     first.ReceiptNo,
		SupplierId:    first.SupplierID,
		WarehouseId:   warehouseID,
		ArrivedAtUnix: first.AcceptedAt.Unix(),
		CreatedBy:     first.CreatedBy,
		AcceptedBy:    first.AcceptedBy,
		Lines:         lines,
		TotalAccepted: totalAccepted,
		TotalValue:    totalValue,
	}), nil
}
