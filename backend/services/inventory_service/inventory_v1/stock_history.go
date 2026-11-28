package inventory_v1

import (
	"context"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// StockHistory returns the ledger rows for one product at the scoped warehouse (paged, newest first) — so a wrong
// on-hand number is explainable.
//
// Without a batch it reads the RACK rows: every change to where the product sits, each with its rack and the rack's
// count after, and — since #142 — the batch its units came from, plus the price corrections, which write no rack row
// (#143; productHistory). Narrowed to a batch it reads that batch's rows instead, each with the batch's count after and
// the rack its transaction moved the product on — one row per rack when the rows are the batch's alone (batchRackJoin).
// No log row carries both a rack and a batch (see ledger_history.go).
func (s *Service) StockHistory(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockHistoryRequest],
) (*connect.Response[inventoryv1.StockHistoryResponse], error) {
	filter := req.Msg.GetFilter()
	page := req.Msg.GetPage()

	var (
		rows  []historyRow
		total int64
		err   error
	)

	if filter.GetBatchId() != 0 {
		rows, total, err = batchHistory(s.db.WithContext(ctx), req.Msg.GetWarehouseId(), filter, page)
	} else {
		rows, total, err = productHistory(s.db.WithContext(ctx), req.Msg.GetWarehouseId(), filter, page)
	}

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

// batchHistory is a history narrowed to one batch: each batch row with the rack it moved on — one row per rack when the
// movement split over racks (batchRackJoin).
func batchHistory(
	db *gorm.DB,
	warehouseID uint64,
	filter *inventoryv1.StockHistoryFilter,
	page pager,
) ([]historyRow, int64, error) {
	query := db.
		Table("batch_logs AS l").
		Joins("JOIN batches b ON b.id = l.batch_id").
		Joins(batchRackJoin).
		Where("l.warehouse_id = ? AND b.product_id = ? AND l.batch_id = ?",
			warehouseID, filter.GetProductId(), filter.GetBatchId())

	if kind := filter.GetKind(); kind != inventoryv1.MovementKind_MOVEMENT_KIND_UNSPECIFIED {
		cond, args := kindsWhere("l", "change_count", kind)
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
		return nil, 0, err
	}

	var rows []historyRow

	err = query.
		Select(batchHistorySelect).
		Order(batchRowOrder).
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Scan(&rows).
		Error
	if err != nil {
		return nil, 0, err
	}

	return rows, total, nil
}

// productHistory is a product's history in a warehouse read WITHOUT a batch — the warehouse product page's Stock History
// (backlog #142/#143), its Placement History (narrowed to MOVE) and its last stock-take (ADJUST, one row):
//
//   - the RACK rows, as before — the units, the rack's count after, who, the rack — each now naming its batch
//     (rackBatchJoin: one row per batch when a movement drew from several that add up to it; moveBatchExpr for a move);
//   - the PRICE CORRECTIONS, which write a batch row and no rack row (priceCorrectionSelect) — only when no kind, or
//     the REVALUATION kind, is asked for.
//
// Two statements, as before: the count over both, and the page — ordered and cut over both first, then each of the
// page's rows names its reference, override stamp, sample recipient and a move's batch (per page row, never per row
// of the product).
func productHistory(
	db *gorm.DB,
	warehouseID uint64,
	filter *inventoryv1.StockHistoryFilter,
	page pager,
) ([]historyRow, int64, error) {
	kind := filter.GetKind()

	racks := []string{"l.warehouse_id = ?", "l.product_id = ?"}
	rackArgs := []any{warehouseID, filter.GetProductId()}

	prices := []string{"l.warehouse_id = ?", "b.product_id = ?", "l.change_type = 'revaluation'"}
	priceArgs := []any{warehouseID, filter.GetProductId()}

	if kind != inventoryv1.MovementKind_MOVEMENT_KIND_UNSPECIFIED {
		cond, args := kindsWhere("l", "stock_change", kind)
		racks = append(racks, cond)
		rackArgs = append(rackArgs, args...)
	}

	if from := filter.GetFromUnix(); from > 0 {
		racks = append(racks, "l.created_at >= ?")
		rackArgs = append(rackArgs, time.Unix(from, 0))
		prices = append(prices, "l.created_at >= ?")
		priceArgs = append(priceArgs, time.Unix(from, 0))
	}

	if to := filter.GetToUnix(); to > 0 {
		racks = append(racks, "l.created_at <= ?")
		rackArgs = append(rackArgs, time.Unix(to, 0))
		prices = append(prices, "l.created_at <= ?")
		priceArgs = append(priceArgs, time.Unix(to, 0))
	}

	rows := "SELECT " + placementBatchSelect + "\n\tFROM product_placement_logs AS l\n\t" + rackBatchJoin +
		"\n\tWHERE " + strings.Join(racks, " AND ")
	args := append([]any{warehouseID, filter.GetProductId()}, rackArgs...) // rackBatchJoin's two, then the rack rows'

	// A price correction moved no unit and touched no rack: it answers no kind but its own.
	if kind == inventoryv1.MovementKind_MOVEMENT_KIND_UNSPECIFIED || kind == inventoryv1.MovementKind_MOVEMENT_KIND_REVALUATION {
		rows += "\nUNION ALL\nSELECT " + priceCorrectionSelect +
			"\n\tFROM batch_logs AS l\n\tJOIN batches b ON b.id = l.batch_id\n\tWHERE " + strings.Join(prices, " AND ")
		args = append(args, priceArgs...)
	}

	var total int64

	err := db.Raw("SELECT COUNT(*) FROM ("+rows+") h", args...).Scan(&total).Error
	if err != nil {
		return nil, 0, err
	}

	pageSQL := `SELECT h.id, h.product_id, h.warehouse_id, h.placement_id, ` + moveBatchExpr("h") + ` AS batch_id,
	h.change_type, h.transaction_id, h.change, h.after, h.description, ` + refExpr("h") + ` AS ref, h.actor_id,
	h.created_at, ` + overrideExpr("h.transaction_id") + ` AS is_override,
	` + recipientExpr("h.change_type", "h.transaction_id") + ` AS recipient,
	h.price_unit_before, h.price_unit_after, h.value_change
FROM (
	` + rows + `
	ORDER BY ` + productHistoryOrder + `
	OFFSET ? LIMIT ?
) h
ORDER BY ` + productHistoryOrder

	var out []historyRow

	err = db.Raw(pageSQL, append(args, pageOffset(page), int(page.GetLimit()))...).Scan(&out).Error
	if err != nil {
		return nil, 0, err
	}

	return out, total, nil
}
