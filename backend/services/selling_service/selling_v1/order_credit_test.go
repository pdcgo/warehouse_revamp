package selling_v1_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

func orderCount(t *testing.T, svc *selling_v1.Service) int {
	t.Helper()

	lst, err := svc.OrderList(context.Background(), connect.NewRequest(&sellingv1.OrderListRequest{
		TeamId: 2, Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	return len(lst.Msg.GetIds())
}

// #189 — THE GUARANTEE: a creditor over its limit means NO ORDER. This is what makes a balance
// operational rather than informative — without it, a limit is a number on a screen that nothing
// enforces.
func TestOrderCreate_CreditLimitBlocksTheOrder(t *testing.T) {
	db := san_testdb.DB(t)
	credit := &fakeCredit{
		block: &selling_v1.CreditBlock{CreditorTeamID: 900, Debt: 52_000_000, Limit: 50_000_000},
	}
	svc := newServiceWithCredit(t, db, credit)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err == nil {
		t.Fatal("an order was created despite the credit limit being reached")
	}

	// FAILED_PRECONDITION, not PERMISSION_DENIED: the caller may place orders — the state of the world
	// is what refuses. It is also not a retry: retrying changes nothing until somebody pays.
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want FailedPrecondition", connect.CodeOf(err))
	}

	// Read it back rather than trusting the error — nothing may survive a refused order.
	if n := orderCount(t, svc); n != 0 {
		t.Fatalf("%d orders survived a credit block, want 0", n)
	}
}

// THE MESSAGE MUST CARRY THE CREDITOR AND THE NUMBERS. The person hitting this is customer service,
// who never sees the Liability screens — "blocked" alone is a dead end for them and for whoever they
// escalate to.
func TestOrderCreate_CreditBlockNamesTheCreditorAndTheNumbers(t *testing.T) {
	db := san_testdb.DB(t)
	credit := &fakeCredit{
		block: &selling_v1.CreditBlock{CreditorTeamID: 900, Debt: 52_000_000, Limit: 50_000_000},
	}
	svc := newServiceWithCredit(t, db, credit)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err == nil {
		t.Fatal("no error")
	}

	msg := err.Error()
	for _, want := range []string{"900", "52000000", "50000000"} {
		if !strings.Contains(msg, want) {
			t.Fatalf("the block message %q does not name %q", msg, want)
		}
	}
}

// ⚠ EVERY CREDITOR IS CHECKED, not just the warehouse. An order draws on the fulfilling warehouse AND
// each team whose goods it sells — a check that only ever asked about the warehouse would pass every
// "is it blocked" test while letting a frozen product owner's stock ship forever.
func TestOrderCreate_ChecksTheWarehouseAndEveryProductOwner(t *testing.T) {
	db := san_testdb.DB(t)
	credit := &fakeCredit{}
	svc := newServiceWithCredit(t, db, credit)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if len(credit.asked) < 2 {
		t.Fatalf("checked %v — want the warehouse AND the product's owner", credit.asked)
	}

	if credit.asked[0] != testWarehouse {
		t.Fatalf("first creditor checked = %d, want the fulfilling warehouse %d",
			credit.asked[0], testWarehouse)
	}
}

// AN UNCONFIGURED LEDGER ALLOWS EVERYTHING. Day one of every pair in the system has no limit set, so
// a nil block must place the order exactly as before — this is the case that must not regress.
func TestOrderCreate_NoLimitPlacesTheOrder(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithCredit(t, db, &fakeCredit{})
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("an order with no credit limit configured was refused: %v", err)
	}

	if n := orderCount(t, svc); n != 1 {
		t.Fatalf("%d orders, want 1", n)
	}
}

// ⚠ THE CHECK RUNS BEFORE THE STOCK IS TAKEN. A blocked order must not have drawn stock it then has
// to give back — a compensating return is a real movement in the warehouse's ledger, and one caused
// by a refusal the system could have made first is noise nobody can explain.
func TestOrderCreate_CreditBlockTakesNoStock(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{}
	credit := &fakeCredit{
		block: &selling_v1.CreditBlock{CreditorTeamID: 900, Debt: 1, Limit: 0},
	}
	svc := selling_v1.NewService(db, picker, nil, &fakeCatalog{}, credit)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err == nil {
		t.Fatal("no error")
	}

	if len(picker.picked) != 0 {
		t.Fatalf("a credit-blocked order drew stock %d time(s), want 0", len(picker.picked))
	}
}

// A BROKEN LEDGER IS AN ERROR, NOT A FREE PASS. If the check itself fails we cannot say whether the
// team is over its limit, and quietly allowing the order would make an outage the way past every
// credit limit in the system.
func TestOrderCreate_CheckFailureRefusesTheOrder(t *testing.T) {
	db := san_testdb.DB(t)
	credit := &fakeCredit{err: errors.New("ledger unavailable")}
	svc := newServiceWithCredit(t, db, credit)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shop)))
	if err == nil {
		t.Fatal("the order was placed although the credit check could not be made")
	}

	if n := orderCount(t, svc); n != 0 {
		t.Fatalf("%d orders survived, want 0", n)
	}
}
