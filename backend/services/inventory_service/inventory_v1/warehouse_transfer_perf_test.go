//go:build perfaudit

package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A opens a transfer to B: one product and twenty — the out-leg is taken at create.
func TestPerf_WarehouseTransferCreate(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20))
	racks := []uint64{newRack(t, svc, wtA, "perf-a"), newRack(t, svc, wtA, "perf-b"), newRack(t, svc, wtA, "perf-c")}
	perfStock(t, db, wtA, 20, 10, 100, racks)

	counts := map[int]int{}

	for _, size := range []int{1, 20} {
		lines := make([]*inventoryv1.WarehouseTransferLine, 0, size)
		for _, product := range perfProducts(size) {
			lines = append(lines, wtLine(product, 1))
		}

		counts[size] = perfRun(t, db, probe, "WarehouseTransferCreate", size, func(int) error {
			_, err := svc.WarehouseTransferCreate(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
				TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtB, Lines: lines, Note: "perf",
			}))

			return err
		})
	}

	t.Logf("WarehouseTransferCreate queries: 1 line=%d, 20 lines=%d", counts[1], counts[20])
}

// B counts the box in: one product and twenty, each line minted per source layer. The transfers are opened, processed
// and shipped before the timer starts.
func TestPerf_WarehouseTransferAccept(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20))
	racks := []uint64{newRack(t, svc, wtA, "perf-a"), newRack(t, svc, wtA, "perf-b"), newRack(t, svc, wtA, "perf-c")}
	perfStock(t, db, wtA, 20, 10, 100, racks)
	atB := newRack(t, svc, wtB, "perf-b1")

	counts := map[int]int{}

	for _, size := range []int{1, 20} {
		lines := make([]*inventoryv1.WarehouseTransferLine, 0, size)
		for _, product := range perfProducts(size) {
			// 3 a line, so a line crosses a layer boundary now and then and mints more than one batch at B.
			lines = append(lines, wtLine(product, 3))
		}

		shipped := make([]*inventoryv1.WarehouseTransfer, 0, 6)

		for range 6 {
			created, err := svc.WarehouseTransferCreate(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
				TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtB, Lines: lines, Note: "perf",
			}))
			if err != nil {
				t.Fatalf("create: %v", err)
			}

			id := created.Msg.GetTransfer().GetId()

			_, err = svc.WarehouseTransferProcess(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.WarehouseTransferProcessRequest{
				TeamId: wtA, TransferId: id,
			}))
			if err != nil {
				t.Fatalf("process: %v", err)
			}

			_, err = svc.WarehouseTransferShip(ctxUser(wtStaffA), connect.NewRequest(&inventoryv1.WarehouseTransferShipRequest{
				TeamId: wtA, TransferId: id,
			}))
			if err != nil {
				t.Fatalf("ship: %v", err)
			}

			shipped = append(shipped, created.Msg.GetTransfer())
		}

		counts[size] = perfRun(t, db, probe, "WarehouseTransferAccept", size, func(run int) error {
			tr := shipped[run]

			countedLines := make([]*inventoryv1.WarehouseTransferCountedLine, 0, size)
			for _, item := range tr.GetItems() {
				countedLines = append(countedLines, counted(item, 3, 1, atB))
			}

			_, err := svc.WarehouseTransferAccept(ctxUser(wtStaffB), connect.NewRequest(&inventoryv1.WarehouseTransferAcceptRequest{
				TeamId: wtB, TransferId: tr.GetId(), Lines: countedLines,
			}))

			return err
		})
	}

	t.Logf("WarehouseTransferAccept queries: 1 line=%d, 20 lines=%d", counts[1], counts[20])
}
