package revenue_v1

import (
	"context"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"

	revenuev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/revenue/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/revenue_service/revenue_service_models"
)

// The longest period a daily series may cover.
//
// This number IS the pagination (HARD RULE 9). A `repeated` is only a latent out-of-memory bug when its
// length grows with the DATA; this one grows with `to − from`, which the caller states — so bounding the
// span bounds the response for all time, no matter how many orders the team ever places. 366 rather
// than 365 so a leap year is a whole year rather than a whole year minus a day, which is the kind of
// off-by-one somebody hits once and never diagnoses.
const maxPeriodDays = 366

var (
	errPeriodRequired = errors.New("a daily series needs both a from and a to date")
	errPeriodTooLong  = fmt.Errorf("a daily series covers at most %d days", maxPeriodDays)
	errPeriodInverted = errors.New("the period's from date is after its to date")
)

// RevenueDaily sums a team's expected money PER DAY over a bounded period.
//
// It exists because RevenueList and its totals answer "what did this period make" and nothing answers
// "which DAYS made it" — which is the first question anybody asks when a month looks wrong, since a
// month is not a thing that goes wrong. A Tuesday is.
//
// ⚠ ONE GROUPED QUERY, not a query per day. A 366-day period asking the database 366 times would be an
// N+1 wearing a calendar, and it is the obvious wrong way to write this — so the grouping is done where
// the rows are.
func (s *Service) RevenueDaily(
	ctx context.Context,
	req *connect.Request[revenuev1.RevenueDailyRequest],
) (*connect.Response[revenuev1.RevenueDailyResponse], error) {
	filter := req.Msg.GetFilter()

	from, to, err := parsePeriod(filter.GetFrom(), filter.GetTo())
	if err != nil {
		return nil, err
	}

	var rows []revenueDayRow

	err = s.db.
		WithContext(ctx).
		Model(&revenue_service_models.OrderRevenue{}).
		Select(
			// UTC, explicitly. A bare `created_at::date` would convert using the SESSION's TimeZone,
			// which nothing here sets — so the same query could bucket differently on two machines while
			// the `created_at >= ?` bound below (parsed as UTC midnight) stayed put. That disagreement
			// would show up as a day whose row does not match the total beside it, which is unreadable.
			"(created_at AT TIME ZONE 'UTC')::date AS day, "+
				"COUNT(*) AS orders, "+
				"COALESCE(SUM(revenue), 0) AS revenue, "+
				"COALESCE(SUM(cogs), 0) AS cogs, "+
				"COALESCE(SUM(shipping_cost), 0) AS shipping_cost, "+
				"COALESCE(SUM(expected_margin), 0) AS expected_margin, "+
				"COUNT(*) FILTER (WHERE NOT cost_known) AS unknown_cost_orders",
		).
		// LIVE rows only. A cancelled order earned nothing (#164), so it must not put a number on a day —
		// exactly the predicate `teamTotals` applies, because the days have to add up to the footer.
		Where("team_id = ? AND voided_at IS NULL", req.Msg.GetTeamId()).
		// The SAME half-open upper bound `withPeriod` uses, and for the same reason: `created_at` is a
		// TIMESTAMPTZ, so `<= to` would mean `<= to 00:00:00` and silently drop almost the whole last day
		// of every period. Written out rather than reusing withPeriod because both bounds are required
		// here, so there is nothing conditional left for it to do.
		Where("created_at >= ? AND created_at < ?", from, to.AddDate(0, 0, 1)).
		Group("day").
		Order("day ASC").
		Scan(&rows).
		Error
	if err != nil {
		return nil, revenueErr(err)
	}

	days := make([]*revenuev1.RevenueDayItem, 0, len(rows))
	for i := range rows {
		days = append(days, rows[i].toProto())
	}

	// The period's totals, from the SAME predicate the days use. Sent rather than left to the client to
	// sum, so the statement's footer is this service's answer and cannot drift from the revenue list's.
	totals, err := periodTotals(ctx, s, req.Msg.GetTeamId(), filter.GetFrom(), filter.GetTo())
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&revenuev1.RevenueDailyResponse{
		Days:   days,
		Totals: totals,
	}), nil
}

// revenueDayRow is the grouped query's shape. `Day` is a Postgres DATE, which pgx hands back as a
// midnight time.Time.
type revenueDayRow struct {
	Day               time.Time
	Orders            int64
	Revenue           int64
	Cogs              int64
	ShippingCost      int64
	ExpectedMargin    int64
	UnknownCostOrders int64
}

func (r *revenueDayRow) toProto() *revenuev1.RevenueDayItem {
	return &revenuev1.RevenueDayItem{
		Date:              r.Day.Format(dateLayout),
		Orders:            uint64(r.Orders),
		Revenue:           r.Revenue,
		Cogs:              r.Cogs,
		ShippingCost:      r.ShippingCost,
		ExpectedMargin:    r.ExpectedMargin,
		UnknownCostOrders: uint64(r.UnknownCostOrders),
	}
}

// parsePeriod validates a REQUIRED, BOUNDED day range and returns its inclusive ends.
//
// Proto validation already enforces the shape, and this re-checks it anyway for the reason parseDate
// does in expense_service: a pattern is not validity ("2026-02-31" matches and is not a day), and a
// unit test calling the handler directly gets no validation interceptor at all.
func parsePeriod(rawFrom, rawTo string) (time.Time, time.Time, error) {
	if rawFrom == "" || rawTo == "" {
		return time.Time{}, time.Time{}, connect.NewError(connect.CodeInvalidArgument, errPeriodRequired)
	}

	from, err := time.Parse(dateLayout, rawFrom)
	if err != nil {
		return time.Time{}, time.Time{}, connect.NewError(connect.CodeInvalidArgument, errBadDate)
	}

	to, err := time.Parse(dateLayout, rawTo)
	if err != nil {
		return time.Time{}, time.Time{}, connect.NewError(connect.CodeInvalidArgument, errBadDate)
	}

	if to.Before(from) {
		// Refused rather than swapped. A reversed range is a bug in the caller, and silently correcting
		// it would return a confident answer to a question nobody asked.
		return time.Time{}, time.Time{}, connect.NewError(connect.CodeInvalidArgument, errPeriodInverted)
	}

	// Inclusive of both ends, so a single day is a span of 1 rather than 0.
	span := int(to.Sub(from).Hours()/24) + 1
	if span > maxPeriodDays {
		return time.Time{}, time.Time{}, connect.NewError(connect.CodeInvalidArgument, errPeriodTooLong)
	}

	return from, to, nil
}
