package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderByExternalRefs resolves a statement's marketplace refs to the team's orders, in one call per file
// (settlement_importer critique 4).
//
// ⚠ EVERY ORDER A REF FINDS IS ANSWERED — cancelled ones and other shops' included. The caller decides
// which counts: the importer takes the ref in its own shop and fails the file on a ref found only in
// another (a-file-with-another-shops-orders-is-refused). Hiding a duplicate here would make that choice
// for it, silently.
func (s *Service) OrderByExternalRefs(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderByExternalRefsRequest],
) (*connect.Response[sellingv1.OrderByExternalRefsResponse], error) {
	var orders []selling_service_models.Order

	// orders_team_external_ref_idx — (team_id, order_external_ref_id), partial on a ref being present.
	err := s.db.
		WithContext(ctx).
		Select("id", "shop_id", "status", "created_by_user_id", "order_external_ref_id").
		Where("team_id = ? AND order_external_ref_id <> '' AND order_external_ref_id IN ?",
			req.Msg.GetTeamId(), req.Msg.GetFilter().GetRefs()).
		Find(&orders).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	byRef := make(map[string]map[uint64]*sellingv1.OrderRefItem)

	for i := range orders {
		order := &orders[i]

		found, ok := byRef[order.OrderExternalRefID]
		if !ok {
			found = make(map[uint64]*sellingv1.OrderRefItem)
			byRef[order.OrderExternalRefID] = found
		}

		found[order.ID] = &sellingv1.OrderRefItem{
			OrderId:         order.ID,
			ShopId:          order.ShopID,
			CreatedByUserId: order.CreatedByUserID,
			Status:          orderStatusFromText(order.Status),
		}
	}

	// ORDER_REF is the only slice, and the default.
	items := make(map[string]*sellingv1.OrderByExternalRefsResponseList, len(byRef))

	for ref, found := range byRef {
		items[ref] = &sellingv1.OrderByExternalRefsResponseList{
			Items: []*sellingv1.OrderByExternalRefsResponseItem{{
				D: &sellingv1.OrderByExternalRefsResponseItem_OrderRef{
					OrderRef: &sellingv1.OrderRefMapItem{MapData: found},
				},
			}},
		}
	}

	return connect.NewResponse(&sellingv1.OrderByExternalRefsResponse{Items: items}), nil
}
