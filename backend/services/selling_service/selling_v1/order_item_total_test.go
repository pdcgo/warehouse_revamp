package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// EACH LINE FREEZES WHAT THE TAKE PRICED IT AT (inventory-computes-the-markup, a-lines-money-is-frozen-at-finalize) —
// stored on `order_items.total` exactly as returned, and carried on `OrderPlaced` as the figure liability posts the
// product fee from (the-ledger-charges-the-frozen-line-total). A fraction survives both hops: rupiah is floating point
// and nothing here rounds it.
func TestOrderCreate_FreezesTheTakesLineTotal(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	picker := &fakePicker{totals: map[uint64]float64{100: 39_600.5}}
	svc := selling_v1.NewService(db, picker, rec.send, &fakeCatalog{}, &fakeCredit{}, nil, nil, nil)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	var items []selling_service_models.OrderItem

	err = db.Where("order_id = ?", created.Msg.GetOrder().GetId()).Find(&items).Error
	if err != nil {
		t.Fatalf("read the lines: %v", err)
	}

	if len(items) != 1 || items[0].Total == nil || *items[0].Total != 39_600.5 {
		t.Fatalf("stored lines %+v, want one line frozen at the take's 39600.5", items)
	}

	lines := rec.placed(t).GetLines()
	if len(lines) != 1 || lines[0].GetTotal() != 39_600.5 {
		t.Fatalf("the event's lines %+v, want the stored total 39600.5", lines)
	}
}

// A PRODUCT THE TAKE NAMED NO TOTAL FOR FREEZES NONE — NULL on the line, never a 0 that reads as "free". The event
// carries 0, which liability posts nothing for (an unknown total), rather than a figure this service made up.
func TestOrderCreate_ALineTheTakeDidNotPriceFreezesNoTotal(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	picker := &fakePicker{}
	svc := selling_v1.NewService(db, picker, rec.send, &fakeCatalog{}, &fakeCredit{}, nil, nil, nil)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	var items []selling_service_models.OrderItem

	err = db.Where("order_id = ?", created.Msg.GetOrder().GetId()).Find(&items).Error
	if err != nil {
		t.Fatalf("read the lines: %v", err)
	}

	if len(items) != 1 || items[0].Total != nil {
		t.Fatalf("stored lines %+v, want one line with NO frozen total", items)
	}

	if got := rec.placed(t).GetLines()[0].GetTotal(); got != 0 {
		t.Fatalf("the event's line total = %v, want 0 (not known)", got)
	}
}
