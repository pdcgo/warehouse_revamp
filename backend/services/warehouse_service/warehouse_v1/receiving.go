package warehouse_v1

import (
	"encoding/json"
	"errors"
	"time"

	warehousev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/warehouse/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_service_models"
)

// nextOpeningHorizon is how far ahead the next opening is looked for. A warehouse closed for longer reads as having
// none — 0 — and the warning says only that it is closed.
const nextOpeningHorizon = 60

// receivingState is the closed-day warning's answer for one warehouse at `now` (a-closed-day-warns-and-never-refuses,
// a-warehouse-records-its-holidays, a-warehouse-with-no-hours-is-not-closed), in Asia/Jakarta:
//
//   - in a closure today → closed, the closure's reason, the next opening AFTER it — set hours or not;
//   - its receiving hours not set (no grid, or one that opens on no day) → NOT closed: `hours_set` false and nothing
//     else to say — "not set" is not "closed", and nobody knows when such a warehouse will handle an order;
//   - inside today's receiving slot → receiving now;
//   - otherwise → closed, and the next slot of the grid that falls on no closure day.
func receivingState(
	now time.Time,
	grid []dayHoursJSON,
	closures []warehouse_service_models.WarehouseClosure,
) *warehousev1.WarehouseReceivingState {
	now = now.In(jakarta)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, jakarta)

	closureOn := func(day time.Time) *warehouse_service_models.WarehouseClosure {
		key := day.Format(dayLayout)
		for i := range closures {
			if closures[i].FirstDay.Format(dayLayout) <= key && key <= closures[i].LastDay.Format(dayLayout) {
				return &closures[i]
			}
		}

		return nil
	}

	byDay := make(map[time.Weekday]dayHoursJSON, len(grid))
	for _, row := range grid {
		byDay[goWeekday(row.Weekday)] = row
	}

	slotOn := func(day time.Time) (time.Time, time.Time, bool) {
		row, ok := byDay[day.Weekday()]
		if !ok || !row.Open {
			return time.Time{}, time.Time{}, false
		}

		open, err1 := time.Parse(timeLayout, row.OpenTime)
		closeAt, err2 := time.Parse(timeLayout, row.CloseTime)
		if err1 != nil || err2 != nil {
			return time.Time{}, time.Time{}, false
		}

		at := func(t time.Time) time.Time {
			return time.Date(day.Year(), day.Month(), day.Day(), t.Hour(), t.Minute(), 0, 0, jakarta)
		}

		return at(open), at(closeAt), true
	}

	// Hours not set: never receiving and no next opening either (no slot to find one in) — `hours_set` false is what
	// tells the reader it is not closed. A closure still names its reason.
	state := &warehousev1.WarehouseReceivingState{HoursSet: hoursSet(grid)}

	closedToday := closureOn(today)
	if closedToday != nil {
		state.ClosureReason = closedToday.Reason
	}

	// In a closure it is closed whatever the grid says; the next opening below skips the closure's days.
	if closedToday == nil {
		open, closeAt, ok := slotOn(today)
		if ok && !now.Before(open) && now.Before(closeAt) {
			state.ReceivingNow = true

			return state
		}
	}

	for i := 0; i <= nextOpeningHorizon; i++ {
		day := today.AddDate(0, 0, i)
		if closureOn(day) != nil {
			continue
		}

		open, _, ok := slotOn(day)
		if ok && open.After(now) {
			state.NextOpeningUnix = open.Unix()

			break
		}
	}

	return state
}

// hoursSet is whether a receiving grid opens on any day (a-warehouse-with-no-hours-is-not-closed): no profile row, an
// empty grid, or a week with every day closed is NOT SET — a week closed every day is not a schedule anyone means.
func hoursSet(grid []dayHoursJSON) bool {
	for _, row := range grid {
		if row.Open {
			return true
		}
	}

	return false
}

// goWeekday maps the proto's Monday=1 … Sunday=7 onto Go's Sunday=0 … Saturday=6.
func goWeekday(proto int32) time.Weekday {
	if proto == 7 {
		return time.Sunday
	}

	return time.Weekday(proto)
}

// scheduleOf decodes a stored grid into its stored rows — what receivingState reads.
func scheduleOf(stored string) ([]dayHoursJSON, error) {
	if stored == "" {
		return nil, nil
	}

	var rows []dayHoursJSON

	err := json.Unmarshal([]byte(stored), &rows)
	if err != nil {
		return nil, errors.New("stored warehouse hours are corrupt")
	}

	return rows, nil
}
