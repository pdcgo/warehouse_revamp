package selling_v1_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// THE ORDER'S IDEMPOTENCY KEY (backlog #10, slice 1): required, stored, unique, and a used one refused
// (the-order-stores-its-idempotency-key, the-idempotency-key-is-unique, the-order-refuses-a-used-key,
// revamp-has-no-real-orders-yet). The race of two submits of one key is order_create_race_test (raceaudit).

// countingCatalog is fakeCatalog that counts the owner lookups — so a test can prove a refusal came before it.
type countingCatalog struct {
	fakeCatalog
	calls int
}

func (c *countingCatalog) Snapshots(
	ctx context.Context,
	teamID uint64,
	productIDs []uint64,
) (map[uint64]selling_v1.ProductSnapshot, error) {
	c.calls++

	return c.fakeCatalog.Snapshots(ctx, teamID, productIDs)
}

// keyedService is a service whose every downstream step records being reached: the owner lookup, the credit check and
// the take.
func keyedService(t *testing.T) (*selling_v1.Service, *gorm.DB, *fakePicker, *countingCatalog, *fakeCredit, uint64) {
	t.Helper()

	db := san_testdb.DB(t)
	picker := &fakePicker{}
	catalog := &countingCatalog{}
	credit := &fakeCredit{}
	svc := selling_v1.NewService(db, picker, nil, catalog, credit, everyoneMayWrite{}, nil, nil, nil, nil, nil)
	shop := insertShop(t, db, 2, "Toko Kunci", "TOKO-KUNCI", "shopee")

	return svc, db, picker, catalog, credit, shop
}

// THE KEY IS STORED on the order it created, and the order answers it back.
func TestOrderCreate_StoresItsKey(t *testing.T) {
	svc, db, _, _, _, shop := keyedService(t)

	req := orderReq(shop)

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if got := created.Msg.GetOrder().GetIdempotencyKey(); got != req.GetIdempotencyKey() {
		t.Fatalf("the order answers key %q, want %q", got, req.GetIdempotencyKey())
	}

	var stored selling_service_models.Order

	err = db.
		Where("id = ?", created.Msg.GetOrder().GetId()).
		Take(&stored).
		Error
	if err != nil {
		t.Fatalf("read the order back: %v", err)
	}

	if stored.IdempotencyKey != req.GetIdempotencyKey() {
		t.Fatalf("the stored order reads key %q, want %q", stored.IdempotencyKey, req.GetIdempotencyKey())
	}

	detail, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId:  2,
		OrderId: stored.ID,
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if got := detail.Msg.GetOrder().GetIdempotencyKey(); got != req.GetIdempotencyKey() {
		t.Fatalf("OrderDetail answers key %q, want %q", got, req.GetIdempotencyKey())
	}
}

// A USED KEY IS REFUSED BEFORE ANYTHING ELSE (the-order-refuses-a-used-key; ⚠ #10 Q9/Q10 defaults): AlreadyExists with
// inventory's KEY_USED detail, and never the order that holds it — the owner lookup, the credit check and the take are
// never reached, so nothing is taken and no second order exists.
func TestOrderCreate_AUsedKeyIsRefusedBeforeAnythingElse(t *testing.T) {
	svc, db, picker, catalog, credit, shop := keyedService(t)

	first := orderReq(shop)

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(first))
	if err != nil {
		t.Fatalf("first create: %v", err)
	}

	pickedBefore, lookupsBefore, ordersBefore := len(picker.picked), catalog.calls, countOrders(t, db)
	credit.asked = nil

	// Another order altogether — another customer — under the first one's key.
	again := orderReq(shop)
	again.IdempotencyKey = first.GetIdempotencyKey()
	again.CustomerName = "Sari"

	res, err := svc.OrderCreate(context.Background(), connect.NewRequest(again))
	if err == nil {
		t.Fatalf("a used key placed order %d, want it refused", res.Msg.GetOrder().GetId())
	}

	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("code = %v, want AlreadyExists: %v", connect.CodeOf(err), err)
	}

	refusal := refusalIn(t, err)
	if refusal.GetReason() != inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_KEY_USED {
		t.Fatalf("reason = %v, want KEY_USED", refusal.GetReason())
	}

	if len(refusal.GetLines()) != 0 {
		t.Fatalf("a used key names %d lines, want none", len(refusal.GetLines()))
	}

	if len(picker.picked) != pickedBefore {
		t.Fatalf("a refused key took stock: %v", picker.picked[pickedBefore:])
	}

	if catalog.calls != lookupsBefore {
		t.Fatalf("the owner lookup ran %d more times, want the key refused before it", catalog.calls-lookupsBefore)
	}

	if credit.asked != nil {
		t.Fatalf("the credit check was asked %v, want the key refused before it", credit.asked)
	}

	if n := countOrders(t, db); n != ordersBefore {
		t.Fatalf("%d orders exist, want only the first (%d)", n, ordersBefore)
	}
}

// AN EMPTY KEY AND A KEY IN THE RESERVED `order:` SHAPE ARE REFUSED (revamp-has-no-real-orders-yet) — InvalidArgument,
// before anything is looked up or taken. The reserved shape is the migration's fill of older developer rows.
func TestOrderCreate_AnEmptyOrReservedKeyIsRefused(t *testing.T) {
	for _, tc := range []struct {
		name string
		key  string
	}{
		{"empty", ""},
		{"reserved shape", "order:1"},
		{"reserved prefix alone", "order:"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc, db, picker, catalog, _, shop := keyedService(t)
			ordersBefore := countOrders(t, db)

			req := orderReq(shop)
			req.IdempotencyKey = tc.key

			_, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
			if connect.CodeOf(err) != connect.CodeInvalidArgument {
				t.Fatalf("code = %v, want InvalidArgument: %v", connect.CodeOf(err), err)
			}

			if len(picker.picked) != 0 || catalog.calls != 0 {
				t.Fatalf("a refused key reached the take (%d) or the owner lookup (%d)", len(picker.picked), catalog.calls)
			}

			if n := countOrders(t, db); n != ordersBefore {
				t.Fatalf("%d orders exist, want %d — none placed", n, ordersBefore)
			}
		})
	}
}

// A KEY THAT MERELY CONTAINS `order:` is a browser's own key and is accepted — only the prefix is reserved.
func TestOrderCreate_OnlyTheOrderPrefixIsReserved(t *testing.T) {
	svc, _, _, _, _, shop := keyedService(t)

	req := orderReq(shop)
	req.IdempotencyKey = "re-order:" + newOrderKey()

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
}

// A USED KEY IS REFUSED WHOEVER HOLDS IT — a row the migration filled as `order:<id>` can never be met by a new key,
// and an order of ANOTHER team under the key is refused the same, never disclosed.
func TestOrderCreate_AKeyHeldByAnotherTeamIsRefusedWithoutItsOrder(t *testing.T) {
	db := san_testdb.DB(t)
	svc := selling_v1.NewService(db, &fakePicker{}, nil, &fakeCatalog{}, &fakeCredit{}, everyoneMayWrite{}, nil, nil, nil, nil, nil)
	theirs := insertShop(t, db, 3, "Toko Lain", "TOKO-LAIN", "shopee")
	ours := insertShop(t, db, 2, "Toko Kami", "TOKO-KAMI", "shopee")

	theirReq := orderReq(theirs)
	theirReq.TeamId = 3

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(theirReq))
	if err != nil {
		t.Fatalf("their create: %v", err)
	}

	ourReq := orderReq(ours)
	ourReq.IdempotencyKey = theirReq.GetIdempotencyKey()

	res, err := svc.OrderCreate(context.Background(), connect.NewRequest(ourReq))
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("code = %v, want AlreadyExists: %v", connect.CodeOf(err), err)
	}

	if res != nil {
		t.Fatalf("a refused key answered order %d", res.Msg.GetOrder().GetId())
	}

	var connectErr *connect.Error
	if errors.As(err, &connectErr) && containsDigits(connectErr.Message()) {
		t.Fatalf("the refusal %q names a number — it must disclose no order", connectErr.Message())
	}
}

func containsDigits(s string) bool {
	for _, r := range s {
		if r >= '0' && r <= '9' {
			return true
		}
	}

	return false
}
