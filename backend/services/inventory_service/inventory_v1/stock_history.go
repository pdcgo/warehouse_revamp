package inventory_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// StockHistory returns the ledger rows for one product at the scoped warehouse (paged, newest first) — so a wrong
// on-hand number is explainable.
//
// Without a batch it reads the RACK rows: every change to where the product sits, each with its rack and the rack's
// count after. Narrowed to a batch it reads that batch's rows instead, each with the batch's count after and the rack
// its transaction moved the product on — one row per rack when the rows are the batch's alone (batchRackJoin). No log
// row carries both a rack and a batch (see ledger_history.go).
func (s *Service) StockHistory(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockHistoryRequest],
) (*connect.Response[inventoryv1.StockHistoryResponse], error) {
	filter := req.Msg.GetFilter()
	page := req.Msg.GetPage()

	var (
		query     *gorm.DB
		selection string
		change    string
		order     string
	)

	if batchID := filter.GetBatchId(); batchID != 0 {
		// Each batch row with the rack it moved on — one row per rack when the movement split over racks (batchRackJoin).
		query = s.db.WithContext(ctx).
			Table("batch_logs AS l").
			Joins("JOIN batches b ON b.id = l.batch_id").
			Joins(batchRackJoin).
			Where("l.warehouse_id = ? AND b.product_id = ? AND l.batch_id = ?",
				req.Msg.GetWarehouseId(), filter.GetProductId(), batchID)
		selection, change, order = batchHistorySelect, "change_count", batchRowOrder
	} else {
		query = s.db.WithContext(ctx).
			Table("product_placement_logs AS l").
			Where("l.warehouse_id = ? AND l.product_id = ?", req.Msg.GetWarehouseId(), filter.GetProductId())
		selection, change, order = placementHistorySelect, "stock_change", "l.id DESC"
	}

	if kind := filter.GetKind(); kind != inventoryv1.MovementKind_MOVEMENT_KIND_UNSPECIFIED {
		cond, args := kindsWhere("l", change, kind)
		query = query.Where(cond, args...)
	}

	if from := filter.GetFromUnix(); from > 0 {
		query = query.Where("l.created_at >= ?", time.Unix(from, 0))
	}

	if to := filter.GetToUnix(); to > 0 {
		query = query.Where("l.created_at <= ?", time.Unix(to, 0))
	}

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var rows []historyRow

	err = query.
		Select(selection).
		Order(order).
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	out := make([]*inventoryv1.StockMovement, 0, len(rows))
	for i := range rows {
		out = append(out, rows[i].proto())
	}

	err = labelCountCorrections(s.db.WithContext(ctx), rows, out)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	items, ids := stockHistoryItems(out, req.Msg.GetDataRequest())

	return connect.NewResponse(&inventoryv1.StockHistoryResponse{
		Items:    items,
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	}), nil
}
