//go:build perfaudit

package inventory_v1_test

import (
	"fmt"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE CUSTOM SHIPMENT'S MOVES AT VOLUME (backlog #88 P3), beside the ledger background (50 000 takes, 10 000 accepted
// restocks) and the custom-shipment background (30 000 parcels in every status). Each move acts on a parcel of its own
// per run — perfRun's warm-up and five measured runs — made before the probe is reset.

// perfMoveSamples creates n team-paid samples of `lines` products, 1 unit each, and returns their ids.
func perfMoveSamples(t *testing.T, svc *inventory_v1.Service, key string, n, lines int) []uint64 {
	t.Helper()

	want := make([]*inventoryv1.CustomShipmentLine, 0, lines)
	for _, product := range perfProducts(lines) {
		want = append(want, csProduct(product, 1))
	}

	ids := make([]uint64, 0, n)

	for i := range n {
		res, err := svc.CustomShipmentCreate(ctxUser(wtSeller), connect.NewRequest(csSample(fmt.Sprintf("%s-%d", key, i), want...)))
		if err != nil {
			t.Fatalf("create %s %d: %v", key, i, err)
		}

		ids = append(ids, res.Msg.GetCustomShipment().GetId())
	}

	return ids
}

func perfMovesSetup(t *testing.T) (*inventory_v1.Service, func(name string, size int, call func(run int) error) int) {
	t.Helper()

	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)
	perfCustomShipmentBackground(t, db)

	svc := perfCustomShipmentService(db)
	racks := []uint64{newRack(t, svc, wtA, "perf-a"), newRack(t, svc, wtA, "perf-b"), newRack(t, svc, wtA, "perf-c")}
	perfStock(t, db, wtA, 20, 10, 100, racks)

	return svc, func(name string, size int, call func(run int) error) int {
		return perfRun(t, db, probe, name, size, call)
	}
}

// *Ubah Ongkir*: the parcel row's lock, the edit, its trail row; the detail read back.
func TestPerf_CustomShipmentCostSet(t *testing.T) {
	svc, run := perfMovesSetup(t)
	ids := perfMoveSamples(t, svc, "perf-cost", 6, 1)

	count := run("CustomShipmentCostSet", 1, func(r int) error {
		_, err := svc.CustomShipmentCostSet(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.CustomShipmentCostSetRequest{
			TeamId: otMelati, Id: ids[r], FinanceAccountId: wtAccount, ShippingCost: 20000,
		}))

		return err
	})

	t.Logf("CustomShipmentCostSet queries=%d", count)
}

// The warehouse's two steps: the parcel row's lock, the move, its trail row; the detail read back as the warehouse.
func TestPerf_CustomShipmentPickedAndHandover(t *testing.T) {
	svc, run := perfMovesSetup(t)
	toPick := perfMoveSamples(t, svc, "perf-pick", 6, 1)
	toHand := perfMoveSamples(t, svc, "perf-hand", 6, 1)

	for _, id := range toHand {
		_, err := svc.CustomShipmentPicked(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.CustomShipmentPickedRequest{TeamId: wtA, Id: id}))
		if err != nil {
			t.Fatalf("pick: %v", err)
		}
	}

	picked := run("CustomShipmentPicked", 1, func(r int) error {
		_, err := svc.CustomShipmentPicked(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.CustomShipmentPickedRequest{
			TeamId: wtA, Id: toPick[r],
		}))

		return err
	})

	handed := run("CustomShipmentHandover", 1, func(r int) error {
		_, err := svc.CustomShipmentHandover(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.CustomShipmentHandoverRequest{
			TeamId: wtA, Id: toHand[r], Resi: "JNE-PERF",
		}))

		return err
	})

	t.Logf("CustomShipmentPicked queries=%d, CustomShipmentHandover queries=%d", picked, handed)
}

// A sample's cancel of one line and of twenty: the parcel row, the take's row, the batches and racks it wrote put back,
// the stock reports — the transfer cancel's shape.
func TestPerf_CustomShipmentCancel_Sample(t *testing.T) {
	svc, run := perfMovesSetup(t)
	counts := map[int]int{}

	for _, size := range []int{1, 20} {
		ids := perfMoveSamples(t, svc, fmt.Sprintf("perf-cancel-%d", size), 6, size)

		counts[size] = run("CustomShipmentCancel(sample)", size, func(r int) error {
			_, err := svc.CustomShipmentCancel(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.CustomShipmentCancelRequest{
				TeamId: otMelati, Id: ids[r],
			}))

			return err
		})
	}

	t.Logf("CustomShipmentCancel(sample) queries: 1 line=%d, 20 lines=%d", counts[1], counts[20])
}

// A reship's cancel: the parcel row and its move — no ledger.
func TestPerf_CustomShipmentCancel_Reship(t *testing.T) {
	svc, run := perfMovesSetup(t)
	rack := newRack(t, svc, wtA, "perf-r")

	restock := csRestock(t, svc, otMelati, &inventoryv1.RestockRequestItem{
		ProductId: perfProducts(1)[0], ProductCode: "PERF", Name: "Perf", Count: 20, Total: 20000,
	})

	_, err := svc.RestockRequestAccept(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: wtA, RequestId: restock.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId: restock.GetItems()[0].GetId(), ReceivedCount: 20, BrokenCount: 10, Placements: placedOn(rack, 10),
		}},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	ids := make([]uint64, 0, 6)

	for i := range 6 {
		res, createErr := svc.CustomShipmentCreate(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.CustomShipmentCreateRequest{
			TeamId: otMelati, Kind: inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_RESTOCK_RESHIP,
			RestockId:         restock.GetId(),
			Lines:             []*inventoryv1.CustomShipmentLine{csRestockLine(restock.GetItems()[0].GetId(), 1)},
			Recipient:         &inventoryv1.CustomShipmentRecipient{Name: "Supplier", Phone: "1", Address: "x"},
			ShipmentChannelId: csCourier,
			Payer:             inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_WAREHOUSE,
			IdempotencyKey:    fmt.Sprintf("perf-reship-%d", i),
		}))
		if createErr != nil {
			t.Fatalf("reship %d: %v", i, createErr)
		}

		ids = append(ids, res.Msg.GetCustomShipment().GetId())
	}

	count := run("CustomShipmentCancel(reship)", 1, func(r int) error {
		_, cancelErr := svc.CustomShipmentCancel(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.CustomShipmentCancelRequest{
			TeamId: otMelati, Id: ids[r],
		}))

		return cancelErr
	})

	t.Logf("CustomShipmentCancel(reship) queries=%d", count)
}
