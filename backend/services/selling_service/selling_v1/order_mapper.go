package selling_v1

import (
	"context"
	"time"

	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderStatus as stored in the `status` TEXT column — the eleven of the order context's status diagram
// (the-status-move-is-the-only-journey). This mapper is the only writer/reader, so validity is guarded
// here (no DB CHECK, cf. #80). 00015 moved every row from the old six.
const (
	orderStatusPending         = "pending"
	orderStatusProcessed       = "processed"
	orderStatusPicked          = "picked"
	orderStatusShipping        = "shipping"
	orderStatusShipped         = "shipped"
	orderStatusCompleted       = "completed"
	orderStatusProblem         = "problem"
	orderStatusLost            = "lost"
	orderStatusReturn          = "return"
	orderStatusReturnCompleted = "return_completed"
	orderStatusCancel          = "cancel"
)

// orderStatusTexts is the ONE pairing of a stored status and its proto value. Both directions read it,
// so a status added to one cannot be missing from the other.
var orderStatusTexts = map[string]sellingv1.OrderStatus{
	orderStatusPending:         sellingv1.OrderStatus_ORDER_STATUS_PENDING,
	orderStatusProcessed:       sellingv1.OrderStatus_ORDER_STATUS_PROCESSED,
	orderStatusPicked:          sellingv1.OrderStatus_ORDER_STATUS_PICKED,
	orderStatusShipping:        sellingv1.OrderStatus_ORDER_STATUS_SHIPPING,
	orderStatusShipped:         sellingv1.OrderStatus_ORDER_STATUS_SHIPPED,
	orderStatusCompleted:       sellingv1.OrderStatus_ORDER_STATUS_COMPLETED,
	orderStatusProblem:         sellingv1.OrderStatus_ORDER_STATUS_PROBLEM,
	orderStatusLost:            sellingv1.OrderStatus_ORDER_STATUS_LOST,
	orderStatusReturn:          sellingv1.OrderStatus_ORDER_STATUS_RETURN,
	orderStatusReturnCompleted: sellingv1.OrderStatus_ORDER_STATUS_RETURN_COMPLETED,
	orderStatusCancel:          sellingv1.OrderStatus_ORDER_STATUS_CANCEL,
}

// orderStatusToText is "" for UNSPECIFIED or a value this build does not know.
func orderStatusToText(s sellingv1.OrderStatus) string {
	for text, status := range orderStatusTexts {
		if status == s {
			return text
		}
	}

	return ""
}

// orderStatusFromText is UNSPECIFIED for a text this build does not know.
func orderStatusFromText(text string) sellingv1.OrderStatus {
	return orderStatusTexts[text]
}

// Which side wrote a timeline row (order-timeline-logs-replaces-order-events), as stored in its `from` column.
const (
	timelineFromWarehouse = "warehouse"
	timelineFromSelling   = "selling"
)

var timelineFroms = map[string]sellingv1.OrderTimelineFrom{
	timelineFromWarehouse: sellingv1.OrderTimelineFrom_ORDER_TIMELINE_FROM_WAREHOUSE,
	timelineFromSelling:   sellingv1.OrderTimelineFrom_ORDER_TIMELINE_FROM_SELLING,
}

// recordTimelineLogs appends rows to orders' timelines in one INSERT — one row for a placement, one per order for a
// batch move. The caller stamps CreatedAt, so a row and the change it describes share ONE moment
// (guidelines/event-guideline.md #2).
func recordTimelineLogs(tx *gorm.DB, logs []selling_service_models.OrderTimelineLog) error {
	if len(logs) == 0 {
		return nil
	}

	return tx.Create(&logs).Error
}

// timelineLogToProto maps one timeline row. A status this build does not know travels as UNSPECIFIED, which the
// screen shows as an unknown step rather than dropping the row — a gap reads as nothing having happened.
func timelineLogToProto(log *selling_service_models.OrderTimelineLog) *sellingv1.OrderTimelineLog {
	return &sellingv1.OrderTimelineLog{
		Id:            log.ID,
		Status:        orderStatusFromText(log.Status),
		Note:          log.Note,
		From:          timelineFroms[log.From],
		ActorId:       log.ActorID,
		CreatedAtUnix: log.CreatedAt.Unix(),
	}
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

// eventIdentity is what the sender's identity PARAMETER takes (identity-is-a-sender-parameter): the
// caller's identity when the access interceptor put one on the ctx, and an explicit SYSTEM identity
// when it did not.
//
// san_auth.GetIdentity ERRORS rather than returning nil outside a request, so passing its error
// through would fail every event published by a worker, a backfill or tools/san. SystemIdentity names
// the agent on purpose — "the system did it" with no agent is indistinguishable from a call site that
// simply lost the user.
//
// ⚠ It is NOT the same thing as eventActor above. This says who caused the PUBLISH — an operator
// running a backfill six hours later. actor_id on the variant says who placed the ORDER, read from the
// stored row, and a consumer folding the fact reads that one.
func eventIdentity(ctx context.Context) *role_basev1.Identity {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return event_source.SystemIdentity("selling_service")
	}

	return identity
}

func orderToProto(o *selling_service_models.Order) *sellingv1.Order {
	items := make([]*sellingv1.OrderItem, 0, len(o.Items))

	// The list query selects the unit count; a detail, which loads the lines, counts them here.
	itemQuantity := o.ItemQuantity

	for i := range o.Items {
		if o.ItemQuantity == 0 {
			itemQuantity += int64(o.Items[i].Quantity)
		}

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
	timeline := make([]*sellingv1.OrderTimelineLog, 0, len(o.TimelineLogs))
	for i := range o.TimelineLogs {
		timeline = append(timeline, timelineLogToProto(&o.TimelineLogs[i]))
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
		// The storefront's own id for this order, verbatim in both directions.
		OrderExternalRefId: o.OrderExternalRefID,
		Items:              items,
		TimelineLogs:       timeline,
		CreatedAtUnix:      o.CreatedAt.Unix(),
		CreatedByUserId:    o.CreatedByUserID,
		ItemQuantity:       itemQuantity,
		// The number printed on the receipt — the proto's `receipt` being the file it is printed on.
		ReceiptCode:  o.Receipt,
		StatusAtUnix: statusAtUnix(o),
		// Absent stays absent: a nil fee is "never priced", never a fee of 0.
		WarehouseFee: o.WarehouseFee,
		// The platform's two dates; 0 = not recorded.
		PlatformCreatedAtUnix:        unixOrZero(o.PlatformCreatedAt),
		PlatformShipmentDeadlineUnix: unixOrZero(o.PlatformShipmentDeadline),
	}
}

// unixOrZero is a nullable moment as unix seconds — 0 when it was never recorded, which is how the contract spells
// "none" for the platform's dates.
func unixOrZero(t *time.Time) int64 {
	if t == nil {
		return 0
	}

	return t.Unix()
}

// timeOrNil is the other direction: 0 from the wire is "none", stored as NULL — never as 1970.
func timeOrNil(unix int64) *time.Time {
	if unix <= 0 {
		return nil
	}

	t := time.Unix(unix, 0)

	return &t
}

// statusAtUnix is when the order entered its CURRENT status (a-filtered-status-shows-its-own-date): the list selects it
// with a subquery, a detail finds it on the timeline it loaded — the newest row moving the order into its status, so
// an order moved back into a status reads the later move. 0 when no row records it.
func statusAtUnix(o *selling_service_models.Order) int64 {
	if o.StatusAt != nil {
		return o.StatusAt.Unix()
	}

	var at int64

	for i := range o.TimelineLogs {
		log := &o.TimelineLogs[i]

		if log.Status == o.Status && log.CreatedAt.Unix() >= at {
			at = log.CreatedAt.Unix()
		}
	}

	return at
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
