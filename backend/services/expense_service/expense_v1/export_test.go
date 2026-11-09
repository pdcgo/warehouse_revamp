package expense_v1

import "time"

// SetClock stamps every correction the service makes from now on with `now` — the day it counts on in Analytic
// (an-expense-correction-counts-on-the-day-it-is-made) — so a test can make a correction on a later day than its
// expense's.
func SetClock(s *Service, now func() time.Time) {
	s.now = now
}
