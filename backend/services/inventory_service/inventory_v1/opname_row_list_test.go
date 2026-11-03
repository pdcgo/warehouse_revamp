package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

func rowList(t *testing.T, f *opnameFixture, filter *inventoryv1.OpnameRowListFilter) *inventoryv1.OpnameRowListResponse {
	t.Helper()

	res, err := f.svc.OpnameRowList(opAdmin(opBudi), connect.NewRequest(&inventoryv1.OpnameRowListRequest{
		TeamId: otWarehouse, Filter: filter, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("row list: %v", err)
	}

	return res.Msg
}

// The admin's watch page carries the book figure on every row, counted or not, by rack code then name — and narrows by
// rack, status, difference and product.
func TestOpnameRowList_TheBookAndTheFilters(t *testing.T) {
	f := opnameStocked(t)
	s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_ALL, 0, 0, 0)

	f.countRow(t, opAni, s.GetId(), otKaosHitam, f.rakA, 4, 0)

	all := rowList(t, f, &inventoryv1.OpnameRowListFilter{SessionId: s.GetId()})
	if len(all.GetIds()) != 3 {
		t.Fatalf("%d rows, want 3", len(all.GetIds()))
	}

	first := all.GetItems()[0].GetRow().GetMapData()[all.GetIds()[0]]
	if first.GetPlacementCode() != "rak-a" || first.GetProductName() != "Kaos Hitam" {
		t.Fatalf("first row %s on %s, want Kaos Hitam on rak-a — by rack code, then name", first.GetProductName(), first.GetPlacementCode())
	}

	for _, r := range all.GetItems()[0].GetRow().GetMapData() {
		if r.GetSystemStockCount() == 0 {
			t.Fatalf("row %d carries no book figure on the admin's page", r.GetId())
		}
	}

	if n := len(rowList(t, f, &inventoryv1.OpnameRowListFilter{SessionId: s.GetId(), OnlyDifferences: true}).GetIds()); n != 1 {
		t.Fatalf("%d differing rows, want 1", n)
	}

	if n := len(rowList(t, f, &inventoryv1.OpnameRowListFilter{SessionId: s.GetId(), PlacementId: f.rakB}).GetIds()); n != 1 {
		t.Fatalf("%d rows on Rak B, want 1", n)
	}

	if n := len(rowList(t, f, &inventoryv1.OpnameRowListFilter{
		SessionId: s.GetId(), Status: inventoryv1.OpnameRowStatus_OPNAME_ROW_STATUS_CREATED,
	}).GetIds()); n != 2 {
		t.Fatalf("%d rows still to count, want 2", n)
	}

	if n := len(rowList(t, f, &inventoryv1.OpnameRowListFilter{SessionId: s.GetId(), Q: "kp-0"}).GetIds()); n != 1 {
		t.Fatalf("%d rows for KP-0, want Kaos Polos's one", n)
	}
}
