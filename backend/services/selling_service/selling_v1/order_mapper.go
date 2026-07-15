package selling_v1

import (
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderStatus as stored in the `status` TEXT column. Keep in sync with the proto enum — this mapper
// is the only writer/reader, so validity is guarded here (no DB CHECK, cf. #80).
const (
	orderStatusPlaced    = "placed"
	orderStatusConfirmed = "confirmed"
	orderStatusCancelled = "cancelled"
)

func orderStatusToText(s sellingv1.OrderStatus) string {
	switch s {
	case sellingv1.OrderStatus_ORDER_STATUS_PLACED:
		return orderStatusPlaced
	case sellingv1.OrderStatus_ORDER_STATUS_CONFIRMED:
		return orderStatusConfirmed
	case sellingv1.OrderStatus_ORDER_STATUS_CANCELLED:
		return orderStatusCancelled
	default:
		return ""
	}
}

func orderStatusFromText(text string) sellingv1.OrderStatus {
	switch text {
	case orderStatusPlaced:
		return sellingv1.OrderStatus_ORDER_STATUS_PLACED
	case orderStatusConfirmed:
		return sellingv1.OrderStatus_ORDER_STATUS_CONFIRMED
	case orderStatusCancelled:
		return sellingv1.OrderStatus_ORDER_STATUS_CANCELLED
	default:
		return sellingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED
	}
}

func orderToProto(o *selling_service_models.Order) *sellingv1.Order {
	items := make([]*sellingv1.OrderItem, 0, len(o.Items))
	for i := range o.Items {
		items = append(items, &sellingv1.OrderItem{
			Id:        o.Items[i].ID,
			ProductId: o.Items[i].ProductID,
			Sku:       o.Items[i].SKU,
			Name:      o.Items[i].Name,
			Quantity:  o.Items[i].Quantity,
			UnitPrice: o.Items[i].UnitPrice,
		})
	}

	return &sellingv1.Order{
		Id:              o.ID,
		TeamId:          o.TeamID,
		ShopId:          o.ShopID,
		Status:          orderStatusFromText(o.Status),
		CustomerName:    o.CustomerName,
		CustomerPhone:   o.CustomerPhone,
		CustomerAddress: o.CustomerAddress,
		ShippingCode:    o.ShippingCode,
		Subtotal:        o.Subtotal,
		ShippingCost:    o.ShippingCost,
		Total:           o.Total,
		Items:           items,
		CreatedAtUnix:   o.CreatedAt.Unix(),
	}
}

// orderItemModels turns request lines into rows; `id` on the input is ignored.
func orderItemModels(in []*sellingv1.OrderItem) []selling_service_models.OrderItem {
	out := make([]selling_service_models.OrderItem, 0, len(in))
	for _, it := range in {
		out = append(out, selling_service_models.OrderItem{
			ProductID: it.GetProductId(),
			SKU:       it.GetSku(),
			Name:      it.GetName(),
			Quantity:  it.GetQuantity(),
			UnitPrice: it.GetUnitPrice(),
		})
	}

	return out
}
