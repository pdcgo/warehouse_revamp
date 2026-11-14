package supplier_v1_test

import (
	"testing"

	"google.golang.org/protobuf/proto"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// STATISTIK UNDER A WAREHOUSE CHIP (the-supplier-reports-carry-the-warehouse, a-supplier-page-is-scoped-by-its-warehouses):
// `metrics/suppliers` takes FILTER_TYPE_WAREHOUSE — the restocks received at that warehouse and the sales taken from it;
// with no chip, the sum over every warehouse, the same figures as before the reports carried it.

func oneWarehouse(id uint64) *analytic_basev1.FilterItem {
	return &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_WarehouseFilter{
		WarehouseFilter: &analytic_basev1.WarehouseFilter{WarehouseId: id},
	}}
}

// chipFixture folds one supplier's October at two warehouses: Kaos received at A (3 Oct) and B (5 Oct), Celana at B
// only (3 Oct); Kaos sold from A (4 Oct), Celana from B (5 Oct).
func chipFixture(t *testing.T, svc *supplier_v1.Service, goods *fakeGoods, supplier uint64, warehouseA, warehouseB uint64, base uint64) {
	t.Helper()

	fold(t, svc, inWarehouse(accept(base+1, sellingA, supplier, "2026-10-03",
		line{product: salKaos, ordered: 5, total: 50_000, accepted: 5}), warehouseA))
	fold(t, svc, inWarehouse(accept(base+2, sellingA, supplier, "2026-10-03",
		line{product: salCelana, ordered: 5, total: 10_000, accepted: 4, broken: 1}), warehouseB))
	fold(t, svc, inWarehouse(accept(base+3, sellingA, supplier, "2026-10-05",
		line{product: salKaos, ordered: 2, total: 20_000, accepted: 2}), warehouseB))

	goods.takes[base+11] = []supplier_v1.SaleTakePart{{ProductID: salKaos, SupplierID: supplier, TeamID: sellingA, WarehouseID: warehouseA, Units: 2}}
	goods.takes[base+12] = []supplier_v1.SaleTakePart{{ProductID: salCelana, SupplierID: supplier, TeamID: sellingA, WarehouseID: warehouseB, Units: 1}}

	salesFold(t, svc, inWarehouse(salePlaced(base+11, base+11, wib("2026-10-04", "10:00"), 30_000, saleLine(salKaos, 2, 20_000)), warehouseA))
	salesFold(t, svc, inWarehouse(salePlaced(base+12, base+12, wib("2026-10-05", "10:00"), 5_000, saleLine(salCelana, 1, 5_000)), warehouseB))
}

func withSales(m *supplierv1.SupplierMetric, count int64, value float64) *supplierv1.SupplierMetric {
	m.SalesCount, m.SalesValue = count, value

	return m
}

// Under chip A Statistik reads A's rows only, under B B's, with none the sum — the headline, Per Periode, Per Produk and
// Per Produk's ranking alike.
func TestMetricData_TheWarehouseChipNarrowsStatistik(t *testing.T) {
	db := san_testdb.DB(t)
	goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{}}
	svc := salesService(db, goods)

	chipFixture(t, svc, goods, salSumber, whA, whB, 100)

	cases := []struct {
		name    string
		chip    []*analytic_basev1.FilterItem
		summary *supplierv1.SupplierMetric
		days    map[string]*supplierv1.SupplierMetric
		kaos    *supplierv1.SupplierMetric
		celana  *supplierv1.SupplierMetric
		ranked  []uint64
	}{
		{
			name:    "chip A",
			chip:    filters(oneWarehouse(whA)),
			summary: withSales(metric(5, 50_000, 0, 0, 0, 0), 2, 30_000),
			days: map[string]*supplierv1.SupplierMetric{
				"2026-10-03": metric(5, 50_000, 0, 0, 0, 0),
				"2026-10-04": withSales(metric(0, 0, 0, 0, 0, 0), 2, 30_000),
				"2026-10-05": metric(0, 0, 0, 0, 0, 0),
			},
			kaos:   withSales(metric(5, 50_000, 0, 0, 0, 0), 2, 30_000),
			celana: metric(0, 0, 0, 0, 0, 0),
			ranked: []uint64{salKaos},
		},
		{
			name:    "chip B",
			chip:    filters(oneWarehouse(whB)),
			summary: withSales(metric(6, 28_000, 0, 0, 1, 2_000), 1, 5_000),
			days: map[string]*supplierv1.SupplierMetric{
				"2026-10-03": metric(4, 8_000, 0, 0, 1, 2_000),
				"2026-10-04": metric(0, 0, 0, 0, 0, 0),
				"2026-10-05": withSales(metric(2, 20_000, 0, 0, 0, 0), 1, 5_000),
			},
			kaos:   metric(2, 20_000, 0, 0, 0, 0),
			celana: withSales(metric(4, 8_000, 0, 0, 1, 2_000), 1, 5_000),
			ranked: []uint64{salKaos, salCelana},
		},
		{
			name:    "no chip",
			summary: withSales(metric(11, 78_000, 0, 0, 1, 2_000), 3, 35_000),
			days: map[string]*supplierv1.SupplierMetric{
				"2026-10-03": metric(9, 58_000, 0, 0, 1, 2_000),
				"2026-10-04": withSales(metric(0, 0, 0, 0, 0, 0), 2, 30_000),
				"2026-10-05": withSales(metric(2, 20_000, 0, 0, 0, 0), 1, 5_000),
			},
			kaos:   withSales(metric(7, 70_000, 0, 0, 0, 0), 2, 30_000),
			celana: withSales(metric(4, 8_000, 0, 0, 1, 2_000), 1, 5_000),
			ranked: []uint64{salKaos, salCelana},
		},
	}

	for _, c := range cases {
		scope := october(append([]*analytic_basev1.FilterItem{oneSupplier(salSumber)}, c.chip...)...)

		summary := fill(t, svc, &supplierv1.MetricDataRequest{
			GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, Filters: scope,
		}).GetSupplierSummary()
		if !proto.Equal(summary, c.summary) {
			t.Fatalf("%s: headline = %v, want %v", c.name, summary, c.summary)
		}

		days := fill(t, svc, &supplierv1.MetricDataRequest{
			GroupBy: analytic_basev1.GroupType_GROUP_TYPE_DAILY, Filters: scope,
			Keys: dayKeys("2026-10-03", "2026-10-04", "2026-10-05"),
		}).GetSupplierByDay().GetItems()
		for day, want := range c.days {
			if !proto.Equal(days[day], want) {
				t.Fatalf("%s: %s = %v, want %v", c.name, day, days[day], want)
			}
		}

		products := fill(t, svc, &supplierv1.MetricDataRequest{
			GroupBy: byProduct, Filters: scope, Keys: idKeys(salKaos, salCelana),
		}).GetSupplierById().GetItems()
		if !proto.Equal(products[salKaos], c.kaos) || !proto.Equal(products[salCelana], c.celana) {
			t.Fatalf("%s: Kaos %v, Celana %v — want %v, %v", c.name, products[salKaos], products[salCelana], c.kaos, c.celana)
		}

		ranked := search(t, svc, &supplierv1.MetricSearchRequest{
			GroupBy: byProduct, Filters: scope, Sort: sortBy("restock_valuation", desc),
		}).GetKeys().GetIds().GetIds()
		if !equalIDs(ranked, c.ranked) {
			t.Fatalf("%s: Per Produk ranks %v, want %v", c.name, ranked, c.ranked)
		}
	}
}

func equalIDs(a, b []uint64) bool {
	if len(a) != len(b) {
		return false
	}

	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}

	return true
}

// NO CHIP IS TODAY'S FIGURES, BYTE FOR BYTE: the same events folded once across two warehouses and once the way the
// reports were before they carried one (every event naming none, so each key is ONE row) answer every Statistik read —
// headline, Per Periode, Per Produk and its ranking — with the same bytes.
func TestMetricData_NoChipReadsTodaysFiguresByteForByte(t *testing.T) {
	db := san_testdb.DB(t)
	goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{}}
	svc := salesService(db, goods)

	const split, whole = salSumber, salSinar

	chipFixture(t, svc, goods, split, whA, whB, 100)
	chipFixture(t, svc, goods, whole, 0, 0, 200)

	marshal := proto.MarshalOptions{Deterministic: true}

	read := func(supplier uint64) [][]byte {
		scope := october(oneSupplier(supplier))

		messages := []proto.Message{
			fill(t, svc, &supplierv1.MetricDataRequest{GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, Filters: scope}),
			fill(t, svc, &supplierv1.MetricDataRequest{
				GroupBy: analytic_basev1.GroupType_GROUP_TYPE_DAILY, Filters: scope,
				Keys: dayKeys("2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"),
			}),
			fill(t, svc, &supplierv1.MetricDataRequest{
				GroupBy: analytic_basev1.GroupType_GROUP_TYPE_MONTHLY, Filters: scope, Keys: dayKeys("2026-10-01"),
			}),
			fill(t, svc, &supplierv1.MetricDataRequest{GroupBy: byProduct, Filters: scope, Keys: idKeys(salKaos, salCelana)}),
			search(t, svc, &supplierv1.MetricSearchRequest{GroupBy: byProduct, Filters: scope, Sort: sortBy("restock_valuation", desc)}),
			search(t, svc, &supplierv1.MetricSearchRequest{GroupBy: byProduct, Filters: scope, Sort: sortBy("broken_rate", asc)}),
		}

		out := make([][]byte, 0, len(messages))

		for _, m := range messages {
			b, err := marshal.Marshal(m)
			if err != nil {
				t.Fatal(err)
			}

			out = append(out, b)
		}

		return out
	}

	got, want := read(split), read(whole)

	for i := range want {
		if string(got[i]) != string(want[i]) {
			t.Fatalf("read %d: split across warehouses %x, one row per key %x — no chip must read today's figures", i, got[i], want[i])
		}
	}

	// And the rows really are split — the test would prove nothing over one warehouse.
	if n := len(restockRows(t, db)); n != 6 {
		t.Fatalf("%d restock rows, want 3 per supplier", n)
	}
}

// The Statistik tab's file follows the chip, as its reads do: Per Produk under chip A lists only what A received.
func TestSupplierFigureExport_FollowsTheWarehouseChip(t *testing.T) {
	db := san_testdb.DB(t)
	store := &fakeExports{}
	goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{}}
	svc := exportService(db, goods, store)

	melati := insertSupplier(t, db, sellingA, "Melati")
	chipFixture(t, svc, goods, melati.ID, whA, whB, 100)

	for _, c := range []struct {
		chip  []*analytic_basev1.FilterItem
		units []string
	}{
		{filters(oneWarehouse(whA)), []string{"5"}},
		{filters(oneWarehouse(whB)), []string{"2", "4"}},
		{nil, []string{"7", "4"}},
	} {
		file, err := runFigureExport(t, svc, store, &supplierv1.SupplierFigureExportRequest{
			TeamId: sellingA, GroupBy: byProduct,
			Filters: append(filters(dateRange("2026-10-01", "2026-10-31"), oneSupplier(melati.ID)), c.chip...),
		})
		if err != nil {
			t.Fatalf("export: %v", err)
		}

		units := file.column(t, "Per Produk", "Direstok (unit)")
		if !equalStrings(units, c.units) {
			t.Fatalf("chip %v: Direstok per product %v, want %v", c.chip, units, c.units)
		}
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}

	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}

	return true
}
