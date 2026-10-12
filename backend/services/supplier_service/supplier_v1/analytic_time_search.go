package supplier_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// AnalyticTimeSearch is one supplier's six figures over time — the Statistics tab's series — and the window's total,
// its headline (the-figures-are-a-statistics-tab-and-a-supplier-report).
//
// Every bucket of the window is a point, a quiet one included (all zero), so a missing row never reads as a period
// that did not load. Any team may read any supplier's figures, a deleted supplier's too
// (every-selling-team-sees-every-teams-figures, a-deleted-supplier-is-kept-for-its-figures) — so nothing here checks
// the supplier exists: an unknown id simply has no figures.
//
// TWO queries: the buckets that had figures (grouped by the timeframe's date_trunc), and the window's total.
func (s *Service) AnalyticTimeSearch(
	ctx context.Context,
	req *connect.Request[supplierv1.AnalyticTimeSearchRequest],
) (*connect.Response[supplierv1.AnalyticTimeSearchResponse], error) {
	msg := req.Msg
	filter := msg.GetFilter()

	start, end, err := parseRange(filter.GetDateRange())
	if err != nil {
		return nil, err
	}

	buckets, err := timeBuckets(msg.GetTimeframe(), start, end)
	if err != nil {
		return nil, err
	}

	db := s.db.WithContext(ctx)
	scope := func() *gorm.DB {
		return window(db, start, end, filter.GetRestockTeamId()).Where("r.supplier_id = ?", msg.GetSupplierId())
	}

	type point struct {
		At time.Time
		supplier_service_models.SupplierMetricColumns
	}

	var points []point

	// The bucket a day rolls up into — grouped by the EXPRESSION, because GORM quotes a bare ordinal as a column name.
	bucketOf := "date_trunc('" + truncUnit(msg.GetTimeframe()) + "', r.day)::date"

	err = scope().
		Select(bucketOf + " AS at, " + figureSums("r")).
		Group(bucketOf).
		Scan(&points).
		Error
	if err != nil {
		return nil, internal(err)
	}

	var total supplier_service_models.SupplierMetricColumns

	err = scope().
		Select(figureSums("r")).
		Scan(&total).
		Error
	if err != nil {
		return nil, internal(err)
	}

	byDay := make(map[string]supplier_service_models.SupplierMetricColumns, len(points))
	for _, p := range points {
		byDay[p.At.Format(dateLayout)] = p.SupplierMetricColumns
	}

	// Newest first when asked; oldest first otherwise.
	if msg.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_DESC {
		for i, j := 0, len(buckets)-1; i < j; i, j = i+1, j-1 {
			buckets[i], buckets[j] = buckets[j], buckets[i]
		}
	}

	page := msg.GetPage()
	from := min(pageOffset(page), len(buckets))
	to := min(from+int(page.GetLimit()), len(buckets))

	datas := make([]*supplierv1.SupplierTimeframeMetric, 0, to-from)
	for _, b := range buckets[from:to] {
		at := b.at.Format(dateLayout)
		datas = append(datas, &supplierv1.SupplierTimeframeMetric{
			At:     at,
			Metric: metricToProto(byDay[at]),
		})
	}

	return connect.NewResponse(&supplierv1.AnalyticTimeSearchResponse{
		Datas:    datas,
		PageInfo: pageInfo(page, int64(len(buckets))),
		Total:    metricToProto(total),
	}), nil
}
