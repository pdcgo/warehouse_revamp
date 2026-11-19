package selling_v1

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

var (
	// errShopFixStatus is a fix asked of an order not handed over yet, or cancelled.
	errShopFixStatus = errors.New("an order's shop is fixed from handover on — shipping, shipped, problem, " +
		"completed, return, return completed or lost")
	// errShopFixMarketplace is a shop of another marketplace (a-shops-marketplace-and-team-are-fixed): its statements
	// are another platform's, so the order can never be in them.
	errShopFixMarketplace = errors.New("the order's shop can only be fixed to a shop of the same marketplace")
)

// shopFixable is where an order's shop may be fixed (an-orders-shop-is-fixed-and-counted-on-the-day, settled in chat
// 2026-11-18): every status FROM HANDOVER ON. A platform statement may carry the order from then — the import posts a
// line to an order whatever its status, and customer service sets the statuses after handover by hand, so an order the
// platform has paid can still read shipped. Before handover (pending, processed, picked) and a cancelled order are
// REFUSED with errShopFixStatus, never ignored: the platform has paid nothing for them. No status from handover on ever
// leads back to pending, so a fixed order is never cancelled (shopAsOf's cancel rule).
var shopFixable = map[string]bool{
	orderStatusShipping:        true,
	orderStatusShipped:         true,
	orderStatusProblem:         true,
	orderStatusCompleted:       true,
	orderStatusReturn:          true,
	orderStatusReturnCompleted: true,
	orderStatusLost:            true,
}

// OrderShopUpdate is FIX AN ORDER'S SHOP (an-orders-shop-is-fixed-and-counted-on-the-day): an order filed under the
// wrong shop moves to another shop of the same team and marketplace, so that shop's statement — refused while the order
// sat elsewhere (a-file-with-another-shops-orders-is-refused) — imports.
//
// THE NEW SHOP is asked first, outside the transaction, the way every order write asks it (refuseShopWrite): another
// team's shop reads NotFound (the scope), and the caller must WRITE it — a grant, or the team's owner or admin
// (a-write-needs-a-grant-or-a-manager). A closed shop is taken: it refuses only new selling
// (a-closed-shop-refuses-only-new-selling), and its statements still import.
//
// THE ROW LOCK (loadScopedOrder) serialises the fix with every status move and every other fix of the order: the moves
// committed before it are on the timeline before its note row, so OrderShopChanged's consumers carry over exactly what
// the order had counted by then, and a move committed after it is counted under the new shop by its own event.
//
// THE RECORD is a note row — no status, from `selling` — naming the old and the new shop, as Edit Resi's is, plus an
// `order_shop_changes` row: the change the order metrics read a past move's shop from (shopAsOf). A request naming the
// shop the order is already in writes nothing and announces nothing.
//
// AFTER THE COMMIT, and non-fatal, OrderShopChanged: settlement moves the order's account and the order metrics count
// the move on the day of the fix — the old shop −1, the new +1 — never re-filing a past day.
func (s *Service) OrderShopUpdate(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderShopUpdateRequest],
) (*connect.Response[sellingv1.OrderShopUpdateResponse], error) {
	teamID := req.Msg.GetTeamId()
	actor := eventActor(ctx)
	override := eventOverride(ctx)

	target, access, err := s.shopAccess(ctx, teamID, req.Msg.GetShopId(), actor)
	if err != nil {
		return nil, err
	}

	if !access {
		return nil, connect.NewError(connect.CodePermissionDenied,
			fmt.Errorf("You have no access to %s — ask the team's owner or admin for it", target.Name))
	}

	var (
		order   selling_service_models.Order
		change  selling_service_models.OrderShopChange
		changed bool
	)

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loadErr := loadScopedOrder(tx, teamID, req.Msg.GetOrderId(), &order)
		if loadErr != nil {
			return loadErr
		}

		if !shopFixable[order.Status] {
			return errShopFixStatus
		}

		if order.ShopID == target.ID {
			return nil
		}

		// The shop it is in now — its marketplace and its name for the note. A shop's team and marketplace never move
		// (a-shops-marketplace-and-team-are-fixed), so no lock is needed to read them.
		var from selling_service_models.Shop

		readErr := tx.
			Select("id", "name", "marketplace").
			Where("id = ?", order.ShopID).
			Take(&from).
			Error
		if readErr != nil {
			return readErr
		}

		if from.Marketplace != target.Marketplace {
			return errShopFixMarketplace
		}

		now := time.Now()

		updateErr := tx.
			Model(&selling_service_models.Order{}).
			Where("id = ?", order.ID).
			Updates(map[string]any{"shop_id": target.ID, "updated_at": now}).
			Error
		if updateErr != nil {
			return updateErr
		}

		note := selling_service_models.OrderTimelineLog{
			OrderID: order.ID,
			// No status: the fix moves nothing along the order's journey.
			Status:     "",
			Note:       "Toko: " + from.Name + " → " + target.Name,
			From:       timelineFromSelling,
			ActorID:    actor,
			IsOverride: override,
			CreatedAt:  now,
		}

		logErr := tx.
			Create(&note).
			Error
		if logErr != nil {
			return logErr
		}

		change = selling_service_models.OrderShopChange{
			OrderID:       order.ID,
			TeamID:        order.TeamID,
			FromShopID:    from.ID,
			ToShopID:      target.ID,
			TimelineLogID: note.ID,
			ActorID:       actor,
			IsOverride:    override,
			CreatedAt:     now,
		}

		changeErr := tx.
			Create(&change).
			Error
		if changeErr != nil {
			return changeErr
		}

		order.ShopID, order.UpdatedAt = target.ID, now
		changed = true

		return nil
	})
	if err != nil {
		if errors.Is(err, errShopFixStatus) || errors.Is(err, errShopFixMarketplace) {
			return nil, connect.NewError(connect.CodeFailedPrecondition, err)
		}

		return nil, mapOrderErr(err)
	}

	if changed {
		s.publishShopChange(ctx, change)
	}

	// The answer names the buyer — from the order's one address row (one-address-per-order-and-per-draft).
	err = attachAddress(s.db.WithContext(ctx), &order)
	if err != nil {
		return nil, dbError(err)
	}

	return connect.NewResponse(&sellingv1.OrderShopUpdateResponse{Order: orderToProto(&order)}), nil
}

// publishShopChange announces a committed fix as OrderShopChanged — after the commit and non-fatal, for
// OrderCancelled's reasons: a report must never count a fix that rolled back, and a fix must never be refused because a
// report could not be told. A lost publish leaves the order's account on the old shop (its statement still refused)
// and the metrics short of the move until it is re-published.
//
// EventId is DERIVED from the change row, so a redelivery and a replay collide on every consumer's dedup; OccurredAt is
// the fix's instant, the day the metrics count the move on (a-fact-counts-on-the-day-it-happened).
func (s *Service) publishShopChange(ctx context.Context, change selling_service_models.OrderShopChange) {
	orderRef := strconv.FormatUint(change.OrderID, 10)

	err := s.events(ctx, eventIdentity(ctx), &eventsv1.Event{
		EventId:     "order-shop-changed:" + strconv.FormatUint(change.ID, 10),
		OccurredAt:  timestamppb.New(change.CreatedAt),
		AggregateId: "order:" + orderRef,
		Message: &eventsv1.Event_OrderShopChanged{
			OrderShopChanged: &eventsv1.OrderShopChanged{
				TeamId:          change.TeamID,
				OrderId:         change.OrderID,
				FromShopId:      change.FromShopID,
				ToShopId:        change.ToShopID,
				ChangeId:        change.ID,
				TimelineLogId:   change.TimelineLogID,
				ActorId:         change.ActorID,
				ActorIsOverride: change.IsOverride,
			},
		},
	})
	if err != nil {
		slog.ErrorContext(ctx, "order's shop fixed but its OrderShopChanged event was not published — "+
			"its settlement account and the order metrics are short of the move until it is",
			"order_id", change.OrderID,
			"change_id", change.ID,
			"error", err,
		)
	}
}
