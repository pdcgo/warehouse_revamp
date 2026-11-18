package selling_v1_test

import (
	"context"
	"maps"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// WHICH ORDER A RETURN'S BATCH CAME BACK FROM (a-returns-batch-opens-its-order) — selling's answer to inventory's batch
// screens, read off `orders.return_transaction_id`.
//
//	order A   returned, put back on the shelf in return transaction 9001
//	order B   returned, in 9002
//	order C   still out — no return transaction; its TAKE was transaction 9003
func TestOrderIDsByReturnTransactions_NamesEachReturnsOrder(t *testing.T) {
	db := san_testdb.DB(t)
	shop := insertShop(t, db, 9_100_001, "Toko Retur", "RTR", "shopee")

	returned := func(returnTx, takeTx uint64) uint64 {
		t.Helper()

		order := selling_service_models.Order{
			IdempotencyKey: newOrderKey(),
			TeamID:         9_100_001, ShopID: shop, WarehouseID: 9_100_002, Status: "return_completed",
			Address: &selling_service_models.OrderAddress{CustomerName: "Budi"},
		}
		if returnTx != 0 {
			order.ReturnTransactionID = &returnTx
		}

		if takeTx != 0 {
			order.TransactionID = &takeTx
		}

		err := db.Create(&order).Error
		if err != nil {
			t.Fatalf("insert order: %v", err)
		}

		return order.ID
	}

	a := returned(9001, 8001)
	b := returned(9002, 8002)
	returned(0, 9003)

	got, err := selling_v1.OrderIDsByReturnTransactions(context.Background(), db, []uint64{9001, 9002, 9003})
	if err != nil {
		t.Fatalf("OrderIDsByReturnTransactions: %v", err)
	}

	// 9003 names no order — absent, never 0 under its key.
	want := map[uint64]uint64{9001: a, 9002: b}
	if !maps.Equal(got, want) {
		t.Fatalf("orders by return transaction = %v, want %v", got, want)
	}

	// A take's transaction is no return's: order C is never found by its take.
	none, err := selling_v1.OrderIDsByReturnTransactions(context.Background(), db, []uint64{9003})
	if err != nil || len(none) != 0 {
		t.Fatalf("a transaction no order names = %v, %v — want none", none, err)
	}
}

// A page with no return's batch asks nothing: no transactions, no statement — it never touches the database (here none).
func TestOrderIDsByReturnTransactions_NothingAskedNoStatement(t *testing.T) {
	got, err := selling_v1.OrderIDsByReturnTransactions(context.Background(), nil, nil)
	if err != nil || got == nil || len(got) != 0 {
		t.Fatalf("nothing asked = %v, %v — want an empty answer, no statement", got, err)
	}
}
