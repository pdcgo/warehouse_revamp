package inventory_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// acceptLine accepts one line on rackID — `good` sellable units, plus `broken` in the box and `missing` short of it —
// and returns the minted batch's id.
//
// The line is ordered as all three together. The warehouse types what was IN THE BOX (good + broken) and how many of
// those are broken; the missing are worked out as count − received (a-short-unit-at-the-door-is-missing) — nobody
// types them.
func acceptLine(
	t *testing.T,
	svc *inventory_v1.Service,
	warehouse, rackID, product uint64,
	good, total, broken, missing int64,
) uint64 {
	t.Helper()
	ctx := ctxUser(1)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: warehouse, Receipt: "GRN-BK",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: product, ProductCode: "KPH-001", Name: "Kaos", Count: good + broken + missing, Total: float64(total)},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	item := created.Msg.GetRequest().GetItems()[0]

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: created.Msg.GetRequest().GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId:        item.GetId(),
			ReceivedCount: good + broken,
			BrokenCount:   broken,
			Placements:    []*inventoryv1.RestockPlacement{{PlacementId: rackID, Quantity: good}},
		}},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	list, err := svc.BatchList(ctx, connect.NewRequest(&inventoryv1.BatchListRequest{TeamId: warehouse, Filter: &inventoryv1.BatchListFilter{ProductId: product}, Page: page1()}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}
	if len(batchRows(list.Msg)) == 0 {
		t.Fatal("no batch minted")
	}
	return batchRows(list.Msg)[0].GetId()
}

// The damaged bucket splits into broken vs lost from the typed damage records (#227), the identity
// arrived = broken + lost + used + ready holds, and every batch reads as a restock origin (#230). The
// same split shows on the LIST projection as on the DETAIL.
func TestBatch_SplitsBrokenLost_AndOriginRestock(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const warehouse, product uint64 = 5, 100

	rack, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}

	// Received 10 sellable, plus 2 broken, and 3 missing from the box (the batch's "lost") → arrived 15.
	batchID := acceptLine(t, svc, warehouse, rack.Msg.GetRack().GetId(), product, 10, 1500000, 2, 3)

	assertLifecycle := func(what string, b *inventoryv1.StockBatch) {
		if b.GetArrived() != 15 || b.GetBroken() != 2 || b.GetLost() != 3 || b.GetReady() != 10 || b.GetUsed() != 0 {
			t.Fatalf("%s lifecycle = a%d b%d l%d r%d u%d, want 15/2/3/10/0",
				what, b.GetArrived(), b.GetBroken(), b.GetLost(), b.GetReady(), b.GetUsed())
		}
		if b.GetArrived() != b.GetBroken()+b.GetLost()+b.GetUsed()+b.GetReady() {
			t.Fatalf("%s identity broken: arrived %d != broken+lost+used+ready", what, b.GetArrived())
		}
		if b.GetOrigin() != inventoryv1.BatchOrigin_BATCH_ORIGIN_RESTOCK {
			t.Fatalf("%s origin = %v, want RESTOCK", what, b.GetOrigin())
		}
	}

	detail, err := svc.BatchDetail(context.Background(), connect.NewRequest(&inventoryv1.BatchDetailRequest{TeamId: warehouse, BatchId: batchID}))
	if err != nil {
		t.Fatalf("BatchDetail: %v", err)
	}
	assertLifecycle("detail", detail.Msg.GetBatch())

	list, err := svc.BatchList(context.Background(), connect.NewRequest(&inventoryv1.BatchListRequest{TeamId: warehouse, Filter: &inventoryv1.BatchListFilter{ProductId: product}, Page: page1()}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}
	assertLifecycle("list", batchRows(list.Msg)[0])
}

// Placements carry the last opname per shelf (#226): the last ADJUST (a stock-take) on that rack. A
// shelf never counted reads 0.
func TestBatchPlacement_LastOpname(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const warehouse, product uint64 = 5, 100

	rack, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}
	rackID := rack.Msg.GetRack().GetId()
	batchID := acceptLine(t, svc, warehouse, rackID, product, 10, 1000000, 0, 0)

	shelf := func() *inventoryv1.BatchShelf {
		res, pErr := svc.BatchPlacementList(context.Background(), connect.NewRequest(&inventoryv1.BatchPlacementListRequest{
			TeamId: warehouse, Filter: &inventoryv1.BatchPlacementListFilter{BatchId: batchID}, Page: page1(),
		}))
		if pErr != nil {
			t.Fatalf("BatchPlacementList: %v", pErr)
		}
		for _, s := range batchShelfRows(res.Msg) {
			if s.GetRackId() == rackID {
				return s
			}
		}
		t.Fatalf("rack %d not in placements", rackID)
		return nil
	}

	// Never counted yet.
	if got := shelf().GetLastOpnameUnix(); got != 0 {
		t.Fatalf("last opname before any count = %d, want 0", got)
	}

	// A stock-take on the rack that finds it exact still counts: the recount writes an `adjustment` rack row of 0.
	before := time.Now().Add(-time.Minute)

	_, err = svc.StockAdjust(ctxUser(1), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: warehouse, ProductId: product, OnHand: 10, Reason: "recount",
		Place: &inventoryv1.StockAdjustRequest_RackId{RackId: rackID},
	}))
	if err != nil {
		t.Fatalf("recount: %v", err)
	}

	if got := shelf().GetLastOpnameUnix(); got < before.Unix() {
		t.Fatalf("last opname = %d, want the recount just made", got)
	}
}

// BatchDetail totals the units that came BACK into the batch (#228): an order's take released, which reverses the
// take's own batch rows (a-rollback-reverses-its-log-rows).
func TestBatchDetail_ReturnAggregate(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const warehouse, product uint64 = 5, 100

	rack, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}
	batchID := acceptLine(t, svc, warehouse, rack.Msg.GetRack().GetId(), product, 10, 1000000, 0, 0)

	detail := func() *inventoryv1.BatchDetailResponse {
		res, dErr := svc.BatchDetail(context.Background(), connect.NewRequest(&inventoryv1.BatchDetailRequest{TeamId: warehouse, BatchId: batchID}))
		if dErr != nil {
			t.Fatalf("BatchDetail: %v", dErr)
		}
		return res.Msg
	}

	// Nothing returned yet.
	if d := detail(); d.GetReturnedQty() != 0 || d.GetLastReturnUnix() != 0 {
		t.Fatalf("before any return: qty=%d last=%d, want 0/0", d.GetReturnedQty(), d.GetLastReturnUnix())
	}

	before := time.Now().Add(-time.Minute)

	for key, qty := range map[string]int64{"key-1": 4, "key-2": 1} {
		takeForOrder(t, svc, 2, warehouse, product, qty, key)

		_, err = svc.OrderTransactionRelease(ctxUser(1), connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
			TeamId: 2, IdempotencyKey: key,
		}))
		if err != nil {
			t.Fatalf("release %s: %v", key, err)
		}
	}

	if d := detail(); d.GetReturnedQty() != 5 || d.GetLastReturnUnix() < before.Unix() {
		t.Fatalf("after two released takes: qty=%d last=%d, want 5 and the latest release", d.GetReturnedQty(), d.GetLastReturnUnix())
	}
}

// A CORRECTED BATCH'S FIGURES KEEP THE PRICE EACH LEFT AT (the-correct-price-prototype-is-accepted,
// a-late-cost-is-an-expense-not-a-revaluation: a correction reprices only the units left). 15 arrived at Rp 100.000 — 2
// broken and 3 missing at the door, 10 minted — and 4 handed out as a sample; then the owner corrects the 6 left to
// Rp 120.000, and again to Rp 110.000. Tiba stays the accepted Rp 1.500.000, Rusak and Hilang their door rows, Terpakai
// the Rp 400.000 its rows took out; only Siap and the unit price move, and the page says what the price was corrected
// from.
func TestBatchDetail_FiguresKeepThePriceTheyLeftAt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const warehouse, owner, product uint64 = 5, 2, 100

	rack, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}

	rackID := rack.Msg.GetRack().GetId()
	batchID := acceptLine(t, svc, warehouse, rackID, product, 10, 1500000, 2, 3)

	_, err = svc.RackSample(ctx, connect.NewRequest(&inventoryv1.RackSampleRequest{
		TeamId: warehouse, RackId: rackID, Recipient: "Budi",
		Lines: []*inventoryv1.RackSampleLine{{ProductId: product, Quantity: 4}},
	}))
	if err != nil {
		t.Fatalf("sample: %v", err)
	}

	detail := func() *inventoryv1.BatchDetailResponse {
		res, dErr := svc.BatchDetail(context.Background(), connect.NewRequest(&inventoryv1.BatchDetailRequest{TeamId: warehouse, BatchId: batchID}))
		if dErr != nil {
			t.Fatalf("BatchDetail: %v", dErr)
		}

		return res.Msg
	}

	type want struct {
		unit, line, broken, lost, used, ready float64
		corrected                             bool
		from                                  float64
	}

	check := func(what string, w want) {
		t.Helper()

		d := detail()
		b := d.GetBatch()

		got := want{
			b.GetUnitCost(), b.GetLineCost(), d.GetBrokenValue(), d.GetLostValue(), d.GetUsedValue(), b.GetReadyValue(),
			d.GetPriceCorrected(), d.GetPriceCorrectedFrom(),
		}

		for _, pair := range [][2]float64{
			{got.unit, w.unit}, {got.line, w.line}, {got.broken, w.broken}, {got.lost, w.lost}, {got.used, w.used},
			{got.ready, w.ready}, {got.from, w.from},
		} {
			if !san_money.Equal(pair[0], pair[1]) {
				t.Fatalf("%s: figures = %+v, want %+v", what, got, w)
			}
		}

		if got.corrected != w.corrected {
			t.Fatalf("%s: corrected = %v, want %v", what, got.corrected, w.corrected)
		}
	}

	check("before any correction", want{
		unit: 100000, line: 1500000, broken: 200000, lost: 300000, used: 400000, ready: 600000,
	})

	_, err = svc.BatchRevalue(ctxUser(8), connect.NewRequest(&inventoryv1.BatchRevalueRequest{
		TeamId: owner, BatchId: batchID, ExpectedPriceUnit: 100000, NewPriceUnit: 120000, Reason: "salah ketik",
	}))
	if err != nil {
		t.Fatalf("revalue: %v", err)
	}

	check("after the first correction", want{
		unit: 120000, line: 1500000, broken: 200000, lost: 300000, used: 400000, ready: 720000, corrected: true, from: 100000,
	})

	_, err = svc.BatchRevalue(ctxUser(8), connect.NewRequest(&inventoryv1.BatchRevalueRequest{
		TeamId: owner, BatchId: batchID, ExpectedPriceUnit: 120000, NewPriceUnit: 110000, Reason: "harga promo",
	}))
	if err != nil {
		t.Fatalf("second revalue: %v", err)
	}

	check("after the second", want{
		unit: 110000, line: 1500000, broken: 200000, lost: 300000, used: 400000, ready: 660000, corrected: true, from: 120000,
	})

	// The 6 left go — Terpakai now holds them at the price they left at, 110.000 each.
	_, err = svc.RackSample(ctx, connect.NewRequest(&inventoryv1.RackSampleRequest{
		TeamId: warehouse, RackId: rackID, Recipient: "Sari",
		Lines: []*inventoryv1.RackSampleLine{{ProductId: product, Quantity: 6}},
	}))
	if err != nil {
		t.Fatalf("second sample: %v", err)
	}

	check("emptied", want{
		unit: 110000, line: 1500000, broken: 200000, lost: 300000, used: 1060000, ready: 0, corrected: true, from: 120000,
	})
}
