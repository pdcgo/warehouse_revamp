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
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A RETURN'S BATCH NAMES ITS ORDER (a-returns-batch-opens-its-order) — *Retur · order #<id>*, resolved by the order side
// in ONE call per page.
//
//	Gudang 5   restock batches (rtStocked's four, emptied by the take, and one restocked after)
//	           return 1 — the first take's parcel back: four batches, ONE `return` transaction
//	           return 2 — a second take's one unit back: one batch, another transaction
//	           a transfer's batch and a count's batch, newest
type returnOrdersFixture struct {
	svc     *inventory_v1.Service
	orders  *recordingReturnOrders
	return1 uint64 // the `return` transactions
	return2 uint64
	restock uint64 // the restock batch raised after the returns
	other   []uint64
}

// recordingReturnOrders is selling_service for these tests: it answers an order for EVERY transaction it is asked about
// (70 000 + the transaction) and records each call — so a batch that is no return's would carry an order the moment the
// read asked about it.
type recordingReturnOrders struct {
	calls [][]uint64
	err   error
}

func (r *recordingReturnOrders) OrderIDsByReturnTransactions(_ context.Context, ids []uint64) (map[uint64]uint64, error) {
	asked := slices.Clone(ids)
	slices.Sort(asked)
	r.calls = append(r.calls, asked)

	if r.err != nil {
		return nil, r.err
	}

	out := make(map[uint64]uint64, len(ids))
	for _, id := range ids {
		out[id] = 70_000 + id
	}

	return out, nil
}

// FoundOrder and NoteFound complete the order seam: these tests read batches, and no found here names an order.
func (r *recordingReturnOrders) FoundOrder(context.Context, uint64) (inventory_v1.FoundOrder, bool, error) {
	return inventory_v1.FoundOrder{}, false, nil
}

func (r *recordingReturnOrders) NoteFound(context.Context, *gorm.DB, inventory_v1.FoundNote) error {
	return nil
}

func returnOrdersStocked(t *testing.T) *returnOrdersFixture {
	t.Helper()

	f := rtStocked(t)

	first, err := f.ret(rtShipWarehouse,
		rtLine(otKaosHitam, otKaosHitam, 0, 3, 0, 0, f.rakA),
		rtLine(otKaosPolos, rtOwnPolos, 0.2, 3, 0, 0, f.rakA))
	if err != nil {
		t.Fatalf("return 1: %v", err)
	}

	again, err := take(f.svc, "key-rt-2", line(otKaosHitam, 1))
	if err != nil {
		t.Fatalf("second take: %v", err)
	}

	f.take = again.GetTransactionId()

	second, err := f.ret(rtShipWarehouse, rtLine(otKaosHitam, otKaosHitam, 0, 1, 0, 0, f.rakA))
	if err != nil {
		t.Fatalf("return 2: %v", err)
	}

	otRestock(t, f.svc, otMelati, otKaosHitam, 2, 20000, []*inventoryv1.RestockPlacement{{PlacementId: f.rakA, Quantity: 2}})

	out := &returnOrdersFixture{orders: &recordingReturnOrders{}, return1: first.GetTransactionId(), return2: second.GetTransactionId()}

	err = f.db.Raw(`SELECT MAX(id) FROM batches WHERE warehouse_id = ?`, rtShipWarehouse).Scan(&out.restock).Error
	if err != nil {
		t.Fatalf("the restock's batch: %v", err)
	}

	// A transfer's batch and a count's — neither is a return's, so neither may ask for an order.
	for _, txType := range []string{"transfer_in", "adjustment"} {
		var batch uint64

		err = f.db.Raw(`WITH t AS (
				INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
				VALUES (?, ?, ?, 1, 'return-orders') RETURNING id, warehouse_id, team_id)
			INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
			                     init_stock_count, init_stock_valuation)
			SELECT warehouse_id, team_id, ?, id, 10000, 1, 10000, 1, 10000 FROM t
			RETURNING id`, rtShipWarehouse, otMelati, txType, otKaosHitam).Scan(&batch).Error
		if err != nil {
			t.Fatalf("a %s batch: %v", txType, err)
		}

		out.other = append(out.other, batch)
	}

	out.svc = inventory_v1.NewService(f.db, nil, nil, nil, nil, nil, nil, nil, out.orders, nil)

	return out
}

func (f *returnOrdersFixture) list(t *testing.T, page, limit uint32) []*inventoryv1.StockBatch {
	t.Helper()

	res, err := f.svc.BatchList(ctxAs(41, rtShipWarehouse, role_basev1.Role_ROLE_WAREHOUSE_STAFF), connect.NewRequest(
		&inventoryv1.BatchListRequest{TeamId: rtShipWarehouse, Page: &commonv1.CommonPagination{Page: page, Limit: limit}},
	))
	if err != nil {
		t.Fatalf("batch list page %d: %v", page, err)
	}

	return batchRows(res.Msg)
}

// Every batch a return minted carries its own return's order; a restock's still carries its restock and no order; a
// transfer's and a count's carry none — and the whole page asked the order side ONCE, for its two returns.
func TestBatchList_AReturnsBatchNamesItsOrder(t *testing.T) {
	f := returnOrdersStocked(t)

	rows := f.list(t, 1, 50)

	if len(f.orders.calls) != 1 {
		t.Fatalf("%d calls to the order side for one page — want exactly one: %v", len(f.orders.calls), f.orders.calls)
	}

	want := []uint64{f.return1, f.return2}
	slices.Sort(want)

	if !slices.Equal(f.orders.calls[0], want) {
		t.Fatalf("asked about %v — want the page's two return transactions %v, each once", f.orders.calls[0], want)
	}

	returns, restocks := 0, 0

	for _, b := range rows {
		switch {
		case b.GetOrigin() == inventoryv1.BatchOrigin_BATCH_ORIGIN_RETURN:
			returns++

			if b.GetReturnOrderId() != 70_000+f.return1 && b.GetReturnOrderId() != 70_000+f.return2 {
				t.Fatalf("return batch %d names order %d — want its return's order", b.GetId(), b.GetReturnOrderId())
			}

			if b.GetDeliveryId() != 0 {
				t.Fatalf("return batch %d carries restock %d", b.GetId(), b.GetDeliveryId())
			}
		case slices.Contains(f.other, b.GetId()):
			if b.GetReturnOrderId() != 0 || b.GetDeliveryId() != 0 {
				t.Fatalf("transfer/count batch %d = order %d, restock %d — want neither", b.GetId(), b.GetReturnOrderId(), b.GetDeliveryId())
			}
		default:
			restocks++

			if b.GetReturnOrderId() != 0 || b.GetDeliveryId() == 0 || b.GetOrigin() != inventoryv1.BatchOrigin_BATCH_ORIGIN_RESTOCK {
				t.Fatalf("restock batch %d = order %d, restock %d, origin %v — want its restock and no order",
					b.GetId(), b.GetReturnOrderId(), b.GetDeliveryId(), b.GetOrigin())
			}
		}
	}

	// return 1 drew two layers of each of two products — four batches; return 2 one.
	if returns != 5 || restocks != 5 {
		t.Fatalf("%d return batches and %d restock batches — want 5 and 5", returns, restocks)
	}

	firstReturn := 0

	for _, b := range rows {
		if b.GetReturnOrderId() == 70_000+f.return1 {
			firstReturn++
		}
	}

	if firstReturn != 4 {
		t.Fatalf("%d batches name return 1's order — want its four", firstReturn)
	}
}

// One call PER PAGE, and none for a page with no return's batch: the newest two (a count's, a transfer's) ask nothing;
// the next (the restock, return 2's batch) asks for return 2 alone.
func TestBatchList_ReturnOrdersAreOneCallPerPage(t *testing.T) {
	f := returnOrdersStocked(t)

	first := f.list(t, 1, 2)
	if len(f.orders.calls) != 0 {
		t.Fatalf("page 1 (%d, %d) asked the order side %v — it holds no return's batch", first[0].GetId(), first[1].GetId(), f.orders.calls)
	}

	second := f.list(t, 2, 2)
	if len(f.orders.calls) != 1 || !slices.Equal(f.orders.calls[0], []uint64{f.return2}) {
		t.Fatalf("page 2 asked %v — want one call for return 2 alone", f.orders.calls)
	}

	if second[0].GetId() != f.restock || second[0].GetReturnOrderId() != 0 || second[1].GetReturnOrderId() != 70_000+f.return2 {
		t.Fatalf("page 2 = %v — want the restock's batch (no order), then return 2's batch (its order)", second)
	}

	f.list(t, 3, 2)
	if len(f.orders.calls) != 2 || !slices.Equal(f.orders.calls[1], []uint64{f.return1}) {
		t.Fatalf("page 3 asked %v — want one more call, for return 1 alone", f.orders.calls)
	}
}

// A batch's page: a return's names its order — one call; a restock's names none and asks nothing.
func TestBatchDetail_AReturnsBatchNamesItsOrder(t *testing.T) {
	f := returnOrdersStocked(t)

	detail := func(batchID uint64) *inventoryv1.StockBatch {
		t.Helper()

		res, err := f.svc.BatchDetail(ctxAs(41, rtShipWarehouse, role_basev1.Role_ROLE_WAREHOUSE_STAFF), connect.NewRequest(
			&inventoryv1.BatchDetailRequest{TeamId: rtShipWarehouse, BatchId: batchID},
		))
		if err != nil {
			t.Fatalf("batch %d: %v", batchID, err)
		}

		return res.Msg.GetBatch()
	}

	restock := detail(f.restock)
	if restock.GetReturnOrderId() != 0 || restock.GetDeliveryId() == 0 || len(f.orders.calls) != 0 {
		t.Fatalf("the restock's batch = order %d, restock %d, %d calls — want its restock, no order, no call",
			restock.GetReturnOrderId(), restock.GetDeliveryId(), len(f.orders.calls))
	}

	var returned uint64

	for _, b := range f.list(t, 1, 50) {
		if b.GetReturnOrderId() == 70_000+f.return2 {
			returned = b.GetId()
		}
	}

	f.orders.calls = nil

	got := detail(returned)
	if got.GetReturnOrderId() != 70_000+f.return2 || len(f.orders.calls) != 1 || !slices.Equal(f.orders.calls[0], []uint64{f.return2}) {
		t.Fatalf("return 2's batch = order %d after %v — want its order in one call", got.GetReturnOrderId(), f.orders.calls)
	}
}

// The order is a label, never the read: when the order side cannot answer, the list still answers, a return's batch with
// no order — *Retur*, as before it existed.
func TestBatchList_ReturnOrdersDownStillLists(t *testing.T) {
	f := returnOrdersStocked(t)
	f.orders.err = errors.New("selling is down")

	rows := f.list(t, 1, 50)
	if len(rows) != 12 {
		t.Fatalf("%d rows — want all 12 batches", len(rows))
	}

	for _, b := range rows {
		if b.GetReturnOrderId() != 0 {
			t.Fatalf("batch %d names order %d with the order side down", b.GetId(), b.GetReturnOrderId())
		}
	}
}
