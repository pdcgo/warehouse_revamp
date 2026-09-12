package team_v1

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
)

// dayHoursJSON is how a weekday's hours are stored inside the JSONB schedule. Its own struct (not
// the proto) so the stored shape does not move when the proto's Go types are regenerated.
type dayHoursJSON struct {
	Weekday   int32  `json:"weekday"`
	Open      bool   `json:"open"`
	OpenTime  string `json:"open_time"`
	CloseTime string `json:"close_time"`
}

// timeLayout is 24-hour "HH:MM".
const timeLayout = "15:04"

// validateSchedule checks a submitted weekly schedule and converts it to the storable form.
//
// Rules: at most one row per weekday; weekday in 1..7; on an OPEN day both times parse as HH:MM
// and open is strictly before close. A CLOSED day ignores its times (stored blank), so the UI
// can keep a day's times while toggling it shut.
func validateSchedule(rows []*teamv1.DayHours) ([]dayHoursJSON, error) {
	out := make([]dayHoursJSON, 0, len(rows))
	seen := map[teamv1.Weekday]bool{}

	for _, row := range rows {
		day := row.GetWeekday()

		if day < teamv1.Weekday_WEEKDAY_MONDAY || day > teamv1.Weekday_WEEKDAY_SUNDAY {
			return nil, fmt.Errorf("invalid weekday %v", day)
		}

		if seen[day] {
			return nil, fmt.Errorf("weekday %v appears more than once", day)
		}
		seen[day] = true

		entry := dayHoursJSON{Weekday: int32(day), Open: row.GetOpen()}

		if row.GetOpen() {
			openAt, err := time.Parse(timeLayout, row.GetOpenTime())
			if err != nil {
				return nil, fmt.Errorf("weekday %v: open_time must be HH:MM", day)
			}

			closeAt, err := time.Parse(timeLayout, row.GetCloseTime())
			if err != nil {
				return nil, fmt.Errorf("weekday %v: close_time must be HH:MM", day)
			}

			if !openAt.Before(closeAt) {
				return nil, fmt.Errorf("weekday %v: open_time must be before close_time", day)
			}

			entry.OpenTime = row.GetOpenTime()
			entry.CloseTime = row.GetCloseTime()
		}

		out = append(out, entry)
	}

	return out, nil
}

// encodeSchedule marshals a validated schedule to the JSON text stored in the jsonb column.
func encodeSchedule(rows []dayHoursJSON) (string, error) {
	if rows == nil {
		rows = []dayHoursJSON{}
	}

	data, err := json.Marshal(rows)
	if err != nil {
		return "", err
	}

	return string(data), nil
}

// decodeSchedule turns stored JSON back into proto DayHours. An empty/blank column is an empty
// schedule (every day closed by omission), never an error.
func decodeSchedule(stored string) ([]*teamv1.DayHours, error) {
	if stored == "" {
		return nil, nil
	}

	var rows []dayHoursJSON

	err := json.Unmarshal([]byte(stored), &rows)
	if err != nil {
		return nil, errors.New("stored warehouse hours are corrupt")
	}

	out := make([]*teamv1.DayHours, 0, len(rows))
	for _, row := range rows {
		out = append(out, &teamv1.DayHours{
			Weekday:   teamv1.Weekday(row.Weekday),
			Open:      row.Open,
			OpenTime:  row.OpenTime,
			CloseTime: row.CloseTime,
		})
	}

	return out, nil
}
