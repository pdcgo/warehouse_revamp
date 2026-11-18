//go:build raceaudit

// Concurrency audit for THE DOOR'S PHOTOS ON THE ACCEPT (a-broken-product-carries-a-photo,
// the-courier-slip-has-an-optional-photo): the broken units' photo rides on the line's broken row and the courier's slip
// on the restock row, both written inside the accept's one transaction, under the restock row's lock
// (accept-locks-the-restock). Two people pressing Terima on one box at the same second must leave ONE count — and its
// photos must be that count's own pair, never one caller's slip beside another's broken photo. The lock order is the
// accept's, unchanged: the photos add a column to rows it already writes. Build-tagged: san_race COMMITS.
//
//	go test -tags raceaudit -p 1 -run "TestRace_RestockDoorPhotos" -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"fmt"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
)

// EIGHT ACCEPTS OF ONE BOX, EACH WITH ITS OWN PHOTOS: one lands, seven are refused (the restock is no longer acceptable),
// and the restock keeps the winner's slip and the winner's broken photo — on one broken row. ×5 rounds.
func TestRace_RestockDoorPhotos_OneAcceptKeepsItsOwnPhotos(t *testing.T) {
	h := san_race.New(t, append([]string{"restock_problem_items", "restock_logs", "restock_items",
		"restocks", "warehouse_products"}, ledgerTables...)...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())
	rack := reportRack(t, h.DB())

	const callers = 8

	for round := range 5 {
		restock := raceRestocks(t, svc, 1, 3)[0]
		item := restock.GetItems()[0]

		res := h.Race(t, callers, func(i int) error {
			_, err := svc.RestockRequestAccept(ctxUser(7), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
				TeamId: raceWarehouse, RequestId: restock.GetId(),
				Lines: []*inventoryv1.RestockRequestReceivedLine{{
					ItemId: item.GetId(), ReceivedCount: item.GetCount(), BrokenCount: 1,
					Placements:      placedOn(rack, item.GetCount()-1),
					BrokenPhotoFile: fmt.Sprintf("race-broken-%d-%d", round, i),
				}},
				WarehouseAdditionalCost:     5000,
				WarehouseAdditionalCostNote: "biaya COD",
				WarehouseAdditionalCostFile: fmt.Sprintf("race-slip-%d-%d", round, i),
			}))

			return err
		})
		res.Report(t)

		if res.Failed() != callers-1 {
			t.Fatalf("round %d: %d of %d accepts failed — want all but one", round, res.Failed(), callers)
		}

		var slip string
		h.DB().Raw(`SELECT warehouse_additional_cost_file FROM restocks WHERE id = ?`, restock.GetId()).Scan(&slip)

		var photos []string
		h.DB().Raw(`SELECT photo_file FROM restock_problem_items WHERE restock_id = ? AND problem_type = 'broken'`,
			restock.GetId()).Scan(&photos)

		var winner int
		_, err := fmt.Sscanf(slip, fmt.Sprintf("race-slip-%d-%%d", round), &winner)
		if err != nil {
			t.Fatalf("round %d: the slip kept is %q: %v", round, slip, err)
		}

		if want := fmt.Sprintf("race-broken-%d-%d", round, winner); len(photos) != 1 || photos[0] != want {
			t.Fatalf("round %d: broken photos %v beside slip %q — want only %q, the same caller's", round, photos, slip, want)
		}
	}
}
