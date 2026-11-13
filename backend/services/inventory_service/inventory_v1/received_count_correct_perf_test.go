//go:build perfaudit

package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// KOREKSI JUMLAH TERIMA against the ledgers' background volume (50 000 batches and their logs): a restock of one line
// and of twenty, accepted 50 of 100 a line onto one rack, then corrected — each run flips every line one unit (out,
// then back in), from the count the last run left. The write is the restock's lock, then per correction a fixed set of
// statements — whatever the line count — plus the detail it answers with.
func TestPerf_RestockReceivedCountCorrect(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20), nil, nil)
	rack := newRack(t, svc, otWarehouse, "perf-shelf")
	owner := ctxAs(70, otWarehouse, role_basev1.Role_ROLE_WAREHOUSE_OWNER)

	counts := map[int]int{}

	for _, size := range []int{1, 20} {
		items := make([]*inventoryv1.RestockRequestItem, 0, size)
		for _, product := range perfProducts(size) {
			items = append(items, &inventoryv1.RestockRequestItem{
				ProductId: product, ProductCode: "PERF", Name: "Perf product", Count: 100, Total: 100000,
			})
		}

		created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: otMelati, WarehouseId: otWarehouse, Items: items,
		}))
		if err != nil {
			t.Fatalf("create: %v", err)
		}

		restock := created.Msg.GetRequest()
		received := make([]*inventoryv1.RestockRequestReceivedLine, 0, size)

		for _, item := range restock.GetItems() {
			received = append(received, &inventoryv1.RestockRequestReceivedLine{
				ItemId: item.GetId(), ReceivedCount: 50, Placements: placedOn(rack, 50),
			})
		}

		_, err = svc.RestockRequestAccept(ctxUser(7), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
			TeamId: otWarehouse, RequestId: restock.GetId(), Lines: received,
		}))
		if err != nil {
			t.Fatalf("accept: %v", err)
		}

		now := int64(50)

		counts[size] = perfRun(t, db, probe, "RestockReceivedCountCorrect", size, func(run int) error {
			to := now - 1
			if run%2 == 1 {
				to = now + 1
			}

			lines := make([]*inventoryv1.ReceivedCountLine, 0, size)
			for _, item := range restock.GetItems() {
				lines = append(lines, &inventoryv1.ReceivedCountLine{
					ItemId: item.GetId(), ExpectedReceivedCount: now, ReceivedCount: to, PlacementId: rack,
				})
			}

			_, callErr := svc.RestockReceivedCountCorrect(owner, connect.NewRequest(&inventoryv1.RestockReceivedCountCorrectRequest{
				TeamId: otWarehouse, RequestId: restock.GetId(), Reason: "perf", Lines: lines,
			}))
			if callErr == nil {
				now = to
			}

			return callErr
		})
	}

	t.Logf("RestockReceivedCountCorrect queries: 1 line=%d, 20 lines=%d", counts[1], counts[20])
}

// The same on a transfer: one product and twenty, 6 sent a line from ten layers of 100 and accepted whole at B — so a
// line's correction walks its layers — then flipped one unit a run.
func TestPerf_WarehouseTransferReceivedCountCorrect(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20), nil, nil)
	racks := []uint64{newRack(t, svc, wtA, "perf-a"), newRack(t, svc, wtA, "perf-b"), newRack(t, svc, wtA, "perf-c")}
	perfStock(t, db, wtA, 20, 10, 100, racks)
	atB := newRack(t, svc, wtB, "perf-b1")
	owner := ctxAs(71, wtB, role_basev1.Role_ROLE_WAREHOUSE_OWNER)

	counts := map[int]int{}

	for _, size := range []int{1, 20} {
		lines := make([]*inventoryv1.WarehouseTransferLine, 0, size)
		for _, product := range perfProducts(size) {
			lines = append(lines, wtLine(product, 6))
		}

		created, err := svc.WarehouseTransferCreate(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
			TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtB, Lines: lines, Note: "perf",
		}))
		if err != nil {
			t.Fatalf("create: %v", err)
		}

		tr := created.Msg.GetTransfer()

		_, err = svc.WarehouseTransferProcess(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.WarehouseTransferProcessRequest{
			TeamId: wtA, TransferId: tr.GetId(),
		}))
		if err != nil {
			t.Fatalf("process: %v", err)
		}

		_, err = svc.WarehouseTransferShip(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.WarehouseTransferShipRequest{
			TeamId: wtA, TransferId: tr.GetId(),
		}))
		if err != nil {
			t.Fatalf("ship: %v", err)
		}

		countedLines := make([]*inventoryv1.WarehouseTransferCountedLine, 0, size)
		for _, item := range tr.GetItems() {
			countedLines = append(countedLines, counted(item, 6, 0, atB))
		}

		_, err = svc.WarehouseTransferAccept(ctxUser(wtStaffB), connect.NewRequest(&inventoryv1.WarehouseTransferAcceptRequest{
			TeamId: wtB, TransferId: tr.GetId(), Lines: countedLines,
		}))
		if err != nil {
			t.Fatalf("accept: %v", err)
		}

		now := int64(6)

		counts[size] = perfRun(t, db, probe, "WarehouseTransferReceivedCountCorrect", size, func(run int) error {
			to := now - 1
			if run%2 == 1 {
				to = now + 1
			}

			correct := make([]*inventoryv1.ReceivedCountLine, 0, size)
			for _, item := range tr.GetItems() {
				correct = append(correct, &inventoryv1.ReceivedCountLine{
					ItemId: item.GetId(), ExpectedReceivedCount: now, ReceivedCount: to, PlacementId: atB,
				})
			}

			_, callErr := svc.WarehouseTransferReceivedCountCorrect(owner, connect.NewRequest(&inventoryv1.WarehouseTransferReceivedCountCorrectRequest{
				TeamId: wtB, TransferId: tr.GetId(), Reason: "perf", Lines: correct,
			}))
			if callErr == nil {
				now = to
			}

			return callErr
		})
	}

	t.Logf("WarehouseTransferReceivedCountCorrect queries: 1 line=%d, 20 lines=%d", counts[1], counts[20])
}
