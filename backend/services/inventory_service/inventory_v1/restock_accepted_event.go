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
func (s *Service) publishAccepted(ctx context.Context, rr *inventory_service_models.RestockRequest) {
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

// RestockAcceptedEvent builds the event an ACCEPTED restock announces — its items loaded, each with its damaged units.
// Pure, and exported: the accept sends it, and `san supplier backfill-figures` builds the very same event for a restock
// accepted before the event existed (past-accepts-are-backfilled-once), so the two cannot disagree.
func RestockAcceptedEvent(rr *inventory_service_models.RestockRequest) *eventsv1.Event {
	acceptedAt := rr.UpdatedAt
	if rr.AcceptedAt != nil {
		acceptedAt = *rr.AcceptedAt
	}

	var supplierID uint64
	if rr.SupplierID != nil {
		supplierID = *rr.SupplierID
	}

	lines := make([]*eventsv1.RestockAcceptedLine, 0, len(rr.Items))

	for _, item := range rr.Items {
		var broken, lost int64

		for _, d := range item.Damaged {
			switch d.DamageType {
			case restockDamageBroken:
				broken += d.Quantity
			case restockDamageLost:
				lost += d.Quantity
			}
		}

		lines = append(lines, &eventsv1.RestockAcceptedLine{
			ItemId:        item.ID,
			ProductId:     item.ProductID,
			OrderedCount:  item.Quantity,
			TotalPrice:    item.TotalPrice,
			AcceptedCount: item.ReceivedQuantity,
			BrokenCount:   broken,
			LostCount:     lost,
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
				TeamId:      rr.RequestingTeamID,
				WarehouseId: rr.WarehouseID,
				SupplierId:  supplierID,
				AcceptedOn:  acceptedAt.In(jakarta).Format("2006-01-02"),
				Lines:       lines,
			},
		},
	}
}

// AcceptedRestocks is every ACCEPTED restock that names a supplier, oldest first, loaded the way RestockAcceptedEvent
// needs it — its items in order, each with its damaged units. For `san supplier backfill-figures`
// (past-accepts-are-backfilled-once): what "accepted" is stored as stays inventory's to know.
func AcceptedRestocks(db *gorm.DB) *gorm.DB {
	return db.
		Model(&inventory_service_models.RestockRequest{}).
		Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		Preload("Items.Damaged").
		Where("status = ? AND supplier_id IS NOT NULL", restockStatusFulfilled).
		Order("id")
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
