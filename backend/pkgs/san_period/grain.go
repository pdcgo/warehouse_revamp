// Package san_period is a period read at a GRAIN — day, month or year — and grouped by the SERVER
// (periods-are-grouped-on-the-server): the RPC takes the grain and returns one row per bucket, so the browser never
// buckets days into months and two screens read side by side compute "August" the same way.
//
// One copy for every period read that takes a grain (ExpenseDaily, LiabilityDaily): the grain's name on the wire, the
// span it unlocks, and the SQL that turns a stored day into its bucket's first day.
package san_period

import (
	"errors"
	"fmt"
	"time"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
)

// Grain is how coarse a row is.
type Grain int

const (
	Day Grain = iota
	Month
	Year
)

// ErrGrain is a group the period reads cannot take — a week, a product. Each service answers it as InvalidArgument.
var ErrGrain = errors.New("a period is read by day, month or year")

// ErrSpanTooLong is a period longer than its grain allows. Each service answers it as InvalidArgument.
var ErrSpanTooLong = errors.New("the period is longer than its grain allows")

// Of reads the grain off the wire: DAILY, MONTHLY or YEARLY, and UNSET as DAILY — the old callers, which sent no grain,
// asked for days.
func Of(group analytic_basev1.GroupType) (Grain, error) {
	switch group {
	case analytic_basev1.GroupType_GROUP_TYPE_UNSPECIFIED, analytic_basev1.GroupType_GROUP_TYPE_DAILY:
		return Day, nil
	case analytic_basev1.GroupType_GROUP_TYPE_MONTHLY:
		return Month, nil
	case analytic_basev1.GroupType_GROUP_TYPE_YEARLY:
		return Year, nil
	}

	return Day, fmt.Errorf("%w, not %s", ErrGrain, group)
}

// MaxBuckets is the span the grain unlocks (periods-are-grouped-on-the-server): 366 days — a leap year is a whole year
// — 60 months, 20 years. The response is one row per bucket at most, so this number IS its pagination (HARD RULE 9).
func (g Grain) MaxBuckets() int {
	switch g {
	case Month:
		return 60
	case Year:
		return 20
	}

	return 366
}

// Noun is the grain's unit — "day", "month", "year" — which is also the field Postgres's date_trunc takes.
func (g Grain) Noun() string {
	switch g {
	case Month:
		return "month"
	case Year:
		return "year"
	}

	return "day"
}

// Buckets counts the buckets an INCLUSIVE period touches, both ends' buckets counted: 2026-01-31 to 2026-02-01 is two
// days, two months and one year. The calendar fields of the two dates as given — no zone enters the count.
func Buckets(from, to time.Time, g Grain) int {
	switch g {
	case Month:
		return (to.Year()-from.Year())*12 + int(to.Month()) - int(from.Month()) + 1
	case Year:
		return to.Year() - from.Year() + 1
	}

	first := time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, time.UTC)
	last := time.Date(to.Year(), to.Month(), to.Day(), 0, 0, 0, 0, time.UTC)

	return int(last.Sub(first).Hours()/24) + 1
}

// CheckSpan refuses a period that touches more buckets than the grain unlocks — "a monthly series covers at most 60
// months". Refused, never clamped: a trimmed period answers a question nobody asked, with a total that looks like the
// one they wanted.
func CheckSpan(from, to time.Time, g Grain) error {
	if Buckets(from, to, g) > g.MaxBuckets() {
		return fmt.Errorf("%w: a %s series covers at most %d %ss", ErrSpanTooLong, g.adjective(), g.MaxBuckets(), g.Noun())
	}

	return nil
}

func (g Grain) adjective() string {
	switch g {
	case Month:
		return "monthly"
	case Year:
		return "yearly"
	}

	return "daily"
}

// Bucket wraps a SQL expression of type DATE in its bucket's FIRST day: the day itself, or
// `date_trunc('month', (e)::timestamp)::date` / `date_trunc('year', …)`. The grain's field is a fixed word from this
// package, never caller text, so the SQL it builds is constant per grain. At Day the expression is returned unchanged,
// so the daily read keeps its old plan.
//
// Through a plain TIMESTAMP, never the date's default cast to TIMESTAMPTZ: a calendar day's month is calendar
// arithmetic, so no zone (the session's or any other) enters it, and the per-row zone conversions a TIMESTAMPTZ round
// trip costs are skipped.
func (g Grain) Bucket(dateExpr string) string {
	if g == Day {
		return dateExpr
	}

	return fmt.Sprintf("date_trunc('%s', (%s)::timestamp)::date", g.Noun(), dateExpr)
}
