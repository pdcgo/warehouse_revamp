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

// seedByCode is every migration-seeded channel, in the list's default order (by code):
// the-three-channels-are-seeded (00001) and the-channels-are-what-orders-ship-by (00002).
var seedByCode = []string{
	"anteraja", "gosend", "grabexpress", "idexpress", "jne", "jnt", "jntcargo", "lex", "pos", "sicepat", "spx",
}

// The seed is there — and the default order is by code.
func TestShipmentChannelList_ReturnsTheSeedByCode(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	got := listCodes(t, list(t, svc, nil, 1, 50))

	want := seedByCode
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

	// The LAST page of two-per-page holds the one left over: 11 seeded → 6 pages, page 6 = [spx].
	pages := uint32((len(seedByCode) + 1) / 2)
	resp := list(t, svc, nil, pages, 2)

	last := seedByCode[len(seedByCode)-1]
	if got := listCodes(t, resp); len(got) != 1 || got[0] != last {
		t.Fatalf("page %d of %d → %v, want [%s]", pages, pages, got, last)
	}

	if resp.GetPageInfo().GetTotalItems() != uint64(len(seedByCode)) || resp.GetPageInfo().GetTotalPage() != pages {
		t.Fatalf("page_info = %+v, want %d items over %d pages", resp.GetPageInfo(), len(seedByCode), pages)
	}
}
