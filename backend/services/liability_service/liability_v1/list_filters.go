package liability_v1

import (
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"

	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
)

// The filters the Team Balance lists apply BEFORE THE PAGE (backlog #34). They were the screen's, over the 20 pairs or
// 50 entries it had loaded, so a match on page 2 was reported as "nothing found" and a date range reaching past page 1
// showed only what page 1 held. One copy each, shared by every list that takes them.

var (
	errListBadDate        = errors.New("a date must be a real day, as YYYY-MM-DD")
	errListPeriodInverted = errors.New("the period ends before it starts")
)

// listPeriod turns a list's optional `from` / `to` — YYYY-MM-DD JAKARTA days, inclusive
// (the-liability-day-is-the-jakarta-day) — into a half-open instant range: `start` is the Jakarta midnight that opens
// `from`, `end` the one that closes `to`. Either is nil when its side is empty (open).
//
// Instants, not `::date` casts on the column: `created_at >= ? AND created_at < ?` reads an index on the column as it
// is, and the two Jakarta midnights put an entry posted at 06:30 WIB on its WIB date, never on the UTC day before.
//
// A pattern is not validity ("2026-02-31" matches it), and a handler called directly gets no validation interceptor,
// so the days are parsed here. A `to` before `from` is refused rather than swapped — a reversed range is the
// caller's bug, and a silent correction answers a question nobody asked.
func listPeriod(rawFrom, rawTo string) (*time.Time, *time.Time, error) {
	var start, end *time.Time

	if rawFrom != "" {
		from, err := time.ParseInLocation(dateLayout, rawFrom, jakarta)
		if err != nil {
			return nil, nil, connect.NewError(connect.CodeInvalidArgument, errListBadDate)
		}

		start = &from
	}

	if rawTo != "" {
		to, err := time.ParseInLocation(dateLayout, rawTo, jakarta)
		if err != nil {
			return nil, nil, connect.NewError(connect.CodeInvalidArgument, errListBadDate)
		}

		// The day AFTER `to`, so the last day counts in full — an entry at 23:59 WIB on it is inside.
		closing := to.AddDate(0, 0, 1)
		end = &closing
	}

	if start != nil && end != nil && !end.After(*start) {
		return nil, nil, connect.NewError(connect.CodeInvalidArgument, errListPeriodInverted)
	}

	return start, end, nil
}

// teamMatches says whether a counterparty's team passes the pair list's search and kind filter.
//
// The search is TeamList's: case-insensitive, anywhere in the name or the code, the term trimmed. A team team_service
// does not know (`known` false) passes only when neither filter is set — it has no name to match and no kind to be.
func teamMatches(fact TeamFact, known bool, q string, kind teamv1.TeamType) bool {
	if !known {
		return q == "" && kind == teamv1.TeamType_TEAM_TYPE_UNSPECIFIED
	}

	if kind != teamv1.TeamType_TEAM_TYPE_UNSPECIFIED && fact.Type != kind {
		return false
	}

	if q == "" {
		return true
	}

	needle := strings.ToLower(q)

	return strings.Contains(strings.ToLower(fact.Name), needle) ||
		strings.Contains(strings.ToLower(fact.Code), needle)
}
