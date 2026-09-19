package settlement_v1

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
)

// jakarta is the system's calendar (the-system-runs-on-jakarta-time). Fixed +7: WIB has no daylight
// saving, and a fixed zone needs no tzdata on the host.
var jakarta = time.FixedZone("WIB", 7*60*60)

// trackedColumns is analytic_context.md §Field that tracked — the movement columns, in SettlementMetric
// order. ⚠ The settlement_type TEXT is the column name, so the mapping from a row to its column is an
// identity checked against this list, never a second table that could drift.
var trackedColumns = []string{
	typeInitialTotal,
	typeInitialTotalCancel,
	typeOther,
	typeFund,
	typeExternalAdsFee,
	typeAffiliateFee,
	typeMarketplaceAdjust,
	typeSystemAdjustment,
}

// columnOfType is the report column a settlement_type folds into.
func columnOfType(typeText string) (string, bool) {
	for _, column := range trackedColumns {
		if column == typeText {
			return column, true
		}
	}

	return "", false
}

// reportGrain is one daily report table: its key, and the columns that identify ONE position — a scope's
// latest close_balance is read per position, then summed.
type reportGrain struct {
	table    string
	key      string
	position []string
}

var (
	shopDaily = reportGrain{
		table:    "shop_settlement_daily_reports",
		key:      "shop_id",
		position: []string{"shop_id", "team_id"},
	}
	userDaily = reportGrain{
		table:    "user_settlement_daily_reports",
		key:      "user_id",
		position: []string{"user_id", "team_id"},
	}
)

// columnsOf renders column names under an alias: "r.shop_id, r.team_id".
func columnsOf(alias string, columns []string) string {
	rendered := make([]string, 0, len(columns))

	for _, column := range columns {
		if alias == "" {
			rendered = append(rendered, column)

			continue
		}

		rendered = append(rendered, alias+"."+column)
	}

	return strings.Join(rendered, ", ")
}

// movementSums renders "COALESCE(SUM(r.initial_total), 0) AS initial_total, …, … AS change".
func movementSums(alias string) string {
	prefix := ""
	if alias != "" {
		prefix = alias + "."
	}

	parts := make([]string, 0, len(trackedColumns)+1)

	for _, column := range append(append([]string{}, trackedColumns...), "change") {
		parts = append(parts, fmt.Sprintf("COALESCE(SUM(%s%s), 0) AS %s", prefix, column, column))
	}

	return strings.Join(parts, ", ")
}

// movementsFrom renders "COALESCE(m.initial_total, 0) AS initial_total, …" — the columns of a joined
// movement row, zero when the join found nothing.
func movementsFrom(alias string) string {
	parts := make([]string, 0, len(trackedColumns)+1)

	for _, column := range append(append([]string{}, trackedColumns...), "change") {
		parts = append(parts, fmt.Sprintf("COALESCE(%s.%s, 0) AS %s", alias, column, column))
	}

	return strings.Join(parts, ", ")
}

// metricToProto maps one scanned metric onto the wire.
//
// ⚠ The scan target is the MODEL's exported column struct, not a local one: GORM does not scan into an
// embedded struct whose type is unexported, and silently leaves every figure at zero.
func metricToProto(m settlement_service_models.SettlementMetricColumns) *settlementv1.SettlementMetric {
	return &settlementv1.SettlementMetric{
		InitialTotal:          m.InitialTotal,
		InitialTotalCancel:    m.InitialTotalCancel,
		Other:                 m.Other,
		Fund:                  m.Fund,
		ExternalAdsFee:        m.ExternalAdsFee,
		AffiliateFee:          m.AffiliateFee,
		MarketplaceAdjustment: m.MarketplaceAdjustment,
		SystemAdjustment:      m.SystemAdjustment,
		Change:                m.Change,
		OpenBalance:           m.OpenBalance,
		CloseBalance:          m.CloseBalance,
	}
}

var (
	errRangeBackwards = connect.NewError(
		connect.CodeInvalidArgument,
		errors.New("start_date must not be after end_date"),
	)

	errUserAndShop = connect.NewError(
		connect.CodeInvalidArgument,
		errors.New("filter by a user or by a shop, not both — the user report has no shop dimension"),
	)

	errBadTimeframe = connect.NewError(connect.CodeInvalidArgument, errors.New("unknown timeframe"))

	errBadGroup = connect.NewError(connect.CodeInvalidArgument, errors.New("unknown group_type"))
)

// parseRange reads a report window. Both ends are required and inclusive.
func parseRange(r *settlementv1.AnalyticDateRange) (time.Time, time.Time, error) {
	start, err := parseDate(r.GetStartDate())
	if err != nil {
		return time.Time{}, time.Time{}, err
	}

	end, err := parseDate(r.GetEndDate())
	if err != nil {
		return time.Time{}, time.Time{}, err
	}

	if start.After(end) {
		return time.Time{}, time.Time{}, errRangeBackwards
	}

	return start, end, nil
}

// isRootScope reports whether a report reads EVERY team. The root team is the one scope only ROOT and
// ADMIN hold, so it is the one scope from which crossing teams is authorised; any other scope reads its
// own team alone.
func isRootScope(teamID uint64) bool {
	return teamID == san_auth.RootTeamID
}

// dateArray renders a Postgres array literal of dates — "{2026-01-01,2026-01-02}".
//
// ⚠ A literal cast in SQL rather than a Go slice argument: GORM expands a slice into a comma list, which
// is right for IN and wrong for an array parameter.
func dateArray(days []time.Time) string {
	parts := make([]string, 0, len(days))
	for _, day := range days {
		parts = append(parts, day.Format(dateLayout))
	}

	return "{" + strings.Join(parts, ",") + "}"
}

func idArray(ids []uint64) string {
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		parts = append(parts, strconv.FormatUint(id, 10))
	}

	return "{" + strings.Join(parts, ",") + "}"
}

// bucket is one point of a time series: `at` is the bucket's own first day, and from/to are that bucket
// clipped to the requested window.
type bucket struct {
	at   time.Time
	from time.Time
	to   time.Time
}

// timeBuckets lays out EVERY bucket of the window, including those with no movement — a quiet day still
// has a position. The span is capped per grain, so a coarser grain reaches further back: 366 days, 60
// months, 20 years.
func timeBuckets(timeframe settlementv1.AnalyticTimeframe, start, end time.Time) ([]bucket, error) {
	var (
		first time.Time
		step  func(time.Time) time.Time
		limit int
	)

	switch timeframe {
	case settlementv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_DAILY:
		first = start
		step = func(t time.Time) time.Time { return t.AddDate(0, 0, 1) }
		limit = 366
	case settlementv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_MONTHLY:
		first = time.Date(start.Year(), start.Month(), 1, 0, 0, 0, 0, time.UTC)
		step = func(t time.Time) time.Time { return t.AddDate(0, 1, 0) }
		limit = 60
	case settlementv1.AnalyticTimeframe_ANALYTIC_TIMEFRAME_YEARLY:
		first = time.Date(start.Year(), time.January, 1, 0, 0, 0, 0, time.UTC)
		step = func(t time.Time) time.Time { return t.AddDate(1, 0, 0) }
		limit = 20
	default:
		return nil, errBadTimeframe
	}

	out := []bucket{}

	for at := first; !at.After(end); at = step(at) {
		if len(out) == limit {
			return nil, connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("the window holds more than %d %s points — narrow it or read a coarser timeframe",
					limit, strings.ToLower(strings.TrimPrefix(timeframe.String(), "ANALYTIC_TIMEFRAME_"))))
		}

		from := at
		if from.Before(start) {
			from = start
		}

		to := step(at).AddDate(0, 0, -1)
		if to.After(end) {
			to = end
		}

		out = append(out, bucket{at: at, from: from, to: to})
	}

	return out, nil
}
