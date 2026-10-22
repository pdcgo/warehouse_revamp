package selling_v1

import (
	"context"
	"log/slog"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// moveRefusal is why one order did not move — a sentence for the person who asked, never a code.
type moveRefusal string

// OrderStatusChange makes one plain move for many orders (one-status-change-for-every-plain-move): the
// warehouse's confirm, pick, hand back and handover, and customer service's shipped, completed, problem,
// lost and forced return. The table of who may make which move is orderMoves.
//
// EACH ORDER HAS ITS OWN RESULT. A handover scan of 30 parcels where 2 were never picked moves the 28 and
// says why the 2 did not — one refusal never blocks the rest, which is what a crew at a van needs.
//
// The scope is either end of the order, and WHICH end the caller is decides the moves it may make: the
// order's warehouse makes the warehouse's, its selling team makes customer service's.
func (s *Service) OrderStatusChange(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderStatusChangeRequest],
) (*connect.Response[sellingv1.OrderStatusChangeResponse], error) {
	teamID := req.Msg.GetTeamId()
	orderIDs := req.Msg.GetOrderIds()
	to := orderStatusToText(req.Msg.GetTo())
	note := strings.TrimSpace(req.Msg.GetNote())

	results, err := s.moveOrders(ctx, teamID, orderIDs, to, note)
	if err != nil {
		// The DATABASE failed, not a rule: the whole batch rolled back, so nothing moved, and every order says
		// so. The crew scans again — a whole-batch retry is the natural one for a scan.
		slog.ErrorContext(ctx, "a batch status move could not be saved",
			"team_id", teamID,
			"to", to,
			"orders", len(orderIDs),
			"error", err,
		)

		results = make([]*sellingv1.OrderStatusChangeResult, 0, len(orderIDs))
		for _, orderID := range orderIDs {
			results = append(results, &sellingv1.OrderStatusChangeResult{
				OrderId:       orderID,
				RefusedReason: "could not be saved — try again",
			})
		}
	}

	return connect.NewResponse(&sellingv1.OrderStatusChangeResponse{Results: results}), nil
}

// moveOrders moves the batch in ONE transaction (a-batch-move-saves-in-one-transaction): lock, decide, write.
// Four statements whatever the batch size — the per-order transactions it replaced cost four round trips per
// order, a quarter of a second for 200.
//
// ⚠ FOR UPDATE IN ID ORDER, then the checks, then the writes. Two crew scanning the same parcels in the same
// second is the normal case here: the second waits on the first's locks, then reads the statuses the first
// wrote and is refused as "already shipping" instead of writing the move twice. Locking in ID order — never in
// the order the ids were scanned — is what lets two batches over the same orders queue instead of deadlocking.
//
// A refusal is decided in Go, from the locked row, before anything is written, so it still touches only its
// own order. Only an error from the database fails the batch.
func (s *Service) moveOrders(
	ctx context.Context,
	teamID uint64,
	orderIDs []uint64,
	to, note string,
) ([]*sellingv1.OrderStatusChangeResult, error) {
	var results []*sellingv1.OrderStatusChangeResult

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var orders []selling_service_models.Order

		err := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id IN ? AND (team_id = ? OR warehouse_id = ?)", orderIDs, teamID, teamID).
			Order("id").
			Find(&orders).
			Error
		if err != nil {
			return err
		}

		byID := make(map[uint64]*selling_service_models.Order, len(orders))
		for i := range orders {
			byID[orders[i].ID] = &orders[i]
		}

		results = make([]*sellingv1.OrderStatusChangeResult, 0, len(orderIDs))
		moving := make([]timelineMove, 0, len(orders))

		for _, orderID := range orderIDs {
			result := &sellingv1.OrderStatusChangeResult{OrderId: orderID}
			results = append(results, result)

			order, ok := byID[orderID]
			if !ok {
				// NotFound and "another team's order" read the same, so a caller cannot probe for which ids exist.
				result.RefusedReason = "not one of this team's orders"

				continue
			}

			refusal := refuseMove(order, teamID, to, note)
			if refusal != "" {
				result.Status = orderStatusFromText(order.Status)
				result.RefusedReason = string(refusal)

				continue
			}

			// The side is read before the status changes in memory: it depends on the move, from → to.
			from := moveFrom(order, teamID, to)

			// Moved in memory now, so an id sent twice reads "already <to>" the second time rather than being
			// written twice. The proto refuses duplicates; a direct caller gets the same answer.
			order.Status = to
			result.Moved = true
			result.Status = orderStatusFromText(to)
			moving = append(moving, timelineMove{order: order, from: from})
		}

		return setOrdersStatus(tx, moving, to, eventActor(ctx), note)
	})

	return results, err
}

// refuseMove is why this caller may not move this order to `to`, or "" when it may.
func refuseMove(order *selling_service_models.Order, teamID uint64, to, note string) moveRefusal {
	from := order.Status

	switch {
	case from == to:
		return moveRefusal("already " + to)
	case to == orderStatusCancel:
		return "a cancel is its own action: Cancel Order, by the selling team"
	case to == orderStatusReturnCompleted:
		return "a return is completed by the warehouse's accept"
	}

	rule, ok := orderMoves[orderMove{from: from, to: to}]
	if !ok {
		return moveRefusal(from + " cannot move to " + to)
	}

	if rule.by&callerSide(order, teamID) == 0 {
		if rule.by == sideWarehouse {
			return moveRefusal("only the warehouse moves " + from + " to " + to)
		}

		return moveRefusal("only the selling team moves " + from + " to " + to)
	}

	if rule.needsNote && note == "" {
		return moveRefusal("a note is required to move " + from + " back to " + to)
	}

	return ""
}

// moveFrom is the side a move's timeline row is written from: the end of the order that made it. A team that is
// both ends, making a move either may make (a forced return), writes it as the warehouse.
func moveFrom(order *selling_service_models.Order, teamID uint64, to string) string {
	rule := orderMoves[orderMove{from: order.Status, to: to}]

	if rule.by&callerSide(order, teamID)&sideWarehouse != 0 {
		return timelineFromWarehouse
	}

	return timelineFromSelling
}

// callerSide is which end of the order the caller is. Both, for a team that is its own warehouse.
func callerSide(order *selling_service_models.Order, teamID uint64) moveSide {
	var side moveSide

	if order.WarehouseID == teamID {
		side |= sideWarehouse
	}

	if order.TeamID == teamID {
		side |= sideSelling
	}

	return side
}
