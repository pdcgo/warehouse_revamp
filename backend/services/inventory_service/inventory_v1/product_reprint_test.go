package inventory_v1_test

import (
	"context"
	"errors"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// CETAK ULANG KODE — inventory's half (backlog #151): the waits are product_service's, asked through the ProductReader
// (a fake here, answering as product_service would); the labels are this service's shelves. cmd/app_development drives
// the real seam end to end.

// reprintReader answers the reprint half of the ProductReader from fixed waits, and records what it is asked.
type reprintReader struct {
	fakeFacts
	waits    []inventory_v1.ReprintWait
	count    int64
	counted  *int
	arrivals *[]arrival
	record   func(tx *gorm.DB) (inventory_v1.ReprintRecorded, error)
}

type arrival struct {
	warehouse uint64
	products  []uint64
}

func (r reprintReader) ReprintWaits(_ context.Context, _ uint64, offset, limit int) (inventory_v1.ReprintWaitPage, error) {
	end := min(offset+limit, len(r.waits))
	if offset > end {
		offset = end
	}

	return inventory_v1.ReprintWaitPage{Waits: r.waits[offset:end], Total: int64(len(r.waits))}, nil
}

func (r reprintReader) ReprintWaitingCount(context.Context, uint64) (int64, error) {
	if r.counted != nil {
		*r.counted++
	}

	return r.count, nil
}

func (r reprintReader) RecordReprint(_ context.Context, tx *gorm.DB, _ uint64, _ []inventory_v1.ReprintPrinted) (inventory_v1.ReprintRecorded, error) {
	return r.record(tx)
}

func (r reprintReader) ReprintArrivals(_ context.Context, _ *gorm.DB, warehouse uint64, products []uint64) error {
	if r.arrivals != nil {
		*r.arrivals = append(*r.arrivals, arrival{warehouse, slices.Clone(products)})
	}

	return nil
}

// ONE LABEL PER SHELF SPOT OF THIS WAREHOUSE holding the product now — by spot code, its quantity; an emptied spot and
// another warehouse's shelf print nothing; a product waiting with nothing on a shelf here is listed with no label. The
// page is the reader's (by live code), its total the reader's count of waiting products.
func TestProductReprintList_OneLabelPerSpotOfThisWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	rakA2 := newRack(t, svc, wtA, "a-02")
	rakA1 := newRack(t, svc, wtA, "a-01")
	rakB := newRack(t, svc, wtB, "b-01")
	otRestock(t, svc, otMelati, wtKaosHitam, 7, 70000, []*inventoryv1.RestockPlacement{{PlacementId: rakA2, Quantity: 3}, {PlacementId: rakA1, Quantity: 4}})
	otRestock(t, svc, otMelati, wtKaosPolos, 1, 10000, []*inventoryv1.RestockPlacement{{PlacementId: rakA1, Quantity: 1}})

	// Another warehouse's shelf holding Kaos Hitam — never on this warehouse's labels.
	err := db.Exec(`INSERT INTO product_placements (team_id, warehouse_id, product_id, placement_id, stock_count, updated_at, created_at)
		VALUES (?, ?, ?, ?, 2, NOW(), NOW())`, otMelati, wtB, wtKaosHitam, rakB).Error
	if err != nil {
		t.Fatal(err)
	}

	// Kaos Polos's spot emptied: it still waits, with no label.
	err = db.Exec("UPDATE product_placements SET stock_count = 0 WHERE product_id = ?", wtKaosPolos).Error
	if err != nil {
		t.Fatal(err)
	}

	reader := reprintReader{fakeFacts: wtFacts(), waits: []inventory_v1.ReprintWait{
		{ProductID: wtKaosHitam, ProductCode: "XYZ-KH-001", Name: "Kaos Hitam", FormerCode: "ABC-KH-001"},
		{ProductID: wtKaosPolos, ProductCode: "XYZ-KP-001", Name: "Kaos Polos", FormerCode: "ABC-KP-001"},
	}}
	svc = inventory_v1.NewService(db, nil, nil, nil, nil, reader, nil, nil, nil, nil)

	res, err := svc.ProductReprintList(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.ProductReprintListRequest{
		WarehouseId: wtA, Page: &commonv1.CommonPagination{Page: 1, Limit: 10},
	}))
	if err != nil {
		t.Fatal(err)
	}

	items := res.Msg.GetItems()
	if len(items) != 2 || res.Msg.GetPageInfo().GetTotalItems() != 2 {
		t.Fatalf("items = %d (total %d), want 2", len(items), res.Msg.GetPageInfo().GetTotalItems())
	}

	hitam := items[0]
	if hitam.GetProductCode() != "XYZ-KH-001" || hitam.GetFormerCode() != "ABC-KH-001" || hitam.GetName() != "Kaos Hitam" {
		t.Errorf("first = %+v, want Kaos Hitam XYZ-KH-001 was ABC-KH-001", hitam)
	}

	var spots []string
	for _, l := range hitam.GetLabels() {
		spots = append(spots, l.GetPlacementCode())

		if (l.GetPlacementCode() == "a-01" && l.GetQuantity() != 4) || (l.GetPlacementCode() == "a-02" && l.GetQuantity() != 3) {
			t.Errorf("label %+v, want a-01 · 4 and a-02 · 3", l)
		}
	}

	if !slices.Equal(spots, []string{"a-01", "a-02"}) {
		t.Errorf("Kaos Hitam's labels = %v, want a-01, a-02 (this warehouse only, by spot code)", spots)
	}

	if len(items[1].GetLabels()) != 0 {
		t.Errorf("Kaos Polos's labels = %v, want none (its spot is empty)", items[1].GetLabels())
	}
}

// THE ENTRY'S (N) RIDES ON THE STOCK LIST only when asked (the warehouse's own Products list): without the slice the
// count is 0 and product_service is never asked; with it, the count is the reader's whatever the list's filter.
func TestWarehouseStockList_CountsTheReprintOnlyWhenAsked(t *testing.T) {
	db := san_testdb.DB(t)
	seed := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	otRestock(t, seed, otMelati, wtKaosHitam, 1, 10000, []*inventoryv1.RestockPlacement{{PlacementId: newRack(t, seed, wtA, "a-01"), Quantity: 1}})

	counted := 0
	reader := reprintReader{fakeFacts: wtFacts(), count: 7, counted: &counted}
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, wslCatalogueReader{reader}, nil, nil, nil, nil)

	list := func(types ...inventoryv1.WarehouseStockListDataType) uint32 {
		res, err := svc.WarehouseStockList(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.WarehouseStockListRequest{
			WarehouseId: wtA, DataRequest: types, Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
		}))
		if err != nil {
			t.Fatal(err)
		}

		return res.Msg.GetReprintWaiting()
	}

	// The root/admin Inventory's read: the row slices only.
	if n := list(inventoryv1.WarehouseStockListDataType_WAREHOUSE_STOCK_LIST_DATA_TYPE_PRODUCT,
		inventoryv1.WarehouseStockListDataType_WAREHOUSE_STOCK_LIST_DATA_TYPE_STOCK); n != 0 || counted != 0 {
		t.Errorf("unasked: count %d, asked product_service %d times — want 0, never", n, counted)
	}

	if n := list(inventoryv1.WarehouseStockListDataType_WAREHOUSE_STOCK_LIST_DATA_TYPE_PRODUCT,
		inventoryv1.WarehouseStockListDataType_WAREHOUSE_STOCK_LIST_DATA_TYPE_REPRINT_WAITING); n != 7 || counted != 1 {
		t.Errorf("asked: count %d after %d reads, want 7 after 1", n, counted)
	}
}

// wslCatalogueReader is the reprint reader with a search answering every held product — the stock list needs one.
type wslCatalogueReader struct {
	reprintReader
}

func (r wslCatalogueReader) Search(_ context.Context, _ uint64, search inventory_v1.ProductSearch) (inventory_v1.ProductSearchPage, error) {
	page := inventory_v1.ProductSearchPage{Total: int64(len(search.ProductIDs))}
	for _, id := range search.ProductIDs {
		page.Products = append(page.Products, inventory_v1.ProductMatch{ID: id, TeamID: otMelati, ProductCode: "C", Name: "N"})
	}

	return page, nil
}

// THE RECORD IS ONE TRANSACTION ACROSS THE SEAM: product_service writes on the transaction the handler opened, so its
// failure takes back everything written on it; its answer comes back as sent.
func TestProductReprintRecord_HandsItsTransactionAcross(t *testing.T) {
	db := san_testdb.DB(t)

	failing := reprintReader{record: func(tx *gorm.DB) (inventory_v1.ReprintRecorded, error) {
		err := tx.Exec("INSERT INTO placements (warehouse_id, code, name) VALUES (?, 'reprint-tx', 'x')", wtA).Error
		if err != nil {
			return inventory_v1.ReprintRecorded{}, err
		}

		return inventory_v1.ReprintRecorded{}, errors.New("product_service failed")
	}}

	svc := inventory_v1.NewService(db, nil, nil, nil, nil, failing, nil, nil, nil, nil)

	_, err := svc.ProductReprintRecord(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.ProductReprintRecordRequest{
		WarehouseId: wtA, Items: []*inventoryv1.ProductReprintPrinted{{ProductId: 1, ProductCode: "X"}},
	}))
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("err = %v, want Internal", err)
	}

	var left int64

	db.Raw("SELECT COUNT(*) FROM placements WHERE code = 'reprint-tx'").Scan(&left)

	if left != 0 {
		t.Errorf("the failed record left %d rows written on its transaction, want 0", left)
	}

	ok := reprintReader{record: func(*gorm.DB) (inventory_v1.ReprintRecorded, error) {
		return inventory_v1.ReprintRecorded{Cleared: []uint64{1}, CodeChanged: []uint64{2}, Untagged: []uint64{1}}, nil
	}}
	svc = inventory_v1.NewService(db, nil, nil, nil, nil, ok, nil, nil, nil, nil)

	res, err := svc.ProductReprintRecord(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.ProductReprintRecordRequest{
		WarehouseId: wtA, Items: []*inventoryv1.ProductReprintPrinted{{ProductId: 1, ProductCode: "X"}},
	}))
	if err != nil {
		t.Fatal(err)
	}

	if !slices.Equal(res.Msg.GetClearedIds(), []uint64{1}) || !slices.Equal(res.Msg.GetCodeChangedIds(), []uint64{2}) ||
		!slices.Equal(res.Msg.GetUntaggedIds(), []uint64{1}) {
		t.Errorf("answer = %+v, want the reader's", res.Msg)
	}

	// With no product service the record refuses — never an empty "nothing waited".
	bare := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, nil, nil)

	_, err = bare.ProductReprintRecord(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.ProductReprintRecordRequest{
		WarehouseId: wtA, Items: []*inventoryv1.ProductReprintPrinted{{ProductId: 1, ProductCode: "X"}},
	}))
	if connect.CodeOf(err) != connect.CodeUnavailable {
		t.Errorf("no product service: err = %v, want Unavailable", err)
	}
}

// ⚠6 — THE ACCEPT TELLS product_service which products it put on a shelf here, in its own transaction: a line whose
// every unit arrived broken put nothing on a shelf and is not named.
func TestWarehouseTransferAccept_NamesTheShelvedProductsForTheReprint(t *testing.T) {
	f := wtStocked(t)

	var arrivals []arrival
	f.svc = inventory_v1.NewService(f.db, nil, nil, nil, f.sent.send, reprintReader{fakeFacts: wtFacts(), arrivals: &arrivals}, nil, nil, nil, nil)

	tr := f.create(t, wtLine(wtKaosHitam, 2), wtLine(wtKaosPolos, 1))
	f.ship(t, tr.GetId())

	_, err := f.accept(tr.GetId(), 0, "",
		counted(itemOf(t, tr, wtKaosHitam), 2, 0, f.rakB1),
		counted(itemOf(t, tr, wtKaosPolos), 1, 1, f.rakB1),
	)
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	if len(arrivals) != 1 || arrivals[0].warehouse != wtB || !slices.Equal(arrivals[0].products, []uint64{wtKaosHitam}) {
		t.Errorf("arrivals = %+v, want B told of Kaos Hitam only (Kaos Polos arrived broken)", arrivals)
	}
}
