package selling_v1

import (
	"context"
	"log/slog"
	"strconv"
	"sync"

	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// statusMove is one order a batch move wrote: the order as it now is, the status it left, and its timeline row.
type statusMove struct {
	order selling_service_models.Order
	from  string
	log   selling_service_models.OrderTimelineLog
}

// publishParallel caps how many publishes wait on the broker at once. A handover scan is one call for many orders, and
// each publish waits for its acknowledgement, so one at a time would add a round trip per parcel to the scan.
const publishParallel = 16

// publishMoves announces each committed move as OrderStatusChanged (the-status-changes-publish-nothing) — one event per
// order, so a handover of 30 parcels is 30 events, each folded on its own.
//
// AFTER THE COMMIT AND NON-FATAL, for OrderCancelled's reasons: a rolled-back move that a report had already counted
// would be a figure for something that never happened, and a move refused because a report could not be told would be
// the tail wagging the dog. A lost publish leaves the report short until somebody notices
// (a-report-is-fed-by-events-only-for-now).
//
// EventId is DERIVED from the move's timeline row, so a redelivery and a replay collide on the fold's dedup; OccurredAt
// is that row's time, the day the move counts on (a-fact-counts-on-the-day-it-happened).
func (s *Service) publishMoves(ctx context.Context, moves []statusMove) {
	if len(moves) == 0 {
		return
	}

	identity := eventIdentity(ctx)
	slots := make(chan struct{}, publishParallel)

	var wg sync.WaitGroup

	for _, move := range moves {
		slots <- struct{}{}

		wg.Add(1)

		go func(move statusMove) {
			defer func() {
				<-slots
				wg.Done()
			}()

			orderRef := strconv.FormatUint(move.order.ID, 10)

			err := s.events(ctx, identity, &eventsv1.Event{
				EventId:     "order-status-changed:" + strconv.FormatUint(move.log.ID, 10),
				OccurredAt:  timestamppb.New(move.log.CreatedAt),
				AggregateId: "order:" + orderRef,
				Message: &eventsv1.Event_OrderStatusChanged{
					OrderStatusChanged: &eventsv1.OrderStatusChanged{
						TeamId:        move.order.TeamID,
						OrderId:       move.order.ID,
						FromStatus:    move.from,
						ToStatus:      move.order.Status,
						ActorId:       move.log.ActorID,
						TimelineLogId: move.log.ID,
					},
				},
			})
			if err != nil {
				slog.ErrorContext(ctx, "order moved but its OrderStatusChanged event was not published — "+
					"the order metrics are short of this move until it is",
					"order_id", move.order.ID,
					"to", move.order.Status,
					"timeline_log_id", move.log.ID,
					"error", err,
				)
			}
		}(move)
	}

	wg.Wait()
}
