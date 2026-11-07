//go:build perfaudit

// go test -tags perfaudit -run TestPerf_SupplierFigureExport -v ./backend/services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"testing"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// The Statistik tab's export of the supplier with the most rows and of the median one: Per Periode by day over the
// default 30 days and a whole year (two steps of 200 periods), by month over a year, and Per Produk over 30 days and a
// year — each step one MetricData read of the tab's own; Per Produk first ranks every key, 200 a search.
func TestPerf_SupplierFigureExport(t *testing.T) {
	b := figSetup(t)
	store := &fakeExports{}
	svc := supplier_v1.NewService(b.db, perfSellingTeams{}, nil, &fakeGoods{}, store)

	for _, c := range []struct {
		name     string
		supplier uint64
		days     int
		group    analytic_basev1.GroupType
	}{
		{"top/daily-30d", b.top, 30, analytic_basev1.GroupType_GROUP_TYPE_DAILY},
		{"top/daily-365d", b.top, 365, analytic_basev1.GroupType_GROUP_TYPE_DAILY},
		{"top/monthly-365d", b.top, 365, analytic_basev1.GroupType_GROUP_TYPE_MONTHLY},
		{"top/product-30d", b.top, 30, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT},
		{"top/product-365d", b.top, 365, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT},
		{"median/daily-365d", b.median, 365, analytic_basev1.GroupType_GROUP_TYPE_DAILY},
		{"median/product-365d", b.median, 365, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT},
	} {
		name := "SupplierFigureExport/" + c.name
		if !figWant(name) {
			continue
		}

		perfRun(t, b.perfBook, name, func(int) error {
			_, err := runFigureExport(t, svc, store, &supplierv1.SupplierFigureExportRequest{
				TeamId:  figTeamBase,
				GroupBy: c.group,
				Filters: figWindow(c.days, oneSupplier(c.supplier)),
			})

			return err
		})
	}
}
