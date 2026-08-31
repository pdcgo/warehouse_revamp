package liability_v1

import (
	"context"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
)

// The longest period a daily series may cover — the SAME bound RevenueDaily and ExpenseDaily enforce.
//
// It must not drift from theirs: the daily statement reads all three side by side, and a cap that
// differed would let one column load a full period while another refused, which reads as missing money
// rather than as a refused request.
//
// This number IS the pagination (HARD RULE 9): the response length is `to − from`, which the caller
// states, so bounding the span bounds the response no matter how large the ledger grows.
const maxPeriodDays = 366

var (
	errPeriodRequired = errors.New("a daily series needs both a from and a to date")
	errPeriodTooLong  = fmt.Errorf("a daily series covers at most %d days", maxPeriodDays)
	errPeriodInverted = errors.New("the period's from date is after its to date")
	errBadDate        = errors.New("a date must be YYYY-MM-DD")
)

// LiabilityDaily sums what the ledger moved PER DAY, from the scoped team's point of view.
//
// It is a WAREHOUSE's income half of the daily statement. A selling team earns the margin on its orders
// and revenue_service holds that; a warehouse has no orders at all, so what it earns is the fees it
// charges the teams it fulfils for — and those only exist here. Without this a warehouse's statement
// would put real expenses against a margin of zero and call every day a loss.
//
// ⚠ IT DOES NOT DECIDE WHAT COUNTS AS INCOME. Every source type comes back in `by_source` and the caller
// picks — see the note on LiabilityDailyFilter for why summing all four would double-count.
//
// ⚠ ONE GROUPED QUERY, not a query per day.
func (s *Service) LiabilityDaily(
	ctx context.Context,
	req *connect.Request[liabilityv1.LiabilityDailyRequest],
) (*connect.Response[liabilityv1.LiabilityDailyResponse], error) {
	filter := req.Msg.GetFilter()

	from, to, err := parsePeriod(filter.GetFrom(), filter.GetTo())
	if err != nil {
		return nil, err
	}

	query := s.db.
		WithContext(ctx).
		Model(&liability_service_models.LiabilityLog{}).
		// The team_id clause IS the scope check — one team can never read another's earnings by id.
		Where("team_id = ?", req.Msg.GetTeamId()).
		// The SAME half-open upper bound the other two daily series use: `created_at` is a TIMESTAMPTZ,
		// so `<= to` would mean `<= to 00:00:00` and silently drop almost the whole last day.
		Where("created_at >= ? AND created_at < ?", from, to.AddDate(0, 0, 1))

	// NOT the scope (§4.9) — an optional narrowing to one counterparty, on top of the team clause above.
	if cp := filter.GetCounterpartyId(); cp != 0 {
		query = query.Where("counterparty_id = ?", cp)
	}

	var rows []liabilityDayRow

	err = query.
		Select(
			// UTC, explicitly. A bare `created_at::date` converts using the session's TimeZone, which
			// nothing here sets — so two machines could bucket differently while the bounds above, parsed
			// as UTC midnight, stayed put. A day whose row disagreed with the total beside it is unreadable.
			"(created_at AT TIME ZONE 'UTC')::date AS day, "+
				"source_type, "+
				"COUNT(*) AS entries, "+
				// REVERSALS ARE INCLUDED, not filtered. A cancelled order's fee is undone by an
				// equal-and-opposite leg, so a plain SUM nets the pair to zero — which is the honest
				// number. Excluding them would report income the ledger has already taken back.
				"COALESCE(SUM(amount), 0) AS net",
		).
		Group("day, source_type").
		Order("day ASC").
		Scan(&rows).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	days, totals := foldDays(rows)

	return connect.NewResponse(&liabilityv1.LiabilityDailyResponse{
		Days:   days,
		Totals: totals,
	}), nil
}

// liabilityDayRow is the grouped query's shape — one row per (day, source_type).
//
// Grouped by source as well as by day because the day item carries a `by_source` split, and asking the
// database for it costs nothing extra: the same scan, one GROUP BY wider. Folding the pairs back into
// days happens below, in Go, where it is a loop rather than a second query.
type liabilityDayRow struct {
	Day        time.Time
	SourceType string
	Entries    int64
	Net        int64
}

// foldDays turns (day, source) pairs into one item per day, and accumulates the period totals in the
// same pass.
//
// The rows arrive sorted by day, so a day's sources are contiguous and the fold needs no map of days and
// no re-sort — only a check of whether the day changed. Keeping the order the database produced is what
// lets the response promise "ascending by date" without sorting it again.
//
// The TOTALS are built here rather than by a second aggregate query, and that is the one place this
// differs from the revenue and expense handlers. They had an existing period-totals query to reuse, and
// reusing it kept their footer identical to their list screen's. There is no such query here, so a second
// one would be a second definition of the same sum — free to drift from the days above it, which is
// exactly the failure the other two reuse their query to avoid.
func foldDays(rows []liabilityDayRow) ([]*liabilityv1.LiabilityDayItem, *liabilityv1.LiabilityDailyTotals) {
	days := make([]*liabilityv1.LiabilityDayItem, 0, len(rows))
	totals := &liabilityv1.LiabilityDailyTotals{BySource: map[int32]int64{}}

	var current *liabilityv1.LiabilityDayItem

	for i := range rows {
		date := rows[i].Day.Format(dateLayout)

		if current == nil || current.GetDate() != date {
			current = &liabilityv1.LiabilityDayItem{
				Date:     date,
				BySource: map[int32]int64{},
			}
			days = append(days, current)
		}

		// An unrecognised source reads as UNSPECIFIED rather than failing the row — the same choice
		// sourceTypeProto already makes for the history screen. A statement that refused to render
		// because one entry carried a source this build does not know is worse than one line reading
		// "unknown".
		source := int32(sourceTypeProto(rows[i].SourceType))

		current.Entries += uint64(rows[i].Entries)
		current.Net += rows[i].Net
		// A source with nothing that day is never added, so it is ABSENT rather than 0.
		current.BySource[source] += rows[i].Net

		totals.Net += rows[i].Net
		totals.BySource[source] += rows[i].Net
	}

	return days, totals
}

// The layout a period bound crosses the wire in — a DATE, matching the other two daily series so the
// statement screen can hand the same pair to all three services.
const dateLayout = "2006-01-02"

// parsePeriod validates a REQUIRED, BOUNDED day range and returns its inclusive ends.
//
// Proto validation already enforces the SHAPE, and this re-checks it anyway: a pattern is not validity
// ("2026-02-31" matches and is not a day), and a unit test calling the handler directly gets no
// validation interceptor at all.
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
