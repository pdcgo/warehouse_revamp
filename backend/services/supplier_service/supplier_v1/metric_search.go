package supplier_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
)

// MetricSearch RANKS the keys of one page of a report table by a field of `metrics/suppliers` — suppliers for the
// Supplier Report, products for the Statistics tab's By Product, or periods
// (docs/business/analytic/rpc_provide.md, the-pattern-replaces-the-shipped-analytics).
//
//   - Only keys with figures in the scope — the rows are the keys this search sends
//     (the-rows-are-the-keys-step-one-sends).
//   - Any team may read any supplier's figures, a deleted supplier's too (every-selling-team-sees-every-teams-figures,
//     a-deleted-supplier-is-kept-for-its-figures) — so nothing here checks a supplier exists.
//   - No total: it reads limit + 1 and says whether another page follows (a-page-says-whether-another-follows).
//
// ONE statement: each table grouped by the key, the two grouped reads summed per key (a UNION ALL of the GROUPED rows —
// window() says why never of the raw rows), ordered, a page plus one.
func (s *Service) MetricSearch(
	ctx context.Context,
	req *connect.Request[supplierv1.MetricSearchRequest],
) (*connect.Response[supplierv1.MetricSearchResponse], error) {
	msg := req.Msg

	scope, err := parseFilters(msg.GetFilters())
	if err != nil {
		return nil, err
	}

	group, err := groupOf(msg.GetGroupBy())
	if err != nil {
		return nil, err
	}

	order, err := sortOrder(msg.GetSort())
	if err != nil {
		return nil, err
	}

	page := msg.GetPage()
	limit := int(page.GetLimit())

	query := s.ranking(ctx, scope, group, order).
		Offset(int(page.GetOffset())).
		Limit(limit + 1)

	keys := &analytic_basev1.MetricKeys{}
	hasNext := false

	if group.isDay {
		var days []time.Time

		err = query.Pluck("g.key", &days).Error
		if err != nil {
			return nil, internal(err)
		}

		if len(days) > limit {
			days, hasNext = days[:limit], true
		}

		list := make([]string, 0, len(days))
		for _, day := range days {
			list = append(list, day.Format(dateLayout))
		}

		keys.K = &analytic_basev1.MetricKeys_Days{Days: &analytic_basev1.DayList{Days: list}}
	} else {
		var ids []uint64

		err = query.Pluck("g.key", &ids).Error
		if err != nil {
			return nil, internal(err)
		}

		if len(ids) > limit {
			ids, hasNext = ids[:limit], true
		}

		keys.K = &analytic_basev1.MetricKeys_Ids{Ids: &analytic_basev1.IDList{Ids: ids}}
	}

	return connect.NewResponse(&supplierv1.MetricSearchResponse{Keys: keys, HasNext: hasNext}), nil
}

// ranking is the search's ONE statement before its page is cut: each table grouped by the key, the two grouped reads
// summed per key, every key with figures in the scope in the sort's order (the key breaking a tie). The Supplier
// Report's export reads it whole (SupplierReportExport) — the same order, in one statement rather than a page at a time.
func (s *Service) ranking(ctx context.Context, scope metricScope, group metricGroup, order string) *gorm.DB {
	db := s.db.WithContext(ctx)
	restock := scope.rows(db).
		Select(group.key + " AS key, " + figureSums("r") + ", " + zerosOf(salesColumns) + ", " + unitsSum("r") + " AS units").
		Group(group.key)
	sales := scope.salesRows(db).
		Select(group.key + " AS key, " + zerosOf(restockColumns) + ", " + salesSums("r") + ", 0::bigint AS units").
		Group(group.key)
	grouped := db.
		Table("(? UNION ALL ?) AS u", restock, sales).
		Select("u.key, " + sumsOf("u", append(append([]string{}, restockColumns...), salesColumns...)) + ", SUM(u.units) AS units").
		Group("u.key")

	return db.
		Table("(?) AS g", grouped).
		Select("g.key").
		Order(order)
}
