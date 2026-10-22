package inventory_v1_test

import (
	"strconv"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE WAREHOUSE TRANSFER'S FIXTURE: Melati moves its own goods from Gudang 5 (A) to Gudang 6 (B).
//
//	at A    Kaos Hitam — batch 1: 2 at Rp 10.000 on Rak A · batch 2: 5 at Rp 12.000, 1 on Rak A and 4 on Rak B
//	        Kaos Polos — 4 at Rp 5.000 on Rak B
//	        Kaos Merah — Sinar's, 5 at Rp 10.000 on Rak A
//	at B    Rak B1, Rak B2 — empty

const (
	wtA       = otWarehouse
	wtB       = uint64(6)
	wtOther   = uint64(99)
	wtAccount = uint64(77)

	wtKaosHitam = otKaosHitam
	wtKaosPolos = otKaosPolos
	wtKaosMerah = otKaosMerah

	wtStaffA = uint64(31)
	wtStaffB = uint64(41)
	wtSeller = uint64(8)
)

type wtFixture struct {
	svc  *inventory_v1.Service
	db   *gorm.DB
	sent *sentEvents

	rakA, rakB, rakB1, rakB2 uint64
}

func wtFacts() fakeFacts {
	return fakeFacts{
		wtKaosHitam: {TeamID: otMelati, SKU: "KH-001", Name: "Kaos Hitam"},
		wtKaosPolos: {TeamID: otMelati, SKU: "KP-001", Name: "Kaos Polos"},
		wtKaosMerah: {TeamID: otSinar, SKU: "KM-001", Name: "Kaos Merah"},
	}
}

func wtStocked(t *testing.T) *wtFixture {
	t.Helper()

	f := &wtFixture{sent: &sentEvents{}}
	f.db = san_testdb.DB(t)
	f.svc = inventory_v1.NewService(f.db, nil, nil, nil, f.sent.send, wtFacts())

	f.rakA = newRack(t, f.svc, wtA, "rak-a")
	f.rakB = newRack(t, f.svc, wtA, "rak-b")
	f.rakB1 = newRack(t, f.svc, wtB, "rak-b1")
	f.rakB2 = newRack(t, f.svc, wtB, "rak-b2")

	otRestock(t, f.svc, otMelati, wtKaosHitam, 2, 20000, []*inventoryv1.RestockPlacement{{PlacementId: f.rakA, Quantity: 2}})
	otRestock(t, f.svc, otMelati, wtKaosHitam, 5, 60000, []*inventoryv1.RestockPlacement{
		{PlacementId: f.rakA, Quantity: 1}, {PlacementId: f.rakB, Quantity: 4},
	})
	otRestock(t, f.svc, otMelati, wtKaosPolos, 4, 20000, []*inventoryv1.RestockPlacement{{PlacementId: f.rakB, Quantity: 4}})
	otRestock(t, f.svc, otSinar, wtKaosMerah, 5, 50000, []*inventoryv1.RestockPlacement{{PlacementId: f.rakA, Quantity: 5}})

	// Only what the transfer itself publishes is asserted on.
	f.sent.events = nil

	return f
}

func wtLine(product uint64, count int64) *inventoryv1.WarehouseTransferLine {
	return &inventoryv1.WarehouseTransferLine{ProductId: product, Count: count}
}

// create opens a transfer as Melati, A → B, with the lines given and no cost.
func (f *wtFixture) create(t *testing.T, lines ...*inventoryv1.WarehouseTransferLine) *inventoryv1.WarehouseTransfer {
	t.Helper()

	res, err := f.svc.WarehouseTransferCreate(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
		TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtB, Lines: lines, Note: "rebalance to Jakarta",
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	return res.Msg.GetTransfer()
}

func (f *wtFixture) process(t *testing.T, id uint64) {
	t.Helper()

	_, err := f.svc.WarehouseTransferProcess(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.WarehouseTransferProcessRequest{
		TeamId: wtA, TransferId: id,
	}))
	if err != nil {
		t.Fatalf("process: %v", err)
	}
}

func (f *wtFixture) ship(t *testing.T, id uint64) {
	t.Helper()

	f.process(t, id)

	_, err := f.svc.WarehouseTransferShip(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.WarehouseTransferShipRequest{
		TeamId: wtA, TransferId: id,
	}))
	if err != nil {
		t.Fatalf("ship: %v", err)
	}
}

func (f *wtFixture) accept(
	id uint64,
	charge float64,
	note string,
	lines ...*inventoryv1.WarehouseTransferCountedLine,
) (*inventoryv1.WarehouseTransfer, error) {
	res, err := f.svc.WarehouseTransferAccept(ctxUser(wtStaffB), connect.NewRequest(&inventoryv1.WarehouseTransferAcceptRequest{
		TeamId: wtB, TransferId: id, Lines: lines, WarehouseAdditionalCost: charge, WarehouseAdditionalCostNote: note,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetTransfer(), nil
}

// counted is one line of B's count, with every good unit on one rack.
func counted(item *inventoryv1.WarehouseTransferItem, arrived, broken int64, rack uint64) *inventoryv1.WarehouseTransferCountedLine {
	line := &inventoryv1.WarehouseTransferCountedLine{ItemId: item.GetId(), ArrivedCount: arrived, BrokenCount: broken}
	if good := arrived - broken; good > 0 {
		line.Placements = []*inventoryv1.WarehouseTransferPlacement{{PlacementId: rack, Quantity: good}}
	}

	return line
}

// itemOf finds a transfer's line by product.
func itemOf(t *testing.T, tr *inventoryv1.WarehouseTransfer, product uint64) *inventoryv1.WarehouseTransferItem {
	t.Helper()

	for _, item := range tr.GetItems() {
		if item.GetProductId() == product {
			return item
		}
	}

	t.Fatalf("transfer %d has no line for product %d", tr.GetId(), product)

	return nil
}

// transferEvents is what the transfer published — the fixture's restocks publish their own.
func (f *wtFixture) transferEvents() []*eventsv1.Event {
	var out []*eventsv1.Event

	for _, e := range f.sent.events {
		switch e.GetMessage().(type) {
		case *eventsv1.Event_WarehouseTransferCreated, *eventsv1.Event_WarehouseTransferUpdated,
			*eventsv1.Event_WarehouseTransferCancelled, *eventsv1.Event_WarehouseTransferAccepted:
			out = append(out, e)
		}
	}

	return out
}

// unitsAt is what a warehouse's batches and racks hold of a product.
func unitsAt(t *testing.T, db *gorm.DB, warehouse, product uint64) (batches, racks int64) {
	t.Helper()

	db.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM batches WHERE warehouse_id = ? AND product_id = ?`,
		warehouse, product).Scan(&batches)
	db.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM product_placements WHERE warehouse_id = ? AND product_id = ?`,
		warehouse, product).Scan(&racks)

	return batches, racks
}

func wantCode(t *testing.T, err error, code connect.Code, why string) {
	t.Helper()

	if connect.CodeOf(err) != code {
		t.Fatalf("%s: err = %v, want %s", why, err, code)
	}
}

func itoa(v uint64) string {
	return strconv.FormatUint(v, 10)
}
