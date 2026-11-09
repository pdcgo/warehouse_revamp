package inventory_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// seedTwoBatches accepts a two-line delivery so there are batches to list, and returns the request.
func seedTwoBatches(t *testing.T, svc *inventory_v1.Service, warehouse uint64) *inventoryv1.RestockRequest {
	t.Helper()
	ctx := ctxUser(1)

	rack, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}
	rackID := rack.Msg.GetRack().GetId()

	// there-is-no-unplaced-pile: the hats that are not shelved yet go to the staging placement, an ordinary placement.
	staging, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{
		TeamId: warehouse, Code: stagingCode, Name: "Area Terima",
	}))
	if err != nil {
		t.Fatalf("staging placement: %v", err)
	}
	stagingID := staging.Msg.GetRack().GetId()

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: warehouse, ShipmentCost: 80000, Receipt: "GRN-0721",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, ProductCode: "KPH-001", Name: "Kaos", Count: 100, Total: 4000000},
			{ProductId: 200, ProductCode: "TTM-207", Name: "Topi", Count: 30, Total: 840000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	req := created.Msg.GetRequest()
	items := req.GetItems()

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: req.GetId(), WarehouseAdditionalCost: 50000, WarehouseAdditionalCostNote: courierNote,
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{
				ItemId:        items[0].GetId(),
				ReceivedCount: 100,
				Placements:    []*inventoryv1.RestockPlacement{{PlacementId: rackID, Quantity: 100}},
			},
			{
				// 30 in the box, 2 of them crushed — 28 go to the staging placement.
				ItemId:        items[1].GetId(),
				ReceivedCount: 30,
				BrokenCount:   2,
				BrokenNote:    "crushed",
				Placements:    []*inventoryv1.RestockPlacement{{PlacementId: stagingID, Quantity: 28}},
			},
		},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	return req
}

func TestBatchList_ReadsCostLayers(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const warehouse uint64 = 5

	req := seedTwoBatches(t, svc, warehouse)

	res, err := svc.BatchList(context.Background(), connect.NewRequest(&inventoryv1.BatchListRequest{
		TeamId: warehouse,
		Page:   page1(),
	}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}
	msg := res.Msg

	if len(batchRows(msg)) != 2 {
		t.Fatalf("%d batches, want 2", len(batchRows(msg)))
	}

	byProduct := map[uint64]*inventoryv1.StockBatch{}
	for _, b := range batchRows(msg) {
		byProduct[b.GetProductId()] = b
	}

	shirt := byProduct[100]
	hat := byProduct[200]
	if shirt == nil || hat == nil {
		t.Fatalf("missing a batch: %+v", byProduct)
	}

	// Identity + snapshots come off the delivery and the line.
	if shirt.GetDeliveryId() != req.GetId() || shirt.GetReceiptNo() != "GRN-0721" || shirt.GetProductCode() != "KPH-001" {
		t.Fatalf("shirt identity wrong: %+v", shirt)
	}

	// The landed price + the lifecycle numbers — freight 130.000 over the 130 units ORDERED = 1.000/pc
	// (all-qty-is-every-unit-ordered):
	//   shirt 4.000.000/100 + 1.000 = 41.000; arrived 100, broken 0, ready 100, used 0
	//   hat     840.000/30  + 1.000 = 29.000; arrived 30, broken 2, ready 28, used 0
	if !shirt.GetCostKnown() || shirt.GetUnitCost() != 41000 {
		t.Fatalf("shirt cost = %v known=%v, want 41000/true", shirt.GetUnitCost(), shirt.GetCostKnown())
	}
	if shirt.GetArrived() != 100 || shirt.GetBroken() != 0 || shirt.GetReady() != 100 || shirt.GetUsed() != 0 {
		t.Fatalf("shirt lifecycle = a%d b%d r%d u%d, want 100/0/100/0",
			shirt.GetArrived(), shirt.GetBroken(), shirt.GetReady(), shirt.GetUsed())
	}
	if hat.GetArrived() != 30 || hat.GetBroken() != 2 || hat.GetReady() != 28 {
		t.Fatalf("hat lifecycle = a%d b%d r%d, want 30/2/28", hat.GetArrived(), hat.GetBroken(), hat.GetReady())
	}

	// line_cost = arrived × cost; ready_value = ready × cost.
	if shirt.GetLineCost() != 4100000 || shirt.GetReadyValue() != 4100000 {
		t.Fatalf("shirt line=%v ready_value=%v, want 4100000/4100000", shirt.GetLineCost(), shirt.GetReadyValue())
	}
	if hat.GetLineCost() != 870000 || hat.GetReadyValue() != 812000 {
		t.Fatalf("hat line=%v ready_value=%v, want 870000/812000", hat.GetLineCost(), hat.GetReadyValue())
	}

	// Header tile: ready value over the whole set = 4.100.000 + 812.000.
	if msg.GetReadyValueTotal() != 4912000 {
		t.Fatalf("ready_value_total = %v, want 4912000", msg.GetReadyValueTotal())
	}

	// Filter to one product — the detail's Batches tab.
	only, err := svc.BatchList(context.Background(), connect.NewRequest(&inventoryv1.BatchListRequest{
		TeamId: warehouse, Filter: &inventoryv1.BatchListFilter{ProductId: 100}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("BatchList product filter: %v", err)
	}
	if len(batchRows(only.Msg)) != 1 || batchRows(only.Msg)[0].GetProductId() != 100 {
		t.Fatalf("product filter returned %d batches, want 1 for product 100", len(batchRows(only.Msg)))
	}

	// Search by the delivery/batch number (with the on-screen '#') finds the delivery's batches.
	found, err := svc.BatchList(context.Background(), connect.NewRequest(&inventoryv1.BatchListRequest{
		TeamId: warehouse, Filter: &inventoryv1.BatchListFilter{Search: "GRN-0721"}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("BatchList search: %v", err)
	}
	if len(batchRows(found.Msg)) != 2 {
		t.Fatalf("receipt search returned %d, want 2", len(batchRows(found.Msg)))
	}
}

// The date-range filter (#217) narrows on the arrived (accepted-at) or the expiry date. Here the two
// batches arrived just now, so a range ending yesterday finds none and one ending tomorrow finds both.
func TestBatchList_DateRange(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const warehouse uint64 = 5
	seedTwoBatches(t, svc, warehouse)

	now := time.Now()

	// Arrived on or before yesterday — nothing (they just arrived).
	past, err := svc.BatchList(context.Background(), connect.NewRequest(&inventoryv1.BatchListRequest{
		TeamId: warehouse,
		Filter: &inventoryv1.BatchListFilter{
			DateField: inventoryv1.BatchDateField_BATCH_DATE_FIELD_ARRIVED,
			ToUnix:    now.AddDate(0, 0, -1).Unix(),
		},
		Page: page1(),
	}))
	if err != nil {
		t.Fatalf("BatchList past: %v", err)
	}
	if len(batchRows(past.Msg)) != 0 {
		t.Fatalf("arrived ≤ yesterday returned %d, want 0", len(batchRows(past.Msg)))
	}

	// Arrived on or before tomorrow — both.
	upto, err := svc.BatchList(context.Background(), connect.NewRequest(&inventoryv1.BatchListRequest{
		TeamId: warehouse,
		Filter: &inventoryv1.BatchListFilter{
			DateField: inventoryv1.BatchDateField_BATCH_DATE_FIELD_ARRIVED,
			ToUnix:    now.AddDate(0, 0, 1).Unix(),
		},
		Page: page1(),
	}))
	if err != nil {
		t.Fatalf("BatchList upto: %v", err)
	}
	if len(batchRows(upto.Msg)) != 2 {
		t.Fatalf("arrived ≤ tomorrow returned %d, want 2", len(batchRows(upto.Msg)))
	}
}

// wibZone is the system's calendar (the-system-runs-on-jakarta-time), for writing an expiry as a Jakarta wall time.
var wibZone = time.FixedZone("WIB", 7*60*60)

// THE SOON WINDOW IS JAKARTA DAYS: today's Jakarta date + 30, whole — the same edge at 01:30 WIB (still yesterday on a
// UTC host) as at 23:59 WIB, and whatever zone `now` is written in. It moves at Jakarta midnight, not UTC midnight.
func TestBatchList_TheSoonWindowEndsWithTheThirtiethJakartaDay(t *testing.T) {
	want := time.Date(2026, 12, 6, 0, 0, 0, 0, wibZone) // 5 Nov + 31 days: the first instant past 5 Dec

	for name, now := range map[string]time.Time{
		"01:30 WIB, written as UTC (still 4 Nov in UTC)": time.Date(2026, 11, 4, 18, 30, 0, 0, time.UTC),
		"06:59 WIB":                 time.Date(2026, 11, 5, 6, 59, 0, 0, wibZone),
		"23:59 WIB, written as UTC": time.Date(2026, 11, 5, 16, 59, 0, 0, time.UTC),
		"the same instant in UTC−5": time.Date(2026, 11, 5, 11, 59, 0, 0, time.FixedZone("UTC-5", -5*60*60)),
	} {
		if got := inventory_v1.SoonCutoff(now); !got.Equal(want) {
			t.Fatalf("%s: cutoff %s, want %s", name, got.In(wibZone), want)
		}
	}

	// 00:00 WIB on 6 Nov is 17:00 UTC on 5 Nov — the window moves a day, at Jakarta midnight.
	if got := inventory_v1.SoonCutoff(time.Date(2026, 11, 5, 17, 0, 0, 0, time.UTC)); !got.Equal(want.AddDate(0, 0, 1)) {
		t.Fatalf("at 00:00 WIB 6 Nov: cutoff %s, want 7 Dec 00:00 WIB", got.In(wibZone))
	}
}

// The list's "expiring ≤ 30 days" filter and count take the WHOLE 30th Jakarta day — a batch expiring at 23:59 WIB on
// it is soon at any hour the list is opened — and nothing of the 31st.
func TestBatchList_ExpiringSoonCountsTheWholeThirtiethJakartaDay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const warehouse uint64 = 5
	seedTwoBatches(t, svc, warehouse)

	today := time.Now().In(wibZone)
	lastSoon := time.Date(today.Year(), today.Month(), today.Day()+30, 23, 59, 0, 0, wibZone)
	firstLater := time.Date(today.Year(), today.Month(), today.Day()+31, 0, 0, 0, 0, wibZone)

	err := db.Exec(`UPDATE batches SET expired_at = CASE WHEN product_id = 100 THEN CAST(? AS timestamptz) ELSE CAST(? AS timestamptz) END
		WHERE warehouse_id = ?`, lastSoon, firstLater, warehouse).Error
	if err != nil {
		t.Fatal(err)
	}

	res, err := svc.BatchList(context.Background(), connect.NewRequest(&inventoryv1.BatchListRequest{
		TeamId: warehouse,
		Filter: &inventoryv1.BatchListFilter{Expiry: inventoryv1.BatchExpiryFilter_BATCH_EXPIRY_FILTER_EXPIRING_SOON},
		Page:   page1(),
	}))
	if err != nil {
		t.Fatalf("BatchList expiring soon: %v", err)
	}

	rows := batchRows(res.Msg)
	if len(rows) != 1 || rows[0].GetProductId() != 100 || res.Msg.GetExpiringSoonCount() != 1 {
		t.Fatalf("expiring soon = %d rows (count %d), want the shirt alone — 23:59 WIB on day 30 is in, 00:00 on day 31 is not",
			len(rows), res.Msg.GetExpiringSoonCount())
	}

	// The header count over the unfiltered list says the same.
	all, err := svc.BatchList(context.Background(), connect.NewRequest(&inventoryv1.BatchListRequest{TeamId: warehouse, Page: page1()}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}

	if all.Msg.GetExpiringSoonCount() != 1 {
		t.Fatalf("expiring_soon_count = %d over both batches, want 1", all.Msg.GetExpiringSoonCount())
	}
}
