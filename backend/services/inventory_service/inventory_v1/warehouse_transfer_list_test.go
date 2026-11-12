package inventory_v1_test

import (
	"slices"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
)

func listTransferIDs(t *testing.T, f *wtFixture, team uint64, filter *inventoryv1.WarehouseTransferListFilter) []uint64 {
	t.Helper()

	res, err := f.svc.WarehouseTransferList(ctxUser(1), connect.NewRequest(&inventoryv1.WarehouseTransferListRequest{
		TeamId: team, Filter: filter, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("list as team %d: %v", team, err)
	}

	if int(res.Msg.GetPageInfo().GetTotalItems()) != len(res.Msg.GetIds()) {
		t.Fatalf("page says %d, ids hold %d", res.Msg.GetPageInfo().GetTotalItems(), len(res.Msg.GetIds()))
	}

	return res.Msg.GetIds()
}

// Each side lists its own, newest first: Melati its transfer, Sinar its own, A both leaving it, B both coming to it, a
// fourth team nothing. The filters narrow within that.
func TestWarehouseTransferList_EachSideSeesItsOwn(t *testing.T) {
	f := wtStocked(t)

	melati := f.create(t, wtLine(wtKaosHitam, 1))

	res, err := f.svc.WarehouseTransferCreate(ctxUser(wtSeller), connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
		TeamId: otSinar, FromWarehouseId: wtA, ToWarehouseId: wtB,
		Lines: []*inventoryv1.WarehouseTransferLine{wtLine(wtKaosMerah, 2)},
	}))
	if err != nil {
		t.Fatalf("create as Sinar: %v", err)
	}

	sinar := res.Msg.GetTransfer()
	f.process(t, sinar.GetId())

	direction := func(d inventoryv1.WarehouseTransferDirection) *inventoryv1.WarehouseTransferListFilter {
		return &inventoryv1.WarehouseTransferListFilter{Direction: d}
	}

	both := []uint64{sinar.GetId(), melati.GetId()}

	cases := []struct {
		name   string
		team   uint64
		filter *inventoryv1.WarehouseTransferListFilter
		want   []uint64
	}{
		{"Melati", otMelati, nil, []uint64{melati.GetId()}},
		{"Sinar", otSinar, nil, []uint64{sinar.GetId()}},
		{"A leaving", wtA, direction(inventoryv1.WarehouseTransferDirection_WAREHOUSE_TRANSFER_DIRECTION_OUTGOING), both},
		{"A coming", wtA, direction(inventoryv1.WarehouseTransferDirection_WAREHOUSE_TRANSFER_DIRECTION_INCOMING), nil},
		{"B coming", wtB, direction(inventoryv1.WarehouseTransferDirection_WAREHOUSE_TRANSFER_DIRECTION_INCOMING), both},
		{"a fourth team", wtOther, nil, nil},
		{"B in process", wtB, &inventoryv1.WarehouseTransferListFilter{
			Status: inventoryv1.WarehouseTransferStatus_WAREHOUSE_TRANSFER_STATUS_PROCESS,
		}, []uint64{sinar.GetId()}},
		{"B for Melati", wtB, &inventoryv1.WarehouseTransferListFilter{OwnerTeamId: otMelati}, []uint64{melati.GetId()}},
		{"B by SKU", wtB, &inventoryv1.WarehouseTransferListFilter{Q: "km-001"}, []uint64{sinar.GetId()}},
		{"B by number", wtB, &inventoryv1.WarehouseTransferListFilter{Q: "#" + itoa(melati.GetId())}, []uint64{melati.GetId()}},
	}

	for _, c := range cases {
		got := listTransferIDs(t, f, c.team, c.filter)
		if !slices.Equal(got, c.want) && !(len(got) == 0 && len(c.want) == 0) {
			t.Fatalf("%s: ids %v, want %v", c.name, got, c.want)
		}
	}
}

// transferListOverrides is a page of WarehouseTransferList as `team`: each transfer's created_by_is_override, by id.
func transferListOverrides(t *testing.T, f *wtFixture, team uint64) map[uint64]bool {
	t.Helper()

	res, err := f.svc.WarehouseTransferList(ctxUser(1), connect.NewRequest(&inventoryv1.WarehouseTransferListRequest{
		TeamId: team, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("list as team %d: %v", team, err)
	}

	out := map[uint64]bool{}

	for _, item := range res.Msg.GetItems() {
		for id, tr := range item.GetWarehouseTransfer().GetMapData() {
			out[id] = tr.GetCreatedByIsOverride()
		}
	}

	return out
}

// WHO RAISED IT, AND WHETHER ROOT DID FROM OUTSIDE (an-override-shows-a-platform-badge): the list's created-by cell
// draws the "by Root team" badge from `created_by_is_override`, read from the trail's FIRST row — the create's. Root
// opening a transfer for a seller it is not in reads true on every side; the seller's own reads false, and stays false
// when Root moves it on later (a later trail row, not the create's).
func TestWarehouseTransferList_CreatedByIsOverride(t *testing.T) {
	f := wtStocked(t)

	res, err := f.svc.WarehouseTransferCreate(ctxAs(ovRoot, otMelati, role_basev1.Role_ROLE_UNSPECIFIED),
		connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
			TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtB, Lines: []*inventoryv1.WarehouseTransferLine{wtLine(wtKaosHitam, 1)},
		}))
	if err != nil {
		t.Fatalf("Root's create: %v", err)
	}

	byRoot := res.Msg.GetTransfer().GetId()

	res, err = f.svc.WarehouseTransferCreate(ctxAs(wtSeller, otMelati, role_basev1.Role_ROLE_SELLING_ADMIN),
		connect.NewRequest(&inventoryv1.WarehouseTransferCreateRequest{
			TeamId: otMelati, FromWarehouseId: wtA, ToWarehouseId: wtB, Lines: []*inventoryv1.WarehouseTransferLine{wtLine(wtKaosPolos, 1)},
		}))
	if err != nil {
		t.Fatalf("the seller's create: %v", err)
	}

	bySeller := res.Msg.GetTransfer().GetId()

	// Root processes the seller's transfer from outside A: an override on the trail's SECOND row only.
	_, err = f.svc.WarehouseTransferProcess(ctxAs(ovRoot, wtA, role_basev1.Role_ROLE_UNSPECIFIED),
		connect.NewRequest(&inventoryv1.WarehouseTransferProcessRequest{TeamId: wtA, TransferId: bySeller}))
	if err != nil {
		t.Fatalf("Root's process: %v", err)
	}

	want := map[uint64]bool{byRoot: true, bySeller: false}

	for _, side := range []struct {
		name string
		team uint64
	}{{"the seller", otMelati}, {"A", wtA}, {"B", wtB}} {
		got := transferListOverrides(t, f, side.team)

		for id, w := range want {
			v, ok := got[id]
			if !ok {
				t.Fatalf("%s: transfer %d not on the page %v", side.name, id, got)
			}

			if v != w {
				t.Errorf("%s: transfer %d created_by_is_override = %v, want %v", side.name, id, v, w)
			}
		}
	}
}
