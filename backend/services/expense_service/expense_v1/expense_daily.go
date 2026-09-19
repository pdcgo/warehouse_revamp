package expense_v1

import (
	"context"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
)

// The longest period a daily series may cover — the same bound RevenueDaily enforces, because the two
// series are read side by side on one screen and a cap that differed would let the statement load half
// a period and look complete.
//
// This number IS the pagination (HARD RULE 9): the response length is `to − from`, which the caller
// states, so bounding the span bounds the response no matter how many expenses the team ever records.
const maxPeriodDays = 366

var (
	errPeriodRequired = errors.New("a daily series needs both a from and a to date")
	errPeriodTooLong  = fmt.Errorf("a daily series covers at most %d days", maxPeriodDays)
	errPeriodInverted = errors.New("the period's from date is after its to date")
)

// ExpenseDaily sums a team's spending PER DAY over a bounded period.
//
// The mirror of RevenueDaily, with one deliberate difference: a cost is bucketed by `occurred_at` — the
// day the person said it BELONGS to — not by when the row was typed. Payroll entered on the 5th for last
// month lands in last month, which is the entire reason `occurred_at` is a separate column.
//
// ⚠ ONE GROUPED QUERY, not a query per day.
func (s *Service) ExpenseDaily(
	ctx context.Context,
	req *connect.Request[expensev1.ExpenseDailyRequest],
) (*connect.Response[expensev1.ExpenseDailyResponse], error) {
	filter := req.Msg.GetFilter()

	_, _, err := parsePeriod(filter.GetFrom(), filter.GetTo())
	if err != nil {
		return nil, err
	}

	// The list request this period and its filters are equivalent to. Built rather than hand-writing the
	// WHERE again, so the daily series, its footer and the expense list screen cannot start disagreeing
	// about what "August, ads only" contains — the same rule `filtered` already exists to enforce.
	as := &expensev1.ExpenseListRequest{
		TeamId: req.Msg.GetTeamId(),
		Filter: &expensev1.ExpenseListFilter{
			From:   filter.GetFrom(),
			To:     filter.GetTo(),
			Kind:   filter.GetKind(),
			ShopId: filter.GetShopId(),
		},
	}

	query, err := s.filtered(ctx, as)
	if err != nil {
		return nil, err
	}

	var rows []expenseDayRow

	err = query.
		// LIVE rows only — the same predicate `totals` applies, because the days have to add up to the
		// footer beside them. A cost entered by mistake and voided never counts.
		Where("voided_at IS NULL").
		// `occurred_at` is a DATE column, so there is no cast and no timezone to get wrong here — unlike
		// the revenue side, which buckets a TIMESTAMPTZ and has to name a zone to do it.
		Select("occurred_at AS day, kind, COUNT(*) AS entries, COALESCE(SUM(amount), 0) AS total").
		Group("occurred_at, kind").
		Order("occurred_at ASC").
		Scan(&rows).
		Error
	if err != nil {
		return nil, costErr(err)
	}

	totals, err := s.totals(ctx, as)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&expensev1.ExpenseDailyResponse{
		Days:   foldDays(rows),
		Totals: totals,
	}), nil
}

// expenseDayRow is the grouped query's shape — one row per (day, kind).
//
// Grouped by kind as well as by day because the day item carries a `by_kind` breakdown, and asking the
// database for the split costs nothing extra: it is the same scan, one GROUP BY wider. Folding the
// pairs back into days happens below, in Go, where it is a loop rather than a second query.
type expenseDayRow struct {
	Day     time.Time
	Kind    int32
	Entries int64
	Total   int64
}

// foldDays turns (day, kind) pairs into one item per day, preserving the query's ascending order.
//
// The rows arrive sorted by day, so a day's kinds are contiguous and the fold needs no map of days and
// no re-sort — only a check of whether the day changed. Keeping the order the database produced is what
// lets the response promise "ascending by date" without sorting it again.
func foldDays(rows []expenseDayRow) []*expensev1.ExpenseDayItem {
	days := make([]*expensev1.ExpenseDayItem, 0, len(rows))

	var current *expensev1.ExpenseDayItem

	for i := range rows {
		date := rows[i].Day.Format(dateLayout)

		if current == nil || current.GetDate() != date {
			current = &expensev1.ExpenseDayItem{
				Date:   date,
				ByKind: map[int32]int64{},
			}
			days = append(days, current)
		}

		current.Entries += uint64(rows[i].Entries)
		current.Total += rows[i].Total
		// A kind with nothing that day is simply never added, so it is ABSENT rather than 0 — the same
		// choice ExpenseTotals makes, and for the same reason: absent and zero read identically on a
		// card, and building the empty ones would mean this knowing the enum's members.
		current.ByKind[rows[i].Kind] += rows[i].Total
	}

	return days
}

// parsePeriod validates a REQUIRED, BOUNDED day range and returns its inclusive ends.
//
// Proto validation already enforces the shape, and this re-checks it anyway for the reason `parseDate`
// does: a pattern is not validity ("2026-02-31" matches and is not a day), and a unit test calling the
// handler directly gets no validation interceptor at all.
func parsePeriod(rawFrom, rawTo string) (time.Time, time.Time, error) {
	if rawFrom == "" || rawTo == "" {
		return time.Time{}, time.Time{}, connect.NewError(connect.CodeInvalidArgument, errPeriodRequired)
	}

	from, err := parseDate(rawFrom)
	if err != nil {
		return time.Time{}, time.Time{}, costErr(err)
	}

	to, err := parseDate(rawTo)
	if err != nil {
		return time.Time{}, time.Time{}, costErr(err)
	}

	if to.Before(from) {
		// Refused rather than swapped. A reversed range is a bug in the caller, and silently correcting it
		// would return a confident answer to a question nobody asked.
		return time.Time{}, time.Time{}, connect.NewError(connect.CodeInvalidArgument, errPeriodInverted)
	}

	// Inclusive of both ends, so a single day is a span of 1 rather than 0.
	span := int(to.Sub(from).Hours()/24) + 1
	if span > maxPeriodDays {
		return time.Time{}, time.Time{}, connect.NewError(connect.CodeInvalidArgument, errPeriodTooLong)
	}

	return from, to, nil
}
