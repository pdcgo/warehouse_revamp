//go:build raceaudit

// Concurrency audit for ShopeeOrderImport / TiktokOrderImport (the audit-sql skill). Both share importOrders, whose
// every write is moveOrders — the code OrderStatusChange runs, whose lock is proved by
// TestInterleave_OrderStatusChange_SecondWaitsAndReReads. What is NEW here is the import's own read: it decides each
// order's move from an UNLOCKED read, and only then locks. These races are what that gap could break.
//
//	go test -tags raceaudit -count=20 -run 'TestRace_OrderImport' -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// raceImportOrder writes a committed order of the race team, in `status`, with the ref the file names.
func raceImportOrder(t *testing.T, db *gorm.DB, shopID uint64, ref, status string) uint64 {
	t.Helper()

	order := selling_service_models.Order{
		TeamID: raceOrderTeam, ShopID: shopID, WarehouseID: testWarehouse,
		Status: status, OrderExternalRefID: ref, CustomerName: "Budi",
	}

	err := db.Create(&order).Error
	if err != nil {
		t.Fatalf("seed order %s: %v", ref, err)
	}

	return order.ID
}

func raceShopeeImport(client sellingv1connect.OrderServiceClient, shopID uint64, content []byte) (*sellingv1.OrderImportTally, error) {
	stream, err := client.ShopeeOrderImport(context.Background(), connect.NewRequest(&sellingv1.ShopeeOrderImportRequest{
		TeamId: raceOrderTeam, ShopId: shopID, FileContent: content,
	}))
	if err != nil {
		return nil, err
	}
	defer stream.Close()

	var tally *sellingv1.OrderImportTally

	for stream.Receive() {
		if stream.Msg().GetTally() != nil {
			tally = stream.Msg().GetTally()
		}
	}

	return tally, stream.Err()
}

// lastRowIsTheStatus fails when an order's newest timeline row is not the status the order holds — the shape a
// move written over another, or written twice, leaves behind.
func lastRowIsTheStatus(t *testing.T, db *gorm.DB, orderID uint64) {
	t.Helper()

	var last string

	err := db.Raw(`SELECT status FROM order_timeline_logs WHERE order_id = ? AND status <> '' ORDER BY id DESC LIMIT 1`,
		orderID).Scan(&last).Error
	if err != nil {
		t.Fatalf("timeline of %d: %v", orderID, err)
	}

	if got := rawStatus(t, db, orderID); got != last {
		t.Fatalf("order %d is %s, but its newest timeline row says %s", orderID, got, last)
	}
}

// Eight people import the same file in the same second. Each move is made ONCE: one timeline row per moved order,
// and across all eight tallies the moves add up to the three the file allows — the other callers are told
// "already there", never a second row.
func TestRace_OrderImport_SameFileAtOnce(t *testing.T) {
	h := orderRaceHarness(t)
	client := importClient(t, h.DB())
	file := orderSample(t, "shopee", shopeeLate)

	const n = 8

	for round := range 5 {
		shop := insertShop(t, h.DB(), raceOrderTeam, "Race Import", "RI-"+string(rune('A'+round)), "shopee")

		moves := map[uint64]string{
			raceImportOrder(t, h.DB(), shop, "2610201E5F6G7H", "shipped"):  "completed",
			raceImportOrder(t, h.DB(), shop, "2610212J8K9L0M", "shipped"):  "return",
			raceImportOrder(t, h.DB(), shop, "2610212N1P2Q3R", "shipping"): "shipped",
		}

		tallies := make([]*sellingv1.OrderImportTally, n)

		res := h.Race(t, n, func(i int) error {
			tally, err := raceShopeeImport(client, shop, file)
			tallies[i] = tally

			return err
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Count(san_race.Deadlock) > 0 {
			t.Fatalf("round %d: %d imports DEADLOCKED", round, res.Count(san_race.Deadlock))
		}

		if res.Failed() > 0 {
			t.Fatalf("round %d: %d imports FAILED — a refused move is a line, never an error", round, res.Failed())
		}

		var moved uint32

		for i, tally := range tallies {
			if tally == nil {
				t.Fatalf("round %d: caller %d ended with no tally", round, i)
			}

			moved += tally.GetMoved()
		}

		if moved != uint32(len(moves)) {
			t.Fatalf("round %d: the eight imports moved %d times in all — want %d, each move once", round, moved, len(moves))
		}

		for orderID, want := range moves {
			if got := rawStatus(t, h.DB(), orderID); got != want {
				t.Fatalf("round %d: order %d is %s, want %s", round, orderID, got, want)
			}

			if got := eventCount(t, h.DB(), orderID, want); got != 1 {
				t.Fatalf("round %d: order %d has %d %s rows — want one", round, orderID, got, want)
			}
		}
	}
}

// THE GAP THE IMPORT ADDS: it reads an order `shipping`, decides "→ shipped", and only then locks. In that second
// customer service returns the same orders by hand (shipping → return). Whoever locks second must be refused by
// the state the first left — never an order the hand returned that the import then calls shipped.
func TestRace_OrderImport_AgainstAHandReturn(t *testing.T) {
	h := orderRaceHarness(t)
	client := importClient(t, h.DB())
	svc := newService(t, h.DB())
	file := orderSample(t, "shopee", shopeeLate)

	for round := range 10 {
		shop := insertShop(t, h.DB(), raceOrderTeam, "Race Import", "RH-"+string(rune('A'+round)), "shopee")
		orderID := raceImportOrder(t, h.DB(), shop, "2610212N1P2Q3R", "shipping")

		res := h.Race(t, 2, func(i int) error {
			if i == 0 {
				_, err := raceShopeeImport(client, shop, file)

				return err
			}

			_, err := raceMove(svc, raceOrderTeam, orderID, sellingv1.OrderStatus_ORDER_STATUS_RETURN)

			return err
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() > 0 {
			t.Fatalf("round %d: %d calls failed", round, res.Failed())
		}

		lastRowIsTheStatus(t, h.DB(), orderID)

		// Either order of the two is legal — shipped then returned, or returned and the import refused — but a
		// return is never followed by the import's shipped.
		var backwards int64

		err := h.DB().Raw(`
			SELECT count(*) FROM order_timeline_logs s
			JOIN order_timeline_logs r ON r.order_id = s.order_id AND r.status = 'return' AND r.id < s.id
			WHERE s.order_id = ? AND s.status = 'shipped'`, orderID).Scan(&backwards).Error
		if err != nil {
			t.Fatalf("round %d: %v", round, err)
		}

		if backwards > 0 {
			t.Fatalf("round %d: the import shipped an order the hand had already returned", round)
		}
	}
}
