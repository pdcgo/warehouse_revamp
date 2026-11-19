package selling_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderPickLines implements [sellingv1connect.OrderServiceHandler].
//
// THE ORDERS' LINES FOR THE BULK PICK LIST (the-bulk-pick-list-prototype-is-accepted): the orders the crew ticked on the
// Dikonfirmasi tab — up to 50, the list's largest page — each with what its parcel carries, the take its racks are read
// by (the-placement-page-reads-racks-by-transaction-id) and its lines. OrderList answers a summary with no lines and
// OrderDetail one order, so without this the page would ask OrderDetail once per ticked order.
//
// THE SCOPE is the order's SHIPPING warehouse (`warehouse_id`, as OrderLabels): a warehouse picks only what ships from
// it, so a return warehouse's narrow arm of orderReaders is not here. Another warehouse's order, or no such order, is
// left out of the answer — the two read alike, so ids cannot be probed. The root team reads any order (readsEveryTeam).
//
// NO MONEY: a line is its product and quantity. Two statements whatever the count — the orders, then their lines
// (order_items_order_idx).
func (s *Service) OrderPickLines(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderPickLinesRequest],
) (*connect.Response[sellingv1.OrderPickLinesResponse], error) {
	ids := req.Msg.GetOrderIds()
	teamID := req.Msg.GetTeamId()

	query := s.db.
		WithContext(ctx).
		Model(&selling_service_models.Order{}).
		Select("id", "status", "shop_id", "order_external_ref_id", "shipment_channel_id", "receipt", "transaction_id").
		Preload("Items", func(db *gorm.DB) *gorm.DB {
			return db.
				Select("id", "order_id", "product_id", "product_code", "name", "quantity").
				Order("order_id ASC, id ASC")
		}).
		Where("id IN ?", ids)

	if !readsEveryTeam(teamID) {
		// THE CHECK: the order ships from this warehouse.
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

	res := &sellingv1.OrderPickLinesResponse{Orders: make([]*sellingv1.OrderPick, 0, len(orders))}

	// In the asked order — the list's order — and only what was found.
	for _, id := range ids {
		order := byID[id]
		if order == nil {
			continue
		}

		res.Orders = append(res.Orders, orderPickToProto(order))
	}

	return connect.NewResponse(res), nil
}

// orderPickToProto is one order as the crew fetches it: no price, no cost, no markup.
func orderPickToProto(order *selling_service_models.Order) *sellingv1.OrderPick {
	out := &sellingv1.OrderPick{
		OrderId:            order.ID,
		Status:             orderStatusFromText(order.Status),
		ShopId:             order.ShopID,
		OrderExternalRefId: order.OrderExternalRefID,
		ShipmentChannelId:  order.ShipmentChannelID,
		ReceiptCode:        order.Receipt,
		Lines:              make([]*sellingv1.OrderPickLine, 0, len(order.Items)),
	}

	if order.TransactionID != nil {
		out.TransactionId = *order.TransactionID
	}

	for _, item := range order.Items {
		out.Lines = append(out.Lines, &sellingv1.OrderPickLine{
			ProductId:   item.ProductID,
			ProductCode: item.ProductCode,
			Name:        item.Name,
			Quantity:    item.Quantity,
		})
	}

	return out
}
