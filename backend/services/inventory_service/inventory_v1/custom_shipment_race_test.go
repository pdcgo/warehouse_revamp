//go:build raceaudit

// Concurrency audit for CustomShipmentCreate (the audit-sql skill, backlog #88 P1). The selling team's two people asking
// for parcels in the same second, and a parcel sample racing an order for the shelf's last units, are the normal case.
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS.
//
//	go test -tags raceaudit -p 1 -run "TestRace_CustomShipment" -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// customShipmentRaceTables is everything a parcel, a restock and the ledgers write — children first.
var customShipmentRaceTables = append([]string{
	"custom_shipment_missing_lines",
	"custom_shipment_logs",
	"custom_shipment_items",
	"custom_shipments",
	"restock_tags",
	"restock_count_corrections",
	"restock_log_changes",
	"restock_problem_items",
	"restock_logs",
	"restock_items",
	"restocks",
	"warehouse_products",
}, ledgerTables...)

// raceBrokenRestock commits a restock of 10 product A to Gudang 5, accepted with `broken` of them broken, and returns its
// id and its line.
func raceBrokenRestock(t *testing.T, svc *inventory_v1.Service, rack uint64, broken int64) (uint64, uint64) {
	t.Helper()

	created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: raceOwner, WarehouseId: raceWarehouse,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: raceProductA, ProductCode: "A", Name: "A", Count: 10, Total: 10000}},
	}))
	if err != nil {
		t.Fatalf("restock create: %v", err)
	}

	restock := created.Msg.GetRequest()
	item := restock.GetItems()[0]

	_, err = svc.RestockRequestAccept(ctxUser(7), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: raceWarehouse, RequestId: restock.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: item.GetId(), ReceivedCount: 10, BrokenCount: broken, Placements: placedOn(rack, 10-broken)},
		},
	}))
	if err != nil {
		t.Fatalf("restock accept: %v", err)
	}

	return restock.GetId(), item.GetId()
}

func raceReship(svc *inventory_v1.Service, key string, restockID, itemID uint64, quantity uint64) error {
	_, err := svc.CustomShipmentCreate(context.Background(), connect.NewRequest(&inventoryv1.CustomShipmentCreateRequest{
		TeamId: raceOwner, Kind: inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_RESTOCK_RESHIP, RestockId: restockID,
		Lines:             []*inventoryv1.CustomShipmentLine{{RestockItemId: itemID, Quantity: quantity}},
		Recipient:         &inventoryv1.CustomShipmentRecipient{Name: "Supplier", Phone: "1", Address: "x"},
		ShipmentChannelId: 9,
		Payer:             inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_WAREHOUSE,
		IdempotencyKey:    key,
	}))

	return err
}

func raceParcelSample(svc *inventory_v1.Service, key string, quantity uint64) error {
	_, err := svc.CustomShipmentCreate(context.Background(), connect.NewRequest(&inventoryv1.CustomShipmentCreateRequest{
		TeamId: raceOwner, Kind: inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_SAMPLE, WarehouseId: raceWarehouse,
		Lines:             []*inventoryv1.CustomShipmentLine{{ProductId: raceProductA, Quantity: quantity}},
		Recipient:         &inventoryv1.CustomShipmentRecipient{Name: "Budi", Phone: "1", Address: "x"},
		ShipmentChannelId: 9,
		Payer:             inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_WAREHOUSE,
		IdempotencyKey:    key,
	}))

	return err
}

// raceLiveReshipUnits is what live reships of a restock line carry.
func raceLiveReshipUnits(t *testing.T, db *gorm.DB, itemID uint64) int64 {
	t.Helper()

	var n int64

	err := db.Raw(`SELECT COALESCE(SUM(i.quantity), 0) FROM custom_shipment_items i
	               JOIN custom_shipments c ON c.id = i.custom_shipment_id
	               WHERE i.restock_item_id = ? AND c.status <> 'cancelled'`, itemID).Scan(&n).Error
	if err != nil {
		t.Fatalf("live reship units: %v", err)
	}

	return n
}

// ⚠ TWO PEOPLE SEND THE LAST BROKEN UNITS BACK AT ONCE. A line has 3 broken; 8 callers each reship 1 — exactly 3 are
// created and 5 refused, never 4 on the way back for 3 broken: the restock row's lock queues them and each judges the
// ones before it. Then 8 callers each want 2 of a fresh line of 3: exactly one wins. Nobody deadlocks. ×4 rounds each.
func TestRace_CustomShipmentReship_NeverSendsMoreThanTheBrokenUnits(t *testing.T) {
	h := san_race.New(t, customShipmentRaceTables...)
	svc := raceService(h.DB())
	rack := newRack(t, svc, raceWarehouse, "rak-a")

	for _, size := range []uint64{1, 2} {
		for round := range 4 {
			restockID, itemID := raceBrokenRestock(t, svc, rack, 3)

			var c codes

			res := h.Race(t, 8, func(i int) error {
				err := raceReship(svc, fmt.Sprintf("reship-%d-%d-%d", size, round, i), restockID, itemID, size)
				c.add(err)

				if connect.CodeOf(err) == connect.CodeFailedPrecondition {
					return nil // over the broken units left is the right answer, not a failure
				}

				return err
			})
			res.Report(t)

			if n := res.Count(san_race.Deadlock); n != 0 {
				t.Fatalf("size %d round %d: %d callers deadlocked", size, round, n)
			}

			wins := int(3 / size)
			if c.got[0] != wins || c.got[connect.CodeFailedPrecondition] != 8-wins {
				t.Fatalf("size %d round %d: outcomes = %v, want %d created and %d refused", size, round, c.got, wins, 8-wins)
			}

			if live := raceLiveReshipUnits(t, h.DB(), itemID); live != int64(wins)*int64(size) || live > 3 {
				t.Fatalf("size %d round %d: live reships carry %d of 3 broken units", size, round, live)
			}
		}
	}
}

// ⚠ A PARCEL SAMPLE AND AN ORDER RACE FOR THE SHELF'S LAST UNITS. 10 units; 16 callers each want 2 — half as a parcel
// sample, half as an order take. Exactly 5 win between them and 11 are refused for stock, nobody deadlocks (the sample
// takes the order's lock order: the team's batches, then racks, each by id), both ledgers end at 0, every take verifies,
// and every sample that won — and only those — has its parcel. ×4 rounds.
func TestRace_CustomShipmentSample_VsAnOrderForTheLastUnits(t *testing.T) {
	samplesWon, ordersWon := 0, 0

	for round := range 4 {
		// A fresh harness each round: it clears every table first, so each round starts from the same shelves.
		h := san_race.New(t, customShipmentRaceTables...)
		svc := raceService(h.DB())

		seedLedgers(t, h.DB(), 5, raceProductA)

		var samples, orders codes

		res := h.Race(t, 16, func(i int) error {
			var err error

			if i%2 == 0 {
				err = raceParcelSample(svc, fmt.Sprintf("sample-%d-%d", round, i), 2)
				samples.add(err)
			} else {
				err = raceTake(svc, fmt.Sprintf("order-%d-%d", round, i), &inventoryv1.OrderTransactionLine{ProductId: raceProductA, Quantity: 2})
				orders.add(err)
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

		won := samples.got[0] + orders.got[0]
		refused := samples.got[connect.CodeFailedPrecondition] + orders.got[connect.CodeFailedPrecondition]

		if won != 5 || refused != 11 {
			t.Fatalf("round %d: samples %v, orders %v — want 5 won and 11 refused between them", round, samples.got, orders.got)
		}

		samplesWon += samples.got[0]
		ordersWon += orders.got[0]

		if b, r := stockOf(t, h.DB(), raceProductA); b != 0 || r != 0 {
			t.Fatalf("round %d: the batches hold %d and the racks %d, want 0 and 0", round, b, r)
		}

		verifyEveryTransaction(t, h.DB())

		var parcels, takes int64
		h.DB().Raw(`SELECT COUNT(*) FROM custom_shipments`).Scan(&parcels)
		h.DB().Raw(`SELECT COUNT(*) FROM inventory_transactions WHERE tx_type = 'sample'`).Scan(&takes)

		if parcels != int64(samples.got[0]) || takes != parcels {
			t.Fatalf("round %d: %d parcels and %d sample takes for %d samples won", round, parcels, takes, samples.got[0])
		}

		var unlinked int64
		h.DB().Raw(`SELECT COUNT(*) FROM custom_shipments c
		            LEFT JOIN inventory_transactions t ON t.id = c.transaction_id AND t.tx_type = 'sample'
		            WHERE t.id IS NULL`).Scan(&unlinked)

		if unlinked != 0 {
			t.Fatalf("round %d: %d parcels without their sample take", round, unlinked)
		}
	}

	t.Logf("over 4 rounds the samples won %d and the orders %d of the 20 takes", samplesWon, ordersWon)
}
