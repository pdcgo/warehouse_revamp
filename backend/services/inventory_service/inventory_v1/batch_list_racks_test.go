package inventory_v1_test

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE BATCH LIST'S ROWS NAME THEIR PRODUCT'S RACKS (the-expiry-report-is-the-batch-list, the-expiry-prototypes-are-
// accepted: the Rak column) — where the product sits in that warehouse now (`product_placements` with units on them), by
// code; a rack counts per product, never per batch, so two batches of one product name the same racks. A batch with
// nothing left names none (the screen's —).

// racksAccept accepts a one-line restock of the product at the warehouse, its units spread over the racks given.
func racksAccept(t *testing.T, svc *inventory_v1.Service, warehouse, product uint64, placements map[uint64]int64) {
	t.Helper()

	var count int64

	lines := []*inventoryv1.RestockPlacement{}
	for rack, n := range placements {
		count += n
		lines = append(lines, &inventoryv1.RestockPlacement{PlacementId: rack, Quantity: n})
	}

	created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: product, ProductCode: "SKU", Name: "Produk", Count: count, Total: float64(count) * 1000}},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	r := created.Msg.GetRequest()

	_, err = svc.RestockRequestAccept(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: r.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{ItemId: r.GetItems()[0].GetId(), ReceivedCount: count, Placements: lines}},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}
}

// racksByBatch is the list's rack codes per batch id.
func racksByBatch(t *testing.T, svc *inventory_v1.Service, warehouse uint64) map[uint64][]string {
	t.Helper()

	res, err := svc.BatchList(context.Background(), connect.NewRequest(&inventoryv1.BatchListRequest{TeamId: warehouse, Page: page1()}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}

	out := map[uint64][]string{}
	for _, b := range batchRows(res.Msg) {
		out[b.GetId()] = b.GetRackCodes()
	}

	return out
}

// batchIDsOf is the warehouse's batches of a product, oldest first.
func batchIDsOf(t *testing.T, svc *inventory_v1.Service, warehouse, product uint64) []uint64 {
	t.Helper()

	res, err := svc.BatchList(context.Background(), connect.NewRequest(&inventoryv1.BatchListRequest{
		TeamId: warehouse, Filter: &inventoryv1.BatchListFilter{ProductId: product}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}

	ids := []uint64{}
	for _, b := range batchRows(res.Msg) {
		ids = append([]uint64{b.GetId()}, ids...) // the list is newest first
	}

	return ids
}

// Kaos (100) sits on B-02 and A-01 over two batches; Topi (200) on C-05. Another warehouse's rack holding Kaos is not
// named. The older Kaos batch is emptied: it names no rack, though the product still sits on both. Then Topi leaves its
// rack while its batch still says units are left — a rack with nothing on it is not a place to look, so none is named.
func TestBatchList_RowsNameTheirProductsRacks(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const (
		warehouse uint64 = 5
		elsewhere uint64 = 6
		kaos      uint64 = 100
		topi      uint64 = 200
	)

	a01 := newRack(t, svc, warehouse, "A-01")
	b02 := newRack(t, svc, warehouse, "B-02")
	c05 := newRack(t, svc, warehouse, "C-05")
	z09 := newRack(t, svc, elsewhere, "Z-09")

	racksAccept(t, svc, warehouse, kaos, map[uint64]int64{b02: 3})
	racksAccept(t, svc, warehouse, kaos, map[uint64]int64{a01: 2, b02: 1})
	racksAccept(t, svc, warehouse, topi, map[uint64]int64{c05: 4})
	racksAccept(t, svc, elsewhere, kaos, map[uint64]int64{z09: 9})

	kaosBatches := batchIDsOf(t, svc, warehouse, kaos)
	topiBatch := batchIDsOf(t, svc, warehouse, topi)[0]

	racks := racksByBatch(t, svc, warehouse)

	// Both Kaos batches name BOTH racks, by code — the product's racks, not the rack each batch went to.
	for _, id := range kaosBatches {
		if !reflect.DeepEqual(racks[id], []string{"a-01", "b-02"}) {
			t.Fatalf("Kaos batch %d names %v, want [a-01 b-02] (the product's racks here, by code; z-09 is elsewhere)", id, racks[id])
		}
	}

	if !reflect.DeepEqual(racks[topiBatch], []string{"c-05"}) {
		t.Fatalf("Topi names %v, want [c-05]", racks[topiBatch])
	}

	// THE OLDER KAOS BATCH EMPTIED — nothing of it left to find, so no rack (the screen's —), while the newer still
	// names both.
	err := db.Exec(`UPDATE batches SET stock_count = 0, stock_valuation = 0 WHERE id = ?`, kaosBatches[0]).Error
	if err != nil {
		t.Fatal(err)
	}

	racks = racksByBatch(t, svc, warehouse)

	if len(racks[kaosBatches[0]]) != 0 {
		t.Fatalf("the emptied Kaos batch names %v, want none", racks[kaosBatches[0]])
	}

	if !reflect.DeepEqual(racks[kaosBatches[1]], []string{"a-01", "b-02"}) {
		t.Fatalf("the Kaos batch with units names %v, want [a-01 b-02]", racks[kaosBatches[1]])
	}

	// TOPI ON NO RACK — the rack rows at 0: a rack the product left is not named.
	err = db.Exec(`UPDATE product_placements SET stock_count = 0 WHERE warehouse_id = ? AND product_id = ?`, warehouse, topi).Error
	if err != nil {
		t.Fatal(err)
	}

	racks = racksByBatch(t, svc, warehouse)

	if len(racks[topiBatch]) != 0 {
		t.Fatalf("Topi, on no rack now, names %v, want none", racks[topiBatch])
	}

	// Another warehouse's list names its own rack only.
	other := racksByBatch(t, svc, elsewhere)
	for id, codes := range other {
		if !reflect.DeepEqual(codes, []string{"z-09"}) {
			t.Fatalf("warehouse %d's batch %d names %v, want [z-09]", elsewhere, id, codes)
		}
	}
}

// THE RACKS ARE ONE STATEMENT PER PAGE — never a read per row: a page of 1 batch and a page of 30 issue one
// product_placements read each, and a page whose batches are all emptied issues none.
func TestBatchList_TheRacksAreOneStatementPerPage(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	svc := newService(t, db)

	const warehouse uint64 = 5

	rack := newRack(t, svc, warehouse, "A-01")
	for product := uint64(1000); product < 1030; product++ {
		racksAccept(t, svc, warehouse, product, map[uint64]int64{rack: 2})
	}

	racksStatements := func(limit uint32) (int, int) {
		probe.Reset()

		res, err := svc.BatchList(context.Background(), connect.NewRequest(&inventoryv1.BatchListRequest{
			TeamId: warehouse, Page: &commonv1.CommonPagination{Page: 1, Limit: limit},
		}))
		if err != nil {
			t.Fatalf("BatchList: %v", err)
		}

		for _, b := range batchRows(res.Msg) {
			if !reflect.DeepEqual(b.GetRackCodes(), []string{"a-01"}) {
				t.Fatalf("batch %d names %v, want [a-01]", b.GetId(), b.GetRackCodes())
			}
		}

		n := 0
		for _, q := range probe.Queries() {
			if strings.Contains(q.SQL, "product_placements") {
				n++
			}
		}

		return n, probe.Count()
	}

	for _, limit := range []uint32{1, 30} {
		racks, all := racksStatements(limit)
		if racks != 1 || all != 4 {
			t.Fatalf("a page of %d: %d racks statements of %d — want 1 of 4 (count, page, strip, racks)", limit, racks, all)
		}
	}

	err := db.Exec(`UPDATE batches SET stock_count = 0, stock_valuation = 0 WHERE warehouse_id = ?`, warehouse).Error
	if err != nil {
		t.Fatal(err)
	}

	probe.Reset()

	_, err = svc.BatchList(context.Background(), connect.NewRequest(&inventoryv1.BatchListRequest{TeamId: warehouse, Page: page1()}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}

	if probe.Count() != 3 {
		t.Fatalf("a page of emptied batches issued %d statements, want 3 — no racks read", probe.Count())
	}
}
