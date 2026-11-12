package selling_v1

import (
	"strconv"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderSaleEventsOn is the day's sales as the orders announced them: the OrderPlaced of every order placed on the Jakarta
// day (its instant = the order's created_at) and the OrderCancelled of every order cancelled on it (its instant = the
// cancel's timeline row) — oldest placement first, then the cancels. For `san report refold --report
// supplier-sale-daily` (a-wrong-day-is-refolded-from-the-log): a report fed by those two events re-reads its day here,
// through the composition root, and selling keeps what "placed" and "cancelled on a day" are stored as.
//
// ⚠ THE IDS AND MOMENTS ARE THE PUBLISHED ONES (order_place.go, order_cancel.go), so a claim written from one collides
// with the event's redelivery. The body carries what the order row holds — the team, shop, warehouse, creator, key,
// take, platform total, fee, goods cost, and each line's product, quantity, unit cost and frozen total — but not what
// the placement resolved elsewhere at the time (a line's owning team, whether its cost was known): no sales fold reads
// those.
func OrderSaleEventsOn(db *gorm.DB, day string) ([]*eventsv1.Event, error) {
	start, err := time.ParseInLocation(metricDateLayout, day, wib)
	if err != nil {
		return nil, err
	}

	end := start.AddDate(0, 0, 1)

	placed := []selling_service_models.Order{}

	err = db.
		Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		Where("created_at >= ? AND created_at < ?", start, end).
		Order("created_at, id").
		Find(&placed).
		Error
	if err != nil {
		return nil, err
	}

	cancels := []struct {
		OrderID    uint64
		ActorID    uint64
		IsOverride bool
		CreatedAt  time.Time
	}{}

	err = db.
		Raw(`SELECT order_id, actor_id, is_override, created_at FROM order_timeline_logs
WHERE status = ? AND created_at >= ? AND created_at < ?
ORDER BY created_at, id`, orderStatusCancel, start, end).
		Scan(&cancels).
		Error
	if err != nil {
		return nil, err
	}

	events := make([]*eventsv1.Event, 0, len(placed)+len(cancels))

	for i := range placed {
		events = append(events, placedSaleEvent(&placed[i]))
	}

	if len(cancels) == 0 {
		return events, nil
	}

	ids := make([]uint64, 0, len(cancels))
	for _, c := range cancels {
		ids = append(ids, c.OrderID)
	}

	cancelled := []selling_service_models.Order{}

	err = db.
		Where("id IN ?", ids).
		Find(&cancelled).
		Error
	if err != nil {
		return nil, err
	}

	byID := make(map[uint64]*selling_service_models.Order, len(cancelled))
	for i := range cancelled {
		byID[cancelled[i].ID] = &cancelled[i]
	}

	for _, c := range cancels {
		order := byID[c.OrderID]
		if order == nil {
			continue
		}

		ref := strconv.FormatUint(order.ID, 10)

		events = append(events, &eventsv1.Event{
			EventId:     "order-cancelled:" + ref,
			OccurredAt:  timestamppb.New(c.CreatedAt),
			AggregateId: "order:" + ref,
			Message: &eventsv1.Event_OrderCancelled{OrderCancelled: &eventsv1.OrderCancelled{
				TeamId: order.TeamID, OrderId: order.ID, ActorId: c.ActorID, ActorIsOverride: c.IsOverride,
				ShopId: order.ShopID, IdempotencyKey: order.IdempotencyKey, WarehouseId: order.WarehouseID,
			}},
		})
	}

	return events, nil
}

// placedSaleEvent is an order's OrderPlaced as the order row holds it.
func placedSaleEvent(order *selling_service_models.Order) *eventsv1.Event {
	ref := strconv.FormatUint(order.ID, 10)

	lines := make([]*eventsv1.OrderPlacedLine, 0, len(order.Items))

	for i := range order.Items {
		item := order.Items[i]

		var total float64
		if item.Total != nil {
			total = *item.Total
		}

		lines = append(lines, &eventsv1.OrderPlacedLine{
			ProductId: item.ProductID, Quantity: item.Quantity, UnitCost: item.UnitCost, Total: total,
		})
	}

	var take uint64
	if order.TransactionID != nil {
		take = *order.TransactionID
	}

	return &eventsv1.Event{
		EventId:     "order-placed:" + ref,
		OccurredAt:  timestamppb.New(order.CreatedAt),
		AggregateId: "order:" + ref,
		Message: &eventsv1.Event_OrderPlaced{OrderPlaced: &eventsv1.OrderPlaced{
			TeamId: order.TeamID, OrderId: order.ID, GoodsCost: order.GoodsCost, WarehouseId: order.WarehouseID,
			Lines: lines, ActorId: order.CreatedByUserID, ActorIsOverride: order.IsOverride, ShopId: order.ShopID,
			PlatformTotal: order.PlatformTotal, WarehouseFee: order.WarehouseFee, IdempotencyKey: order.IdempotencyKey,
			TransactionId: take,
		}},
	}
}
