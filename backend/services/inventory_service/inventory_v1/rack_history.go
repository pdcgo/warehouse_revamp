package inventory_v1

import (
	"context"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RackHistory is the movement ledger narrowed to ONE SHELF (#197).
//
// `StockHistory` cannot answer this and was never meant to: it requires a `product_id`, because it
// was built for "what has happened to this product" (#158). Standing at a rack the question is the
// other way round — "what has happened HERE" — and no amount of per-product paging assembles it.
//
// Nothing is stored differently for it. Every movement has carried `rack_id` since #135, so this is a
// filter over data that already exists.
//
// The rack is verified against the scoped warehouse first, so another warehouse's rack reads as
// NotFound rather than as an empty history — "not yours" and "nothing has happened" must not look the
// same, or a probe could map another warehouse's rack ids by which come back empty.
func (s *Service) RackHistory(
	ctx context.Context,
	req *connect.Request[inventoryv1.RackHistoryRequest],
) (*connect.Response[inventoryv1.RackHistoryResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	rackID := req.Msg.GetRackId()
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
		Model(&inventory_service_models.StockMovement{}).
		Where("warehouse_id = ? AND rack_id = ?", warehouseID, rackID)

	// Which kinds, or all of them. The detail page asks two questions of this one ledger: everything
	// that changed a count here, and the put-aways that decided goods LIVE here.
	// `kind` is stored as the enum's NUMBER (see StockMovement.Kind), exactly as StockHistory filters
	// it — so this is a numeric IN-list, not a text one.
	kinds := make([]int32, 0, len(req.Msg.GetKinds()))

	for _, kind := range req.Msg.GetKinds() {
		// UNSPECIFIED is not a kind anything is ever written as, and treating it as a filter value
		// would return nothing at all — which reads as "this shelf has no history" rather than as the
		// caller having asked for a kind that does not exist.
		if kind == inventoryv1.MovementKind_MOVEMENT_KIND_UNSPECIFIED {
			continue
		}

		kinds = append(kinds, int32(kind))
	}

	if len(kinds) > 0 {
		query = query.Where("kind IN ?", kinds)
	}

	var total int64

	err = query.Count(&total).Error
	if err != nil {
		return nil, rackDBError(err)
	}

	var movements []inventory_service_models.StockMovement

	// Newest first: the last thing that happened to this shelf is what somebody came to see.
	err = query.
		Order("id DESC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&movements).
		Error
	if err != nil {
		return nil, rackDBError(err)
	}

	out := make([]*inventoryv1.StockMovement, 0, len(movements))
	for i := range movements {
		out = append(out, movementToProto(&movements[i]))
	}

	return connect.NewResponse(&inventoryv1.RackHistoryResponse{
		Movements: out,
		PageInfo:  pageInfo(page, total),
	}), nil
}
