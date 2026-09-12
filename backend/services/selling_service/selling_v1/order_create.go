package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
)

// OrderCreate records a new order (status PLACED) and its lines in one transaction. The shop must
// belong to the scoped team.
//
// The work itself is placeOrder (order_place.go), which OrderDraftPromote also runs — so what counts
// as a valid order is defined once and cannot drift between the two doors into `orders`.
func (s *Service) OrderCreate(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderCreateRequest],
) (*connect.Response[sellingv1.OrderCreateResponse], error) {
	order, err := s.placeOrder(ctx, &orderPlacement{
		teamID:           req.Msg.GetTeamId(),
		shopID:           req.Msg.GetShopId(),
		warehouseID:      req.Msg.GetWarehouseId(),
		customerName:     req.Msg.GetCustomerName(),
		customerPhone:    req.Msg.GetCustomerPhone(),
		address:          req.Msg.GetAddress(),
		shippingCode:     req.Msg.GetShippingCode(),
		note:             req.Msg.GetNote(),
		receipt:          req.Msg.GetReceipt(),
		subtotal:         req.Msg.GetSubtotal(),
		shippingCost:     req.Msg.GetShippingCost(),
		total:            req.Msg.GetTotal(),
		marketplaceTotal: req.Msg.GetMarketplaceTotal(),
		// The storefront's own id for this order, as typed. OrderDraftPromote leaves this empty for
		// now — a draft's `external_id` is its idempotency key (and is a minted `form-…` id for a
		// draft this form made), so carrying it across would fill the field with something that is
		// not a marketplace reference.
		orderExternalRefID: req.Msg.GetOrderExternalRefId(),
		items:              req.Msg.GetItems(),
	})
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&sellingv1.OrderCreateResponse{Order: orderToProto(order)}), nil
}
