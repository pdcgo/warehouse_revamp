package inventory_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// StockHistory returns the movement ledger for one product at the scoped warehouse (paged,
// newest-first) — so a wrong on-hand number is explainable.
func (s *Service) StockHistory(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockHistoryRequest],
) (*connect.Response[inventoryv1.StockHistoryResponse], error) {
	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&inventory_service_models.StockMovement{}).
		Where("warehouse_id = ? AND product_id = ?", req.Msg.GetWarehouseId(), req.Msg.GetFilter().GetProductId())

	// One kind, or all of them (#158). Server-side because the ledger is paginated and grows forever:
	// a client-side filter would narrow the loaded page only, so "when was this last counted" would read
	// as "never" the moment the last stock-take fell off page one.
	if kind := req.Msg.GetFilter().GetKind(); kind != inventoryv1.MovementKind_MOVEMENT_KIND_UNSPECIFIED {
		query = query.Where("kind = ?", int32(kind))
	}

	// One batch, or all of them (#209). A batch-specific view drops batch-less events (a shelf recount)
	// by construction — `batch_id = N` never matches a NULL — which is exactly the "—" row falling out
	// of the filter.
	if batchID := req.Msg.GetFilter().GetBatchId(); batchID != 0 {
		query = query.Where("batch_id = ?", batchID)
	}

	// A date range over the movement's OWN created_at (#218/#225). Server-side for the same reason as
	// kind: the ledger is paginated and grows forever, so a client-side date filter would narrow only
	// the loaded page. 0 = open on that end; the frontend pushes the upper bound to end-of-day.
	if from := req.Msg.GetFilter().GetFromUnix(); from > 0 {
		query = query.Where("created_at >= ?", time.Unix(from, 0))
	}
	if to := req.Msg.GetFilter().GetToUnix(); to > 0 {
		query = query.Where("created_at <= ?", time.Unix(to, 0))
	}

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var movements []inventory_service_models.StockMovement

	err = query.
		Order("id DESC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&movements).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	out := make([]*inventoryv1.StockMovement, 0, len(movements))
	for i := range movements {
		out = append(out, movementToProto(&movements[i]))
	}

	items, ids := stockHistoryItems(out, req.Msg.GetDataRequest())

	return connect.NewResponse(&inventoryv1.StockHistoryResponse{
		Items:    items,
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	}), nil
}
