package inventory_v1_test

import (
	"slices"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// *Tandai Selesai* (a-restock-problem-is-settled-by-resolution-rows, 🔄 B): the settled mark on the restock — who and
// when — and its problem tags off; once only. A settled restock still takes resolution rows and stays settled (🔄 A).
// Only what takes resolutions settles; the warehouse cannot (its team reads NotFound). Both sides read the mark.
func TestRestockRequestSettle_MarksItAndTakesTheProblemTagsOff(t *testing.T) {
	f := rsStocked(t)

	if tags := problemTagsOn(t, f.db, f.restock); !slices.Equal(tags, []string{"restock.problem.broken"}) {
		t.Fatalf("before: tags = %v, want Barang rusak", tags)
	}

	settled, err := f.settle(otMelati, f.restock)
	if err != nil {
		t.Fatalf("settle: %v", err)
	}

	if settled.GetSettledAtUnix() == 0 || settled.GetSettledByUserId() != wtSeller || settled.GetSettledByIsOverride() {
		t.Fatalf("settled = at %d by %d", settled.GetSettledAtUnix(), settled.GetSettledByUserId())
	}

	if tags := problemTagsOn(t, f.db, f.restock); len(tags) != 0 {
		t.Fatalf("after: tags = %v, want the problem tags off", tags)
	}

	for _, tag := range settled.GetTags() {
		if tag.GetType() == inventoryv1.RestockTagType_RESTOCK_TAG_TYPE_SYSTEM {
			t.Fatalf("the answer still carries %q", tag.GetName())
		}
	}

	_, err = f.settle(otMelati, f.restock)
	codeOf(t, "settled twice", err, connect.CodeFailedPrecondition)

	// A late refund still lands; the restock stays settled, its tags off.
	f.mustResolve(t, rsRefund(f.restock, "late-refund", 5000, accountPlain))

	after := f.restockAs(t, wtA, wtStaffA, f.restock)
	if after.GetSettledAtUnix() == 0 || after.GetResolutionCount() != 1 || len(problemTagsOn(t, f.db, f.restock)) != 0 {
		t.Fatalf("after a late refund: settled %d, rows %d", after.GetSettledAtUnix(), after.GetResolutionCount())
	}

	_, err = f.settle(wtA, f.restock)
	codeOf(t, "the warehouse settling", err, connect.CodeNotFound)

	_, err = f.settle(otMelati, f.ongoing)
	codeOf(t, "a restock on its way", err, connect.CodeFailedPrecondition)

	_, err = f.settle(otMelati, f.cleanRestock(t))
	codeOf(t, "a restock received whole", err, connect.CodeFailedPrecondition)
}

// The seller's lists (the-restock-resolutions-prototype-is-accepted): each row carries its resolution count and settled
// mark; a SETTLED lost restock leaves the Hilang tab (LOST + UNSETTLED) and stays under Semua; SETTLED / UNSETTLED
// narrow the statistics' and export's predicate alike (restockListScope).
func TestRestockRequestList_ReadsTheResolutionsAndTheSettledMark(t *testing.T) {
	f := rsStocked(t)
	lost := f.lostRestock(t)

	f.mustResolve(t, rsRefund(lost, "lost-refund", 1000, accountPlain))
	f.mustResolve(t, rsRefund(f.restock, "r1", 1000, accountPlain))
	f.mustResolve(t, rsRefund(f.restock, "r2", 2000, accountPlain))

	list := func(filter *inventoryv1.RestockRequestListFilter) map[uint64]*inventoryv1.RestockRequest {
		t.Helper()

		res, err := f.svc.RestockRequestList(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.RestockRequestListRequest{
			TeamId: otMelati, Filter: filter, Page: rsPage(),
			DataRequest: []inventoryv1.RestockRequestListDataType{inventoryv1.RestockRequestListDataType_RESTOCK_REQUEST_LIST_DATA_TYPE_RESTOCK_REQUEST},
		}))
		if err != nil {
			t.Fatalf("list: %v", err)
		}

		out := map[uint64]*inventoryv1.RestockRequest{}
		for _, item := range res.Msg.GetItems() {
			for id, r := range item.GetRestockRequest().GetMapData() {
				out[id] = r
			}
		}

		return out
	}

	lostTab := &inventoryv1.RestockRequestListFilter{
		Status:  inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_LOST,
		Settled: inventoryv1.RestockSettledFilter_RESTOCK_SETTLED_FILTER_UNSETTLED,
	}

	all := list(nil)
	if all[f.restock].GetResolutionCount() != 2 || all[lost].GetResolutionCount() != 1 || all[f.ongoing].GetResolutionCount() != 0 {
		t.Fatalf("counts = %d / %d / %d", all[f.restock].GetResolutionCount(), all[lost].GetResolutionCount(),
			all[f.ongoing].GetResolutionCount())
	}

	if _, ok := list(lostTab)[lost]; !ok {
		t.Fatalf("an open lost restock is missing from the Hilang tab")
	}

	_, err := f.settle(otMelati, lost)
	if err != nil {
		t.Fatalf("settle the lost one: %v", err)
	}

	if _, ok := list(lostTab)[lost]; ok {
		t.Fatalf("a settled lost restock is still on the Hilang tab")
	}

	semua := list(nil)[lost]
	if semua == nil || semua.GetSettledAtUnix() == 0 {
		t.Fatalf("a settled lost restock is gone from Semua or reads unsettled: %v", semua)
	}

	settledOnly := list(&inventoryv1.RestockRequestListFilter{Settled: inventoryv1.RestockSettledFilter_RESTOCK_SETTLED_FILTER_SETTLED})
	if len(settledOnly) != 1 || settledOnly[lost] == nil {
		t.Fatalf("SETTLED reads %d rows", len(settledOnly))
	}
}
