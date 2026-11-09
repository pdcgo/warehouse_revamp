//go:build raceaudit

// Concurrency audit for OrderReturnAccept WITH ITS STOCK HALF (the audit-sql skill, return_decision.md): two of the
// return warehouse's crew scan the same returned parcel in the same second. It lives in the composition root because it
// is the one place selling's accept and inventory's OrderTransactionReturn meet a real database together, through the
// real adapter — the race is across the two.
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS.
//
//	go test -tags raceaudit -run "TestRace_OrderReturnAccept" -v ./backend/cmd/app_development/
package main

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
	warehouse_v1 "github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_v1"
)

// The order race's tables, the return's own, and what the accept reads.
var returnRaceTables = append([]string{"team_return_configurations", "warehouse_products"}, orderRaceTables...)

// ownCatalog is product_service for the race: every product is Melati's own, so no line is borrowed.
type ownCatalog struct{}

func (ownCatalog) Snapshots(_ context.Context, _ uint64, ids []uint64) (map[uint64]selling_v1.ProductSnapshot, error) {
	out := make(map[uint64]selling_v1.ProductSnapshot, len(ids))
	for _, id := range ids {
		out[id] = selling_v1.ProductSnapshot{TeamID: ocTeam, ProductCode: "KAOS", Name: "Kaos"}
	}

	return out, nil
}

// returnService is orderService with a catalogue — the accept reads whose each line is.
func returnService(db *gorm.DB) *selling_v1.Service {
	inventory := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil)

	return selling_v1.NewService(db, NewStockPicker(inventory), nil, ownCatalog{}, nil, runsEveryShop{}, nil,
		NewWarehouseFeePricer(warehouse_v1.NewService(db, nil)), nil, nil, nil)
}

// raceMoveTo moves the order as the team given — committed.
func raceMoveTo(t *testing.T, svc interface {
	OrderStatusChange(context.Context, *connect.Request[sellingv1.OrderStatusChangeRequest]) (*connect.Response[sellingv1.OrderStatusChangeResponse], error)
}, teamID, orderID uint64, to sellingv1.OrderStatus) {
	t.Helper()

	res, err := svc.OrderStatusChange(context.Background(), connect.NewRequest(&sellingv1.OrderStatusChangeRequest{
		TeamId: teamID, OrderIds: []uint64{orderID}, To: to,
	}))
	if err != nil || !res.Msg.GetResults()[0].GetMoved() {
		t.Fatalf("move %d to %v: %v %v", orderID, to, err, res)
	}
}

// EIGHT ACCEPTS OF ONE PARCEL AT ONCE, over the real take: exactly one accepts it, the other seven are told it is
// already accepted — and inventory holds ONE return transaction for it (order_return_checks, the take's row lock), the
// two units back on the rack once, the order naming that one transaction.
func TestRace_OrderReturnAccept_OneReturnTransaction(t *testing.T) {
	h := san_race.New(t, returnRaceTables...)
	db := h.DB()

	for round := range 5 {
		resetOrderRace(t, db)

		err := db.Exec(`DELETE FROM team_return_configurations WHERE team_id = ?`, ocTeam).Error
		if err != nil {
			t.Fatalf("reset the return configuration: %v", err)
		}

		shop := seedTwoBatches(t, db)
		svc := returnService(db)

		// Melati's return warehouse is the one that shipped the order.
		err = db.Exec(`INSERT INTO team_return_configurations (team_id, warehouse_id, created_at, updated_at)
			VALUES (?, ?, NOW(), NOW())`, ocTeam, ocWarehouse).Error
		if err != nil {
			t.Fatalf("configure the return warehouse: %v", err)
		}

		created, err := svc.OrderCreate(context.Background(), connect.NewRequest(twoUnits(shop)))
		if err != nil {
			t.Fatalf("round %d: create: %v", round, err)
		}

		orderID := created.Msg.GetOrder().GetId()

		for _, to := range []sellingv1.OrderStatus{
			sellingv1.OrderStatus_ORDER_STATUS_PROCESSED,
			sellingv1.OrderStatus_ORDER_STATUS_PICKED,
			sellingv1.OrderStatus_ORDER_STATUS_SHIPPING,
		} {
			raceMoveTo(t, svc, ocWarehouse, orderID, to)
		}

		raceMoveTo(t, svc, ocTeam, orderID, sellingv1.OrderStatus_ORDER_STATUS_RETURN)

		var rack uint64

		err = db.Raw(`SELECT id FROM placements WHERE warehouse_id = ? AND code = 'rak-a'`, ocWarehouse).Scan(&rack).Error
		if err != nil {
			t.Fatalf("round %d: the rack: %v", round, err)
		}

		lines := []*sellingv1.OrderReturnAcceptLine{{
			OrderItemId: created.Msg.GetOrder().GetItems()[0].GetId(),
			Placements:  []*sellingv1.OrderReturnPlacement{{RackId: rack, Quantity: 2}},
		}}

		const n = 8

		errs := make([]error, n)

		res := h.Race(t, n, func(i int) error {
			_, errs[i] = svc.OrderReturnAccept(context.Background(), connect.NewRequest(&sellingv1.OrderReturnAcceptRequest{
				TeamId: ocWarehouse, OrderId: orderID, Lines: lines,
			}))

			// A refusal is the expected answer for all but one — judged below.
			return nil
		})

		if round == 0 {
			res.Report(t)
		}

		accepted := 0

		for i, err := range errs {
			switch {
			case err == nil:
				accepted++
			case connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "already accepted"):
				t.Fatalf("round %d: caller %d got %v — want \"already accepted\"", round, i, err)
			}
		}

		if accepted != 1 {
			t.Fatalf("round %d: %d callers accepted — want exactly one", round, accepted)
		}

		assertOneReturn(t, db, round, orderID, rack)
	}
}

// assertOneReturn is the data the race must leave: one return transaction, claimed once, the units back on the rack
// once, the order naming it.
func assertOneReturn(t *testing.T, db *gorm.DB, round int, orderID, rack uint64) {
	t.Helper()

	var returns, claims, onRack int64

	db.Raw(`SELECT count(*) FROM inventory_transactions WHERE tx_type = 'return'`).Scan(&returns)
	db.Raw(`SELECT count(*) FROM order_return_checks`).Scan(&claims)
	db.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM product_placements WHERE placement_id = ? AND product_id = ?`,
		rack, ocProduct).Scan(&onRack)

	if returns != 1 || claims != 1 {
		t.Fatalf("round %d: %d return transactions, %d claims — want one of each", round, returns, claims)
	}

	// Four on the shelf, two taken, the two back.
	if onRack != 4 {
		t.Fatalf("round %d: %d units on the rack after the return, want 4 — the parcel back once", round, onRack)
	}

	var order selling_service_models.Order

	err := db.Where("id = ?", orderID).Take(&order).Error
	if err != nil {
		t.Fatalf("round %d: read the order: %v", round, err)
	}

	var returnTx uint64

	db.Raw(`SELECT id FROM inventory_transactions WHERE tx_type = 'return'`).Scan(&returnTx)

	if order.Status != "return_completed" || order.ReturnTransactionID == nil || *order.ReturnTransactionID != returnTx {
		t.Fatalf("round %d: order %s naming return %v, want return_completed naming %d", round, order.Status,
			order.ReturnTransactionID, returnTx)
	}
}
