//go:build raceaudit

// Concurrency audit for a found naming a LOST order (a-found-lost-parcel-is-a-found-stock-in, the audit-sql skill): two
// approvals of one order's founds must never bring back more than its take drew, nor price one unit of a take layer
// twice. They queue on the take's row (inventory_mutations.PostOrderFoundApproval) and the second counts the first's
// units. Build-tagged: san_race COMMITS.
//
//	go test -tags raceaudit -p 1 -run "TestRace_FoundRequestOrder|TestInterleave_FoundRequestOrder" -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

const raceLostOrder uint64 = 7001

// raceOrderService is raceService with the order side answering one lost order of raceOwner shipped from raceWarehouse.
func raceOrderService(db *gorm.DB, orders *lostOrders) *inventory_v1.Service {
	return inventory_v1.NewService(db, nil, nil, nil, nil, fakeFacts{raceProductA: {TeamID: raceOwner}}, nil, nil, orders, nil)
}

// raceLostTake seeds the two batches of 10 — the second repriced to Rp 2.000 — and has order 7001 take 12: batch 1's 10
// at Rp 1.000 and 2 of batch 2's at Rp 2.000. The order is lost; the order side answers it.
func raceLostTake(t *testing.T, db *gorm.DB) *lostOrders {
	t.Helper()

	seedLedgers(t, db, 10, raceProductA)

	err := db.Exec(`UPDATE batches SET price_unit = 2000, stock_valuation = 20000, init_stock_valuation = 20000
		WHERE id = (SELECT MAX(id) FROM batches WHERE product_id = ?)`, raceProductA).Error
	if err != nil {
		t.Fatalf("reprice batch 2: %v", err)
	}

	orders := &lostOrders{orders: map[uint64]inventory_v1.FoundOrder{}}

	res, err := raceOrderService(db, orders).OrderTransactionCreate(context.Background(),
		connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
			TeamId: raceOwner, IdempotencyKey: "key-race-lost", WarehouseId: raceWarehouse,
			Lines: []*inventoryv1.OrderTransactionLine{{ProductId: raceProductA, Quantity: 12}},
		}))
	if err != nil {
		t.Fatalf("the order's take: %v", err)
	}

	orders.orders[raceLostOrder] = inventory_v1.FoundOrder{
		ID: raceLostOrder, TeamID: raceOwner, WarehouseID: raceWarehouse, Status: "lost", Lost: true,
		TakeTransactionID: res.Msg.GetTransactionId(),
	}

	return orders
}

// raceReportFrom reports n found naming the lost order, as `by`; 0 when refused.
func raceReportFrom(t *testing.T, svc *inventory_v1.Service, by, rack uint64, n int64) (uint64, error) {
	t.Helper()

	res, err := svc.FoundRequestCreate(raceStaff(by), connect.NewRequest(&inventoryv1.FoundRequestCreateRequest{
		TeamId: raceWarehouse, ProductId: raceProductA, RackId: rack, Quantity: n, OrderId: raceLostOrder,
	}))
	if err != nil {
		return 0, err
	}

	return res.Msg.GetFoundRequest().GetId(), nil
}

// foundMinted is what every `found` transaction minted of the product: units and value.
func foundMinted(t *testing.T, db *gorm.DB) (units int64, value float64) {
	t.Helper()

	db.Raw(`SELECT COALESCE(SUM(b.init_stock_count), 0) FROM batches b
		JOIN inventory_transactions x ON x.id = b.transaction_id
		WHERE x.tx_type = 'found' AND b.product_id = ?`, raceProductA).Scan(&units)
	db.Raw(`SELECT COALESCE(SUM(b.init_stock_valuation), 0) FROM batches b
		JOIN inventory_transactions x ON x.id = b.transaction_id
		WHERE x.tx_type = 'found' AND b.product_id = ?`, raceProductA).Scan(&value)

	return units, value
}

// THE SECOND APPROVAL WAITS ON THE TAKE, THEN COUNTS THE FIRST. Two founds of 6 name order 7001 (it took 12). A approves
// the first — 6 at batch 1's Rp 1.000 — and holds its transaction open; B's approval of the second BLOCKS on the take's
// row. Once A commits, B brings back the other 4 of batch 1 and batch 2's 2 at Rp 2.000: Rp 14.000 in all, exactly
// what the order took. Without the take's lock B still waits — on the rack row, AFTER it read the order's founds — and
// prices all 6 at Rp 1.000 (Rp 12.000): mutation-checked.
func TestInterleave_FoundRequestOrder_TheSecondApprovalWaitsOnTheTake(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	orders := raceLostTake(t, h.DB())
	svc := raceOrderService(h.DB(), orders)
	rack := raceRack(t, h.DB(), "rak-a")

	first, err := raceReportFrom(t, svc, 44, rack, 6)
	if err != nil {
		t.Fatalf("report the first: %v", err)
	}

	second, err := raceReportFrom(t, svc, 44, rack, 6)
	if err != nil {
		t.Fatalf("report the second: %v", err)
	}

	approveIn := func(by, id uint64) func(tx *gorm.DB) error {
		return func(tx *gorm.DB) error {
			_, approveErr := raceOrderService(tx, orders).FoundRequestApprove(raceAdmin(by),
				connect.NewRequest(&inventoryv1.FoundRequestApproveRequest{TeamId: raceWarehouse, FoundRequestId: id}))

			return approveErr
		}
	}

	sched := h.Interleave(t,
		san_race.Do("A", "the first approval posts", approveIn(60, first)),
		san_race.Block("B", "the second approval waits on the take", approveIn(61, second)),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	if r := sched.Get("the first approval posts"); r.Err != nil {
		t.Fatalf("the first approval: %v", r.Err)
	}

	if r := sched.Get("the second approval waits on the take"); !r.Blocked || r.Err != nil {
		t.Fatalf("the second approval did not wait for the first on the take: %+v", r)
	}

	units, value := foundMinted(t, h.DB())
	if units != 12 || !san_money.Equal(value, 14000) {
		t.Fatalf("the founds minted %d units worth %v, want 12 worth Rp 14.000 — what the order took", units, value)
	}

	if b, r := stockOf(t, h.DB(), raceProductA); b != 20 || r != 20 {
		t.Fatalf("batches %d, racks %d — want 20 each", b, r)
	}
}

// OVER-REPORTED AT THE SAME SECOND, CAPPED AT THE APPROVAL. Ten rounds: two staff report 8 found of order 7001 (it took
// 12) at the same second — the reports read plainly, so both may land. Two Admins then approve whatever landed at the
// same second: never more than the 12 taken come back, and what does is priced oldest layer first.
func TestRace_FoundRequestOrder_NeverBringsBackMoreThanTaken(t *testing.T) {
	h := san_race.New(t, ledgerTables...)

	both := 0

	for round := range 10 {
		wipeLedgers(t, h.DB())
		orders := raceLostTake(t, h.DB())
		svc := raceOrderService(h.DB(), orders)
		rack := raceRack(t, h.DB(), "rak-a")

		ids := make([]uint64, 2)

		reports := h.Race(t, 2, func(i int) error {
			id, err := raceReportFrom(t, svc, uint64(44+i), rack, 8)
			ids[i] = id

			if connect.CodeOf(err) == connect.CodeFailedPrecondition {
				return nil
			}

			return err
		})
		if reports.Failed() != 0 {
			reports.Report(t)
			t.Fatalf("round %d: a report failed beyond the expected refusal", round)
		}

		var landed []uint64

		for _, id := range ids {
			if id != 0 {
				landed = append(landed, id)
			}
		}

		if len(landed) == 2 {
			both++
		}

		var c codes

		approvals := h.Race(t, len(landed), func(i int) error {
			_, err := svc.FoundRequestApprove(raceAdmin(uint64(60+i)), connect.NewRequest(&inventoryv1.FoundRequestApproveRequest{
				TeamId: raceWarehouse, FoundRequestId: landed[i],
			}))
			c.add(err)

			if connect.CodeOf(err) == connect.CodeFailedPrecondition {
				return nil
			}

			return err
		})
		if approvals.Failed() != 0 || approvals.Count(san_race.Deadlock) != 0 {
			approvals.Report(t)
			t.Fatalf("round %d: an approval failed beyond the expected refusal", round)
		}

		if c.got[0] != 1 {
			t.Fatalf("round %d: %d approvals went through, want exactly 1 (8 + 8 is past the 12 taken)", round, c.got[0])
		}

		units, value := foundMinted(t, h.DB())
		if units != 8 || !san_money.Equal(value, 8000) {
			t.Fatalf("round %d: the founds minted %d units worth %v, want 8 at Rp 1.000", round, units, value)
		}

		if b, r := stockOf(t, h.DB(), raceProductA); b != 16 || r != 16 {
			t.Fatalf("round %d: batches %d, racks %d — want 16 each", round, b, r)
		}
	}

	t.Logf("both reports landed in %d of 10 rounds; the approval capped every one", both)
}
