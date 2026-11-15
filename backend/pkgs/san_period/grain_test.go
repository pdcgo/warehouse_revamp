package san_period_test

import (
	"errors"
	"testing"
	"time"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_period"
)

func day(t *testing.T, s string) time.Time {
	t.Helper()

	d, err := time.Parse(time.DateOnly, s)
	if err != nil {
		t.Fatal(err)
	}

	return d
}

// The wire's groups map onto the three grains; unset is a day (the callers that send no grain asked for days), and a
// group the period reads cannot take is refused.
func TestOf(t *testing.T) {
	cases := []struct {
		group analytic_basev1.GroupType
		want  san_period.Grain
	}{
		{analytic_basev1.GroupType_GROUP_TYPE_UNSPECIFIED, san_period.Day},
		{analytic_basev1.GroupType_GROUP_TYPE_DAILY, san_period.Day},
		{analytic_basev1.GroupType_GROUP_TYPE_MONTHLY, san_period.Month},
		{analytic_basev1.GroupType_GROUP_TYPE_YEARLY, san_period.Year},
	}

	for _, tc := range cases {
		got, err := san_period.Of(tc.group)
		if err != nil || got != tc.want {
			t.Fatalf("Of(%s) = %v, %v — want %v", tc.group, got, err, tc.want)
		}
	}

	for _, refused := range []analytic_basev1.GroupType{
		analytic_basev1.GroupType_GROUP_TYPE_WEEKLY,
		analytic_basev1.GroupType_GROUP_TYPE_PRODUCT,
	} {
		_, err := san_period.Of(refused)
		if !errors.Is(err, san_period.ErrGrain) {
			t.Fatalf("Of(%s) = %v, want ErrGrain", refused, err)
		}
	}
}

// The span each grain unlocks, both ends counted (periods-are-grouped-on-the-server): 366 days, 60 months, 20 years —
// one past each is refused, and a period touching a bucket only by a day still counts that bucket.
func TestCheckSpan(t *testing.T) {
	cases := []struct {
		name     string
		from, to string
		grain    san_period.Grain
		buckets  int
		refused  bool
	}{
		{"a leap year of days fits", "2028-01-01", "2028-12-31", san_period.Day, 366, false},
		{"367 days do not", "2027-12-31", "2028-12-31", san_period.Day, 367, true},
		{"a month boundary is two months", "2026-01-31", "2026-02-01", san_period.Month, 2, false},
		{"60 months fit", "2022-01-01", "2026-12-31", san_period.Month, 60, false},
		{"61 months do not, by a day", "2021-12-31", "2026-12-31", san_period.Month, 61, true},
		{"a year boundary is two years", "2025-12-31", "2026-01-01", san_period.Year, 2, false},
		{"20 years fit", "2007-06-01", "2026-06-01", san_period.Year, 20, false},
		{"21 years do not", "2006-12-31", "2026-01-01", san_period.Year, 21, true},
		{"three years of days are refused", "2024-01-01", "2026-12-31", san_period.Day, 1096, true},
		{"three years of years are three rows", "2024-01-01", "2026-12-31", san_period.Year, 3, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			from, to := day(t, tc.from), day(t, tc.to)

			if got := san_period.Buckets(from, to, tc.grain); got != tc.buckets {
				t.Fatalf("Buckets = %d, want %d", got, tc.buckets)
			}

			err := san_period.CheckSpan(from, to, tc.grain)
			if tc.refused != errors.Is(err, san_period.ErrSpanTooLong) {
				t.Fatalf("CheckSpan = %v, refused want %v", err, tc.refused)
			}
		})
	}

	err := san_period.CheckSpan(day(t, "2021-12-31"), day(t, "2026-12-31"), san_period.Month)
	if err == nil || err.Error() != "the period is longer than its grain allows: a monthly series covers at most 60 months" {
		t.Fatalf("the refusal reads %q", err)
	}
}

// A day is its own bucket, unchanged — the daily read keeps its plan; a month and a year truncate to their first day.
func TestBucket(t *testing.T) {
	if got := san_period.Day.Bucket("occurred_at"); got != "occurred_at" {
		t.Fatalf("Day.Bucket = %q", got)
	}
	if got := san_period.Month.Bucket("occurred_at"); got != "date_trunc('month', (occurred_at)::timestamp)::date" {
		t.Fatalf("Month.Bucket = %q", got)
	}
	if got := san_period.Year.Bucket("d"); got != "date_trunc('year', (d)::timestamp)::date" {
		t.Fatalf("Year.Bucket = %q", got)
	}
}
