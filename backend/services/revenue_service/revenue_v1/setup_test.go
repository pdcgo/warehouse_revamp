package revenue_v1_test

import (
	"testing"

	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	revenuev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/revenue/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/revenue_service/revenue_v1"
)

func newService(t *testing.T, db *gorm.DB) *revenue_v1.Service {
	t.Helper()

	return revenue_v1.NewService(db)
}

func page1() *commonv1.CommonPagination {
	return &commonv1.CommonPagination{Page: 1, Limit: 20}
}

// revenueRows pulls the REVENUE (row) slice out of a list response, in the response's sorted id order.
// The handler defaults an empty data_request to the REVENUE slice, so tests that don't set one get it.
func revenueRows(res *revenuev1.RevenueListResponse) []*revenuev1.RevenueRowItem {
	var rowMap map[uint64]*revenuev1.RevenueRowItem

	for _, it := range res.GetItems() {
		r := it.GetRevenue()
		if r != nil {
			rowMap = r.GetMapData()
		}
	}

	out := make([]*revenuev1.RevenueRowItem, 0, len(res.GetIds()))
	for _, id := range res.GetIds() {
		row, ok := rowMap[id]
		if ok {
			out = append(out, row)
		}
	}

	return out
}
