package settlement_v1

import (
	"context"
	"fmt"
	"time"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_metric"
)

// MetricSearch RANKS the keys of one page of a report table by a field of ONE settlement metric — teams, shops,
// people or periods (docs/business/analytic/rpc_provide.md).
//
//   - An id group holds every key with a row up to the window's END: a shop quiet in the window still ranks by the
//     position it carries in. A time group holds every period of the window, a quiet one included — and its span is
//     capped, since each period is a position read.
//   - It ranks by the SAME definition the fill answers with (measureSQL), so the order and the numbers agree.
//   - A shop and a person together is refused (one-settlement-metric-reads-both-tables).
//   - No total: it reads limit + 1 and says whether another page follows (a-page-says-whether-another-follows).
//
// ONE statement: the keys' figures, ordered, a page plus one.
func (s *Service) MetricSearch(
	ctx context.Context,
	req *connect.Request[settlementv1.MetricSearchRequest],
) (*connect.Response[settlementv1.MetricSearchResponse], error) {
	msg := req.Msg

	metric, err := settlementMetricByID(msg.GetSort().GetMetricId())
	if err != nil {
		return nil, err
	}

	metrics := []*settlementMetric{metric}

	filters, err := parseMetricFilters(msg.GetFilters(), metrics)
	if err != nil {
		return nil, err
	}

	group := msg.GetGroupBy()

	err = checkGroup(group, metrics)
	if err != nil {
		return nil, err
	}

	field, _, err := san_metric.SortField(metric.desc, msg.GetSort().GetField())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	grain, err := tableOf(group, filters)
	if err != nil {
		return nil, err
	}

	scope := scopeOf(msg.GetTeamId(), filters)

	var base string

	if column, ok := idColumnOf(group); ok {
		base = idBase(grain, column, scope, filters, nil)
	} else if isTimeGroup(group) {
		buckets, err := windowBuckets(group, filters)
		if err != nil {
			return nil, err
		}

		base = timeBase(grain, scope, buckets)
	} else {
		return nil, invalidMetric("%s has no key — a summary is read, never searched", group)
	}

	// An unspecified sort reads DESC — on `position_to_date`, the largest shortfall first.
	direction := "DESC"
	if msg.GetSort().GetSortType() == analytic_basev1.SortType_SORT_TYPE_ASC {
		direction = "ASC"
	}

	page := msg.GetPage()
	limit := int(page.GetLimit())

	// The field is one the metric declares sortable (SortField), so its name is safe to write into the ORDER BY. The
	// key, DESC, breaks every tie (the-key-breaks-every-tie).
	query := base + fmt.Sprintf(`
SELECT key FROM measured
ORDER BY %s %s NULLS LAST, k DESC
OFFSET %d LIMIT %d`, field.Name(), direction, page.GetOffset(), limit+1)

	var found []string

	err = s.db.WithContext(ctx).Raw(query).Scan(&found).Error
	if err != nil {
		return nil, dbError(err)
	}

	hasNext := len(found) > limit
	if hasNext {
		found = found[:limit]
	}

	keys := &analytic_basev1.MetricKeys{}

	if isTimeGroup(group) {
		keys.K = &analytic_basev1.MetricKeys_Days{Days: &analytic_basev1.DayList{Days: found}}
	} else {
		ids, err := parseIDs(found)
		if err != nil {
			return nil, dbError(err)
		}

		keys.K = &analytic_basev1.MetricKeys_Ids{Ids: &analytic_basev1.IDList{Ids: ids}}
	}

	return connect.NewResponse(&settlementv1.MetricSearchResponse{Keys: keys, HasNext: hasNext}), nil
}

// parseIDs reads back the id keys the SQL rendered as text.
func parseIDs(keys []string) ([]uint64, error) {
	ids := make([]uint64, 0, len(keys))

	for _, key := range keys {
		var id uint64

		_, err := fmt.Sscan(key, &id)
		if err != nil {
			return nil, fmt.Errorf("settlement metrics: key %q is not an id: %w", key, err)
		}

		ids = append(ids, id)
	}

	return ids, nil
}

// parseDays reads asked period keys, each the first day of its period — any other day of it names no row, and would
// come back a quiet zero.
func parseDays(group analytic_basev1.GroupType, raw []string) ([]time.Time, error) {
	days := make([]time.Time, 0, len(raw))

	for _, text := range raw {
		day, err := time.Parse(dateLayout, text)
		if err != nil {
			return nil, invalidMetric("%q is not a day", text)
		}

		if !periodStart(group, day).Equal(day) {
			return nil, invalidMetric("%s is not the first day of its %s period", text, group)
		}

		days = append(days, day)
	}

	return days, nil
}
