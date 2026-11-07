//go:build perfaudit

// go test -tags perfaudit -run TestPerf_SupplierReportExport -v ./backend/services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"testing"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// The Supplier Report's export over the seed the ranking was audited on (2 000 suppliers): the whole ranking by value
// and by broken rate over the default 30 days and a whole year, every team's and one team's, and a search — each step
// of 200 one MetricData read and one read of the suppliers, after the ranking's searches (200 a page).
func TestPerf_SupplierReportExport(t *testing.T) {
	b := figSetup(t)
	store := &fakeExports{}
	svc := supplier_v1.NewService(b.db, perfSellingTeams{}, nil, &fakeGoods{}, store)

	keyword := &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_SupplierKeywordFilter{
		SupplierKeywordFilter: &analytic_basev1.SupplierKeywordFilter{Q: "1"},
	}}

	for _, c := range []struct {
		name    string
		field   string
		filters []*analytic_basev1.FilterItem
	}{
		{"value/30d", "restock_valuation", figWindow(30)},
		{"value/366d", "restock_valuation", figWindow(366)},
		{"rate/366d", "broken_rate", figWindow(366)},
		{"value/366d/team", "restock_valuation", figWindow(366, figTeam(figTeamBase)...)},
		{"value/366d/search", "restock_valuation", figWindow(366, keyword)},
	} {
		name := "SupplierReportExport/" + c.name
		if !figWant(name) {
			continue
		}

		perfRun(t, b.perfBook, name, func(int) error {
			_, err := runReportExport(t, svc, store, &supplierv1.SupplierReportExportRequest{
				TeamId:  figTeamBase,
				Filters: c.filters,
				Sort:    sortBy(c.field, desc),
			})

			return err
		})
	}
}
