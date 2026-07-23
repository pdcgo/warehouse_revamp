package inventory_v1

import (
	"context"
	"math"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// BatchList reads the deliveries of stock as COST LAYERS (#209) — one row per batch (one product's
// units from one delivery). It backs both the product detail's Batches tab (filtered to one product)
// and the warehouse-wide batch list, so it carries the search, supplier and expiry filters both use.
//
// Newest delivery first: the list is read top-down as "what came in recently", while FIFO cost draw
// (oldest first) is a property of the PICK, not of how the list is ordered.
//
// The identity/receipt/supplier come from the delivery the batch was accepted on; sku/name are the
// restock line's snapshot; Ready is Σ shelf_batch.qty and Used is what is left of Arrived once damage
// and Ready are taken out.
func (s *Service) BatchList(
	ctx context.Context,
	req *connect.Request[inventoryv1.BatchListRequest],
) (*connect.Response[inventoryv1.BatchListResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	page := req.Msg.GetPage()

	// The shared shape of the list query and the aggregate query — same WHERE, different projection.
	base := func() *gorm.DB {
		q := s.db.
			WithContext(ctx).
			Table("stock_batches AS b").
			Joins("JOIN restock_request_items i ON i.id = b.restock_request_item_id").
			Joins("JOIN restock_requests r ON r.id = b.delivery_id").
			Where("b.warehouse_id = ?", warehouseID)

		if productID := req.Msg.GetProductId(); productID != 0 {
			q = q.Where("b.product_id = ?", productID)
		}

		// A batch id and a receipt share the delivery number, so one box searches both. A leading '#' is
		// how the number reads on screen — stripped so "#3007" and "3007" match the same row.
		if search := req.Msg.GetSearch(); search != "" {
			like := "%" + search + "%"
			bare := "%" + trimHash(search) + "%"
			q = q.Where("CAST(b.delivery_id AS TEXT) ILIKE ? OR r.receipt ILIKE ?", bare, like)
		}

		if supplierID := req.Msg.GetSupplierId(); supplierID != 0 {
			q = q.Where("r.supplier_id = ?", supplierID)
		}

		switch req.Msg.GetExpiry() {
		case inventoryv1.BatchExpiryFilter_BATCH_EXPIRY_FILTER_EXPIRING_SOON:
			q = q.Where("b.expires_on IS NOT NULL AND b.expires_on <= ?", soonCutoff())
		case inventoryv1.BatchExpiryFilter_BATCH_EXPIRY_FILTER_NO_EXPIRY:
			q = q.Where("b.expires_on IS NULL")
		}

		return q
	}

	var total int64

	err := base().Count(&total).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// The ready quantity for a batch is a correlated sum over its shelf rows; the aggregate tiles need
	// it too, so it is one scalar subquery reused in both projections.
	const readyExpr = "COALESCE((SELECT SUM(sb.qty) FROM stock_shelf_batches sb WHERE sb.batch_id = b.id), 0)"

	type row struct {
		ID         uint64
		DeliveryID uint64
		ReceiptNo  string
		ProductID  uint64
		SKU        string
		Name       string
		SupplierID uint64
		UnitCost   *int64
		Arrived    int64
		Damaged    int64
		Ready      int64
		ExpiresOn  *time.Time
		CreatedAt  time.Time
		AcceptedAt time.Time
		CreatedBy  uint64
		AcceptedBy uint64
	}

	var rows []row

	offset := int((page.GetPage() - 1) * page.GetLimit())

	err = base().
		Select(`
			b.id, b.delivery_id, r.receipt AS receipt_no,
			b.product_id, i.sku, i.name, COALESCE(r.supplier_id, 0) AS supplier_id,
			b.unit_cost, b.arrived_qty AS arrived, b.damaged_qty AS damaged,
			` + readyExpr + ` AS ready,
			b.expires_on, b.created_at, b.accepted_at, b.created_by, b.accepted_by`).
		Order("b.id DESC").
		Offset(offset).
		Limit(int(page.GetLimit())).
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// The header tiles over the WHOLE filtered set (not the page): total ready value and how many are
	// expiring soon. Ready value skips unknown-cost batches (their value is Unknown, not 0, #74).
	type agg struct {
		ReadyValue   int64
		ExpiringSoon int64
	}

	var a agg

	err = base().
		Select(`
			COALESCE(SUM(CASE WHEN b.unit_cost IS NOT NULL THEN `+readyExpr+` * b.unit_cost ELSE 0 END), 0) AS ready_value,
			COALESCE(SUM(CASE WHEN b.expires_on IS NOT NULL AND b.expires_on <= ? THEN 1 ELSE 0 END), 0) AS expiring_soon`,
			soonCutoff()).
		Scan(&a).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	batches := make([]*inventoryv1.StockBatch, 0, len(rows))
	for i := range rows {
		r := &rows[i]

		costKnown := r.UnitCost != nil
		var unitCost int64
		if costKnown {
			unitCost = *r.UnitCost
		}

		out := &inventoryv1.StockBatch{
			Id:         r.ID,
			DeliveryId: r.DeliveryID,
			ReceiptNo:  r.ReceiptNo,
			ProductId:  r.ProductID,
			Sku:        r.SKU,
			Name:       r.Name,
			SupplierId: r.SupplierID,
			UnitCost:   unitCost,
			CostKnown:  costKnown,
			Arrived:    r.Arrived,
			Damaged:    r.Damaged,
			Ready:      r.Ready,
			// Used = arrived − damaged − ready. What is neither broken nor still on a shelf has left.
			Used:           r.Arrived - r.Damaged - r.Ready,
			LineCost:       r.Arrived * unitCost,
			ReadyValue:     r.Ready * unitCost,
			CreatedAtUnix:  r.CreatedAt.Unix(),
			AcceptedAtUnix: r.AcceptedAt.Unix(),
			CreatedBy:      r.CreatedBy,
			AcceptedBy:     r.AcceptedBy,
		}

		if r.ExpiresOn != nil {
			out.ExpiresOnUnix = r.ExpiresOn.Unix()
		}

		batches = append(batches, out)
	}

	return connect.NewResponse(&inventoryv1.BatchListResponse{
		Batches: batches,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   pageCount(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
		ReadyValueTotal:   a.ReadyValue,
		ExpiringSoonCount: uint64(a.ExpiringSoon),
	}), nil
}

// soonCutoff is the "expiring ≤ 30 days" boundary — a batch is soon-to-expire when its date is on or
// before it. A date, not a timestamp: expiry is a calendar day.
func soonCutoff() time.Time {
	return time.Now().AddDate(0, 0, 30)
}

// trimHash drops a leading '#', which is how a delivery/batch number reads on screen but not how it is
// stored — so a search for "#3007" matches the row 3007.
func trimHash(s string) string {
	if len(s) > 0 && s[0] == '#' {
		return s[1:]
	}
	return s
}

func pageCount(total int64, limit uint32) uint32 {
	if limit == 0 {
		return 0
	}
	return uint32(math.Ceil(float64(total) / float64(limit)))
}
