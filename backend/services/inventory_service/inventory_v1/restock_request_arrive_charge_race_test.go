//go:build raceaudit

// Concurrency audit for THE COURIER'S CHARGE NOTED AT TIBA (the-courier-charge-is-noted-at-tiba-and-final-at-terima): the
// sign now writes the charge, its note and its slip — on the restock row it already locks FOR UPDATE and already
// updates, so the lock order is the sign's, unchanged. What the write adds is a second writer of the charge beside
// Terima's: a sign racing Terima on one box must never leave Tiba's figure over Terima's. Either the sign commits first
// and Terima replaces its charge, or Terima commits first and the sign is refused (a counted box has nothing to sign) —
// in both, the restock keeps Terima's figure and *Restock Accepted* carries it once. Build-tagged: san_race COMMITS.
//
//	go test -tags raceaudit -p 1 -run "TestRace_RestockArriveCharge" -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// lockedSender records what is published, safe for racing callers.
type lockedSender struct {
	mu   sync.Mutex
	sent []*eventsv1.Event
}

func (l *lockedSender) send(_ context.Context, _ *role_basev1.Identity, event *eventsv1.Event) error {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.sent = append(l.sent, event)

	return nil
}

// acceptedCharges is each restock's *Restock Accepted* charges, in the order published.
func (l *lockedSender) acceptedCharges(restockID uint64) []float64 {
	l.mu.Lock()
	defer l.mu.Unlock()

	var out []float64

	for _, event := range l.sent {
		if a := event.GetRestockAccepted(); a != nil && a.GetRestockId() == restockID {
			out = append(out, a.GetWarehouseAdditionalCost())
		}
	}

	return out
}

// A SIGN WITH A CHARGE RACING TERIMA ON ONE BOX: whichever commits first, the restock ends ACCEPTED with Terima's charge,
// note and slip — never Tiba's — and *Restock Accepted* carries Terima's figure exactly once. The sign is held back on
// odd rounds and Terima on even ones, a few ms, so both orders are hit; the rounds taking each path are logged.
func TestRace_RestockArriveCharge_TerimasFigureWinsWhenItCommitsLast(t *testing.T) {
	h := san_race.New(t, append([]string{"restock_problem_items", "restock_logs", "restock_items",
		"restocks", "warehouse_products"}, ledgerTables...)...)
	seedLedgers(t, h.DB(), 10, raceProductA)

	sender := &lockedSender{}
	svc := inventory_v1.NewService(h.DB(), nil, nil, nil, sender.send, fakeFacts{raceProductA: {TeamID: raceOwner}},
		nil, nil, nil, nil)
	rack := reportRack(t, h.DB())

	const rounds = 16

	var signedFirst, refused int

	for round := range rounds {
		restock := raceRestocks(t, svc, 1, 3)[0]
		item := restock.GetItems()[0]

		tibaFile := fmt.Sprintf("race-tiba-%d", round)
		terimaFile := fmt.Sprintf("race-terima-%d", round)

		res := h.Race(t, 2, func(i int) error {
			// Each side held back on alternate rounds, so both orders are hit.
			if i == 0 {
				if round%2 == 1 {
					time.Sleep(time.Duration(round%8) * time.Millisecond)
				}

				_, err := svc.RestockRequestArrive(ctxUser(7), connect.NewRequest(&inventoryv1.RestockRequestArriveRequest{
					TeamId: raceWarehouse, RequestId: restock.GetId(),
					WarehouseAdditionalCost: 15000, WarehouseAdditionalCostNote: "tiba", WarehouseAdditionalCostFile: tibaFile,
				}))

				return err
			}

			if round%2 == 0 {
				time.Sleep(time.Duration(2+round%8) * time.Millisecond)
			}

			_, err := svc.RestockRequestAccept(ctxUser(8), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
				TeamId: raceWarehouse, RequestId: restock.GetId(),
				Lines: []*inventoryv1.RestockRequestReceivedLine{{
					ItemId: item.GetId(), ReceivedCount: item.GetCount(), Placements: placedOn(rack, item.GetCount()),
				}},
				WarehouseAdditionalCost: 20000, WarehouseAdditionalCostNote: "terima", WarehouseAdditionalCostFile: terimaFile,
			}))

			return err
		})
		res.Report(t)

		// Terima never fails; the sign fails only as refused — a box Terima already counted.
		if res.Outcomes[1].Err != nil {
			t.Fatalf("round %d: Terima failed: %v", round, res.Outcomes[1].Err)
		}

		signErr := res.Outcomes[0].Err

		switch {
		case signErr == nil:
			signedFirst++
		case connect.CodeOf(signErr) == connect.CodeFailedPrecondition:
			refused++
		default:
			t.Fatalf("round %d: the sign failed with %v — want success or FailedPrecondition", round, signErr)
		}

		var stored struct {
			Status                      string
			WarehouseAdditionalCost     float64
			WarehouseAdditionalCostNote string
			WarehouseAdditionalCostFile string
		}

		h.DB().Raw(`SELECT status, warehouse_additional_cost, warehouse_additional_cost_note, warehouse_additional_cost_file
			FROM restocks WHERE id = ?`, restock.GetId()).Scan(&stored)

		if stored.Status != "accepted" || stored.WarehouseAdditionalCost != 20000 ||
			stored.WarehouseAdditionalCostNote != "terima" || stored.WarehouseAdditionalCostFile != terimaFile {
			t.Fatalf("round %d: the restock is %+v — want accepted with Terima's 20000 \"terima\" %q", round, stored, terimaFile)
		}

		if charges := sender.acceptedCharges(restock.GetId()); len(charges) != 1 || charges[0] != 20000 {
			t.Fatalf("round %d: Restock Accepted charges %v — want Terima's 20000 once", round, charges)
		}
	}

	t.Logf("%d rounds: the sign committed first in %d (Terima replaced its charge), was refused after Terima in %d",
		rounds, signedFirst, refused)
}
