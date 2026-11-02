package san_metric

import (
	"errors"
	"fmt"
	"time"
)

// MaxRangeDays is how long a metric's date range may be, BOTH days counted — 366, so a leap year fits
// (a-metric-reads-at-most-a-year). A ranking reads every daily row in its window, so a range without a ceiling is one
// that gets slower every day the business runs; *which supplier was best over two years* is two one-year rankings.
const MaxRangeDays = 366

// ErrRangeTooLong is a date range past MaxRangeDays. Each service answers it as InvalidArgument, beside its own
// "range backwards" check.
var ErrRangeTooLong = errors.New("a metric reads at most a year")

// CheckRange refuses a range of more than MaxRangeDays, counting both ends — 2024-01-01 to 2024-12-31 is 366 and fits.
// The days are calendar days of the two dates as given, so no timezone enters the count.
func CheckRange(start, end time.Time) error {
	first := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
	last := time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, time.UTC)

	days := int(last.Sub(first).Hours()/24) + 1
	if days > MaxRangeDays {
		return fmt.Errorf("%w: %s to %s is %d days, and a metric reads at most %d — pick a year at most",
			ErrRangeTooLong, first.Format(time.DateOnly), last.Format(time.DateOnly), days, MaxRangeDays)
	}

	return nil
}
