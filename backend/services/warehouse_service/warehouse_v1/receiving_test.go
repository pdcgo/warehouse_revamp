package warehouse_v1

import (
	"testing"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_service_models"
)

// The decisions' own grid: receiving Mon–Sat 08:00–17:00, closed Sunday.
func monToSat() []dayHoursJSON {
	grid := make([]dayHoursJSON, 0, 7)
	for d := int32(1); d <= 6; d++ {
		grid = append(grid, dayHoursJSON{Weekday: d, Open: true, OpenTime: "08:00", CloseTime: "17:00"})
	}

	return append(grid, dayHoursJSON{Weekday: 7, Open: false})
}

func wib(s string) time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04", s, jakarta)
	if err != nil {
		panic(err)
	}

	return t
}

func day(s string) time.Time {
	t, err := time.Parse(dayLayout, s)
	if err != nil {
		panic(err)
	}

	return t
}

// a-closed-day-warns-and-never-refuses: open inside the slot; outside it, the NEXT slot — 22:00 Friday is handled from
// Saturday 08:00, Saturday evening from Monday 08:00 (Sunday is closed).
func TestReceivingState_TheWeeklyGrid(t *testing.T) {
	cases := []struct {
		name, now string
		open      bool
		next      string
	}{
		{"Friday 10:00 — inside the slot", "2026-11-06 10:00", true, ""},
		{"Friday 22:00 — after closing", "2026-11-06 22:00", false, "2026-11-07 08:00"},
		{"Saturday 06:30 — before opening", "2026-11-07 06:30", false, "2026-11-07 08:00"},
		{"Saturday 17:00 — at closing", "2026-11-07 17:00", false, "2026-11-09 08:00"},
		{"Sunday — closed all day", "2026-11-08 12:00", false, "2026-11-09 08:00"},
	}

	for _, c := range cases {
		got := receivingState(wib(c.now), monToSat(), nil)
		if got.GetReceivingNow() != c.open {
			t.Fatalf("%s: receiving %v, want %v", c.name, got.GetReceivingNow(), c.open)
		}

		want := int64(0)
		if c.next != "" {
			want = wib(c.next).Unix()
		}

		if got.GetNextOpeningUnix() != want {
			t.Fatalf("%s: next opening %s, want %s", c.name, time.Unix(got.GetNextOpeningUnix(), 0).In(jakarta), c.next)
		}
	}
}

// a-warehouse-records-its-holidays — the decision's example: closed 30 Mar – 6 Apr for Idul Fitri; an order on 31 Mar is
// told the reason and the first slot AFTER the closure, 7 Apr 08:00.
func TestReceivingState_AClosureNamesItsReason(t *testing.T) {
	idulFitri := []warehouse_service_models.WarehouseClosure{{FirstDay: day("2027-03-30"), LastDay: day("2027-04-06"), Reason: "Idul Fitri"}}

	got := receivingState(wib("2027-03-31 10:00"), monToSat(), idulFitri)
	if got.GetReceivingNow() || got.GetClosureReason() != "Idul Fitri" {
		t.Fatalf("during the closure = %+v, want closed for Idul Fitri", got)
	}

	if want := wib("2027-04-07 08:00").Unix(); got.GetNextOpeningUnix() != want {
		t.Fatalf("next opening %s, want 7 Apr 08:00", time.Unix(got.GetNextOpeningUnix(), 0).In(jakarta))
	}

	// The day before it starts, after closing: no reason today, and the next opening skips the whole closure.
	before := receivingState(wib("2027-03-29 18:00"), monToSat(), idulFitri)
	if before.GetClosureReason() != "" || before.GetNextOpeningUnix() != wib("2027-04-07 08:00").Unix() {
		t.Fatalf("the evening before = %+v, want no reason and 7 Apr 08:00", before)
	}
}

// A warehouse with no grid never opens: closed, and no next opening to name.
func TestReceivingState_NoGridNeverOpens(t *testing.T) {
	got := receivingState(wib("2026-11-06 10:00"), nil, nil)
	if got.GetReceivingNow() || got.GetNextOpeningUnix() != 0 {
		t.Fatalf("no grid = %+v, want closed with no next opening", got)
	}
}
