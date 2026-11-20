package inventory_v1_test

import (
	"context"
	"fmt"
	"math"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// RESTOCK BEFORE THE ACCEPT, READ BACK (the-restock-before-the-accept-prototype-is-accepted,
// a-cancelled-restock-takes-its-ordered-back-on-its-day, a-lost-box-that-turns-up-takes-its-lost-back-on-its-day). The
// accepted prototype's seven worked restocks (accepts/accept85/README.md, restockPrototype's OCTOBER_DAYS) driven through
// the REAL writes — create, edit, cancel, mark lost, sign, accept — each on its own October day, so the served numbers
// are the pictures the owner accepted. Toko Melati (12), Gudang Pusat (11) unless named:
//
//	R6  1 Oct  5 × Kemeja, ongkir 15.000 · lost 5 Oct · the box turns up 18 Oct · accepted 19 Oct, COD 5.000
//	R7  2 Oct  6 × Sepatu, ongkir 12.000 · arrived 7 Oct · edited while arrived 9 Oct (+ 2 × Tas) · accepted 12 Oct
//	R1  6 Oct  20 × Kaos + 10 × Kemeja, ongkir 30.000 · edited 8 Oct (Kaos 20 → 30) · accepted 10 Oct: 1 broken,
//	           2 missing, COD 20.000
//	R5  7 Oct  10 × Kaos, ongkir 10.000 · cancelled 11 Oct
//	R2 12 Oct  10 × Sepatu to Gudang Cabang (14), ongkir 20.000 · edited 13 Oct: to Gudang Pusat · accepted 16 Oct
//	R3 14 Oct  4 × Tas, ongkir 20.000 · lost 17 Oct
//	R4 15 Oct  50 × Botol + 50 × Kotak, ongkir 20.000 · edited 16 Oct: ongkir → 35.000 · accepted 20 Oct: 3 missing,
//	           COD 10.000

const (
	octSeller   uint64 = 12
	octPusat    uint64 = 11
	octCabang   uint64 = 14
	octStranger uint64 = 77
	octAccount  uint64 = 41
)

// octProduct is a sample product: its price and its supplier (sample.ts SAMPLE_PRODUCTS).
type octProduct struct {
	id       uint64
	name     string
	price    float64
	supplier uint64
}

var (
	octKaos   = octProduct{201, "Kaos Polos Hitam", 45_000, 32}
	octKemeja = octProduct{202, "Kemeja Flanel", 120_000, 32}
	octBotol  = octProduct{203, "Botol Minum 1L", 6_500, 33}
	octKotak  = octProduct{204, "Kotak Makan", 7_000, 33}
	octSepatu = octProduct{205, "Sepatu Kanvas", 180_000, 31}
	octTas    = octProduct{206, "Tas Selempang", 95_000, 31}
)

type octLine struct {
	product octProduct
	count   int64
}

// octOn is noon (Jakarta) of an October 2026 day — the stock transaction's clock, so the write's report rows land on it.
func octOn(ctx context.Context, day int) context.Context {
	return inventory_ledgers.WithNow(ctx, time.Date(2026, time.October, day, 12, 0, 0, 0, metricWIB))
}

func octDay(day int) string {
	return fmt.Sprintf("2026-10-%02d", day)
}

func octWindow() *analytic_basev1.FilterItem {
	return windowOf(octDay(1), octDay(20))
}

func octItems(lines []octLine) []*inventoryv1.RestockRequestItem {
	items := make([]*inventoryv1.RestockRequestItem, 0, len(lines))
	for _, l := range lines {
		items = append(items, &inventoryv1.RestockRequestItem{
			ProductId: l.product.id, ProductCode: fmt.Sprintf("P%d", l.product.id), Name: l.product.name,
			Count: l.count, Total: float64(l.count) * l.product.price, SupplierId: l.product.supplier,
		})
	}

	return items
}

// octBook is the seven restocks' service and its rack in Gudang Pusat.
type octBook struct {
	db   *gorm.DB
	svc  *inventory_v1.Service
	rack uint64
}

func newOctBook(t *testing.T) *octBook {
	t.Helper()

	db := san_testdb.DB(t)
	svc := newServiceWithSuppliers(t, db, fakeSuppliers{31: true, 32: true, 33: true})

	return &octBook{db: db, svc: svc, rack: newRack(t, svc, octPusat, "oct-a")}
}

func (b *octBook) create(t *testing.T, day int, warehouse uint64, shipping float64, lines ...octLine) *inventoryv1.RestockRequest {
	t.Helper()

	res, err := b.svc.RestockRequestCreate(octOn(ctxUser(1), day), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: octSeller, WarehouseId: warehouse, FinanceAccountId: octAccount, ShipmentCost: shipping, Items: octItems(lines),
	}))
	if err != nil {
		t.Fatalf("create on %s: %v", octDay(day), err)
	}

	return res.Msg.GetRequest()
}

func (b *octBook) edit(t *testing.T, day int, r *inventoryv1.RestockRequest, warehouse uint64, shipping float64, lines ...octLine) {
	t.Helper()

	_, err := b.svc.RestockRequestUpdate(octOn(ctxUser(1), day), connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
		TeamId: octSeller, RequestId: r.GetId(), WarehouseId: warehouse, FinanceAccountId: octAccount,
		ShipmentCost: shipping, Items: octItems(lines),
	}))
	if err != nil {
		t.Fatalf("edit restock %d on %s: %v", r.GetId(), octDay(day), err)
	}
}

func (b *octBook) cancel(t *testing.T, day int, r *inventoryv1.RestockRequest) {
	t.Helper()

	_, err := b.svc.RestockRequestCancel(octOn(ctxUser(1), day), connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{
		TeamId: octSeller, RequestId: r.GetId(),
	}))
	if err != nil {
		t.Fatalf("cancel restock %d on %s: %v", r.GetId(), octDay(day), err)
	}
}

func (b *octBook) lose(t *testing.T, day int, r *inventoryv1.RestockRequest) {
	t.Helper()

	_, err := b.svc.RestockRequestMarkLost(octOn(ctxUser(1), day), connect.NewRequest(&inventoryv1.RestockRequestMarkLostRequest{
		TeamId: octSeller, RequestId: r.GetId(),
	}))
	if err != nil {
		t.Fatalf("mark restock %d lost on %s: %v", r.GetId(), octDay(day), err)
	}
}

func (b *octBook) arrive(t *testing.T, day int, r *inventoryv1.RestockRequest) {
	t.Helper()

	_, err := b.svc.RestockRequestArrive(octOn(ctxUser(7), day), connect.NewRequest(&inventoryv1.RestockRequestArriveRequest{
		TeamId: octPusat, RequestId: r.GetId(),
	}))
	if err != nil {
		t.Fatalf("sign for restock %d on %s: %v", r.GetId(), octDay(day), err)
	}
}

// octCount is how one line was counted at the door: in the box, of those broken.
type octCount struct {
	product          octProduct
	received, broken int64
}

func (b *octBook) accept(t *testing.T, day int, restockID uint64, cod float64, counts ...octCount) {
	t.Helper()

	var stored struct{ ID uint64 }

	lines := make([]*inventoryv1.RestockRequestReceivedLine, 0, len(counts))

	for _, c := range counts {
		err := b.db.Raw(`SELECT id FROM restock_items WHERE restock_id = ? AND product_id = ?`, restockID, c.product.id).
			Scan(&stored).Error
		if err != nil || stored.ID == 0 {
			t.Fatalf("restock %d's line of %d: %v", restockID, c.product.id, err)
		}

		line := &inventoryv1.RestockRequestReceivedLine{ItemId: stored.ID, ReceivedCount: c.received, BrokenCount: c.broken}
		if good := c.received - c.broken; good > 0 {
			line.Placements = placedOn(b.rack, good)
		}

		lines = append(lines, line)
	}

	req := &inventoryv1.RestockRequestAcceptRequest{TeamId: octPusat, RequestId: restockID, Lines: lines}
	if cod > 0 {
		req.WarehouseAdditionalCost = cod
		req.WarehouseAdditionalCostNote = "ongkir cod"
	}

	_, err := b.svc.RestockRequestAccept(octOn(ctxUser(7), day), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("accept restock %d on %s: %v", restockID, octDay(day), err)
	}
}

// The restocks, one by one, each step on its own day.
func (b *octBook) r6(t *testing.T) {
	r := b.create(t, 1, octPusat, 15_000, octLine{octKemeja, 5})
	b.lose(t, 5, r)
	b.arrive(t, 18, r)
	b.accept(t, 19, r.GetId(), 5_000, octCount{octKemeja, 5, 0})
}

func (b *octBook) r7(t *testing.T) {
	r := b.create(t, 2, octPusat, 12_000, octLine{octSepatu, 6})
	b.arrive(t, 7, r)
	b.edit(t, 9, r, octPusat, 12_000, octLine{octSepatu, 6}, octLine{octTas, 2})
	b.accept(t, 12, r.GetId(), 0, octCount{octSepatu, 6, 0}, octCount{octTas, 2, 0})
}

func (b *octBook) r1(t *testing.T) {
	r := b.create(t, 6, octPusat, 30_000, octLine{octKaos, 20}, octLine{octKemeja, 10})
	b.edit(t, 8, r, octPusat, 30_000, octLine{octKaos, 30}, octLine{octKemeja, 10})
	b.accept(t, 10, r.GetId(), 20_000, octCount{octKaos, 28, 0}, octCount{octKemeja, 10, 1})
}

func (b *octBook) r5(t *testing.T) {
	r := b.create(t, 7, octPusat, 10_000, octLine{octKaos, 10})
	b.cancel(t, 11, r)
}

func (b *octBook) r2(t *testing.T) {
	r := b.create(t, 12, octCabang, 20_000, octLine{octSepatu, 10})
	b.edit(t, 13, r, octPusat, 20_000, octLine{octSepatu, 10})
	b.accept(t, 16, r.GetId(), 0, octCount{octSepatu, 10, 0})
}

func (b *octBook) r3(t *testing.T) {
	r := b.create(t, 14, octPusat, 20_000, octLine{octTas, 4})
	b.lose(t, 17, r)
}

func (b *octBook) r4(t *testing.T) {
	r := b.create(t, 15, octPusat, 20_000, octLine{octBotol, 50}, octLine{octKotak, 50})
	b.edit(t, 16, r, octPusat, 35_000, octLine{octBotol, 50}, octLine{octKotak, 50})
	b.accept(t, 20, r.GetId(), 10_000, octCount{octBotol, 50, 0}, octCount{octKotak, 47, 0})
}

// octAll is the whole October book.
func octAll(t *testing.T) *octBook {
	t.Helper()

	b := newOctBook(t)
	b.r6(t)
	b.r7(t)
	b.r1(t)
	b.r5(t)
	b.r2(t)
	b.r3(t)
	b.r4(t)

	return b
}

// octFields is Restock's nine fields, in the proto's order.
var octFields = []string{
	"ordered_count", "ordered_value", "lost_count", "lost_value",
	"accepted_count", "accepted_value", "broken_count", "missing_count", "cod_amount",
}

// octValues is what a warehouse is not given.
var octValues = map[string]bool{"ordered_value": true, "lost_value": true, "accepted_value": true}

// octFigs is one answer's figures by field name, and which values came back set.
type octFigs map[string]float64

func figsOf(m *inventoryv1.InventoryRestockMetric) (octFigs, map[string]bool) {
	set := map[string]bool{
		"ordered_value": m.OrderedValue != nil, "lost_value": m.LostValue != nil, "accepted_value": m.AcceptedValue != nil,
	}

	return octFigs{
		"ordered_count": float64(m.GetOrderedCount()), "ordered_value": m.GetOrderedValue(),
		"lost_count": float64(m.GetLostCount()), "lost_value": m.GetLostValue(),
		"accepted_count": float64(m.GetAcceptedCount()), "accepted_value": m.GetAcceptedValue(),
		"broken_count": float64(m.GetBrokenCount()), "missing_count": float64(m.GetMissingCount()),
		"cod_amount": m.GetCodAmount(),
	}, set
}

// wantFigs compares every field — one not named in `want` is 0.
func wantFigs(t *testing.T, what string, got *inventoryv1.InventoryRestockMetric, want octFigs) {
	t.Helper()

	figs, _ := figsOf(got)

	for _, f := range octFields {
		if math.Abs(figs[f]-want[f]) >= 0.0001 {
			t.Errorf("%s: %s = %v — want %v", what, f, figs[f], want[f])
		}
	}
}

// THE ACCEPTED PICTURE, day by day (restockPrototype.stories.tsx OCTOBER_DAYS): every worked step on its own day — a
// day not named, and a field not named, is 0.
var octDays = map[int]octFigs{
	1:  {"ordered_count": 5, "ordered_value": 615_000},
	2:  {"ordered_count": 6, "ordered_value": 1_092_000},
	5:  {"lost_count": 5, "lost_value": 615_000},
	6:  {"ordered_count": 30, "ordered_value": 2_130_000},
	7:  {"ordered_count": 10, "ordered_value": 460_000},
	8:  {"ordered_count": 10, "ordered_value": 450_000},
	9:  {"ordered_count": 2, "ordered_value": 190_000},
	10: {"accepted_count": 37, "accepted_value": 2_386_250, "broken_count": 1, "missing_count": 2, "cod_amount": 20_000},
	11: {"ordered_count": -10, "ordered_value": -460_000},
	12: {"ordered_count": 10, "ordered_value": 1_820_000, "accepted_count": 8, "accepted_value": 1_282_000},
	13: {},
	14: {"ordered_count": 4, "ordered_value": 400_000},
	15: {"ordered_count": 100, "ordered_value": 695_000},
	16: {"ordered_value": 15_000, "accepted_count": 10, "accepted_value": 1_820_000},
	17: {"lost_count": 4, "lost_value": 400_000},
	18: {"lost_count": -5, "lost_value": -615_000},
	19: {"accepted_count": 5, "accepted_value": 620_000, "cod_amount": 5_000},
	20: {"accepted_count": 97, "accepted_value": 697_650, "missing_count": 3, "cod_amount": 10_000},
}

var octTotals = octFigs{
	"ordered_count": 167, "ordered_value": 7_407_000, "lost_count": 4, "lost_value": 400_000,
	"accepted_count": 157, "accepted_value": 6_805_900, "broken_count": 1, "missing_count": 5, "cod_amount": 35_000,
}

var (
	octSellerCtx = asRole(1, role_basev1.Role_ROLE_SELLING_OWNER)
	octPusatCtx  = asRole(7, role_basev1.Role_ROLE_WAREHOUSE_STAFF)
	octRootCtx   = asRole(1, role_basev1.Role_ROLE_ROOT)
)

func octAllDays() []string {
	days := make([]string, 0, 20)
	for d := 1; d <= 20; d++ {
		days = append(days, octDay(d))
	}

	return days
}

// Every worked day reads the accepted picture, for the seller and for root, and the window's headline is the sum.
func TestRestockBeforeAccept_EveryStepOnItsOwnDay(t *testing.T) {
	b := octAll(t)

	for _, reader := range []struct {
		name string
		ctx  context.Context
		team uint64
	}{
		{"Toko Melati", octSellerCtx, octSeller},
		{"root", octRootCtx, 1},
	} {
		byDay := mustRead(t, b.svc, reader.ctx, reader.team, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
			dayKeys(octAllDays()...), octWindow()).GetRestockByDay().GetItems()

		for d := 1; d <= 20; d++ {
			wantFigs(t, reader.name+" "+octDay(d), byDay[octDay(d)], octDays[d])
		}

		wantFigs(t, reader.name+"'s headline", mustRead(t, b.svc, reader.ctx, reader.team, restockMetricID,
			analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, octWindow()).GetRestockSummary(), octTotals)
	}
}

// A CANCEL takes the ordered back on the cancel day (a-cancelled-restock-takes-its-ordered-back-on-its-day): R5 alone —
// +10 / +Rp 460.000 on the 7th, −10 / −Rp 460.000 on the 11th, nothing on the days between; the window reads 0.
func TestRestockBeforeAccept_ACancelTakesItsOrderedBackOnItsDay(t *testing.T) {
	b := newOctBook(t)
	b.r5(t)

	byDay := mustRead(t, b.svc, octSellerCtx, octSeller, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		dayKeys(octDay(7), octDay(9), octDay(11)), octWindow()).GetRestockByDay().GetItems()
	wantFigs(t, "the create day", byDay[octDay(7)], octFigs{"ordered_count": 10, "ordered_value": 460_000})
	wantFigs(t, "a day between", byDay[octDay(9)], octFigs{})
	wantFigs(t, "the cancel day", byDay[octDay(11)], octFigs{"ordered_count": -10, "ordered_value": -460_000})

	wantFigs(t, "the window", mustRead(t, b.svc, octSellerCtx, octSeller, restockMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, octWindow()).GetRestockSummary(), octFigs{})
}

// A LOST BOX THAT TURNS UP takes its lost back on the day it is signed for
// (a-lost-box-that-turns-up-takes-its-lost-back-on-its-day), and the accept counts as usual on its own day: R6. An
// ordinary sign (R7 on the 7th) counts nothing.
func TestRestockBeforeAccept_ALostBoxThatTurnsUpTakesItsLostBack(t *testing.T) {
	b := newOctBook(t)
	b.r6(t)
	b.r7(t)

	byDay := mustRead(t, b.svc, octSellerCtx, octSeller, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		dayKeys(octDay(5), octDay(7), octDay(18), octDay(19)), octWindow()).GetRestockByDay().GetItems()
	wantFigs(t, "the lost day", byDay[octDay(5)], octFigs{"lost_count": 5, "lost_value": 615_000})
	wantFigs(t, "an ordinary sign", byDay[octDay(7)], octFigs{})
	wantFigs(t, "the day it turned up", byDay[octDay(18)], octFigs{"lost_count": -5, "lost_value": -615_000})
	wantFigs(t, "the accept", byDay[octDay(19)], octFigs{"accepted_count": 5, "accepted_value": 620_000, "cod_amount": 5_000})

	summary := mustRead(t, b.svc, octSellerCtx, octSeller, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY,
		nil, octWindow()).GetRestockSummary()
	if summary.GetLostCount() != 0 || math.Abs(summary.GetLostValue()) >= 0.0001 {
		t.Fatalf("lost over the window = %d / Rp %v — want 0: nothing is still lost", summary.GetLostCount(), summary.GetLostValue())
	}
}

// AN EDIT BY PRODUCT (screenshot 07): R1's Kaos 20 → 30 on the 8th — Kaos +10 / +Rp 452.500, and the unchanged ongkir
// spread over 40 units instead of 30 moves Rp 2.500 off Kemeja; the restock's difference is +Rp 450.000. A product the
// edit only re-spread still ranks (its value moved).
func TestRestockBeforeAccept_AnEditsDifferenceByProduct(t *testing.T) {
	b := newOctBook(t)
	b.r1(t)

	day := windowOf(octDay(8), octDay(8))

	byProduct := mustRead(t, b.svc, octSellerCtx, octSeller, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT,
		ids(octKaos.id, octKemeja.id), day).GetRestockById().GetItems()
	wantFigs(t, "Kaos on the edit day", byProduct[octKaos.id], octFigs{"ordered_count": 10, "ordered_value": 452_500})
	wantFigs(t, "Kemeja on the edit day", byProduct[octKemeja.id], octFigs{"ordered_value": -2_500})

	wantFigs(t, "the edit day's headline", mustRead(t, b.svc, octSellerCtx, octSeller, restockMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, day).GetRestockSummary(),
		octFigs{"ordered_count": 10, "ordered_value": 450_000})

	ranked, err := searchMetric(b.svc, octSellerCtx, octSeller, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT,
		"ordered_value", analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10, day)
	if err != nil {
		t.Fatalf("search the edit day: %v", err)
	}

	if got := ranked.GetKeys().GetIds().GetIds(); len(got) != 2 || got[0] != octKaos.id || got[1] != octKemeja.id {
		t.Fatalf("the edit day by value = %v — want Kaos then Kemeja", got)
	}

	// An edit that changes nothing adds nothing: the day's door rows are not even touched (one test transaction, so a
	// row's ctid is what moves on any UPDATE).
	still := b.create(t, 9, octPusat, 10_000, octLine{octKaos, 3}, octLine{octKemeja, 7})
	before := doorRowsOn(t, b.db, octDay(9))
	b.edit(t, 9, still, octPusat, 10_000, octLine{octKaos, 3}, octLine{octKemeja, 7})

	if after := doorRowsOn(t, b.db, octDay(9)); after != before || before == "" {
		t.Fatalf("an edit that changed nothing moved the day's door rows: %q → %q", before, after)
	}
}

// A WAREHOUSE CHANGE (screenshot 04, checklist row 59): on the edit day R2 leaves Gudang Cabang (−10 / −Rp 1.820.000)
// and reaches Gudang Pusat (+10 / +Rp 1.820.000); the day nets 0. Cabang reads it arrive on the 12th and leave on the
// 13th, Pusat from the 13th — each in units only.
func TestRestockBeforeAccept_AWarehouseChangeMovesItOnTheEditDay(t *testing.T) {
	b := newOctBook(t)
	b.r2(t)

	moveDay := windowOf(octDay(13), octDay(13))

	byWarehouse := mustRead(t, b.svc, octSellerCtx, octSeller, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_WAREHOUSE,
		ids(octPusat, octCabang), moveDay).GetRestockById().GetItems()
	wantFigs(t, "Gudang Pusat on the move day", byWarehouse[octPusat], octFigs{"ordered_count": 10, "ordered_value": 1_820_000})
	wantFigs(t, "Gudang Cabang on the move day", byWarehouse[octCabang], octFigs{"ordered_count": -10, "ordered_value": -1_820_000})
	wantFigs(t, "the move day's headline", mustRead(t, b.svc, octSellerCtx, octSeller, restockMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, moveDay).GetRestockSummary(), octFigs{})

	cabang := asRole(8, role_basev1.Role_ROLE_WAREHOUSE_ADMIN)
	cabangDays := mustRead(t, b.svc, cabang, octCabang, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		dayKeys(octDay(12), octDay(13)), octWindow()).GetRestockByDay().GetItems()

	if got := cabangDays[octDay(12)]; got.GetOrderedCount() != 10 || got.OrderedValue != nil {
		t.Fatalf("Cabang on the 12th = %+v — want 10 ordered, no value", got)
	}

	if got := cabangDays[octDay(13)]; got.GetOrderedCount() != -10 || got.OrderedValue != nil {
		t.Fatalf("Cabang on the 13th = %+v — want −10 ordered, no value", got)
	}

	pusatDays := mustRead(t, b.svc, octPusatCtx, octPusat, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		dayKeys(octDay(12), octDay(13)), octWindow()).GetRestockByDay().GetItems()
	if pusatDays[octDay(12)].GetOrderedCount() != 0 || pusatDays[octDay(13)].GetOrderedCount() != 10 {
		t.Fatalf("Pusat = %d on the 12th, %d on the 13th — want 0 then 10", pusatDays[octDay(12)].GetOrderedCount(),
			pusatDays[octDay(13)].GetOrderedCount())
	}
}

// WHO READS (a-warehouse-sees-no-seller-money, the-warehouse-sees-the-cod-it-paid): the warehouse the restock goes to
// reads the units and the COD it paid — the DATA it receives carries no value, ordered, lost or accepted, in any group;
// it may not rank by one. Another seller and another warehouse read nothing.
func TestRestockBeforeAccept_AWarehouseReadsUnitsAndTheCODItPaid(t *testing.T) {
	b := octAll(t)

	groups := []struct {
		group analytic_basev1.GroupType
		keys  *analytic_basev1.MetricKeys
	}{
		{analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil},
		{analytic_basev1.GroupType_GROUP_TYPE_DAILY, dayKeys(octAllDays()...)},
		{analytic_basev1.GroupType_GROUP_TYPE_PRODUCT, ids(201, 202, 203, 204, 205, 206)},
		{analytic_basev1.GroupType_GROUP_TYPE_SUPPLIER, ids(31, 32, 33)},
		{analytic_basev1.GroupType_GROUP_TYPE_TEAM, ids(octSeller)},
		{analytic_basev1.GroupType_GROUP_TYPE_WAREHOUSE, ids(octPusat, octCabang)},
	}

	for _, g := range groups {
		data := mustRead(t, b.svc, octPusatCtx, octPusat, restockMetricID, g.group, g.keys, octWindow())

		for key, m := range restockAnswers(data) {
			_, set := figsOf(m)
			for field := range octValues {
				if set[field] {
					t.Fatalf("Gudang Pusat's %s %s carries %s — a warehouse is given no value", g.group, key, field)
				}
			}
		}
	}

	headline := mustRead(t, b.svc, octPusatCtx, octPusat, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY,
		nil, octWindow()).GetRestockSummary()
	if headline.GetOrderedCount() != 167 || headline.GetLostCount() != 4 || headline.GetAcceptedCount() != 157 ||
		headline.GetCodAmount() != 35_000 {
		t.Fatalf("Gudang Pusat's headline = %+v — want 167 ordered, 4 lost, 157 accepted, COD Rp 35.000", headline)
	}

	tenth := mustRead(t, b.svc, octPusatCtx, octPusat, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		dayKeys(octDay(10)), octWindow()).GetRestockByDay().GetItems()[octDay(10)]
	if tenth.GetCodAmount() != 20_000 {
		t.Fatalf("Gudang Pusat's COD on the 10th = %v — want Rp 20.000", tenth.GetCodAmount())
	}

	for _, field := range []string{"ordered_value", "lost_value", "accepted_value"} {
		_, err := searchMetric(b.svc, octPusatCtx, octPusat, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT,
			field, analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10, octWindow())
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("a warehouse ranking by %s: %v — want InvalidArgument", field, err)
		}
	}

	_, err := searchMetric(b.svc, octPusatCtx, octPusat, restockMetricID, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT,
		"cod_amount", analytic_basev1.SortType_SORT_TYPE_DESC, 0, 10, octWindow())
	if err != nil {
		t.Fatalf("a warehouse ranking by the COD it paid: %v", err)
	}

	for _, reader := range []struct {
		name string
		ctx  context.Context
		team uint64
	}{
		{"another seller", asRole(1, role_basev1.Role_ROLE_SELLING_OWNER), octStranger},
		{"another warehouse", asRole(1, role_basev1.Role_ROLE_WAREHOUSE_OWNER), 6},
	} {
		wantFigs(t, reader.name, mustRead(t, b.svc, reader.ctx, reader.team, restockMetricID,
			analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, octWindow()).GetRestockSummary(), octFigs{})
	}
}

// THE HEADLINE IS THE SUM OF ITS ROWS (the-headline-is-the-sum-of-its-rows): in every group the search's keys, read back,
// add up to the headline in every field — the shipping and the COD spread over the units leave nothing outside a row.
func TestRestockBeforeAccept_TheHeadlineIsTheSumOfItsRows(t *testing.T) {
	b := octAll(t)

	headline, _ := figsOf(mustRead(t, b.svc, octSellerCtx, octSeller, restockMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, octWindow()).GetRestockSummary())

	for _, group := range []analytic_basev1.GroupType{
		analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		analytic_basev1.GroupType_GROUP_TYPE_PRODUCT,
		analytic_basev1.GroupType_GROUP_TYPE_SUPPLIER,
		analytic_basev1.GroupType_GROUP_TYPE_TEAM,
		analytic_basev1.GroupType_GROUP_TYPE_WAREHOUSE,
	} {
		ranked, err := searchMetric(b.svc, octSellerCtx, octSeller, restockMetricID, group, "ordered_count",
			analytic_basev1.SortType_SORT_TYPE_DESC, 0, 100, octWindow())
		if err != nil {
			t.Fatalf("search %s: %v", group, err)
		}

		if ranked.GetHasNext() || ranked.GetKeys().GetK() == nil {
			t.Fatalf("%s: the search answered no single page of keys", group)
		}

		data := mustRead(t, b.svc, octSellerCtx, octSeller, restockMetricID, group, ranked.GetKeys(), octWindow())

		sum := octFigs{}
		rows := 0

		for _, m := range restockAnswers(data) {
			figs, _ := figsOf(m)
			for f, v := range figs {
				sum[f] += v
			}

			rows++
		}

		if rows == 0 {
			t.Fatalf("%s: no rows", group)
		}

		for _, f := range octFields {
			if math.Abs(sum[f]-headline[f]) >= 0.0001 {
				t.Errorf("%s: Σ rows %s = %v — the headline reads %v", group, f, sum[f], headline[f])
			}
		}

		if group == analytic_basev1.GroupType_GROUP_TYPE_SUPPLIER && rows != 3 {
			t.Errorf("suppliers: %d rows — want 31, 32 and 33", rows)
		}
	}

	wantFigs(t, "the headline", mustRead(t, b.svc, octSellerCtx, octSeller, restockMetricID,
		analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, octWindow()).GetRestockSummary(), octTotals)
}

// restockAnswers is one MetricData answer's Restock messages by key — the summary keyed "", a time or id group by its key.
func restockAnswers(data *inventoryv1.MetricData) map[string]*inventoryv1.InventoryRestockMetric {
	out := map[string]*inventoryv1.InventoryRestockMetric{}

	if s := data.GetRestockSummary(); s != nil {
		out[""] = s
	}

	for k, v := range data.GetRestockByDay().GetItems() {
		out[k] = v
	}

	for k, v := range data.GetRestockById().GetItems() {
		out[fmt.Sprint(k)] = v
	}

	return out
}

// doorRowsOn is a day's door rows as their physical places and figures — any write to one changes it.
func doorRowsOn(t *testing.T, db *gorm.DB, day string) string {
	t.Helper()

	var rows string

	err := db.Raw(`SELECT COALESCE(string_agg(format('%s:%s:%s', ctid, product_id, ordered_count), ',' ORDER BY product_id), '')
		FROM inventory_door_daily_reports WHERE day = CAST(? AS date)`, day).Scan(&rows).Error
	if err != nil {
		t.Fatalf("door rows on %s: %v", day, err)
	}

	return rows
}
