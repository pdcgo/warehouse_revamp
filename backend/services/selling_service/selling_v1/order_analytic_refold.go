package selling_v1

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_event"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// A WRONG DAY IS RE-FOLDED FROM THE LOG (docs/business/settlement/context_decision.md#a-wrong-day-is-refolded-from-the-log)
// — for the order metrics: the repair for a day of `order_daily_reports` that is short while the orders are right,
// which is what a lost event leaves (a-report-is-fed-by-events-only-for-now). One report, one scope — a seller team —
// one Jakarta day: it re-reads the day's moves of the team's orders, recomputes the day's rows and replaces them. It
// writes no order and no timeline row. `san report refold --report order-daily` is its one caller.
//
// THE LOG is the orders and their timeline — the very rows each event was built from, one event per move:
//
//	created         orders.created_at                         order-placed:<order>
//	cancelled       the timeline row INTO cancel              order-cancelled:<order>
//	return_created  a timeline row INTO return                order-status-changed:<timeline row>
//	lost_created    a timeline row INTO lost                  order-status-changed:<timeline row>
//	return_arrived  the timeline row INTO return_completed    order-return-accepted:<order>
//	warehouse_fee   +1 and the fee beside a created, −1 and the fee beside a cancelled — an order with a fee only
//
// Every figure is the order's own frozen one, as the fold reads it. No row carries a balance, so no later day moves.
//
// ⚠ WHAT IT COUNTS, so that it never races the fold into a double count — settlement's rule
// (settlement_v1/day_refold.go):
//
//   - every move whose event is CLAIMED in `order_event_logs`;
//   - every move never claimed and older than refoldInFlight — its event was lost. The re-fold CLAIMS it (the event's
//     own id), so a late redelivery is a no-op;
//   - NOT a move never claimed and younger than that: its event is in flight, and the fold adds it after this commits.
//
// ⚠ THE LOCK. The fold takes no advisory lock: it claims, then upserts — and an upsert holds ROW EXCLUSIVE on the report
// until it commits. So the re-fold claims first (the fold's order), then takes `order_daily_reports` in SHARE ROW
// EXCLUSIVE: it waits for every fold that already wrote to commit, and every fold that has not yet written waits for the
// re-fold. Reads are not blocked (ACCESS SHARE). Under that lock the claims are re-read: a fold still waiting holds a
// claim nobody else can see, is not counted, and adds its move after.

// ReportOrderDaily is `order_daily_reports`, re-folded per seller team.
const ReportOrderDaily = "order-daily"

// refoldInFlight is how young an unclaimed move may be and still count as an event on its way — settlement's hour:
// Pub/Sub's backoff tops out at ten minutes, and the order's publish waits a minute at most.
const refoldInFlight = "1 hour"

var (
	errRefoldNoTeam = errors.New(ReportOrderDaily + " re-folds one seller team: a team id is required")
	// errRefoldDryRun rolls the dry run's transaction back after everything was computed.
	errRefoldDryRun = errors.New("dry run")
)

// OrderDayRefoldInput is one re-fold: the seller team and the Jakarta day.
type OrderDayRefoldInput struct {
	TeamID uint64
	Day    string
	// DryRun computes everything, writes it inside the transaction, and rolls it back.
	DryRun bool
}

// OrderDayRefoldRow is one of the day's report rows — a metric for one shop, warehouse and creator: as stored before,
// and as the orders say. Before is nil when the day had no such row; After nil when the row is removed.
type OrderDayRefoldRow struct {
	Metric      string
	ShopID      uint64
	WarehouseID uint64
	UserID      uint64

	Before *selling_service_models.OrderMetricColumns
	After  *selling_service_models.OrderMetricColumns
}

// OrderDayRefoldResult is what the re-fold found and did.
type OrderDayRefoldResult struct {
	Rows []OrderDayRefoldRow

	// Counted is how many moves the day's rows were rebuilt from; Claimed how many of them nobody had claimed (their
	// events were lost); InFlight how many were left to the fold.
	Counted  int
	Claimed  int
	InFlight int

	DryRun bool
}

// Changed says whether any row moved.
func (r OrderDayRefoldResult) Changed() bool {
	for _, row := range r.Rows {
		if !sameOrderColumns(row.Before, row.After) {
			return true
		}
	}

	return false
}

// refoldMove is one move of the day: its event, its metric, the order's key and frozen figures, and the claim.
type refoldMove struct {
	EventID     string
	Metric      string
	OrderID     uint64
	LogID       uint64
	At          time.Time
	ShopID      uint64
	WarehouseID uint64
	UserID      uint64
	TotalCost   float64
	MpTotal     float64
	Fee         *float64
	Claimed     bool
	Old         bool
}

// refoldKey is a report row of the day under the team.
type refoldKey struct {
	Metric      string
	ShopID      uint64
	WarehouseID uint64
	UserID      uint64
}

// DayRefold re-folds one seller team's day of `order_daily_reports` from its orders and their timeline.
func (a *Analytic) DayRefold(ctx context.Context, in OrderDayRefoldInput) (OrderDayRefoldResult, error) {
	result := OrderDayRefoldResult{DryRun: in.DryRun}

	if in.TeamID == 0 {
		return result, errRefoldNoTeam
	}

	start, err := time.ParseInLocation(metricDateLayout, in.Day, wib)
	if err != nil {
		return result, fmt.Errorf("date must be YYYY-MM-DD: %w", err)
	}

	err = a.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error

		result, err = refoldOrderDay(tx, in, start)
		if err != nil {
			return err
		}

		if in.DryRun {
			return errRefoldDryRun
		}

		return nil
	})
	if errors.Is(err, errRefoldDryRun) {
		return result, nil
	}

	if err != nil {
		return OrderDayRefoldResult{DryRun: in.DryRun}, err
	}

	return result, nil
}

func refoldOrderDay(tx *gorm.DB, in OrderDayRefoldInput, start time.Time) (OrderDayRefoldResult, error) {
	result := OrderDayRefoldResult{DryRun: in.DryRun}

	// 1 · THE DAY's MOVES, each with its claim and its age.
	moves, err := dayMoves(tx, in.TeamID, start)
	if err != nil {
		return result, err
	}

	// 2 · CLAIM THE LOST ONES — before the report's lock, as the fold claims before it writes. A fold redelivering one
	// of them right now holds its claim uncommitted; this insert waits for it, and DO NOTHING keeps whichever came first.
	for _, move := range moves {
		if move.Claimed || !move.Old {
			continue
		}

		// The claim keeps the event as the order announced it — its id, its moment, its order — so a person questioning
		// the figure reads the same kind of row whoever claimed it.
		raw, err := san_event.Marshal(lostMoveEvent(in.TeamID, move))
		if err != nil {
			return result, err
		}

		claim := tx.Exec(
			`INSERT INTO order_event_logs (id, raw, day) VALUES (?, ?, CAST(? AS date)) ON CONFLICT (id) DO NOTHING`,
			move.EventID, raw, in.Day,
		)
		if claim.Error != nil {
			return result, fmt.Errorf("order re-fold: claim %s: %w", move.EventID, claim.Error)
		}

		if claim.RowsAffected == 1 {
			result.Claimed++
		}
	}

	// 3 · THE FOLD's OWN LOCK — every upsert's ROW EXCLUSIVE on the report waits on this, and this on every upsert.
	err = tx.Exec(`LOCK TABLE order_daily_reports IN SHARE ROW EXCLUSIVE MODE`).Error
	if err != nil {
		return result, fmt.Errorf("order re-fold: lock the report: %w", err)
	}

	// 4 · UNDER THE LOCK, what counts is every move with a visible claim. An unclaimed one now is in flight.
	moves, err = dayMoves(tx, in.TeamID, start)
	if err != nil {
		return result, err
	}

	after := map[refoldKey]*selling_service_models.OrderMetricColumns{}

	add := func(key refoldKey, move selling_service_models.OrderMetricColumns) {
		row := after[key]
		if row == nil {
			row = &selling_service_models.OrderMetricColumns{}
			after[key] = row
		}

		row.OrderCount += move.OrderCount
		row.Total += move.Total
		row.MpTotal += move.MpTotal
	}

	for _, move := range moves {
		if !move.Claimed {
			result.InFlight++

			continue
		}

		result.Counted++

		key := refoldKey{Metric: move.Metric, ShopID: move.ShopID, WarehouseID: move.WarehouseID, UserID: move.UserID}

		// The fold's own sum: one order, its total_cost and its platform_total…
		add(key, selling_service_models.OrderMetricColumns{OrderCount: 1, Total: move.TotalCost, MpTotal: move.MpTotal})

		// …and the fee row beside a placement or a cancel, by the fold's own rule.
		fee, ok := feeMove(move.Metric, move.Fee)
		if ok {
			key.Metric = reportWarehouseFee
			add(key, fee)
		}
	}

	// 5 · THE STORED ROWS of the team's day, and every key either side holds.
	stored := []selling_service_models.OrderDailyReport{}

	err = tx.
		Where("team_id = ? AND day = CAST(? AS date)", in.TeamID, in.Day).
		Find(&stored).
		Error
	if err != nil {
		return result, fmt.Errorf("order re-fold: read the day's rows: %w", err)
	}

	before := map[refoldKey]*selling_service_models.OrderMetricColumns{}

	for i := range stored {
		row := stored[i]
		before[refoldKey{Metric: row.Metric, ShopID: row.ShopID, WarehouseID: row.WarehouseID, UserID: row.UserID}] = &row.OrderMetricColumns
	}

	keys := make([]refoldKey, 0, len(before)+len(after))
	for key := range before {
		keys = append(keys, key)
	}

	for key := range after {
		if before[key] == nil {
			keys = append(keys, key)
		}
	}

	slices.SortFunc(keys, compareRefoldKeys)

	// 6 · REPLACE what differs, remove what the orders do not hold, leave what already matches — `last_updated`
	// included, so a second run writes nothing.
	for _, key := range keys {
		row := OrderDayRefoldRow{
			Metric: key.Metric, ShopID: key.ShopID, WarehouseID: key.WarehouseID, UserID: key.UserID,
			Before: before[key], After: after[key],
		}

		result.Rows = append(result.Rows, row)

		if sameOrderColumns(row.Before, row.After) {
			continue
		}

		err = writeRefoldRow(tx, in.TeamID, in.Day, key, row.After)
		if err != nil {
			return result, err
		}
	}

	return result, nil
}

// dayMoves reads every move of the team's orders on the Jakarta day, with its claim, its age, and the order's frozen
// figures — the event each one was announced by, rebuilt from the row it was built from.
func dayMoves(tx *gorm.DB, teamID uint64, start time.Time) ([]refoldMove, error) {
	moves := []refoldMove{}

	err := tx.
		Raw(`
WITH moves AS (
    SELECT 'order-placed:' || o.id AS event_id, 'created' AS metric, o.id AS order_id, 0 AS log_id, o.created_at AS at
    FROM orders o
    WHERE o.team_id = @team AND o.created_at >= @from AND o.created_at < @to
  UNION ALL
    SELECT CASE l.status WHEN @cancel THEN 'order-cancelled:' || o.id
                         WHEN @arrived THEN 'order-return-accepted:' || o.id
                         ELSE 'order-status-changed:' || l.id END,
           CASE l.status WHEN @cancel THEN 'cancelled'
                         WHEN @return THEN 'return_created'
                         WHEN @lost THEN 'lost_created'
                         ELSE 'return_arrived' END,
           o.id, l.id, l.created_at
    FROM orders o
    JOIN order_timeline_logs l ON l.order_id = o.id
    WHERE o.team_id = @team AND l.status IN (@cancel, @return, @lost, @arrived)
      AND l.created_at >= @from AND l.created_at < @to
)
SELECT m.event_id, m.metric, m.order_id, m.log_id, m.at,
       o.shop_id, o.warehouse_id, o.created_by_user_id AS user_id, o.total_cost, o.platform_total AS mp_total,
       o.warehouse_fee AS fee,
       EXISTS (SELECT 1 FROM order_event_logs e WHERE e.id = m.event_id) AS claimed,
       m.at < NOW() - CAST(@inflight AS interval) AS old
FROM moves m
JOIN orders o ON o.id = m.order_id
ORDER BY m.event_id`,
			map[string]any{
				"team": teamID, "from": start, "to": start.AddDate(0, 0, 1), "inflight": refoldInFlight,
				"cancel": orderStatusCancel, "return": orderStatusReturn, "lost": orderStatusLost,
				"arrived": orderStatusReturnCompleted,
			}).
		Scan(&moves).
		Error
	if err != nil {
		return nil, fmt.Errorf("order re-fold: read the day's moves: %w", err)
	}

	return moves, nil
}

// writeRefoldRow REPLACES one report row with the orders' figures, or removes it when they hold none.
func writeRefoldRow(tx *gorm.DB, teamID uint64, day string, key refoldKey, after *selling_service_models.OrderMetricColumns) error {
	if after == nil {
		err := tx.
			Exec(`DELETE FROM order_daily_reports
WHERE day = CAST(? AS date) AND metric = ? AND team_id = ? AND shop_id = ? AND warehouse_id = ? AND user_id = ?`,
				day, key.Metric, teamID, key.ShopID, key.WarehouseID, key.UserID).
			Error
		if err != nil {
			return fmt.Errorf("order re-fold: remove a row: %w", err)
		}

		return nil
	}

	err := tx.
		Exec(`
INSERT INTO order_daily_reports AS d (
    day, metric, team_id, shop_id, warehouse_id, user_id, order_count, total, mp_total, last_updated
)
VALUES (CAST(? AS date), ?, ?, ?, ?, ?, ?, ?, ?, NOW())
ON CONFLICT (day, metric, team_id, shop_id, warehouse_id, user_id) DO UPDATE
SET order_count  = EXCLUDED.order_count,
    total        = EXCLUDED.total,
    mp_total     = EXCLUDED.mp_total,
    last_updated = NOW()`,
			day, key.Metric, teamID, key.ShopID, key.WarehouseID, key.UserID, after.OrderCount, after.Total, after.MpTotal).
		Error
	if err != nil {
		return fmt.Errorf("order re-fold: write a row: %w", err)
	}

	return nil
}

func compareRefoldKeys(a, b refoldKey) int {
	return cmp.Or(
		strings.Compare(a.Metric, b.Metric),
		cmp.Compare(a.ShopID, b.ShopID),
		cmp.Compare(a.WarehouseID, b.WarehouseID),
		cmp.Compare(a.UserID, b.UserID),
	)
}

// lostMoveEvent is the event a lost move was announced by — its id, moment and order, which is all the fold reads of
// it (the figures are the order's). What the claim stores as `raw`.
func lostMoveEvent(teamID uint64, move refoldMove) *eventsv1.Event {
	ref := strconv.FormatUint(move.OrderID, 10)

	event := &eventsv1.Event{
		EventId:     move.EventID,
		OccurredAt:  timestamppb.New(move.At),
		AggregateId: "order:" + ref,
	}

	switch move.Metric {
	case reportCreated:
		event.Message = &eventsv1.Event_OrderPlaced{OrderPlaced: &eventsv1.OrderPlaced{TeamId: teamID, OrderId: move.OrderID}}
	case reportCancelled:
		event.Message = &eventsv1.Event_OrderCancelled{OrderCancelled: &eventsv1.OrderCancelled{TeamId: teamID, OrderId: move.OrderID}}
	case reportReturnArrived:
		event.Message = &eventsv1.Event_OrderReturnAccepted{OrderReturnAccepted: &eventsv1.OrderReturnAccepted{
			TeamId: teamID, OrderId: move.OrderID, TimelineLogId: move.LogID,
		}}
	default:
		to := orderStatusReturn
		if move.Metric == reportLostCreated {
			to = orderStatusLost
		}

		event.Message = &eventsv1.Event_OrderStatusChanged{OrderStatusChanged: &eventsv1.OrderStatusChanged{
			TeamId: teamID, OrderId: move.OrderID, ToStatus: to, TimelineLogId: move.LogID,
		}}
	}

	return event
}

// sameOrderColumns compares two rows: the count exactly, the money with san_money's tolerance — never == on a double
// (every-ledger-moves-to-double-rounded-when-frozen).
func sameOrderColumns(a, b *selling_service_models.OrderMetricColumns) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}

	return a.OrderCount == b.OrderCount && san_money.Equal(a.Total, b.Total) && san_money.Equal(a.MpTotal, b.MpTotal)
}
