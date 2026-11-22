//go:build raceaudit

// Concurrency audit for the restock resolutions (backlog #101 P1, the audit-sql skill): two people recording resolutions
// on one restock in the same second, a double-tapped form, two people settling it at once, a settle racing an inbound
// parcel's Terima that reopens the restock, and two Terima of one parcel.
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS.
//
//	go test -tags raceaudit -p 1 -run "TestRace_RestockResolution" -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// resolutionRaceTables is the custom shipments' tables with the resolutions and their links first (children first).
var resolutionRaceTables = append([]string{"restock_custom_shipments", "restock_resolutions"}, customShipmentRaceTables...)

func raceRefund(svc *inventory_v1.Service, restockID uint64, key string) error {
	_, err := svc.RestockResolutionCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockResolutionCreateRequest{
		TeamId: raceOwner, RestockId: restockID, Type: inventoryv1.RestockResolutionType_RESTOCK_RESOLUTION_TYPE_REFUND,
		RefundAmount: 1000, FinanceAccountId: 7, IdempotencyKey: key,
	}))

	return err
}

func raceSettle(svc *inventory_v1.Service, restockID uint64) error {
	_, err := svc.RestockRequestSettle(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestSettleRequest{
		TeamId: raceOwner, RequestId: restockID,
	}))

	return err
}

// raceInbound commits a reshipping of 3 product A on the restock and returns its parcel's id and line.
func raceInbound(t *testing.T, svc *inventory_v1.Service, restockID uint64, key string) (uint64, uint64) {
	t.Helper()

	res, err := svc.RestockResolutionCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockResolutionCreateRequest{
		TeamId: raceOwner, RestockId: restockID, Type: inventoryv1.RestockResolutionType_RESTOCK_RESOLUTION_TYPE_RESHIPPING,
		Reshipping: &inventoryv1.RestockReshippingParcel{
			ShipmentChannelId: 9,
			Lines:             []*inventoryv1.RestockReshippingLine{{ProductId: raceProductA, Count: 3, PriceUnit: 1000}},
		},
		IdempotencyKey: key,
	}))
	if err != nil {
		t.Fatalf("reshipping: %v", err)
	}

	cs := res.Msg.GetCustomShipment()

	return cs.GetId(), cs.GetItems()[0].GetId()
}

func raceReceive(svc *inventory_v1.Service, parcelID, itemID, received, rack uint64) error {
	_, err := svc.CustomShipmentReceive(context.Background(), connect.NewRequest(&inventoryv1.CustomShipmentReceiveRequest{
		TeamId: raceWarehouse, Id: parcelID,
		Lines: []*inventoryv1.CustomShipmentReceivedLine{{ItemId: itemID, Received: received, RackId: rack}},
	}))

	return err
}

// raceSettledAndTags is a restock's settled mark and how many problem tags it carries, as committed.
func raceSettledAndTags(t *testing.T, db *gorm.DB, restockID uint64) (bool, int64) {
	t.Helper()

	var settled bool

	err := db.Raw(`SELECT settled_at IS NOT NULL FROM restocks WHERE id = ?`, restockID).Scan(&settled).Error
	if err != nil {
		t.Fatalf("read the settled mark: %v", err)
	}

	var tags int64

	err = db.Raw(`SELECT COUNT(*) FROM restock_tags rt JOIN tags t ON t.id = rt.tag_id
	              WHERE rt.restock_id = ? AND t.app_task <> ''`, restockID).Scan(&tags).Error
	if err != nil {
		t.Fatalf("read the problem tags: %v", err)
	}

	return settled, tags
}

// ⚠ TWO PEOPLE RECORD RESOLUTIONS AT ONCE, AND A FORM IS DOUBLE-TAPPED. A broken restock; 8 callers each record a refund
// under their own key and 4 more reuse ONE key: the 8 all land (nothing lost under the restock row's lock), the shared
// key lands ONCE and the other three are AlreadyExists. Then 8 callers settle it: exactly one wins, seven
// FailedPrecondition. Nobody deadlocks. ×4 rounds.
func TestRace_RestockResolution_ConcurrentRowsAndOneSettle(t *testing.T) {
	h := san_race.New(t, resolutionRaceTables...)
	svc := raceService(h.DB())
	rack := newRack(t, svc, raceWarehouse, "rak-a")

	for round := range 4 {
		restockID, _ := raceBrokenRestock(t, svc, rack, 3)

		var c codes

		res := h.Race(t, 12, func(i int) error {
			key := fmt.Sprintf("own-%d", i)
			if i >= 8 {
				key = "shared"
			}

			err := raceRefund(svc, restockID, key)
			c.add(err)

			if connect.CodeOf(err) == connect.CodeAlreadyExists {
				return nil
			}

			return err
		})
		res.Report(t)

		if n := res.Count(san_race.Deadlock); n != 0 {
			t.Fatalf("round %d: %d callers deadlocked", round, n)
		}

		if c.got[0] != 9 || c.got[connect.CodeAlreadyExists] != 3 {
			t.Fatalf("round %d: outcomes %v, want 9 recorded and 3 AlreadyExists", round, c.got)
		}

		var rows int64
		h.DB().Raw(`SELECT COUNT(*) FROM restock_resolutions WHERE restock_id = ?`, restockID).Scan(&rows)

		if rows != 9 {
			t.Fatalf("round %d: %d rows, want 9", round, rows)
		}

		var settles codes

		res = h.Race(t, 8, func(int) error {
			err := raceSettle(svc, restockID)
			settles.add(err)

			if connect.CodeOf(err) == connect.CodeFailedPrecondition {
				return nil
			}

			return err
		})
		res.Report(t)

		if settles.got[0] != 1 || settles.got[connect.CodeFailedPrecondition] != 7 {
			t.Fatalf("round %d: settles %v, want exactly one", round, settles.got)
		}

		if settled, tags := raceSettledAndTags(t, h.DB(), restockID); !settled || tags != 0 {
			t.Fatalf("round %d: settled %v with %d problem tags", round, settled, tags)
		}
	}
}

// ⚠ A SETTLE RACES A RESHIPPING'S SHORT TERIMA (a-restock-problem-is-settled-by-resolution-rows, 🔄 A: a late shortfall
// reopens it). Both take the restock row's lock first, so they are judged one after the other: settle-then-Terima leaves
// it REOPENED (unsettled, tags back on); Terima-then-settle leaves it SETTLED (tags off). Never a settled restock still
// carrying a problem tag, never an unsettled one with none. Nobody deadlocks. ×12 rounds, staggered so both orders hit.
func TestRace_RestockResolution_SettleVsAReopeningTerima(t *testing.T) {
	h := san_race.New(t, resolutionRaceTables...)
	svc := raceService(h.DB())
	rack := newRack(t, svc, raceWarehouse, "rak-a")

	settledWins, reopenedWins := 0, 0

	for round := range 12 {
		restockID, _ := raceBrokenRestock(t, svc, rack, 3)
		parcelID, itemID := raceInbound(t, svc, restockID, fmt.Sprintf("reship-%d", round))

		res := h.Race(t, 2, func(i int) error {
			if i == 0 {
				// Staggered by rounds so both orders are hit: Terima reads its parcel before it locks, so an
				// unstaggered settle nearly always takes the restock row first.
				time.Sleep(time.Duration(round%3) * 4 * time.Millisecond)

				return raceSettle(svc, restockID)
			}

			return raceReceive(svc, parcelID, itemID, 2, rack)
		})
		res.Report(t)

		if res.Failed() != 0 {
			t.Fatalf("round %d: %d callers failed — both acts are allowed in either order", round, res.Failed())
		}

		settled, tags := raceSettledAndTags(t, h.DB(), restockID)

		switch {
		case settled && tags == 0:
			settledWins++
		case !settled && tags > 0:
			reopenedWins++
		default:
			t.Fatalf("round %d: settled %v with %d problem tags — a lost update", round, settled, tags)
		}
	}

	t.Logf("over 12 rounds: settled last %d, reopened last %d", settledWins, reopenedWins)
}

// ⚠ TWO PEOPLE COUNT ONE INBOUND PARCEL IN. 8 callers Terima it: exactly one stock-in, seven FailedPrecondition — the
// units are on the shelf once. ×4 rounds.
func TestRace_RestockResolution_TerimaCountsOnce(t *testing.T) {
	h := san_race.New(t, resolutionRaceTables...)
	svc := raceService(h.DB())
	rack := newRack(t, svc, raceWarehouse, "rak-a")

	for round := range 4 {
		restockID, _ := raceBrokenRestock(t, svc, rack, 3)
		parcelID, itemID := raceInbound(t, svc, restockID, fmt.Sprintf("count-%d", round))

		before, _ := stockOf(t, h.DB(), raceProductA)

		var c codes

		res := h.Race(t, 8, func(int) error {
			err := raceReceive(svc, parcelID, itemID, 3, rack)
			c.add(err)

			if connect.CodeOf(err) == connect.CodeFailedPrecondition {
				return nil
			}

			return err
		})
		res.Report(t)

		if c.got[0] != 1 || c.got[connect.CodeFailedPrecondition] != 7 {
			t.Fatalf("round %d: outcomes %v, want exactly one count", round, c.got)
		}

		if after, racks := stockOf(t, h.DB(), raceProductA); after-before != 3 || racks != after {
			t.Fatalf("round %d: the batches moved %d (racks %d / batches %d), want 3", round, after-before, racks, after)
		}
	}

	verifyTakesAndUndos(t, h.DB())
}
