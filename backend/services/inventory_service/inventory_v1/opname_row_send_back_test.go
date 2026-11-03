package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// "Recount Rak A": a counted row goes back to created, its count, counter and drafts cleared — and only a counted row.
func TestOpnameRowSendBack_ClearsTheRowAndItsDrafts(t *testing.T) {
	f := opnameStocked(t)
	s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosHitam, 0)
	r := f.row(t, s.GetId(), otKaosHitam, f.rakA)

	sendBack := func() (*inventoryv1.OpnameRow, error) {
		res, err := f.svc.OpnameRowSendBack(opAdmin(opBudi), connect.NewRequest(&inventoryv1.OpnameRowSendBackRequest{
			TeamId: otWarehouse, RowId: r.GetId(),
		}))
		if err != nil {
			return nil, err
		}

		return res.Msg.GetRow(), nil
	}

	_, err := sendBack()
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("an uncounted row: err = %v, want FailedPrecondition", err)
	}

	f.countRow(t, opAni, s.GetId(), otKaosHitam, f.rakA, 3, 1)

	back, err := sendBack()
	if err != nil {
		t.Fatalf("send back: %v", err)
	}

	if back.GetStatus() != inventoryv1.OpnameRowStatus_OPNAME_ROW_STATUS_CREATED || back.GetRevealed() || back.GetCountedById() != 0 ||
		len(back.GetDrafts()) != 0 {
		t.Fatalf("row %+v, want created, blind again, no counter, no drafts", back)
	}

	var drafts int64
	f.db.Model(&models.OpnameProblemsDraft{}).Where("opname_session_id = ?", s.GetId()).Count(&drafts)
	if drafts != 0 {
		t.Fatalf("%d drafts survive the send back", drafts)
	}

	// Counted again, from scratch.
	_, err = f.count(opStaff(opDodi), r.GetId(), 5)
	if err != nil {
		t.Fatalf("count again: %v", err)
	}
}
