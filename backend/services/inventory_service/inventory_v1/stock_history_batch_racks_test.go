package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A BATCH'S HISTORY NAMES THE RACK EACH ROW MOVED ON (backlog #47) — it read 0 ("Unplaced") on every row. A batch row
// knows no rack (no log row carries both), so the rack is read from the RACK rows the same transaction wrote for the
// batch's product, on the same side (in or out). As the rack and product histories show it, a movement over several
// racks is one row per rack — each with that rack's units, the batch's count after it and its share of the value — when
// those rack rows are this batch's alone (they add up to the batch row). When several batches drew on several racks the
// split is unknown, so the row keeps its own units on the transaction's FIRST rack. A row that touched no rack (a price
// correction) stays 0. Otherwise the history is what it was: newest first, every id once.
func TestStockHistory_ABatchsRowsCarryTheirRack(t *testing.T) {
	svc, db, rakA, rakB := otStocked(t)

	// Kaos Polos — ONE batch of 5 at 20.000, put away 2 on Rak A and 3 on Rak B: two RECEIVE rows, newest first.
	polos := productBatches(t, db, otKaosPolos)[0]

	got := batchHistory(t, svc, otKaosPolos, polos.ID)
	wantRows(t, "the put-away", got,
		row{inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE, rakB, 3, 5, 60000},
		row{inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE, rakA, 2, 2, 40000},
	)

	// A take of 4 from that one batch, off both racks: one PICK row per rack, carrying that rack's units.
	_, err := takeAs(svc, otSinar, "key-47-polos", line(otKaosPolos, 4))
	if err != nil {
		t.Fatalf("take polos: %v", err)
	}

	racks := rackRowsOf(t, db, otKaosPolos, "order")
	if len(racks) != 2 {
		t.Fatalf("the take wrote %d rack rows, want 2 (off both racks)", len(racks))
	}

	got = batchHistory(t, svc, otKaosPolos, polos.ID)
	wantRows(t, "the take", got[:2],
		row{inventoryv1.MovementKind_MOVEMENT_KIND_PICK, racks[1].PlacementID, racks[1].StockChange, 1, float64(racks[1].StockChange) * 20000},
		row{inventoryv1.MovementKind_MOVEMENT_KIND_PICK, racks[0].PlacementID, racks[0].StockChange, 1 - racks[1].StockChange, float64(racks[0].StockChange) * 20000},
	)

	// A move carries units between racks and writes no batch row (a-move-writes-two-rack-rows-and-no-batch-row): the
	// batch's history is unchanged by it.
	_, err = svc.RackMove(ctxUser(8), connect.NewRequest(&inventoryv1.RackMoveRequest{
		TeamId: otWarehouse, FromRackId: rakA, Lines: []*inventoryv1.RackMoveLine{{ProductId: otKaosHitam, Quantity: 4, ToRackId: rakB}},
	}))
	if err != nil {
		t.Fatalf("move: %v", err)
	}

	// Kaos Hitam — 10 on Rak A, then a second delivery of 5 onto Rak B; a take of 12 draws on BOTH batches and BOTH racks.
	otRestock(t, svc, otMelati, otKaosHitam, 5, 75000, []*inventoryv1.RestockPlacement{{PlacementId: rakB, Quantity: 5}})

	hitam := productBatches(t, db, otKaosHitam)
	if len(hitam) != 2 {
		t.Fatalf("hitam batches = %d, want 2", len(hitam))
	}

	first, second := hitam[0], hitam[1]

	if rows := batchHistory(t, svc, otKaosHitam, first.ID); len(rows) != 1 || rows[0].GetRackId() != rakA {
		t.Fatalf("the first hitam batch after the move = %+v, want its one RECEIVE on Rak A — a move writes no batch row", rows)
	}

	wantRows(t, "the second delivery", batchHistory(t, svc, otKaosHitam, second.ID),
		row{inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE, rakB, 5, 5, 75000},
	)

	_, err = take(svc, "key-47-hitam", line(otKaosHitam, 12))
	if err != nil {
		t.Fatalf("take hitam: %v", err)
	}

	// Which rack fed which batch is not recorded, so each batch's take is ONE row — its own units — on the take's first
	// rack row for the product.
	hitamTake := rackRowsOf(t, db, otKaosHitam, "order")
	if len(hitamTake) < 2 {
		t.Fatalf("the hitam take wrote %d rack rows, want both racks", len(hitamTake))
	}

	firstRack := hitamTake[0].PlacementID

	olderRows := batchHistory(t, svc, otKaosHitam, first.ID)
	newerRows := batchHistory(t, svc, otKaosHitam, second.ID)

	if len(olderRows) != 2 || len(newerRows) != 2 {
		t.Fatalf("after the take: %d and %d rows, want the receive and ONE take row each", len(olderRows), len(newerRows))
	}

	wantRows(t, "the older batch's take", olderRows[:1],
		row{inventoryv1.MovementKind_MOVEMENT_KIND_PICK, firstRack, -10, 0, -100000},
	)
	wantRows(t, "the newer batch's take", newerRows[:1],
		row{inventoryv1.MovementKind_MOVEMENT_KIND_PICK, firstRack, -2, 3, -30000},
	)

	// A price correction moved no unit on any rack: no rack.
	_, err = svc.BatchRevalue(ctxAs(ovRoot, otMelati, rootOutsideRole), connect.NewRequest(revalueRequest(second.ID, 15000, 16000)))
	if err != nil {
		t.Fatalf("revalue: %v", err)
	}

	if c := batchHistory(t, svc, otKaosHitam, second.ID)[0]; c.GetKind() != inventoryv1.MovementKind_MOVEMENT_KIND_REVALUATION || c.GetRackId() != 0 {
		t.Fatalf("the correction row = %+v, want REVALUATION on no rack", c)
	}
}

// The parts of a row split over racks page and count as rows: a page of one walks them one at a time, the total counts
// each, and no id repeats.
func TestStockHistory_ABatchsRackRowsPage(t *testing.T) {
	svc, db, _, _ := otStocked(t)

	polos := productBatches(t, db, otKaosPolos)[0]

	seen := map[uint64]bool{}

	for p := uint32(1); p <= 3; p++ {
		res, err := svc.StockHistory(context.Background(), connect.NewRequest(&inventoryv1.StockHistoryRequest{
			WarehouseId: otWarehouse,
			Filter:      &inventoryv1.StockHistoryFilter{ProductId: otKaosPolos, BatchId: polos.ID},
			Page:        &commonv1.CommonPagination{Page: p, Limit: 1},
		}))
		if err != nil {
			t.Fatalf("page %d: %v", p, err)
		}

		if total := res.Msg.GetPageInfo().GetTotalItems(); total != 2 {
			t.Fatalf("total = %d, want the put-away's two rack rows", total)
		}

		for _, m := range stockHistoryRows(res.Msg) {
			if seen[m.GetId()] {
				t.Fatalf("id %d repeats across pages", m.GetId())
			}

			seen[m.GetId()] = true
		}
	}

	if len(seen) != 2 {
		t.Fatalf("paged %d rows, want 2", len(seen))
	}
}

type row struct {
	kind    inventoryv1.MovementKind
	rack    uint64
	delta   int64
	balance int64
	value   float64
}

func wantRows(t *testing.T, what string, got []*inventoryv1.StockMovement, want ...row) {
	t.Helper()

	if len(got) < len(want) {
		t.Fatalf("%s: %d rows, want %d", what, len(got), len(want))
	}

	seen := map[uint64]bool{}

	for i, w := range want {
		g := got[i]
		if g.GetKind() != w.kind || g.GetRackId() != w.rack || g.GetDelta() != w.delta || g.GetBalance() != w.balance ||
			!san_money.Equal(g.GetValueChange(), w.value) || seen[g.GetId()] {
			t.Fatalf("%s: row %d = kind %v rack %d delta %d balance %d value %v id %d — want %+v (rows %+v)",
				what, i, g.GetKind(), g.GetRackId(), g.GetDelta(), g.GetBalance(), g.GetValueChange(), g.GetId(), w, got)
		}

		seen[g.GetId()] = true
	}
}

func batchHistory(t *testing.T, svc *inventory_v1.Service, product, batch uint64) []*inventoryv1.StockMovement {
	t.Helper()

	res, err := svc.StockHistory(context.Background(), connect.NewRequest(&inventoryv1.StockHistoryRequest{
		WarehouseId: otWarehouse,
		Filter:      &inventoryv1.StockHistoryFilter{ProductId: product, BatchId: batch},
		Page:        page1(),
	}))
	if err != nil {
		t.Fatalf("StockHistory: %v", err)
	}

	if uint64(len(res.Msg.GetIds())) != res.Msg.GetPageInfo().GetTotalItems() {
		t.Fatalf("a page of %d ids for a total of %d", len(res.Msg.GetIds()), res.Msg.GetPageInfo().GetTotalItems())
	}

	return stockHistoryRows(res.Msg)
}

type rackRow struct {
	PlacementID uint64
	StockChange int64
}

// rackRowsOf is the product's rack rows of the newest transaction of a change type, oldest row first.
func rackRowsOf(t *testing.T, db *gorm.DB, product uint64, changeType string) []rackRow {
	t.Helper()

	var rows []rackRow

	err := db.Raw(`SELECT placement_id, stock_change FROM product_placement_logs
		WHERE product_id = ? AND change_type = ? AND transaction_id = (
		    SELECT MAX(transaction_id) FROM product_placement_logs WHERE product_id = ? AND change_type = ?)
		ORDER BY id`, product, changeType, product, changeType).
		Scan(&rows).
		Error
	if err != nil {
		t.Fatalf("rack rows: %v", err)
	}

	return rows
}

func takeAs(svc *inventory_v1.Service, team uint64, key string, lines ...*inventoryv1.OrderTransactionLine) (*inventoryv1.OrderTransactionCreateResponse, error) {
	res, err := svc.OrderTransactionCreate(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
		TeamId: team, IdempotencyKey: key, WarehouseId: otWarehouse, Lines: lines,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}
