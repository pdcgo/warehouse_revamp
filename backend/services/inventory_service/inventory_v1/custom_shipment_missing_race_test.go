//go:build raceaudit

// Concurrency audit for *Barang Tidak Ketemu* (the audit-sql skill, backlog #88 P6): the warehouse noting goods missing
// in the same second a second picker marks the parcel picked, or the selling team cancels it — and the team sending a
// cancelled reship's broken units again while the note that names them is being read. Each is the normal case for
// people working in pairs on one parcel.
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS.
//
//	go test -tags raceaudit -p 1 -run "TestRace_CustomShipmentMissing" -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

func raceMissing(svc *inventory_v1.Service, id, item, rack, quantity uint64) error {
	_, err := svc.CustomShipmentMissingReport(context.Background(), connect.NewRequest(&inventoryv1.CustomShipmentMissingReportRequest{
		TeamId: raceWarehouse, Id: id,
		Lines: []*inventoryv1.CustomShipmentMissingLine{{ItemId: item, RackId: rack, Quantity: quantity}},
	}))

	return err
}

// raceLineAndRack is a parcel's one line and the rack its take drew it from (0 for a reship).
func raceLineAndRack(t *testing.T, db *gorm.DB, id uint64) (item, rack uint64) {
	t.Helper()

	err := db.Raw(`SELECT i.id FROM custom_shipment_items i WHERE i.custom_shipment_id = ?`, id).Scan(&item).Error
	if err != nil || item == 0 {
		t.Fatalf("parcel %d's line: %v", id, err)
	}

	db.Raw(`SELECT l.placement_id FROM product_placement_logs l JOIN custom_shipments c ON c.transaction_id = l.transaction_id
	        WHERE c.id = ? ORDER BY l.id LIMIT 1`, id).Scan(&rack)

	return item, rack
}

// raceTrail is a parcel's trail, oldest first.
func raceTrail(t *testing.T, db *gorm.DB, id uint64) []models.CustomShipmentLog {
	t.Helper()

	var trail []models.CustomShipmentLog

	err := db.
		Where("custom_shipment_id = ?", id).
		Order("id").
		Find(&trail).
		Error
	if err != nil {
		t.Fatalf("trail of %d: %v", id, err)
	}

	return trail
}

// notesBefore counts the goods-missing rows and fails when one sits after the row that moved the parcel out of
// requested — a note is written only while requested.
func notesBefore(t *testing.T, round int, trail []models.CustomShipmentLog, moved models.CustomShipmentStatus) int {
	t.Helper()

	notes, movedAt := 0, -1

	for i, row := range trail {
		switch {
		case row.Kind == models.CustomShipmentLogGoodsMissing:
			notes++

			if movedAt >= 0 {
				t.Fatalf("round %d: a goods-missing note landed after the parcel was %s: %+v", round, moved, trail)
			}
		case row.ToStatus == moved && row.FromStatus == models.CustomShipmentRequested:
			movedAt = i
		}
	}

	if movedAt < 0 {
		t.Fatalf("round %d: no move to %s on the trail: %+v", round, moved, trail)
	}

	return notes
}

// ⚠ THE WAREHOUSE NOTES GOODS MISSING IN THE SECOND A SECOND PICKER MARKS THE PARCEL PICKED. A requested sample of 2; 8
// callers — four note 1 missing on its rack, four pick. Exactly one pick wins (three refused); a note wins only if it
// committed BEFORE the pick and every later one is refused (FailedPrecondition) — so the trail's notes all sit before
// the picked row, and each won note left exactly one line. Nothing moves stock: both ledgers hold 40 less 2 per parcel.
// Nobody deadlocks. ×12 rounds, the two sides staggered by turns so both orders are hit.
func TestRace_CustomShipmentMissing_ReportVsPicked(t *testing.T) {
	h := san_race.New(t, customShipmentRaceTables...)
	svc := raceService(h.DB())

	seedLedgers(t, h.DB(), 20, raceProductA)

	notesWon := map[int]int{}

	for round := range 12 {
		id := raceTeamPaidSample(t, svc, fmt.Sprintf("missing-pick-%d", round), 2)
		item, rack := raceLineAndRack(t, h.DB(), id)

		var notes, picks codes

		res := h.Race(t, 8, func(i int) error {
			var err error

			if i < 4 {
				if round%3 == 1 {
					time.Sleep(15 * time.Millisecond)
				}

				err = raceMissing(svc, id, item, rack, 1)
				notes.add(err)
			} else {
				if round%3 == 2 {
					time.Sleep(15 * time.Millisecond)
				}

				err = racePicked(svc, id)
				picks.add(err)
			}

			if connect.CodeOf(err) == connect.CodeFailedPrecondition {
				return nil // the parcel already moved — the right answer, not a failure
			}

			return err
		})
		res.Report(t)

		if n := res.Count(san_race.Deadlock); n != 0 {
			t.Fatalf("round %d: %d callers deadlocked", round, n)
		}

		if picks.got[0] != 1 || picks.got[connect.CodeFailedPrecondition] != 3 {
			t.Fatalf("round %d: picks = %v, want exactly 1 and 3 refused", round, picks.got)
		}

		won := notes.got[0]
		if won+notes.got[connect.CodeFailedPrecondition] != 4 {
			t.Fatalf("round %d: notes = %v, want each written or refused", round, notes.got)
		}

		notesWon[won]++

		if n := notesBefore(t, round, raceTrail(t, h.DB(), id), models.CustomShipmentPicked); n != won {
			t.Fatalf("round %d: %d notes on the trail, %d won", round, n, won)
		}

		var lines int64
		h.DB().Raw(`SELECT COUNT(*) FROM custom_shipment_missing_lines ml JOIN custom_shipment_logs l
		            ON l.id = ml.custom_shipment_log_id WHERE l.custom_shipment_id = ?`, id).Scan(&lines)

		if lines != int64(won) {
			t.Fatalf("round %d: %d note lines for %d notes", round, lines, won)
		}
	}

	if b, r := stockOf(t, h.DB(), raceProductA); b != 40-2*12 || r != 40-2*12 {
		t.Fatalf("the batches hold %d and the racks %d, want %d — the notes moved nothing", b, r, 40-2*12)
	}

	verifyTakesAndUndos(t, h.DB())

	t.Logf("notes written before the pick, per round: %v (k notes → rounds)", notesWon)
}

// raceReshipID creates a reship of `quantity` of a restock line and returns its id.
func raceReshipID(t *testing.T, svc *inventory_v1.Service, key string, restockID, itemID, quantity uint64) uint64 {
	t.Helper()

	res, err := svc.CustomShipmentCreate(context.Background(), connect.NewRequest(&inventoryv1.CustomShipmentCreateRequest{
		TeamId: raceOwner, Kind: inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_RESTOCK_RESHIP, RestockId: restockID,
		Lines:             []*inventoryv1.CustomShipmentLine{{RestockItemId: itemID, Quantity: quantity}},
		Recipient:         &inventoryv1.CustomShipmentRecipient{Name: "Supplier", Phone: "1", Address: "x"},
		ShipmentChannelId: 9,
		Payer:             inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_WAREHOUSE,
		IdempotencyKey:    key,
	}))
	if err != nil {
		t.Fatalf("reship: %v", err)
	}

	return res.Msg.GetCustomShipment().GetId()
}

// raceOffered is a restock line as the reship choices offer it, nil when not offered.
func raceOffered(t *testing.T, svc *inventory_v1.Service, itemID uint64) *inventoryv1.CustomShipmentReshipLine {
	t.Helper()

	res, err := svc.CustomShipmentReshipOptions(context.Background(), connect.NewRequest(&inventoryv1.CustomShipmentReshipOptionsRequest{
		TeamId: raceOwner, Page: &commonv1.CommonPagination{Page: 1, Limit: 200},
	}))
	if err != nil {
		t.Fatalf("reship options: %v", err)
	}

	for _, o := range res.Msg.GetOptions() {
		for _, line := range o.GetLines() {
			if line.GetRestockItemId() == itemID {
				return line
			}
		}
	}

	return nil
}

// ⚠ THE WAREHOUSE NOTES A RESHIP'S UNITS GONE IN THE SECOND THE TEAM CANCELS IT. A reship of a line's 3 broken units;
// 8 callers — four note 2 of them missing, four cancel. Exactly one cancel wins (three refused); a note wins only if it
// committed BEFORE the cancel — so every note sits before the cancelled row — and the line then holds exactly what the
// won notes named (2 when any won, else nothing): the choices offer 1 or 3, never a gone unit and never a free one held
// back. Nobody deadlocks. ×12 rounds, staggered by turns.
func TestRace_CustomShipmentMissing_ReportVsCancel(t *testing.T) {
	h := san_race.New(t, customShipmentRaceTables...)
	svc := raceService(h.DB())
	rack := newRack(t, svc, raceWarehouse, "rak-a")

	notesWon := map[int]int{}

	for round := range 12 {
		restockID, line := raceBrokenRestock(t, svc, rack, 3)
		id := raceReshipID(t, svc, fmt.Sprintf("missing-cancel-%d", round), restockID, line, 3)
		item, _ := raceLineAndRack(t, h.DB(), id)

		var notes, cancels codes

		res := h.Race(t, 8, func(i int) error {
			var err error

			if i < 4 {
				if round%3 == 1 {
					time.Sleep(15 * time.Millisecond)
				}

				err = raceMissing(svc, id, item, 0, 2)
				notes.add(err)
			} else {
				if round%3 == 2 {
					time.Sleep(15 * time.Millisecond)
				}

				err = raceCancel(svc, id)
				cancels.add(err)
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

		if cancels.got[0] != 1 || cancels.got[connect.CodeFailedPrecondition] != 3 {
			t.Fatalf("round %d: cancels = %v, want exactly 1 and 3 refused", round, cancels.got)
		}

		won := notes.got[0]
		if won+notes.got[connect.CodeFailedPrecondition] != 4 {
			t.Fatalf("round %d: notes = %v, want each written or refused", round, notes.got)
		}

		notesWon[won]++

		if n := notesBefore(t, round, raceTrail(t, h.DB(), id), models.CustomShipmentCancelled); n != won {
			t.Fatalf("round %d: %d notes on the trail, %d won", round, n, won)
		}

		gone := uint64(0)
		if won > 0 {
			gone = 2
		}

		offered := raceOffered(t, svc, line)
		if offered == nil || offered.GetNotFound() != gone || offered.GetAlreadySent() != 0 || offered.GetBroken() != 3 {
			t.Fatalf("round %d: %d notes won, the line is offered %+v — want 3 broken, %d noted gone", round, won, offered, gone)
		}
	}

	t.Logf("notes written before the cancel, per round: %v (k notes → rounds)", notesWon)
}

// ⚠ THE TEAM CANCELS A NOTED RESHIP AND SENDS ITS UNITS AGAIN AT ONCE. A reship of a line's 3 broken units, 2 of them
// noted gone; then, together, its cancel and 7 new reships of 1 unit each. A new reship judged before the cancel sees
// all 3 on the live parcel (refused); one judged after sees 3 − 2 gone = 1 free — so AT MOST ONE is created, never a
// gone unit sent again, whatever the order: the restock row's lock queues the creates and each judges what the cancel
// committed. Every refusal is FailedPrecondition; nobody deadlocks. ×12 rounds, the cancel staggered among the creates.
func TestRace_CustomShipmentMissing_CancelThenReshipOfTheNamedUnits(t *testing.T) {
	h := san_race.New(t, customShipmentRaceTables...)
	svc := raceService(h.DB())
	rack := newRack(t, svc, raceWarehouse, "rak-a")

	createdPerRound := map[int]int{}

	for round := range 12 {
		restockID, line := raceBrokenRestock(t, svc, rack, 3)
		id := raceReshipID(t, svc, fmt.Sprintf("noted-%d", round), restockID, line, 3)
		item, _ := raceLineAndRack(t, h.DB(), id)

		err := raceMissing(svc, id, item, 0, 2)
		if err != nil {
			t.Fatalf("round %d: note: %v", round, err)
		}

		var cancels, creates codes

		res := h.Race(t, 8, func(i int) error {
			var err error

			if i == 0 {
				// Stagger the cancel by turns — before, among and well after the creates.
				time.Sleep([]time.Duration{0, 25, 400}[round%3] * time.Millisecond)

				err = raceCancel(svc, id)
				cancels.add(err)
			} else {
				err = raceReship(svc, fmt.Sprintf("again-%d-%d", round, i), restockID, line, 1)
				creates.add(err)
			}

			if connect.CodeOf(err) == connect.CodeFailedPrecondition && i != 0 {
				return nil // no broken unit left to send — the right answer
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

		won := creates.got[0]
		if won > 1 || won+creates.got[connect.CodeFailedPrecondition] != 7 {
			t.Fatalf("round %d: new reships = %v, want at most 1 created and the rest refused", round, creates.got)
		}

		createdPerRound[won]++

		if live := raceLiveReshipUnits(t, h.DB(), line); live != int64(won) {
			t.Fatalf("round %d: live reships carry %d, want %d — the 2 noted gone are never sent again", round, live, won)
		}
	}

	t.Logf("new reships created per round: %v (k → rounds)", createdPerRound)
}
