package supplier_v1

import (
	"context"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// AnalyticProductSearch is one supplier's six figures per product over a window — Product Grouped, the Statistics
// tab's by-product table (the-figures-are-a-statistics-tab-and-a-supplier-report). The largest restocked value first.
//
// A row is the RESTOCKING team's product, so two teams buying one item are two rows, each naming its team
// (every-accepted-line-links-its-own-product). The names are product_service's — the screen resolves them by id.
//
// TWO queries: the page of products, and how many there are.
func (s *Service) AnalyticProductSearch(
	ctx context.Context,
	req *connect.Request[supplierv1.AnalyticProductSearchRequest],
) (*connect.Response[supplierv1.AnalyticProductSearchResponse], error) {
	msg := req.Msg
	filter := msg.GetFilter()
	page := msg.GetPage()

	start, end, err := parseRange(filter.GetDateRange())
	if err != nil {
		return nil, err
	}

	db := s.db.WithContext(ctx)
	grouped := window(db, start, end, filter.GetRestockTeamId()).
		Where("r.supplier_id = ?", msg.GetSupplierId()).
		Group("r.product_id, r.team_id")

	var total int64

	err = db.Table("(?) AS g", grouped.Select("1")).Count(&total).Error
	if err != nil {
		return nil, internal(err)
	}

	type row struct {
		ProductID uint64
		TeamID    uint64
		supplier_service_models.SupplierMetricColumns
	}

	var rows []row

	err = window(db, start, end, filter.GetRestockTeamId()).
		Where("r.supplier_id = ?", msg.GetSupplierId()).
		Select("r.product_id, r.team_id, " + figureSums("r")).
		Group("r.product_id, r.team_id").
		Order("SUM(r.restock_valuation) DESC, r.product_id, r.team_id").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Scan(&rows).
		Error
	if err != nil {
		return nil, internal(err)
	}

	datas := make([]*supplierv1.SupplierProductMetric, 0, len(rows))
	for _, r := range rows {
		datas = append(datas, &supplierv1.SupplierProductMetric{
			ProductId: r.ProductID,
			TeamId:    r.TeamID,
			Metric:    metricToProto(r.SupplierMetricColumns),
		})
	}

	return connect.NewResponse(&supplierv1.AnalyticProductSearchResponse{
		Datas:    datas,
		PageInfo: pageInfo(page, total),
	}), nil
}
