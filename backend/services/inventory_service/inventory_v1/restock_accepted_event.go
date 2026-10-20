package inventory_v1

import (
	"context"
	"log/slog"
	"strconv"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// jakarta is the system's calendar (the-system-runs-on-jakarta-time) — the accept's day is a Jakarta day. Fixed +7:
// WIB has no daylight saving, and a fixed zone needs no tzdata on the host.
var jakarta = time.FixedZone("WIB", 7*60*60)

// publishAccepted announces a committed accept as `RestockAccepted`.
//
// ⚠ A PUBLISH FAILURE DOES NOT FAIL THE ACCEPT. The goods are on the shelf and that is the truth; the event is how a
// supplier's figures learn of it (no-outbox-the-publish-is-trusted). A lost publish is logged with its event_id —
// the figures are then short that restock until a replay or an adjustment, never wrong in the other direction.
func (s *Service) publishAccepted(ctx context.Context, rr *inventory_service_models.Restock) {
	event := RestockAcceptedEvent(rr)

	err := s.events(ctx, publishIdentity(ctx), event)
	if err != nil {
		slog.ErrorContext(ctx, "restock accepted but RestockAccepted was not published — the supplier's figures "+
			"are short this restock",
			"event_id", event.GetEventId(),
			"error", err,
		)
	}
}

// RestockAcceptedEvent builds the event an ACCEPTED restock announces — its items and its problem rows loaded.
// Pure, and exported: the accept sends it, and `san supplier backfill-figures` builds the very same event for a restock
// accepted before the event existed (past-accepts-are-backfilled-once), so the two cannot disagree.
func RestockAcceptedEvent(rr *inventory_service_models.Restock) *eventsv1.Event {
	acceptedAt := rr.UpdatedAt
	if rr.AcceptedAt != nil {
		acceptedAt = *rr.AcceptedAt
	}

	supplierID := commonLineSupplier(rr.Items)

	problems := problemCountsByProduct(rr.Problems)

	lines := make([]*eventsv1.RestockAcceptedLine, 0, len(rr.Items))

	for _, item := range rr.Items {
		counts := problems[item.ProductID]

		lines = append(lines, &eventsv1.RestockAcceptedLine{
			ItemId:       item.ID,
			ProductId:    item.ProductID,
			OrderedCount: item.Count,
			TotalPrice:   item.Total,
			// What was in the box, less what was broken — the batch's sellable count.
			AcceptedCount:     item.ReceivedCount - counts.broken,
			BrokenCount:       counts.broken,
			MissingCount:      counts.missing,
			SupplierId:        idOrZero(item.SupplierID),
			SupplierChannelId: idOrZero(item.SupplierChannelID),
		})
	}

	ref := strconv.FormatUint(rr.ID, 10)

	return &eventsv1.Event{
		// DERIVED from the restock, never a fresh UUID: a restock is accepted once, so a republish, a replay and the
		// backfill all collide in the fold's dedup.
		EventId: "restock-accepted:" + ref,
		// The accept — the one clock for this fact, identical on a republish.
		OccurredAt:  timestamppb.New(acceptedAt),
		AggregateId: "restock:" + ref,
		Message: &eventsv1.Event_RestockAccepted{
			RestockAccepted: &eventsv1.RestockAccepted{
				RestockId:   rr.ID,
				TeamId:      rr.TeamID,
				WarehouseId: rr.WarehouseID,
				SupplierId:  supplierID,
				AcceptedOn:  acceptedAt.In(jakarta).Format("2006-01-02"),
				Lines:       lines,
				// restock-accepted-carries-every-line: the instant, beside the day derived from it.
				AcceptedAtUnix: acceptedAt.Unix(),
				// The courier's charge, which balance posts as the selling team's debt to the warehouse
				// (balance-posts-the-couriers-debt-from-the-event), and who counted the box in — both from the stored row.
				WarehouseAdditionalCost:     rr.WarehouseAdditionalCost,
				WarehouseAdditionalCostNote: rr.WarehouseAdditionalCostNote,
				ActorId:                     rr.AcceptedByUserID,
			},
		},
	}
}

// AcceptedRestocks is every ACCEPTED restock that names a supplier, oldest first, loaded the way RestockAcceptedEvent
// needs it — its items in order, and its problem rows. For `san supplier backfill-figures`
// (past-accepts-are-backfilled-once): what "accepted" is stored as stays inventory's to know.
func AcceptedRestocks(db *gorm.DB) *gorm.DB {
	return db.
		Model(&inventory_service_models.Restock{}).
		Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		Preload("Problems").
		Where("status = ?", restockStatusAccepted).
		Where("EXISTS (SELECT 1 FROM restock_items i " +
			"WHERE i.restock_id = restocks.id AND i.supplier_id IS NOT NULL)").
		Order("id")
}

// commonLineSupplier is the one supplier every line names, or 0 when they disagree or one names none.
//
// ⚠ supplier_service's figures still fold a whole restock under the event's restock-level supplier_id. Lines name their
// own supplier now (a-line-names-the-channel-it-was-bought-from) and the event carries each, but until the fold reads a
// line's own, a restock whose lines name one supplier keeps feeding it, and one that mixes suppliers credits none of
// them rather than all of it to the first.
func commonLineSupplier(items []inventory_service_models.RestockItem) uint64 {
	var supplier uint64

	for i := range items {
		id := idOrZero(items[i].SupplierID)
		if id == 0 || (supplier != 0 && supplier != id) {
			return 0
		}

		supplier = id
	}

	return supplier
}

// publishIdentity is who caused the publish: the caller when a request put one on the ctx, and an explicit system
// identity otherwise (identity-is-a-sender-parameter).
func publishIdentity(ctx context.Context) *role_basev1.Identity {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return event_source.SystemIdentity("inventory_service")
	}

	return identity
}
