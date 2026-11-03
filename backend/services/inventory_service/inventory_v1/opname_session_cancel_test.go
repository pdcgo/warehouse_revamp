package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// An abandoned count is cancelled by the admin: its rows are released — the shelf moves again — nothing is posted, and
// what was counted stays for the record. A count that is no longer active cannot be cancelled.
func TestOpnameSessionCancel_ReleasesAndPostsNothing(t *testing.T) {
	f := opnameStocked(t)
	s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosHitam, 0)

	f.countRow(t, opAni, s.GetId(), otKaosHitam, f.rakA, 2, 0)

	cancel := func() error {
		_, err := f.svc.OpnameSessionCancel(opAdmin(opBudi), connect.NewRequest(&inventoryv1.OpnameSessionCancelRequest{
			TeamId: otWarehouse, SessionId: s.GetId(),
		}))

		return err
	}

	err := cancel()
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	err = f.moveOne(otKaosHitam, f.rakA, f.rakB)
	if err != nil {
		t.Fatalf("a move after the cancel: %v", err)
	}

	if n := countTransactions(f.db, models.TxProblem); n != 0 {
		t.Fatalf("a cancelled count posted %d problem transactions", n)
	}

	if r := f.row(t, s.GetId(), otKaosHitam, f.rakA); r.GetRecountedStockCount() != 2 || len(r.GetDrafts()) != 1 {
		t.Fatalf("row %+v, want its count and its lost draft kept for the record", r)
	}

	err = cancel()
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("cancel twice: err = %v, want FailedPrecondition", err)
	}
}
