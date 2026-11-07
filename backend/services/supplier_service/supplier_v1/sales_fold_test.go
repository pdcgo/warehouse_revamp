package supplier_v1_test

import (
	"context"
	"errors"
	"math"
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// PENJUALAN (penjualan-is-the-selling-value-on-the-order-day): the selling value of a supplier's goods, on the Jakarta
// day the order was placed, a cancel taken back on its own day — folded from OrderPlaced / OrderCancelled and read
// through `metrics/suppliers`.

const (
	salSumber uint64 = 41
	salSinar  uint64 = 42
	salKaos   uint64 = 901 // sellingA's
	salCelana uint64 = 902 // sellingB's
)

// fakeGoods is the GoodsReader fake: each take by transaction, and the all-time figures per supplier.
type fakeGoods struct {
	takes map[uint64][]supplier_v1.SaleTakePart
	sold  map[uint64]int64
	ready map[uint64]int64
	// Per store, for the Toko tab's export.
	stores map[uint64]supplier_v1.StoreGoods
	err    error
	asked  int
}

func (f *fakeGoods) StoreGoods(context.Context, uint64) (map[uint64]supplier_v1.StoreGoods, error) {
	if f.err != nil {
		return nil, f.err
	}

	return f.stores, nil
}

func (f *fakeGoods) OrderTakeSuppliers(_ context.Context, transactionID uint64) ([]supplier_v1.SaleTakePart, error) {
	if f.err != nil {
		return nil, f.err
	}

	return f.takes[transactionID], nil
}

func (f *fakeGoods) SupplierIDsByFigure(_ context.Context, figure supplier_v1.GoodsFigure, lo, hi int64) ([]uint64, error) {
	if f.err != nil {
		return nil, f.err
	}

	f.asked++

	values := f.sold
	if figure == supplier_v1.GoodsReady {
		values = f.ready
	}

	var ids []uint64

	for id, v := range values {
		if v >= lo && (hi == 0 || v < hi) {
			ids = append(ids, id)
		}
	}

	return ids, nil
}

func salesService(db *gorm.DB, goods *fakeGoods) *supplier_v1.Service {
	return supplier_v1.NewService(db, sellingTeams{selling: map[uint64]bool{sellingA: true, sellingB: true}}, nil, goods, nil)
}

// salePlaced is the OrderPlaced the order service sends, at an instant.
func salePlaced(orderID, transactionID uint64, at time.Time, platformTotal float64, lines ...*eventsv1.OrderPlacedLine) *eventsv1.Event {
	ref := strconv.FormatUint(orderID, 10)

	return &eventsv1.Event{
		EventId:     "order-placed:" + ref,
		OccurredAt:  timestamppb.New(at),
		AggregateId: "order:" + ref,
		Message: &eventsv1.Event_OrderPlaced{OrderPlaced: &eventsv1.OrderPlaced{
			TeamId: sellingA, OrderId: orderID, TransactionId: transactionID, PlatformTotal: platformTotal, Lines: lines,
		}},
	}
}

func saleCancelled(orderID uint64, at time.Time) *eventsv1.Event {
	ref := strconv.FormatUint(orderID, 10)

	return &eventsv1.Event{
		EventId:     "order-cancelled:" + ref,
		OccurredAt:  timestamppb.New(at),
		AggregateId: "order:" + ref,
		Message: &eventsv1.Event_OrderCancelled{OrderCancelled: &eventsv1.OrderCancelled{
			TeamId: sellingA, OrderId: orderID, IdempotencyKey: "k-" + ref,
		}},
	}
}

func saleLine(product uint64, qty uint32, total float64) *eventsv1.OrderPlacedLine {
	return &eventsv1.OrderPlacedLine{ProductId: product, Quantity: qty, Total: total}
}

func salesFold(t *testing.T, svc *supplier_v1.Service, event *eventsv1.Event) {
	t.Helper()

	err := svc.SalesFoldHandler()(context.Background(), event)
	if err != nil {
		t.Fatalf("sales fold %s: %v", event.GetEventId(), err)
	}
}

// wib is an instant on a Jakarta wall clock.
func wib(day, clock string) time.Time {
	at, err := time.ParseInLocation("2006-01-02 15:04", day+" "+clock, time.FixedZone("WIB", 7*3600))
	if err != nil {
		panic(err)
	}

	return at
}

type saleFigure struct {
	count int64
	value float64
}

// salesByDay reads Penjualan per day for one supplier through MetricData — the Statistik tab's daily read.
func salesByDay(t *testing.T, svc *supplier_v1.Service, supplier uint64, days ...string) map[string]saleFigure {
	t.Helper()

	data := fill(t, svc, &supplierv1.MetricDataRequest{
		GroupBy: analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		Filters: filters(dateRange("2026-10-01", "2026-10-31"), oneSupplier(supplier)),
		Keys:    dayKeys(days...),
	})

	out := map[string]saleFigure{}
	for day, m := range data.GetSupplierByDay().GetItems() {
		out[day] = saleFigure{count: m.GetSalesCount(), value: m.GetSalesValue()}
	}

	return out
}

func near(a, b float64) bool {
	return math.Abs(a-b) < 0.00005
}

func checkSale(t *testing.T, name string, got, want saleFigure) {
	t.Helper()

	if got.count != want.count || !near(got.value, want.value) {
		t.Fatalf("%s = %d units · Rp %v, want %d · Rp %v", name, got.count, got.value, want.count, want.value)
	}
}

// AN ORDER AT 00:30 WIB COUNTS ON THAT JAKARTA DAY, read on a UTC clock (17:30 UTC the day before). The line's share of
// the platform total goes to the suppliers by the units their batches gave: 9 Kaos sold for Rp 900.000, 8 from Sumber's
// batch and 1 from Sinar's → Rp 800.000 and Rp 100.000.
func TestSalesFold_CountsTheOrderOnItsJakartaDayAtItsSellingValue(t *testing.T) {
	db := san_testdb.DB(t)
	goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{
		7001: {
			{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, Units: 8},
			{ProductID: salKaos, SupplierID: salSinar, TeamID: sellingA, Units: 1},
		},
	}}
	svc := salesService(db, goods)

	at := wib("2026-10-08", "00:30")
	if at.UTC().Day() != 7 {
		t.Fatalf("the instant should fall on the 7th in UTC, got %v", at.UTC())
	}

	salesFold(t, svc, salePlaced(1, 7001, at.UTC(), 900_000, saleLine(salKaos, 9, 450_000)))

	sumber := salesByDay(t, svc, salSumber, "2026-10-07", "2026-10-08")
	checkSale(t, "Sumber on 7 Oct (the UTC day)", sumber["2026-10-07"], saleFigure{})
	checkSale(t, "Sumber on 8 Oct", sumber["2026-10-08"], saleFigure{count: 8, value: 800_000})

	checkSale(t, "Sinar on 8 Oct", salesByDay(t, svc, salSinar, "2026-10-08")["2026-10-08"], saleFigure{count: 1, value: 100_000})
}

// The order's platform total is split over its LINES by their frozen total: Kaos (total 60.000) and Celana (total
// 40.000) on one order the buyer paid Rp 150.000 for → Kaos Rp 90.000, Celana Rp 60.000. With no line total known, by
// their quantities.
func TestSalesFold_SplitsTheOrderOverItsLinesByTheirTotal(t *testing.T) {
	db := san_testdb.DB(t)
	goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{
		7002: {
			{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, Units: 2},
			{ProductID: salCelana, SupplierID: salSinar, TeamID: sellingB, Units: 1},
		},
		7003: {
			{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, Units: 3},
			{ProductID: salCelana, SupplierID: salSinar, TeamID: sellingB, Units: 1},
		},
	}}
	svc := salesService(db, goods)

	salesFold(t, svc, salePlaced(2, 7002, wib("2026-10-10", "12:00"), 150_000,
		saleLine(salKaos, 2, 60_000), saleLine(salCelana, 1, 40_000)))
	salesFold(t, svc, salePlaced(3, 7003, wib("2026-10-11", "12:00"), 100_000,
		saleLine(salKaos, 3, 0), saleLine(salCelana, 1, 0)))

	sumber := salesByDay(t, svc, salSumber, "2026-10-10", "2026-10-11")
	checkSale(t, "Kaos by total", sumber["2026-10-10"], saleFigure{count: 2, value: 90_000})
	checkSale(t, "Kaos by quantity", sumber["2026-10-11"], saleFigure{count: 3, value: 75_000})

	sinar := salesByDay(t, svc, salSinar, "2026-10-10", "2026-10-11")
	checkSale(t, "Celana by total", sinar["2026-10-10"], saleFigure{count: 1, value: 60_000})
	checkSale(t, "Celana by quantity", sinar["2026-10-11"], saleFigure{count: 1, value: 25_000})
}

// A CANCEL TAKES IT BACK ON ITS OWN DAY: placed on the 7th, cancelled on the 9th — the 7th keeps the sale, the 9th
// reads it negative, the month nets to zero. A redelivery of either folds nothing twice.
func TestSalesFold_ACancelTakesItBackOnItsOwnDay(t *testing.T) {
	db := san_testdb.DB(t)
	goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{
		7004: {{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, Units: 4}},
	}}
	svc := salesService(db, goods)

	placed := salePlaced(4, 7004, wib("2026-10-07", "10:00"), 200_000, saleLine(salKaos, 4, 120_000))
	cancelled := saleCancelled(4, wib("2026-10-09", "23:59"))

	salesFold(t, svc, placed)
	salesFold(t, svc, cancelled)
	salesFold(t, svc, placed)
	salesFold(t, svc, cancelled)

	days := salesByDay(t, svc, salSumber, "2026-10-07", "2026-10-08", "2026-10-09")
	checkSale(t, "the order's day", days["2026-10-07"], saleFigure{count: 4, value: 200_000})
	checkSale(t, "between", days["2026-10-08"], saleFigure{})
	checkSale(t, "the cancel's day", days["2026-10-09"], saleFigure{count: -4, value: -200_000})

	month := fill(t, svc, &supplierv1.MetricDataRequest{
		GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY,
		Filters: filters(dateRange("2026-10-01", "2026-10-31"), oneSupplier(salSumber)),
	}).GetSupplierSummary()
	checkSale(t, "October", saleFigure{count: month.GetSalesCount(), value: month.GetSalesValue()}, saleFigure{})
}

// The broker may bring the cancel FIRST. It is held on the order's row; the late placement adds on its day and takes
// back on the cancel's, in one go — the same figures as in order.
func TestSalesFold_ACancelArrivingFirstStillTakesItBackOnItsDay(t *testing.T) {
	db := san_testdb.DB(t)
	goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{
		7005: {{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, Units: 2}},
	}}
	svc := salesService(db, goods)

	salesFold(t, svc, saleCancelled(5, wib("2026-10-12", "08:00")))

	if got := salesByDay(t, svc, salSumber, "2026-10-12")["2026-10-12"]; got.count != 0 {
		t.Fatalf("a cancel before its placement moved the figures: %+v", got)
	}

	salesFold(t, svc, salePlaced(5, 7005, wib("2026-10-11", "08:00"), 50_000, saleLine(salKaos, 2, 30_000)))

	days := salesByDay(t, svc, salSumber, "2026-10-11", "2026-10-12")
	checkSale(t, "placed", days["2026-10-11"], saleFigure{count: 2, value: 50_000})
	checkSale(t, "cancelled", days["2026-10-12"], saleFigure{count: -2, value: -50_000})
}

// ANOTHER TEAM'S SALE COUNTS for every reader (every-selling-team-sees-every-teams-figures): sellingB's Celana from
// Sinar, read by sellingA; the team filter narrows to whose goods — sellingB keeps it, sellingA has none.
func TestSalesFold_AnotherTeamsSaleCountsForEveryReader(t *testing.T) {
	db := san_testdb.DB(t)
	goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{
		7006: {{ProductID: salCelana, SupplierID: salSinar, TeamID: sellingB, Units: 5}},
	}}
	svc := salesService(db, goods)

	salesFold(t, svc, salePlaced(6, 7006, wib("2026-10-15", "09:00"), 250_000, saleLine(salCelana, 5, 100_000)))

	read := func(team uint64) saleFigure {
		items := []*analytic_basev1.FilterItem{dateRange("2026-10-01", "2026-10-31")}
		if team != 0 {
			items = append(items, restockTeam(team))
		}

		m := fill(t, svc, &supplierv1.MetricDataRequest{
			GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUPPLIER,
			Filters: items,
			Keys:    idKeys(salSinar),
		}).GetSupplierById().GetItems()[salSinar]

		return saleFigure{count: m.GetSalesCount(), value: m.GetSalesValue()}
	}

	checkSale(t, "read by sellingA, every team", read(0), saleFigure{count: 5, value: 250_000})
	checkSale(t, "sellingB's goods", read(sellingB), saleFigure{count: 5, value: 250_000})
	checkSale(t, "sellingA's goods", read(sellingA), saleFigure{})

	// The ranking sorts by it too, as by any figure (a-sort-field-is-its-proto-name).
	res, err := svc.MetricSearch(context.Background(), connect.NewRequest(&supplierv1.MetricSearchRequest{
		TeamId:  sellingA,
		GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUPPLIER,
		Filters: filters(dateRange("2026-10-01", "2026-10-31")),
		Sort:    sortBy("sales_value", analytic_basev1.SortType_SORT_TYPE_DESC),
		Page:    window(0, 10),
	}))
	if err != nil {
		t.Fatalf("MetricSearch by sales_value: %v", err)
	}

	if ids := res.Msg.GetKeys().GetIds().GetIds(); len(ids) != 1 || ids[0] != salSinar {
		t.Fatalf("ranked by sales = %v, want Sinar", ids)
	}
}

// Inventory not answering NACKS the placement, and writes nothing — the redelivery folds it. A batch from nobody (no
// part) still marks the order folded, so its cancel finds nothing to take back.
func TestSalesFold_AnUnreadTakeIsRedelivered(t *testing.T) {
	db := san_testdb.DB(t)
	goods := &fakeGoods{err: errors.New("inventory down")}
	svc := salesService(db, goods)

	placed := salePlaced(8, 7008, wib("2026-10-20", "09:00"), 10_000, saleLine(salKaos, 1, 5_000))

	err := svc.SalesFoldHandler()(context.Background(), placed)
	if err == nil {
		t.Fatalf("a placement whose take could not be read was acknowledged")
	}

	var orders int64

	err = db.Model(&supplier_service_models.SupplierSaleOrder{}).Where("order_id = ?", 8).Count(&orders).Error
	if err != nil || orders != 0 {
		t.Fatalf("an unread take left %d order rows (%v)", orders, err)
	}

	goods.err = nil
	salesFold(t, svc, placed)
	salesFold(t, svc, saleCancelled(8, wib("2026-10-21", "09:00")))

	checkSale(t, "nothing from nobody", salesByDay(t, svc, salSumber, "2026-10-21")["2026-10-21"], saleFigure{})
}

// A WAREHOUSE ROLE IS REFUSED, as SupplierGoods refuses it: supplier figures are a selling team's
// (only-a-selling-team-has-suppliers) — both reads' policies name the selling roles, root and the monitor, no warehouse.
func TestSupplierMetrics_RefuseAWarehouseRole(t *testing.T) {
	for _, name := range []string{"warehouse.supplier.v1.MetricDataRequest", "warehouse.supplier.v1.MetricSearchRequest"} {
		desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName(name))
		if err != nil {
			t.Fatalf("descriptor %s: %v", name, err)
		}

		roles := map[string]bool{}
		for _, role := range san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor)).GetRoles() {
			roles[role.String()] = true
		}

		for _, want := range []string{"ROLE_ROOT", "ROLE_ADMINISTRATOR", "ROLE_SELLING_OWNER", "ROLE_SELLING_ADMIN", "ROLE_SELLING_CS"} {
			if !roles[want] {
				t.Fatalf("%s: %s may not read the figures", name, want)
			}
		}

		for _, refused := range []string{"ROLE_WAREHOUSE_OWNER", "ROLE_WAREHOUSE_ADMIN", "ROLE_WAREHOUSE_STAFF"} {
			if roles[refused] {
				t.Fatalf("%s: %s may read the figures", name, refused)
			}
		}
	}
}
