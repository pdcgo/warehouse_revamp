package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// RackHistory is the movement ledger narrowed to ONE SHELF (#197).
//
// `StockHistory` cannot answer this and was never meant to: it requires a `product_id`, because it
// was built for "what has happened to this product" (#158). Standing at a rack the question is the
// other way round — "what has happened HERE" — and no amount of per-product paging assembles it.
//
// Nothing is stored differently for it: every rack row of the placement ledger names its rack, so this is a filter
// over data that already exists.
//
// The rack is verified against the scoped warehouse first, so another warehouse's rack reads as
// NotFound rather than as an empty history — "not yours" and "nothing has happened" must not look the
// same, or a probe could map another warehouse's rack ids by which come back empty.
func (s *Service) RackHistory(
	ctx context.Context,
	req *connect.Request[inventoryv1.RackHistoryRequest],
) (*connect.Response[inventoryv1.RackHistoryResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	rackID := req.Msg.GetFilter().GetRackId()
	page := req.Msg.GetPage()

	exists, err := rackExists(s.db.WithContext(ctx), warehouseID, rackID)
	if err != nil {
		return nil, rackDBError(err)
	}

	if !exists {
		return nil, rackNotFound()
	}

	// The warehouse is in the WHERE as well as the rack. Belt and braces on a scoped read: the rack
	// check above already proves ownership, but a movement is fetched by rack id alone otherwise, and
	// a future refactor that dropped the check would silently widen this.
	query := s.db.
		WithContext(ctx).
		Table("product_placement_logs AS l").
		Where("l.warehouse_id = ? AND l.placement_id = ?", warehouseID, rackID)

	// Which kinds, or all of them. The detail page asks two questions of this one log: everything that changed a count
	// here, and the put-aways that decided goods LIVE here. UNSPECIFIED is no kind and is skipped, so it never narrows
	// the history to nothing.
	if cond, args := kindsWhere("l", "stock_change", req.Msg.GetFilter().GetKinds()...); cond != "" {
		query = query.Where(cond, args...)
	}

	var total int64

	err = query.Count(&total).Error
	if err != nil {
		return nil, rackDBError(err)
	}

	var rows []historyRow

	// Newest first: the last thing that happened to this shelf is what somebody came to see.
	err = query.
		Select(placementHistorySelect).
		Order("l.id DESC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Scan(&rows).
		Error
	if err != nil {
		return nil, rackDBError(err)
	}

	out := make([]*inventoryv1.StockMovement, 0, len(rows))
	for i := range rows {
		out = append(out, rows[i].proto())
	}

	items, ids := rackHistoryListItems(out, req.Msg.GetDataRequest())

	return connect.NewResponse(&inventoryv1.RackHistoryResponse{
		Items:    items,
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	}), nil
}
