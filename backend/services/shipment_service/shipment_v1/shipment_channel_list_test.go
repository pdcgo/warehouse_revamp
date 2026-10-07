package shipment_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func listCodes(t *testing.T, resp *shipmentv1.ShipmentChannelListResponse) []string {
	t.Helper()

	var rows map[uint64]*shipmentv1.ShipmentChannel
	for _, it := range resp.GetItems() {
		if c := it.GetChannel(); c != nil {
			rows = c.GetMapData()
		}
	}

	codes := make([]string, 0, len(resp.GetIds()))
	for _, id := range resp.GetIds() {
		codes = append(codes, rows[id].GetCode())
	}

	return codes
}

func list(t *testing.T, svc interface {
	ShipmentChannelList(context.Context, *connect.Request[shipmentv1.ShipmentChannelListRequest]) (*connect.Response[shipmentv1.ShipmentChannelListResponse], error)
}, filter *shipmentv1.ShipmentChannelListFilter, page uint32, limit uint32) *shipmentv1.ShipmentChannelListResponse {
	t.Helper()

	resp, err := svc.ShipmentChannelList(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelListRequest{
		Filter: filter,
		Page:   &commonv1.CommonPagination{Page: page, Limit: limit},
	}))
	if err != nil {
		t.Fatalf("ShipmentChannelList: %v", err)
	}

	return resp.Msg
}

// the-three-channels-are-seeded — and the default order is by code.
func TestShipmentChannelList_ReturnsTheSeedByCode(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	got := listCodes(t, list(t, svc, nil, 1, 50))

	want := []string{"jne", "jnt", "sicepat"}
	if len(got) != len(want) {
		t.Fatalf("codes = %v, want %v", got, want)
	}

	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("codes = %v, want %v", got, want)
		}
	}
}

// Deleted channels are hidden unless include_deleted.
func TestShipmentChannelList_IncludeDeleted(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	jnt := seeded(t, db, "jnt")

	_, err := svc.ShipmentChannelDelete(context.Background(), connect.NewRequest(&shipmentv1.ShipmentChannelDeleteRequest{ChannelId: jnt.ID}))
	if err != nil {
		t.Fatalf("delete: %v", err)
	}

	live := listCodes(t, list(t, svc, nil, 1, 50))
	for _, c := range live {
		if c == "jnt" {
			t.Fatal("a deleted channel appeared without include_deleted")
		}
	}

	all := listCodes(t, list(t, svc, &shipmentv1.ShipmentChannelListFilter{IncludeDeleted: true}, 1, 50))
	if len(all) != len(live)+1 {
		t.Fatalf("include_deleted returned %d, want %d", len(all), len(live)+1)
	}
}

// q matches name or code, case-insensitively, and a LIKE wildcard is literal.
func TestShipmentChannelList_Search(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	byName := listCodes(t, list(t, svc, &shipmentv1.ShipmentChannelListFilter{Q: "cepat"}, 1, 50))
	if len(byName) != 1 || byName[0] != "sicepat" {
		t.Fatalf("q=cepat → %v, want [sicepat]", byName)
	}

	wildcard := listCodes(t, list(t, svc, &shipmentv1.ShipmentChannelListFilter{Q: "%"}, 1, 50))
	if len(wildcard) != 0 {
		t.Fatalf("q=%% matched %v — the wildcard was not escaped", wildcard)
	}
}

func TestShipmentChannelList_Pages(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	resp := list(t, svc, nil, 2, 2)

	if got := listCodes(t, resp); len(got) != 1 || got[0] != "sicepat" {
		t.Fatalf("page 2 of 2 → %v, want [sicepat]", got)
	}

	if resp.GetPageInfo().GetTotalItems() != 3 || resp.GetPageInfo().GetTotalPage() != 2 {
		t.Fatalf("page_info = %+v, want 3 items over 2 pages", resp.GetPageInfo())
	}
}
