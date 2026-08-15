package selling_v1

import (
	"context"
	"time"

	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderStatus as stored in the `status` TEXT column. Keep in sync with the proto enum — this mapper
// is the only writer/reader, so validity is guarded here (no DB CHECK, cf. #80).
const (
	orderStatusPlaced    = "placed"
	orderStatusConfirmed = "confirmed"
	orderStatusCancelled = "cancelled"

	// The warehouse's states (#150): CONFIRMED -> PICKING -> PACKED -> SHIPPED.
	orderStatusPicking = "picking"
	orderStatusPacked  = "packed"
	orderStatusShipped = "shipped"
)

func orderStatusToText(s sellingv1.OrderStatus) string {
	switch s {
	case sellingv1.OrderStatus_ORDER_STATUS_PLACED:
		return orderStatusPlaced
	case sellingv1.OrderStatus_ORDER_STATUS_CONFIRMED:
		return orderStatusConfirmed
	case sellingv1.OrderStatus_ORDER_STATUS_CANCELLED:
		return orderStatusCancelled
	case sellingv1.OrderStatus_ORDER_STATUS_PICKING:
		return orderStatusPicking
	case sellingv1.OrderStatus_ORDER_STATUS_PACKED:
		return orderStatusPacked
	case sellingv1.OrderStatus_ORDER_STATUS_SHIPPED:
		return orderStatusShipped
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
	case orderStatusPicking:
		return sellingv1.OrderStatus_ORDER_STATUS_PICKING
	case orderStatusPacked:
		return sellingv1.OrderStatus_ORDER_STATUS_PACKED
	case orderStatusShipped:
		return sellingv1.OrderStatus_ORDER_STATUS_SHIPPED
	default:
		return sellingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED
	}
}

// OrderEventKind as stored in the `kind` TEXT column of `order_events` (00011).
//
// ⚠ THE STRINGS ARE THE STATUS STRINGS ABOVE, ON PURPOSE — every event so far is a transition, so a
// transition records the state it moved INTO and the 00011 backfill could insert `status` verbatim as
// a kind. They are declared separately rather than aliased because the two vocabularies are only
// coincidentally equal: the first event that is not a status change (a note edited, a receipt
// attached) gets a kind here and no status anywhere, and an alias would have to be untangled first.
const (
	orderEventPlaced    = "placed"
	orderEventConfirmed = "confirmed"
	orderEventCancelled = "cancelled"
	orderEventPicking   = "picking"
	orderEventPacked    = "packed"
	orderEventShipped   = "shipped"
)

func orderEventKindFromText(text string) sellingv1.OrderEventKind {
	switch text {
	case orderEventPlaced:
		return sellingv1.OrderEventKind_ORDER_EVENT_KIND_PLACED
	case orderEventConfirmed:
		return sellingv1.OrderEventKind_ORDER_EVENT_KIND_CONFIRMED
	case orderEventCancelled:
		return sellingv1.OrderEventKind_ORDER_EVENT_KIND_CANCELLED
	case orderEventPicking:
		return sellingv1.OrderEventKind_ORDER_EVENT_KIND_PICKING
	case orderEventPacked:
		return sellingv1.OrderEventKind_ORDER_EVENT_KIND_PACKED
	case orderEventShipped:
		return sellingv1.OrderEventKind_ORDER_EVENT_KIND_SHIPPED
	default:
		// A kind written by a newer build than this one. UNSPECIFIED travels out and the screen renders
		// it as an unknown step, which is better than dropping the row — a gap in a history reads as
		// nothing having happened.
		return sellingv1.OrderEventKind_ORDER_EVENT_KIND_UNSPECIFIED
	}
}

// recordOrderEvent appends one row to the order's history.
//
// `at` is passed in rather than taken here so the event and the thing it describes share ONE moment:
// setOrderStatus already stamped `updated_at`, and a second time.Now() at this line would file a
// midnight transition on a different day from the row it belongs to (guidelines/event-guideline.md #2).
func recordOrderEvent(tx *gorm.DB, orderID uint64, kind string, actor uint64, at time.Time) error {
	return tx.Create(&selling_service_models.OrderEvent{
		OrderID:     orderID,
		Kind:        kind,
		ActorUserID: actor,
		At:          at,
	}).Error
}

// eventActor is WHO is doing this, for the history — 0 when the caller cannot be identified.
//
// Deliberately NOT draftAuthor's treatment, which refuses the request outright. A draft is personal,
// so an unidentifiable caller has no correct answer to receive; an event is a byproduct, and refusing
// to confirm an order because its history could not be attributed would let the record-keeping veto
// the work. 0 means "not recorded" everywhere in this system, and the timeline renders such a step
// with its date and no person.
func eventActor(ctx context.Context) uint64 {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return 0
	}

	return identity.GetIdentityId()
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
			UnitCost:  o.Items[i].UnitCost,
		})
	}

	// Empty on every path but OrderDetail, which is the only one that preloads them.
	events := make([]*sellingv1.OrderEvent, 0, len(o.Events))
	for i := range o.Events {
		events = append(events, &sellingv1.OrderEvent{
			Id:          o.Events[i].ID,
			Kind:        orderEventKindFromText(o.Events[i].Kind),
			ActorUserId: o.Events[i].ActorUserID,
			AtUnix:      o.Events[i].At.Unix(),
		})
	}

	return &sellingv1.Order{
		Id:            o.ID,
		TeamId:        o.TeamID,
		ShopId:        o.ShopID,
		WarehouseId:   o.WarehouseID,
		Status:        orderStatusFromText(o.Status),
		CustomerName:  o.CustomerName,
		CustomerPhone: o.CustomerPhone,
		Address:       orderAddressToProto(o),
		ShippingCode:  o.ShippingCode,
		// Out as it came in. Nothing here reads it, and nothing may.
		Note:         o.Note,
		Receipt:      orderReceiptToProto(o),
		Subtotal:     o.Subtotal,
		Cogs:         o.COGS,
		ShippingCost: o.ShippingCost,
		Total:        o.Total,
		// A note, carried out as it was carried in — nothing here derives it and nothing may.
		MarketplaceTotal: o.MarketplaceTotal,
		Items:            items,
		Events:           events,
		CreatedAtUnix:    o.CreatedAt.Unix(),
	}
}

// orderAddressToProto reads the frozen address off the order row. Always returns a message (never
// nil): an order with no address is an EMPTY address, not a missing field — that keeps the client
// from having to null-check a value it will render either way.
func orderAddressToProto(o *selling_service_models.Order) *sellingv1.OrderAddress {
	return &sellingv1.OrderAddress{
		ProvinsiCode:  o.ProvinsiCode,
		ProvinsiName:  o.ProvinsiName,
		KabupatenCode: o.KabupatenCode,
		KabupatenName: o.KabupatenName,
		KecamatanCode: o.KecamatanCode,
		KecamatanName: o.KecamatanName,
		DesaCode:      o.DesaCode,
		DesaName:      o.DesaName,
		KodePos:       o.KodePos,
		AddressLine:   o.AddressLine,
	}
}

// orderReceiptToProto reads the attached shipping receipt off the order row. Always returns a
// message, never nil — an order with no receipt is an EMPTY receipt, exactly as an order with no
// address is an empty address, so a client renders it without null-checking. An empty `document_id`
// is what "none" means.
func orderReceiptToProto(o *selling_service_models.Order) *sellingv1.OrderReceipt {
	return &sellingv1.OrderReceipt{
		DocumentId: o.ReceiptDocumentID,
		Filename:   o.ReceiptFilename,
		MimeType:   o.ReceiptMimeType,
	}
}

// orderItemModels turns request lines into rows; `id` on the input is ignored.
// It deliberately does NOT read unit_cost from the request (#74): what the goods cost comes from the
// WAREHOUSE at order time, and a client supplying it would be writing its own margin — the one number
// nobody placing an order should get to choose. OrderCreate stamps it after building these.
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
