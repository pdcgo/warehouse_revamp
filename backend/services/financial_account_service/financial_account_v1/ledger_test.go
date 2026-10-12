package financial_account_v1_test

import "testing"

// the-daily-row-is-written-with-the-log-row — and a LATE row shifts every later day, never recomputes.
func TestDailyReport_ALateRowShiftsEveryLaterDay(t *testing.T) {
	db, svc, ops, kas := book(t)

	before := daily(t, db, ops)
	last := before[len(before)-1]

	if last.CloseBalance != 1_300_000 {
		t.Fatalf("close before = %v", last.CloseBalance)
	}

	// Typed today, dated 8 days ago — before the withdrawal and the transfer.
	mustTransfer(t, svc, teamA, kas, ops, 10_000, day(8))

	after := daily(t, db, ops)
	for _, r := range after {
		switch r.Day.Format("2006-01-02") {
		case day(10):
			if r.CloseBalance != 1_000_000 {
				t.Errorf("day 10 moved: %+v", r)
			}
		case day(8):
			if r.OpenBalance != 1_000_000 || r.CloseBalance != 1_010_000 || r.Transfer != 10_000 {
				t.Errorf("day 8 = %+v", r)
			}
		case day(5), day(3):
			if r.CloseBalance-r.OpenBalance != r.Change {
				t.Errorf("%s does not add up: %+v", r.Day, r)
			}
		}
	}

	if after[len(after)-1].CloseBalance != 1_310_000 {
		t.Fatalf("last close = %v, want 1.310.000", after[len(after)-1].CloseBalance)
	}
}
