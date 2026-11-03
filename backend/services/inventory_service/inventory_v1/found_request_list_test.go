package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
)

// THE FOUND STOCK LIST (an-adjust-found-waits-for-the-owner-or-admin): newest first, paged, one status or all; a waiting
// request says what approving would post now and why THIS caller may not; an approved one what it posted; staff read
// only their own (staff-may-report-a-found, the-reporter-may-withdraw-their-found).

func TestFoundRequestList_NewestFirstFilteredAndPaged(t *testing.T) {
	f := opnameStocked(t)

	approved := f.mustReport(t, opStaff(opAni), otKaosHitam, f.rakA, 1)
	rejected := f.mustReport(t, opStaff(opAni), otKaosHitam, f.rakB, 1)
	waiting := f.mustReport(t, opStaff(opDodi), otKaosHitam, f.rakC, 2)

	_, err := f.approve(opAdmin(opBudi), approved.GetId())
	if err != nil {
		t.Fatalf("approve: %v", err)
	}

	_, err = f.reject(opAdmin(opBudi), rejected.GetId(), "a parcel")
	if err != nil {
		t.Fatalf("reject: %v", err)
	}

	all := f.foundList(t, opAdmin(opBudi), inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_UNSPECIFIED)
	if len(all) != 3 || all[0].GetId() != waiting.GetId() || all[2].GetId() != approved.GetId() {
		t.Fatalf("all %v, want the three newest first", all)
	}

	only := f.foundList(t, opAdmin(opBudi), inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_WAITING)
	if len(only) != 1 || only[0].GetId() != waiting.GetId() ||
		only[0].GetBlock() != inventoryv1.FoundRequestApproveBlock_FOUND_REQUEST_APPROVE_BLOCK_UNSPECIFIED {
		t.Fatalf("waiting %v, want Dodi's, approvable by Budi", only)
	}

	// An approved request keeps what it posted: nothing to claim, so one mint at Rp 12.000 into the batch it made.
	done := f.foundList(t, opAdmin(opBudi), inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_APPROVED)
	if len(done) != 1 || len(done[0].GetLines()) != 1 || done[0].GetLines()[0].GetBatchId() == 0 ||
		!san_money.Equal(done[0].GetMintedAmount(), 12000) || done[0].GetTransactionId() == 0 ||
		done[0].GetBlock() != inventoryv1.FoundRequestApproveBlock_FOUND_REQUEST_APPROVE_BLOCK_NOT_WAITING {
		t.Fatalf("approved %+v, want its posted mint and transaction", done)
	}

	res, err := f.svc.FoundRequestList(opAdmin(opBudi), connect.NewRequest(&inventoryv1.FoundRequestListRequest{
		TeamId: otWarehouse, Page: &commonv1.CommonPagination{Page: 1, Limit: 2},
		DataRequest: []inventoryv1.FoundRequestListDataType{inventoryv1.FoundRequestListDataType_FOUND_REQUEST_LIST_DATA_TYPE_GENERAL},
	}))
	if err != nil {
		t.Fatalf("page: %v", err)
	}

	if len(res.Msg.GetIds()) != 2 || res.Msg.GetPageInfo().GetTotalItems() != 3 || res.Msg.GetPageInfo().GetTotalPage() != 2 {
		t.Fatalf("page 1 of 2: ids %v, info %+v", res.Msg.GetIds(), res.Msg.GetPageInfo())
	}
}

// STAFF READ ONLY THEIR OWN — filtered by the server — and may not approve any.
func TestFoundRequestList_StaffSeeOnlyTheirOwn(t *testing.T) {
	f := opnameStocked(t)
	anis := f.mustReport(t, opStaff(opAni), otKaosHitam, f.rakA, 1)
	f.mustReport(t, opStaff(opDodi), otKaosHitam, f.rakB, 1)
	f.mustReport(t, opAdmin(opBudi), otKaosHitam, f.rakC, 1)

	mine := f.foundList(t, opStaff(opAni), inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_UNSPECIFIED)
	if len(mine) != 1 || mine[0].GetId() != anis.GetId() ||
		mine[0].GetBlock() != inventoryv1.FoundRequestApproveBlock_FOUND_REQUEST_APPROVE_BLOCK_OWN_REPORT {
		t.Fatalf("Ani reads %v, want only her own", mine)
	}

	if all := f.foundList(t, opAdmin(opBudi), inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_UNSPECIFIED); len(all) != 3 {
		t.Fatalf("Budi reads %d, want all 3", len(all))
	}
}

// THE BLOCK IS PER CALLER: the reporter's own, a count holding the rack (naming it), and a request settled by a count —
// which names that count too (a-count-settles-the-found-it-counted).
func TestFoundRequestList_BlocksPerCallerAndTheSettled(t *testing.T) {
	f := opnameStocked(t)
	held := f.mustReport(t, opAdmin(opBudi), otKaosHitam, f.rakB, 2)
	s := countKaosHitam(t, f)

	listed := f.foundList(t, opAdmin(opBudi), inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_WAITING)
	if len(listed) != 1 || listed[0].GetBlock() != inventoryv1.FoundRequestApproveBlock_FOUND_REQUEST_APPROVE_BLOCK_OWN_REPORT {
		t.Fatalf("Budi reads %v, want OWN_REPORT before the count", listed)
	}

	listed = f.foundList(t, opOwner(opDewi), inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_WAITING)
	if len(listed) != 1 || listed[0].GetBlock() != inventoryv1.FoundRequestApproveBlock_FOUND_REQUEST_APPROVE_BLOCK_BEING_COUNTED ||
		listed[0].GetCountingSessionId() != s.GetId() {
		t.Fatalf("Dewi reads %v, want BEING_COUNTED by count #%d", listed, s.GetId())
	}

	f.countRow(t, opAni, s.GetId(), otKaosHitam, f.rakA, 5, 0)
	f.countRow(t, opAni, s.GetId(), otKaosHitam, f.rakB, 7, 0)

	_, err := f.finalize(opOwner(opDewi), s.GetId())
	if err != nil {
		t.Fatalf("finalize: %v", err)
	}

	settled := f.foundList(t, opOwner(opDewi), inventoryv1.FoundRequestStatus_FOUND_REQUEST_STATUS_SETTLED_BY_COUNT)
	if len(settled) != 1 || settled[0].GetId() != held.GetId() || settled[0].GetSettledByCountingSessionId() != s.GetId() ||
		settled[0].GetDecidedById() != opDewi || len(settled[0].GetLines()) != 0 ||
		settled[0].GetBlock() != inventoryv1.FoundRequestApproveBlock_FOUND_REQUEST_APPROVE_BLOCK_NOT_WAITING {
		t.Fatalf("settled %v, want Budi's, settled by count #%d, decided by Dewi, posting nothing", settled, s.GetId())
	}
}
