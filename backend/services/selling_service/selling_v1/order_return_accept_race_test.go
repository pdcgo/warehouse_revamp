//go:build raceaudit

// Concurrency audit for OrderReturnAccept (the audit-sql skill): two of the crew scanning the same returned parcel in
// the same second must accept it ONCE — one `return_completed` row, one OrderReturnAccepted, so one courier charge. The
// stock half here is a fake; the real one — one return transaction for two accepts at once — is
// cmd/app_development/order_return_accept_race_test.go.
//
//	go test -tags raceaudit -run 'TestRace_OrderReturnAccept|TestInterleave_OrderReturnAccept' -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"context"
	"strings"
	"sync"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// lockedRecorder counts the accepts announced — safe for the racing goroutines, unlike recorder.
type lockedRecorder struct {
	mu       sync.Mutex
	accepted []uint64
}

func (r *lockedRecorder) send(_ context.Context, _ *role_basev1.Identity, event *eventsv1.Event) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if got := event.GetOrderReturnAccepted(); got != nil {
		r.accepted = append(r.accepted, got.GetOrderId())
	}

	return nil
}

func (r *lockedRecorder) count(orderID uint64) int {
	r.mu.Lock()
	defer r.mu.Unlock()

	n := 0

	for _, id := range r.accepted {
		if id == orderID {
			n++
		}
	}

	return n
}

// ReturnStock is the fake stock side's return, safe for the racing goroutines (lockedPicker: shop_close_race_test.go).
func (p *lockedPicker) ReturnStock(ctx context.Context, in selling_v1.StockReturn) (selling_v1.ReturnedStock, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	return p.fakePicker.ReturnStock(ctx, in)
}

// configureRaceReturnWarehouse gives the race team its return warehouse — committed, cleaned by orderRaceHarness.
func configureRaceReturnWarehouse(t *testing.T, db *gorm.DB, warehouseID uint64) {
	t.Helper()

	err := db.Exec(`INSERT INTO team_return_configurations (team_id, warehouse_id, created_at, updated_at) VALUES (?, ?, NOW(), NOW())
		ON CONFLICT (team_id) DO UPDATE SET warehouse_id = EXCLUDED.warehouse_id`,
		raceOrderTeam, warehouseID).Error
	if err != nil {
		t.Fatalf("configure the race team's return warehouse: %v", err)
	}
}

// raceLines is a whole, sound count of the order: every line on one rack.
func raceLines(t *testing.T, db *gorm.DB, orderID uint64) []*sellingv1.OrderReturnAcceptLine {
	t.Helper()

	var items []selling_service_models.OrderItem

	err := db.Where("order_id = ?", orderID).Order("id").Find(&items).Error
	if err != nil {
		t.Fatalf("read the order's lines: %v", err)
	}

	lines := make([]*sellingv1.OrderReturnAcceptLine, 0, len(items))
	for _, item := range items {
		lines = append(lines, &sellingv1.OrderReturnAcceptLine{
			OrderItemId: item.ID,
			Placements:  []*sellingv1.OrderReturnPlacement{{RackId: 77, Quantity: item.Quantity}},
		})
	}

	return lines
}

// raceReturnedOrder places a race-team order and walks it to `return` — committed.
func raceReturnedOrder(t *testing.T, svc *selling_v1.Service, shopID uint64) uint64 {
	t.Helper()

	orderID := raceOrder(t, svc, shopID)

	for _, to := range []sellingv1.OrderStatus{
		sellingv1.OrderStatus_ORDER_STATUS_PROCESSED,
		sellingv1.OrderStatus_ORDER_STATUS_PICKED,
		sellingv1.OrderStatus_ORDER_STATUS_SHIPPING,
	} {
		moveOrder(t, svc, testWarehouse, orderID, to, "")
	}

	moveOrder(t, svc, raceOrderTeam, orderID, sellingv1.OrderStatus_ORDER_STATUS_RETURN, "")

	return orderID
}

func raceAccept(svc *selling_v1.Service, orderID uint64, lines []*sellingv1.OrderReturnAcceptLine) error {
	return raceAcceptAt(svc, testWarehouse, orderID, lines)
}

// raceAcceptAt accepts the order as the given warehouse — only the return warehouse is let through.
func raceAcceptAt(svc *selling_v1.Service, warehouseID, orderID uint64, lines []*sellingv1.OrderReturnAcceptLine) error {
	_, err := svc.OrderReturnAccept(context.Background(), connect.NewRequest(&sellingv1.OrderReturnAcceptRequest{
		TeamId: warehouseID, OrderId: orderID, CourierCharge: 15_000, CourierChargeNote: "ongkir retur", Lines: lines,
	}))

	return err
}

// Eight of the crew accept the same parcel at once: exactly one accepts it, the other seven are told it is already
// accepted, the history has ONE return_completed row and ONE event is published — so the courier is charged once.
func TestRace_OrderReturnAccept_SameParcelAtOnce(t *testing.T) {
	h := orderRaceHarness(t)
	rec := &lockedRecorder{}
	svc := selling_v1.NewService(h.DB(), &lockedPicker{}, rec.send, &fakeCatalog{}, &fakeCredit{}, everyoneMayWrite{}, nil, nil, nil, nil, nil)
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Return", "RR-1", "shopee")
	configureRaceReturnWarehouse(t, h.DB(), testWarehouse)

	const n = 8

	for round := range 10 {
		orderID := raceReturnedOrder(t, svc, shopID)
		lines := raceLines(t, h.DB(), orderID)

		errs := make([]error, n)

		res := h.Race(t, n, func(i int) error {
			errs[i] = raceAccept(svc, orderID, lines)

			// A refusal is the expected answer for all but one — judged below, not counted as a failure here.
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
			t.Fatalf("round %d: %d callers accepted the return — want exactly one", round, accepted)
		}

		if got := eventCount(t, h.DB(), orderID, "return_completed"); got != 1 {
			t.Fatalf("round %d: %d return_completed rows — want one", round, got)
		}

		if got := rec.count(orderID); got != 1 {
			t.Fatalf("round %d: %d OrderReturnAccepted published — want one, or the courier is charged twice", round, got)
		}
	}
}

// THE PROOF THE ORDER'S ROW LOCK HOLDS, and that B RE-READS after it. A has accepted and not committed; B's accept read
// `return` BEFORE A's lock (its unlocked pre-read passes) and must still wait on the row, then see A's
// return_completed and be refused — never write a second accept from the status it read first.
func TestInterleave_OrderReturnAccept_SecondWaitsAndReReads(t *testing.T) {
	h := orderRaceHarness(t)
	svc := newService(t, h.DB())
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Return", "RR-2", "shopee")
	configureRaceReturnWarehouse(t, h.DB(), testWarehouse)

	orderID := raceReturnedOrder(t, svc, shopID)
	lines := raceLines(t, h.DB(), orderID)

	var aErr, bErr error

	accept := func(dst *error) func(tx *gorm.DB) error {
		return func(tx *gorm.DB) error {
			*dst = raceAccept(newService(t, tx), orderID, lines)

			return nil
		}
	}

	const second = "B accepts the same parcel"

	sched := h.Interleave(t,
		san_race.Do("A", "A accepts the return — FOR UPDATE holds its row", accept(&aErr)),
		san_race.Block("B", second, accept(&bErr)),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	step := sched.Get(second)
	if !step.Blocked || !step.Released {
		t.Fatalf("B did not wait on the order's row (blocked=%v released=%v)", step.Blocked, step.Released)
	}

	if aErr != nil {
		t.Fatalf("A was refused: %v", aErr)
	}

	if connect.CodeOf(bErr) != connect.CodeFailedPrecondition || !strings.Contains(bErr.Error(), "already accepted") {
		t.Fatalf("B after the wait: %v — it acted on the status it read BEFORE the lock", bErr)
	}

	if got := eventCount(t, h.DB(), orderID, "return_completed"); got != 1 {
		t.Fatalf("%d return_completed rows — want one", got)
	}
}

// TWO BUILDINGS, ONE PARCEL — only the return warehouse accepts a return (only-the-return-warehouse-accepts-a-return).
// The order's own warehouse and the configured return warehouse press Accept in the same second: every press at the
// shipping warehouse is refused naming where the parcel goes, exactly one press at the return warehouse accepts it, and
// the accept row and the one event name the return warehouse.
func TestRace_OrderReturnAccept_TwoWarehousesAtOnce(t *testing.T) {
	h := orderRaceHarness(t)
	rec := &lockedRecorder{}
	svc := selling_v1.NewService(h.DB(), &lockedPicker{}, rec.send, &fakeCatalog{}, &fakeCredit{}, everyoneMayWrite{}, nil, nil, nil, nil, nil)
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Return", "RR-3", "shopee")

	const returnWarehouse uint64 = 7_700_950

	configureRaceReturnWarehouse(t, h.DB(), returnWarehouse)

	const n = 8

	for round := range 10 {
		orderID := raceReturnedOrder(t, svc, shopID)
		lines := raceLines(t, h.DB(), orderID)

		errs := make([]error, n)
		at := func(i int) uint64 {
			if i%2 == 0 {
				return testWarehouse
			}

			return returnWarehouse
		}

		res := h.Race(t, n, func(i int) error {
			errs[i] = raceAcceptAt(svc, at(i), orderID, lines)

			return nil
		})

		if round == 0 {
			res.Report(t)
		}

		accepted := 0

		for i, err := range errs {
			switch {
			case at(i) == testWarehouse:
				// Before the accept it is told where the parcel goes; after it, that the return is already accepted.
				if connect.CodeOf(err) != connect.CodeFailedPrecondition ||
					!strings.Contains(err.Error(), "this return goes to") && !strings.Contains(err.Error(), "already accepted") {
					t.Fatalf("round %d: the shipping warehouse's caller %d got %v — want it refused", round, i, err)
				}
			case err == nil:
				accepted++
			case connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "already accepted"):
				t.Fatalf("round %d: caller %d (warehouse %d) got %v — want \"already accepted\"", round, i, at(i), err)
			}
		}

		if accepted != 1 {
			t.Fatalf("round %d: %d accepts at the return warehouse — want exactly one", round, accepted)
		}

		var row struct{ AcceptingWarehouseID uint64 }

		err := h.DB().Raw(`SELECT accepting_warehouse_id FROM order_timeline_logs WHERE order_id = ? AND status = 'return_completed'`,
			orderID).Scan(&row).Error
		if err != nil {
			t.Fatalf("round %d: read the accept row: %v", round, err)
		}

		if row.AcceptingWarehouseID != returnWarehouse {
			t.Fatalf("round %d: the accept row names %d, want the return warehouse %d", round, row.AcceptingWarehouseID,
				returnWarehouse)
		}

		if got := eventCount(t, h.DB(), orderID, "return_completed"); got != 1 {
			t.Fatalf("round %d: %d return_completed rows — want one", round, got)
		}

		if got := rec.count(orderID); got != 1 {
			t.Fatalf("round %d: %d OrderReturnAccepted published — want one", round, got)
		}
	}
}
