package region_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	regionv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/region/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// An EMPTY parent_code means the top level — the provinsi. It must mean `parent_code IS NULL`, not
// `parent_code = ”`; getting that wrong returns nothing at all.
func TestRegionList_EmptyParentIsProvinsi(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedTree(t, db)

	resp, err := svc.RegionList(context.Background(), connect.NewRequest(&regionv1.RegionListRequest{
		Page: page(20),
	}))
	if err != nil {
		t.Fatalf("RegionList: %v", err)
	}

	got := resp.Msg.GetRegions()
	if len(got) != 2 {
		t.Fatalf("provinsi = %d, want 2 (%+v)", len(got), got)
	}

	// Ordered by name — this list is read by a human picking from it.
	if got[0].GetName() != "Aceh" || got[1].GetName() != "Sumatera Utara" {
		t.Fatalf("not name-ordered: %q, %q", got[0].GetName(), got[1].GetName())
	}

	if got[0].GetLevel() != regionv1.RegionLevel_REGION_LEVEL_PROVINSI || got[0].GetParentCode() != "" {
		t.Fatalf("provinsi shape wrong: %+v", got[0])
	}
}

// The cascading picker's only query: children of one code.
func TestRegionList_Children(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedTree(t, db)

	resp, err := svc.RegionList(context.Background(), connect.NewRequest(&regionv1.RegionListRequest{
		ParentCode: "11", Page: page(20),
	}))
	if err != nil {
		t.Fatalf("RegionList: %v", err)
	}

	got := resp.Msg.GetRegions()
	if len(got) != 2 {
		t.Fatalf("children of Aceh = %d, want 2 (%+v)", len(got), got)
	}

	for _, r := range got {
		if r.GetParentCode() != "11" || r.GetLevel() != regionv1.RegionLevel_REGION_LEVEL_KABUPATEN {
			t.Fatalf("unexpected child: %+v", r)
		}
	}

	// A desa carries its kode pos; a kabupaten has none.
	if got[0].GetKodePos() != "" {
		t.Fatalf("kabupaten should have no kode pos: %+v", got[0])
	}
}

func TestRegionList_Paginates(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedTree(t, db)

	// Three desa under Bakongan, one per page.
	resp, err := svc.RegionList(context.Background(), connect.NewRequest(&regionv1.RegionListRequest{
		ParentCode: "11.01.01", Page: page(1),
	}))
	if err != nil {
		t.Fatalf("RegionList: %v", err)
	}

	if len(resp.Msg.GetRegions()) != 1 {
		t.Fatalf("page 1 rows = %d, want 1", len(resp.Msg.GetRegions()))
	}

	info := resp.Msg.GetPageInfo()
	if info.GetTotalItems() != 3 || info.GetTotalPage() != 3 {
		t.Fatalf("page info = %+v, want total 3 / 3 pages", info)
	}

	// Page 2 continues the same name order.
	resp, err = svc.RegionList(context.Background(), connect.NewRequest(&regionv1.RegionListRequest{
		ParentCode: "11.01.01", Page: pageAt(2, 1),
	}))
	if err != nil {
		t.Fatalf("RegionList page 2: %v", err)
	}

	if len(resp.Msg.GetRegions()) != 1 || resp.Msg.GetRegions()[0].GetName() != "Keude Bakongan" {
		t.Fatalf("page 2 = %+v, want Keude Bakongan", resp.Msg.GetRegions())
	}
}

// A childless code lists nothing rather than erroring — a desa simply has no children.
func TestRegionList_LeafHasNoChildren(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedTree(t, db)

	resp, err := svc.RegionList(context.Background(), connect.NewRequest(&regionv1.RegionListRequest{
		ParentCode: "11.01.01.2001", Page: page(20),
	}))
	if err != nil {
		t.Fatalf("RegionList: %v", err)
	}

	if len(resp.Msg.GetRegions()) != 0 {
		t.Fatalf("a desa should have no children, got %+v", resp.Msg.GetRegions())
	}
}
