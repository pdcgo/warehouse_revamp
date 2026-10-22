package inventory_v1_test

import (
	"slices"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
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
