package san_metric

import (
	"errors"
	"testing"
	"time"
)

// A YEAR AT MOST, both days counted (a-metric-reads-at-most-a-year): a leap year's 366 days fit, one day more does not,
// and a single day is a range of 1.
func TestCheckRange(t *testing.T) {
	day := func(s string) time.Time {
		d, err := time.Parse(time.DateOnly, s)
		if err != nil {
			t.Fatal(err)
		}

		return d
	}

	cases := []struct {
		from, to string
		ok       bool
	}{
		{"2026-11-02", "2026-11-02", true},  // one day
		{"2025-11-03", "2026-11-02", true},  // "the last year" — 365 days
		{"2024-01-01", "2024-12-31", true},  // a leap year — 366
		{"2024-01-01", "2025-01-01", false}, // 367
		{"2024-01-01", "2026-01-01", false}, // two years
	}

	for _, c := range cases {
		err := CheckRange(day(c.from), day(c.to))
		if (err == nil) != c.ok {
			t.Fatalf("%s to %s: %v, want accepted %v", c.from, c.to, err, c.ok)
		}

		if err != nil && !errors.Is(err, ErrRangeTooLong) {
			t.Fatalf("%s to %s: %v is not ErrRangeTooLong", c.from, c.to, err)
		}
	}
}
