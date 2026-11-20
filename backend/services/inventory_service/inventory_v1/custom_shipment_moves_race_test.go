//go:build raceaudit

// Concurrency audit for the custom shipment's moves (the audit-sql skill, backlog #88 P3): the selling team calling a
// parcel off in the same second the warehouse picks it, the team editing its courier cost while the warehouse hands the
// parcel over, and a cancelled sample's units going back onto a shelf orders are taking from — each the normal case
// for people working in pairs on one stock level.
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS.
//
//	go test -tags raceaudit -p 1 -run "TestRace_CustomShipmentMove" -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// verifyTakesAndUndos is verifyEveryTransaction for a ledger holding undone takes: a live transaction verifies (its
// items equal its rows, both ledgers agree); a rolled-back one's rows net to nothing on both ledgers.
func verifyTakesAndUndos(t *testing.T, db *gorm.DB) {
	t.Helper()

	var txs []models.InventoryTransaction
	db.Raw(`SELECT * FROM inventory_transactions WHERE id IN (SELECT DISTINCT transaction_id FROM batch_logs)`).Scan(&txs)

	for _, tx := range txs {
		if tx.IsRollback {
			if rows := takeNetRows(t, db, tx.ID); len(rows) != 0 {
				t.Fatalf("rolled-back transaction %d still moves %v", tx.ID, rows)
			}

			continue
		}

		err := inventory_ledgers.Verify(db, tx.ID)
		if err != nil {
			t.Fatalf("Verify %d: %v", tx.ID, err)
		}
	}
}

// raceEvents records what a racing service publishes — safe from many goroutines.
type raceEvents struct {
	mu     sync.Mutex
	events []*eventsv1.Event
}

func (r *raceEvents) send(_ context.Context, _ *role_basev1.Identity, event *eventsv1.Event) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.events = append(r.events, event)

	return nil
}

func (r *raceEvents) of(id uint64) (costUpdated []*eventsv1.CustomShipmentCostUpdated, handedOver int) {
	r.mu.Lock()
	defer r.mu.Unlock()

	for _, e := range r.events {
		if c := e.GetCustomShipmentCostUpdated(); c != nil && c.GetCustomShipmentId() == id {
			costUpdated = append(costUpdated, c)
		}

		if h := e.GetCustomShipmentHandedOver(); h != nil && h.GetCustomShipmentId() == id {
			handedOver++
		}
	}

	return costUpdated, handedOver
}

// raceMoveService is raceService with its events recorded.
func raceMoveService(db *gorm.DB, events *raceEvents) *inventory_v1.Service {
	return inventory_v1.NewService(db, nil, nil, nil, events.send, fakeFacts{
		raceProductA: {TeamID: raceOwner},
		raceProductB: {TeamID: raceOwner},
	}, nil, nil, nil, nil)
}

// raceTeamPaidSample commits a sample of `quantity` product A, the team paying Rp 1.000 from account 7, and returns its id.
func raceTeamPaidSample(t *testing.T, svc *inventory_v1.Service, key string, quantity uint64) uint64 {
	t.Helper()

	res, err := svc.CustomShipmentCreate(context.Background(), connect.NewRequest(&inventoryv1.CustomShipmentCreateRequest{
		TeamId: raceOwner, Kind: inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_SAMPLE, WarehouseId: raceWarehouse,
		Lines:             []*inventoryv1.CustomShipmentLine{{ProductId: raceProductA, Quantity: quantity}},
		Recipient:         &inventoryv1.CustomShipmentRecipient{Name: "Budi", Phone: "1", Address: "x"},
		ShipmentChannelId: 9,
		Payer:             inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_TEAM,
		FinanceAccountId:  7,
		ShippingCost:      1000,
		IdempotencyKey:    key,
	}))
	if err != nil {
		t.Fatalf("create the sample: %v", err)
	}

	return res.Msg.GetCustomShipment().GetId()
}

func raceCancel(svc *inventory_v1.Service, id uint64) error {
	_, err := svc.CustomShipmentCancel(context.Background(), connect.NewRequest(&inventoryv1.CustomShipmentCancelRequest{
		TeamId: raceOwner, Id: id,
	}))

	return err
}

func racePicked(svc *inventory_v1.Service, id uint64) error {
	_, err := svc.CustomShipmentPicked(context.Background(), connect.NewRequest(&inventoryv1.CustomShipmentPickedRequest{
		TeamId: raceWarehouse, Id: id,
	}))

	return err
}

func raceStored(t *testing.T, db *gorm.DB, id uint64) (models.CustomShipment, models.InventoryTransaction) {
	t.Helper()

	var cs models.CustomShipment

	err := db.First(&cs, id).Error
	if err != nil {
		t.Fatalf("read custom shipment %d: %v", id, err)
	}

	var take models.InventoryTransaction

	if cs.TransactionID != nil {
		err = db.First(&take, *cs.TransactionID).Error
		if err != nil {
			t.Fatalf("read its take: %v", err)
		}
	}

	return cs, take
}

// ⚠ THE TEAM CALLS A PARCEL OFF IN THE SECOND THE WAREHOUSE PICKS IT. 8 callers on one requested sample of 2 — four
// cancel, four pick: EXACTLY ONE wins and seven are refused (FailedPrecondition), never both a cancel and a pick: the
// parcel row's lock queues them and each judges the status the one before it committed. When the cancel won, the take
// is rolled back and its 2 units are on the shelf again; when the pick won, they stay out. Nobody deadlocks; both
// ledgers agree and every transaction verifies. ×12 rounds.
func TestRace_CustomShipmentMove_CancelVsPickedExactlyOneWins(t *testing.T) {
	h := san_race.New(t, customShipmentRaceTables...)
	svc := raceService(h.DB())

	seedLedgers(t, h.DB(), 20, raceProductA) // 40 units: two batches of 20, over two racks

	cancelsWon, picksWon := 0, 0

	for round := range 12 {
		id := raceTeamPaidSample(t, svc, fmt.Sprintf("cancel-pick-%d", round), 2)

		var (
			c                  codes
			cancelled, pickedN atomic.Int32
		)

		res := h.Race(t, 8, func(i int) error {
			var err error

			if i%2 == 0 {
				err = raceCancel(svc, id)
				if err == nil {
					cancelled.Add(1)
				}
			} else {
				err = racePicked(svc, id)
				if err == nil {
					pickedN.Add(1)
				}
			}

			c.add(err)

			if connect.CodeOf(err) == connect.CodeFailedPrecondition {
				return nil // the parcel already moved — the right answer, not a failure
			}

			return err
		})
		res.Report(t)

		if n := res.Count(san_race.Deadlock); n != 0 {
			t.Fatalf("round %d: %d callers deadlocked", round, n)
		}

		if c.got[0] != 1 || c.got[connect.CodeFailedPrecondition] != 7 {
			t.Fatalf("round %d: outcomes = %v, want exactly 1 won and 7 refused", round, c.got)
		}

		cs, take := raceStored(t, h.DB(), id)

		switch {
		case cancelled.Load() == 1:
			cancelsWon++

			if cs.Status != models.CustomShipmentCancelled || !take.IsRollback {
				t.Fatalf("round %d: the cancel won but the parcel is %s, its take rolled back %v", round, cs.Status, take.IsRollback)
			}
		case pickedN.Load() == 1:
			picksWon++

			if cs.Status != models.CustomShipmentPicked || take.IsRollback {
				t.Fatalf("round %d: the pick won but the parcel is %s, its take rolled back %v", round, cs.Status, take.IsRollback)
			}
		}

		var steps int64
		h.DB().Raw(`SELECT COUNT(*) FROM custom_shipment_logs WHERE custom_shipment_id = ? AND from_status = 'requested'`, id).
			Scan(&steps)

		if steps != 1 {
			t.Fatalf("round %d: %d moves out of requested on the trail, want exactly 1", round, steps)
		}
	}

	want := int64(40 - 2*picksWon)
	if b, r := stockOf(t, h.DB(), raceProductA); b != want || r != want {
		t.Fatalf("the batches hold %d and the racks %d, want %d — 40 less 2 per picked parcel", b, r, want)
	}

	verifyTakesAndUndos(t, h.DB())

	t.Logf("over 12 rounds the cancel won %d and the pick %d", cancelsWon, picksWon)
}

// ⚠ THE TEAM EDITS ITS COURIER COST WHILE THE WAREHOUSE HANDS THE PARCEL OVER. A picked team-paid parcel at Rp 1.000;
// 8 callers — four hand it over, four set a new cost. Exactly one handover wins (three refused); a cost edit wins only
// if it committed BEFORE the handover, and every later one is refused — so the trail's edit rows all sit before the
// handed-over row, the stored revision counts them, each won edit published its own CostUpdated (revisions 1..k), the
// stored cost is the last of them, and one HandedOver was published. Nobody deadlocks. ×12 rounds, the two sides
// staggered by turns so both orders are hit.
func TestRace_CustomShipmentMove_HandoverVsCostSet(t *testing.T) {
	h := san_race.New(t, customShipmentRaceTables...)
	events := &raceEvents{}
	svc := raceMoveService(h.DB(), events)

	seedLedgers(t, h.DB(), 20, raceProductA)

	editsBefore := map[int]int{}

	for round := range 12 {
		id := raceTeamPaidSample(t, svc, fmt.Sprintf("handover-cost-%d", round), 1)

		err := racePicked(svc, id)
		if err != nil {
			t.Fatalf("round %d: pick: %v", round, err)
		}

		var handovers, edits codes

		res := h.Race(t, 8, func(i int) error {
			var err error

			if i < 4 {
				// Round 1 of 3 lets the edits go first; round 2 of 3 lets the handovers go first.
				if round%3 == 1 {
					time.Sleep(15 * time.Millisecond)
				}

				_, err = svc.CustomShipmentHandover(context.Background(), connect.NewRequest(&inventoryv1.CustomShipmentHandoverRequest{
					TeamId: raceWarehouse, Id: id,
				}))
				handovers.add(err)
			} else {
				if round%3 == 2 {
					time.Sleep(15 * time.Millisecond)
				}

				_, err = svc.CustomShipmentCostSet(context.Background(), connect.NewRequest(&inventoryv1.CustomShipmentCostSetRequest{
					TeamId: raceOwner, Id: id, FinanceAccountId: 7, ShippingCost: float64(2000 + 100*i),
				}))
				edits.add(err)
			}

			if connect.CodeOf(err) == connect.CodeFailedPrecondition {
				return nil
			}

			return err
		})
		res.Report(t)

		if n := res.Count(san_race.Deadlock); n != 0 {
			t.Fatalf("round %d: %d callers deadlocked", round, n)
		}

		if handovers.got[0] != 1 || handovers.got[connect.CodeFailedPrecondition] != 3 {
			t.Fatalf("round %d: handovers = %v, want exactly 1 and 3 refused", round, handovers.got)
		}

		won := edits.got[0]
		if won+edits.got[connect.CodeFailedPrecondition] != 4 {
			t.Fatalf("round %d: edits = %v, want each won or refused", round, edits.got)
		}

		editsBefore[won]++

		cs, _ := raceStored(t, h.DB(), id)

		var trail []models.CustomShipmentLog
		h.DB().Where("custom_shipment_id = ?", id).Order("id").Find(&trail)

		editRows, handedAt := 0, -1

		for i, row := range trail {
			switch {
			case row.FromStatus == row.ToStatus:
				editRows++

				if handedAt >= 0 {
					t.Fatalf("round %d: a cost edit landed after the handover: %+v", round, trail)
				}
			case row.ToStatus == models.CustomShipmentHandedOver:
				handedAt = i
			}
		}

		if cs.Status != models.CustomShipmentHandedOver || handedAt < 0 || editRows != won || int(cs.CostRevision) != won {
			t.Fatalf("round %d: status %s, %d edit rows, revision %d — want handed over with %d edits", round, cs.Status,
				editRows, cs.CostRevision, won)
		}

		updated, handedOver := events.of(id)
		if len(updated) != won || handedOver != 1 {
			t.Fatalf("round %d: %d CostUpdated and %d HandedOver published, want %d and 1", round, len(updated), handedOver, won)
		}

		// The stored cost is the LAST edit's (its trail row ends in it), or the create's when no edit won — and an edit
		// that won published it.
		if won == 0 {
			if cs.ShippingCost != 1000 {
				t.Fatalf("round %d: no edit won, yet the cost is %v", round, cs.ShippingCost)
			}

			continue
		}

		var lastEdit models.CustomShipmentLog

		for _, row := range trail {
			if row.FromStatus == row.ToStatus {
				lastEdit = row
			}
		}

		published := false

		for _, u := range updated {
			published = published || u.GetNewAmount() == cs.ShippingCost
		}

		if !strings.HasSuffix(lastEdit.Description, "→ "+san_money.Text(cs.ShippingCost)) || !published {
			t.Fatalf("round %d: stored cost %v, last edit %q, published %v — want the last edit's cost", round,
				cs.ShippingCost, lastEdit.Description, published)
		}
	}

	t.Logf("edits won before the handover, per round: %v (k edits → rounds)", editsBefore)
}

// ⚠ A CANCELLED SAMPLE'S UNITS GO BACK ONTO A SHELF ORDERS ARE TAKING FROM. 10 units; a parcel sample took 4 (6 left).
// Then, at once, its cancel and 7 orders of 2: the cancel always lands, and the orders win 3 (it came back after them)
// to 5 (it came back first) — never more units than were there at any moment: both ledgers end at exactly
// 10 − 2 × orders won, the take is rolled back, every transaction verifies, nobody deadlocks (the cancel takes the
// order's lock order: batches, then racks, each by id). ×24 rounds: the deadlock a racks-first undo would make is a
// matter of timing (8 rounds once missed it), so the rounds are many.
func TestRace_CustomShipmentMove_CancelRollbackVsAnOrderForTheSameUnits(t *testing.T) {
	wonCounts := map[int]int{}

	for round := range 24 {
		h := san_race.New(t, customShipmentRaceTables...)
		svc := raceService(h.DB())

		seedLedgers(t, h.DB(), 5, raceProductA)

		id := raceTeamPaidSample(t, svc, fmt.Sprintf("sample-%d", round), 4)

		var cancels, orders codes

		res := h.Race(t, 8, func(i int) error {
			var err error

			if i == 0 {
				// Stagger the cancel by turns, so it lands before, among and after the orders.
				time.Sleep(time.Duration(round%4) * 3 * time.Millisecond)

				err = raceCancel(svc, id)
				cancels.add(err)
			} else {
				err = raceTake(svc, fmt.Sprintf("order-%d-%d", round, i), &inventoryv1.OrderTransactionLine{ProductId: raceProductA, Quantity: 2})
				orders.add(err)
			}

			if connect.CodeOf(err) == connect.CodeFailedPrecondition && i != 0 {
				return nil // too few on the shelf for this order — the right answer
			}

			return err
		})
		res.Report(t)

		if n := res.Count(san_race.Deadlock); n != 0 {
			t.Fatalf("round %d: %d callers deadlocked", round, n)
		}

		if cancels.got[0] != 1 {
			t.Fatalf("round %d: the cancel = %v, want it through", round, cancels.got)
		}

		won := orders.got[0]
		if won < 3 || won > 5 || won+orders.got[connect.CodeFailedPrecondition] != 7 {
			t.Fatalf("round %d: orders = %v, want 3 to 5 won and the rest refused", round, orders.got)
		}

		wonCounts[won]++

		want := int64(10 - 2*won)
		if b, r := stockOf(t, h.DB(), raceProductA); b != want || r != want {
			t.Fatalf("round %d: the batches hold %d and the racks %d, want %d", round, b, r, want)
		}

		_, take := raceStored(t, h.DB(), id)
		if !take.IsRollback {
			t.Fatalf("round %d: the cancelled sample's take is not rolled back", round)
		}

		verifyTakesAndUndos(t, h.DB())
	}

	t.Logf("orders won per round: %v (won → rounds)", wonCounts)
}
