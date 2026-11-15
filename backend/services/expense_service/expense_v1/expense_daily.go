package expense_v1

import (
	"context"
	"errors"
	"slices"
	"time"

	"connectrpc.com/connect"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_period"
)

// The longest period a series may cover follows its GRAIN — 366 days, 60 months, 20 years
// (periods-are-grouped-on-the-server) — and is san_period's, the one copy LiabilityDaily reads too: the two series are
// read side by side on one screen, and a cap that differed would let the statement load half a period and look
// complete.
//
// That number IS the pagination (HARD RULE 9): the response holds at most one row per bucket of the period, which the
// caller states, so bounding the span bounds the response no matter how many expenses the team ever records.
var (
	errPeriodRequired = errors.New("a daily series needs both a from and a to date")
	errPeriodInverted = errors.New("the period's from date is after its to date")
)

// ExpenseDaily sums a team's spending PER BUCKET — a day, a month or a year, as the request's grain says — over a
// bounded period.
//
// A cost is bucketed by `occurred_at` — the day the person said it BELONGS to — not by when the row was typed. Payroll
// entered on the 5th for last month lands in last month, which is the entire reason `occurred_at` is a separate column.
//
// THE SERVER GROUPS (periods-are-grouped-on-the-server): a month's row is the GROUP BY of its days, in the query, keyed
// by the month's first day — the browser never buckets days into months, so a month here is exactly the sum of its day
// rows at the daily grain.
//
// ⚠ ONE GROUPED QUERY, not a query per bucket.
func (s *Service) ExpenseDaily(
	ctx context.Context,
	req *connect.Request[expensev1.ExpenseDailyRequest],
) (*connect.Response[expensev1.ExpenseDailyResponse], error) {
	filter := req.Msg.GetFilter()

	grain, err := san_period.Of(req.Msg.GetGroupBy())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	_, _, err = parsePeriod(filter.GetFrom(), filter.GetTo(), grain)
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

	// The bucket's first day: `occurred_at` itself at the daily grain — the SQL, and so the plan, the daily read always
	// had — or its month's / year's first day. `occurred_at` is a DATE column, so there is no cast and no timezone to
	// get wrong here: a person chose the day, and its month is that day's month.
	bucket := grain.Bucket("occurred_at")

	err = query.
		// Every row, as `totals` sums them, so the buckets add up to the footer beside them — an adjustment counts on its
		// expense's day, with its sign (an-adjustment-counts-on-the-day-it-fixes).
		Select(bucket + " AS day, kind, COUNT(*) AS entries, COALESCE(SUM(amount), 0) AS total").
		Group(bucket + ", kind").
		Scan(&rows).
		Error
	if err != nil {
		return nil, costErr(err)
	}

	// ASCENDING by bucket — sorted HERE, over the few grouped rows, never by an ORDER BY: with one the planner may group
	// by SORTING every row (it cannot estimate how few buckets there are), which spills to disk at volume; without one it
	// hashes them into the buckets. LiabilityDaily's measured case (TestPerf_LiabilityDaily); the same shape here.
	slices.SortStableFunc(rows, func(a, b expenseDayRow) int { return a.Day.Compare(b.Day) })

	totals, err := s.totals(ctx, as)
	if err != nil {
		return nil, err
	}

	return connect.NewResponse(&expensev1.ExpenseDailyResponse{
		Days:   foldDays(rows),
		Totals: totals,
	}), nil
}

// expenseDayRow is the grouped query's shape — one row per (bucket, kind); `Day` is the bucket's first day.
//
// Grouped by kind as well as by day because the day item carries a `by_kind` breakdown, and asking the
// database for the split costs nothing extra: it is the same scan, one GROUP BY wider. Folding the
// pairs back into days happens below, in Go, where it is a loop rather than a second query.
type expenseDayRow struct {
	Day     time.Time
	Kind    int32
	Entries int64
	Total   float64
}

// foldDays turns (bucket, kind) pairs into one item per bucket, preserving their ascending order.
//
// The rows arrive sorted by bucket, so a bucket's kinds are contiguous and the fold needs no map of buckets
// and no re-sort — only a check of whether the bucket changed. Keeping that order is what lets the response
// promise "ascending by date" without sorting it again.
func foldDays(rows []expenseDayRow) []*expensev1.ExpenseDayItem {
	days := make([]*expensev1.ExpenseDayItem, 0, len(rows))

	var current *expensev1.ExpenseDayItem

	for i := range rows {
		date := rows[i].Day.Format(dateLayout)

		if current == nil || current.GetDate() != date {
			current = &expensev1.ExpenseDayItem{
				Date:   date,
				ByKind: map[int32]float64{},
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

// parsePeriod validates a REQUIRED day range, BOUNDED by its grain's span, and returns its inclusive ends.
//
// Proto validation already enforces the shape, and this re-checks it anyway for the reason `parseDate`
// does: a pattern is not validity ("2026-02-31" matches and is not a day), and a unit test calling the
// handler directly gets no validation interceptor at all.
func parsePeriod(rawFrom, rawTo string, grain san_period.Grain) (time.Time, time.Time, error) {
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

	// Inclusive of both ends, so a single day is a span of 1 rather than 0 — 366 days, 60 months or 20 years.
	err = san_period.CheckSpan(from, to, grain)
	if err != nil {
		return time.Time{}, time.Time{}, connect.NewError(connect.CodeInvalidArgument, err)
	}

	return from, to, nil
}
