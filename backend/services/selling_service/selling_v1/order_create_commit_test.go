package selling_v1_test

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// A COMMIT THAT REPORTS AN ERROR MAY HAVE LANDED (backlog #10c). The order is looked for by its key K, fresh, before
// anything is released: there → answered as placed, the take kept, no cancel published; not there → compensated as
// every failure is; the look itself failing → nothing released, Unavailable.

var errCommitLost = errors.New("connection reset while committing")

// THE COMMIT LANDED, ITS ANSWER WAS LOST: the order exists, so the person is answered with it, its stock stays taken,
// OrderPlaced is announced once, and no InventoryTxCancel is published.
func TestOrderCreate_ACommitThatLandedButReportedAnErrorIsAnsweredAsPlaced(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	picker := &fakePicker{txID: 6100}
	svc := compensationService(db, picker, rec, nil)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")
	req := orderReq(shop)

	selling_v1.SetOrderCommitResult(svc, func(err error) error {
		if err != nil {
			return err
		}

		return errCommitLost
	})

	res, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("create: %v — a commit that landed must be answered as placed", err)
	}

	got := res.Msg.GetOrder()
	if got.GetId() == 0 || got.GetIdempotencyKey() != req.GetIdempotencyKey() || len(got.GetItems()) == 0 {
		t.Fatalf("answered %+v, want the placed order under key %q with its lines", got, req.GetIdempotencyKey())
	}

	if n := countOrders(t, db); n != 1 {
		t.Fatalf("%d orders, want the 1 that committed", n)
	}

	if len(picker.returned) != 0 {
		t.Fatalf("released %v — the stock of an order that exists must stay taken", picker.returned)
	}

	if cancels := rec.txCancels(); len(cancels) != 0 {
		t.Fatalf("published %d InventoryTxCancel for an order that exists", len(cancels))
	}

	placed := rec.placed(t)
	if placed.GetOrderId() != got.GetId() || placed.GetTransactionId() != 6100 {
		t.Fatalf("OrderPlaced = %+v, want order %d with transaction 6100", placed, got.GetId())
	}
}

// THE COMMIT DID NOT LAND: the error came at the commit, and the re-read by K finds no order — so the take is released
// by K and InventoryTxCancel published, exactly as any other failure after the take.
func TestOrderCreate_ACommitThatDidNotLandIsCompensated(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	picker := &fakePicker{}
	svc := compensationService(db, picker, rec, nil)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")
	req := orderReq(shop)

	// The commit is lost: what the transaction wrote is gone, and the caller hears an error.
	selling_v1.SetOrderCommitResult(svc, func(err error) error {
		if err != nil {
			return err
		}

		ids := db.Model(&selling_service_models.Order{}).
			Select("id").
			Where("idempotency_key = ?", req.GetIdempotencyKey())

		lost := db.Where("order_id IN (?)", ids).Delete(&selling_service_models.OrderItem{}).Error
		if lost == nil {
			lost = db.Where("order_id IN (?)", ids).Delete(&selling_service_models.OrderTimelineLog{}).Error
		}

		if lost == nil {
			lost = db.Where("idempotency_key = ?", req.GetIdempotencyKey()).Delete(&selling_service_models.Order{}).Error
		}

		if lost != nil {
			t.Fatalf("simulate the lost commit: %v", lost)
		}

		return errCommitLost
	})

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if err == nil {
		t.Fatal("a commit that did not land was answered as placed")
	}

	assertCompensated(t, db, picker, rec, req.GetIdempotencyKey(), 2)
}

// NOT KNOWN EITHER WAY: the commit reported an error and the re-read failed too. Nothing is released — a release under
// an order that did commit is stock gone from a live order — and the person hears Unavailable, not "not placed".
func TestOrderCreate_AnUnknownCommitReleasesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	picker := &fakePicker{}
	svc := compensationService(db, picker, rec, nil)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")
	req := orderReq(shop)

	// The connection is broken: the test transaction is aborted, so every read after this fails.
	selling_v1.SetOrderCommitResult(svc, func(err error) error {
		if err != nil {
			return err
		}

		_ = db.Exec("SELECT 1/0").Error

		return errCommitLost
	})

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("err = %v, want Unavailable — the outcome is not known", err)
	}

	if len(picker.returned) != 0 || len(rec.txCancels()) != 0 {
		t.Fatalf("released %v and published %d cancels — an unknown outcome must release nothing", picker.returned,
			len(rec.txCancels()))
	}
}
