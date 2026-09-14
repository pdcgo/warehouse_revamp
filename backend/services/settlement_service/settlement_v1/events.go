package settlement_v1

import (
	"context"
	"log/slog"
	"strconv"

	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
)

// publishPosted announces one committed log row as `SettlementLogPosted`.
//
// ⚠ A PUBLISH FAILURE DOES NOT FAIL THE POST. The row is committed and it is the truth; the event is how
// the report and the Financial Ledger learn of it (no-outbox-the-publish-is-trusted). A lost publish is
// logged with its event_id, and re-posting the same unique_id republishes it — the fold dedups on the id.
func (s *Service) publishPosted(ctx context.Context, result PostResult) {
	event := postedEvent(result)

	err := s.events(ctx, publishIdentity(ctx), event)
	if err != nil {
		slog.ErrorContext(ctx, "settlement row committed but SettlementLogPosted was not published — "+
			"re-post the same unique_id to republish it",
			"event_id", event.GetEventId(),
			"error", err,
		)
	}
}

// postedEvent builds the event for one row. Pure, so a test can read what would be sent.
func postedEvent(result PostResult) *eventsv1.Event {
	entry := result.Entry

	// The creator is the ORDER's (#the-creator-is-stamped-on-the-state-row); a shop-addressed row has no
	// order and so none — the fold attributes that row to its actor instead.
	var creator uint64
	if result.State != nil {
		creator = result.State.CreatedByUserID
	}

	var reverses uint64
	if entry.ReversesID != nil {
		reverses = *entry.ReversesID
	}

	logRef := strconv.FormatUint(entry.ID, 10)

	return &eventsv1.Event{
		// DERIVED from the row, never a fresh UUID: a retried publish of the same row must collide in
		// every consumer's dedup rather than fold the movement twice.
		EventId: "settlement-log:" + logRef,
		// When the row was written — the one clock for this fact, identical on a republish.
		OccurredAt:  timestamppb.New(entry.CreatedAt),
		AggregateId: "shop:" + strconv.FormatUint(entry.ShopID, 10),
		Message: &eventsv1.Event_SettlementLogPosted{
			SettlementLogPosted: &eventsv1.SettlementLogPosted{
				LogId:                entry.ID,
				UniqueId:             entry.UniqueID,
				OrderId:              derefOrder(entry.OrderID),
				ShopId:               entry.ShopID,
				TeamId:               entry.TeamID,
				ActorId:              entry.ActorID,
				OrderCreatedByUserId: creator,
				SettlementType:       settlementTypeEnum[entry.SettlementType],
				SourceType:           sourceTypeEnum[entry.SourceType],
				Change:               entry.Change,
				Balance:              entry.Balance,
				PostedOn:             entry.PostedOn.Format(dateLayout),
				OccurredOn:           entry.OccurredOn.Format(dateLayout),
				ReversesId:           reverses,
				Note:                 entry.Note,
			},
		},
	}
}

// publishIdentity is who caused the publish: the caller when a request put one on the ctx, and an
// explicit system identity otherwise (identity-is-a-sender-parameter).
func publishIdentity(ctx context.Context) *role_basev1.Identity {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil {
		return event_source.SystemIdentity("settlement_service")
	}

	return identity
}
