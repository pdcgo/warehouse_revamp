package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderPrintByIds implements [sellingv1connect.OrderServiceHandler].
//
// THE PRINT PAGE'S ORDERS (the-print-page-and-the-courier-count-prototype-is-accepted): the orders the crew ticked for
// Cetak Resi — up to 50, OrderLabels' cap — each with what its line on the print page shows and whether its label file is
// attached, so an order with none is named before the print. It replaces the page's one OrderDetail per order (the
// interim read the prototype marked).
//
// THE SCOPE is OrderLabels' own: the order's SHIPPING warehouse (`warehouse_id`), so the page lists exactly what the
// print can hold — a return warehouse's narrow arm of orderReaders is not here. Another warehouse's order, or no such
// order, is left out of the answer; the two read alike, so ids cannot be probed. The root team reads any order
// (readsEveryTeam).
//
// NO MONEY, and no document id: `has_label` is OrderLabels' NO_LABEL test (`receipt_document_id` set) said as a yes or
// no. ONE statement whatever the count — the orders by primary key.
func (s *Service) OrderPrintByIds(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderPrintByIdsRequest],
) (*connect.Response[sellingv1.OrderPrintByIdsResponse], error) {
	ids := req.Msg.GetOrderIds()
	teamID := req.Msg.GetTeamId()

	query := s.db.
		WithContext(ctx).
		Model(&selling_service_models.Order{}).
		Select("id", "status", "shop_id", "order_external_ref_id", "shipment_channel_id", "receipt", "receipt_document_id").
		Where("id IN ?", ids)

	if !readsEveryTeam(teamID) {
		// THE CHECK: the order ships from this warehouse — OrderLabels' check.
		query = query.Where("warehouse_id = ?", teamID)
	}

	var orders []selling_service_models.Order

	err := query.
		Find(&orders).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	byID := make(map[uint64]*selling_service_models.Order, len(orders))
	for i := range orders {
		byID[orders[i].ID] = &orders[i]
	}

	res := &sellingv1.OrderPrintByIdsResponse{Orders: make([]*sellingv1.OrderPrint, 0, len(orders))}

	// In the asked order — the list's, which is the print's — and only what was found.
	for _, id := range ids {
		order := byID[id]
		if order == nil {
			continue
		}

		res.Orders = append(res.Orders, orderPrintToProto(order))
	}

	return connect.NewResponse(res), nil
}

// orderPrintToProto is one order as the print page lists it: no price, no cost, no file id.
func orderPrintToProto(order *selling_service_models.Order) *sellingv1.OrderPrint {
	return &sellingv1.OrderPrint{
		OrderId:            order.ID,
		Status:             orderStatusFromText(order.Status),
		ShopId:             order.ShopID,
		OrderExternalRefId: order.OrderExternalRefID,
		ShipmentChannelId:  order.ShipmentChannelID,
		ReceiptCode:        order.Receipt,
		HasLabel:           order.ReceiptDocumentID != "",
	}
}
