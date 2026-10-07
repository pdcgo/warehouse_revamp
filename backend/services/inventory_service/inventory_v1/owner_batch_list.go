package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// OwnerBatchList is the BATCH tab of the catalogue owner's product detail (#232): every delivery the
// owner's units arrived on, newest first, across every warehouse holding them.
//
// BatchList answers this for one building, because a warehouse can only be asked about itself. An
// owner's deliveries are not a fact about a building — 200 units in Surabaya and 300 in Jakarta are
// one purchase history — so the warehouse becomes a column on the row and a LENS on the filter,
// never the scope.
//
// ── Two joins to restock_requests, deliberately ─────────────────────────────────────────────────
//
// `rr` is the restock the LINE belongs to and answers WHO OWNS this — the same climb every owner read
// makes. `r` is the delivery the batch was accepted on and answers what the receipt and supplier were.
// They are the same row in every case the system can currently produce, and collapsing them would tie
// ownership to a delivery id rather than to the line the goods were ordered on.
func (s *Service) OwnerBatchList(
	ctx context.Context,
	req *connect.Request[inventoryv1.OwnerBatchListRequest],
) (*connect.Response[inventoryv1.OwnerBatchListResponse], error) {
	teamID := req.Msg.GetTeamId()
	page := req.Msg.GetPage()

	// The shared shape of the list query and the aggregate — same WHERE, different projection.
	base := func() *gorm.DB {
		q := s.db.
			WithContext(ctx).
			Table("stock_batches AS b").
			Joins("JOIN restock_request_items i ON i.id = b.restock_request_item_id").
			Joins("JOIN restock_requests rr ON rr.id = i.restock_request_id").
			Joins("JOIN restock_requests r ON r.id = b.delivery_id").
			Where("rr.requesting_team_id = ?", teamID)

		if productID := req.Msg.GetFilter().GetProductId(); productID != 0 {
			q = q.Where("b.product_id = ?", productID)
		}

		if warehouseID := req.Msg.GetFilter().GetWarehouseId(); warehouseID != 0 {
			q = q.Where("b.warehouse_id = ?", warehouseID)
		}

		return q
	}

	var total int64

	err := base().Count(&total).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	const readyExpr = "COALESCE((SELECT SUM(sb.qty) FROM stock_shelf_batches sb WHERE sb.batch_id = b.id), 0)"

	// batchRow/batchSelect/batchRowToProto are BatchDetail's, shared on purpose: a batch is a batch, and
	// the owner reading one must not see different arithmetic from the warehouse holding it.
	var rows []batchRow

	err = base().
		Select(batchSelect).
		Order("b.id DESC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Over the WHOLE filtered set, not the page. Unknown-cost batches add units and no money (#74).
	var readyValue int64

	err = base().
		Select(`COALESCE(SUM(CASE WHEN b.unit_cost IS NOT NULL THEN ` + readyExpr + ` * b.unit_cost ELSE 0 END), 0)`).
		Scan(&readyValue).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	batches := make([]*inventoryv1.StockBatch, 0, len(rows))
	for i := range rows {
		batches = append(batches, batchRowToProto(&rows[i]))
	}

	items, ids := ownerBatchItems(batches, req.Msg.GetDataRequest())

	return connect.NewResponse(&inventoryv1.OwnerBatchListResponse{
		Items:           items,
		Ids:             ids,
		PageInfo:        pageInfo(page, total),
		ReadyValueTotal: readyValue,
	}), nil
}
