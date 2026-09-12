package region_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	regionv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/region/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The picker's entry point: a postcode in, the addresses it covers out — each with its full
// ancestry, so one pick fills provinsi through desa without a second round-trip.
func TestRegionSearchByKodePos_HitsCarryTheirAncestry(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedTree(t, db)

	resp, err := svc.RegionSearchByKodePos(context.Background(),
		connect.NewRequest(&regionv1.RegionSearchByKodePosRequest{KodePos: "23773", Limit: 20}))
	if err != nil {
		t.Fatalf("RegionSearchByKodePos: %v", err)
	}

	got := resp.Msg.GetResults()
	if len(got) != 1 {
		t.Fatalf("results = %d, want 1 (%+v)", len(got), got)
	}

	hit := got[0]
	if hit.GetDesaName() != "Keude Bakongan" || hit.GetKodePos() != "23773" {
		t.Fatalf("wrong hit: %+v", hit)
	}

	if hit.GetProvinsiName() != "Aceh" ||
		hit.GetKabupatenName() != "Kabupaten Aceh Selatan" ||
		hit.GetKecamatanName() != "Bakongan" {
		t.Fatalf("hit is missing its ancestry: %+v", hit)
	}
}

// A PARTIAL code matches from the start, so the list narrows as it is typed. Ordered by the code
// itself, which keeps the desa of one postcode together.
func TestRegionSearchByKodePos_MatchesAPrefix(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedTree(t, db)

	resp, err := svc.RegionSearchByKodePos(context.Background(),
		connect.NewRequest(&regionv1.RegionSearchByKodePosRequest{KodePos: "2377", Limit: 20}))
	if err != nil {
		t.Fatalf("RegionSearchByKodePos: %v", err)
	}

	got := resp.Msg.GetResults()
	if len(got) != 3 {
		t.Fatalf("prefix results = %d, want 3 (%+v)", len(got), got)
	}

	if got[0].GetKodePos() != "23773" || got[2].GetKodePos() != "23775" {
		t.Fatalf("not ordered by kode pos: %+v", got)
	}
}

// ONE POSTCODE, SEVERAL DESA — the normal case, and the reason this returns a list rather than an
// address. Choosing for the person would put the order in the wrong kelurahan every time a code was
// shared, invisibly.
func TestRegionSearchByKodePos_OneCodeCanCoverSeveralDesa(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedTree(t, db)

	// A second desa in the same kecamatan, sharing Keude Bakongan's postcode.
	insertRegion(t, db, "11.01.01.2004", "11.01.01", 4, "Ujung Mangki", "23773")

	resp, err := svc.RegionSearchByKodePos(context.Background(),
		connect.NewRequest(&regionv1.RegionSearchByKodePosRequest{KodePos: "23773", Limit: 20}))
	if err != nil {
		t.Fatalf("RegionSearchByKodePos: %v", err)
	}

	got := resp.Msg.GetResults()
	if len(got) != 2 {
		t.Fatalf("shared postcode returned %d, want both desa (%+v)", len(got), got)
	}

	// Name-ordered within the one code.
	if got[0].GetDesaName() != "Keude Bakongan" || got[1].GetDesaName() != "Ujung Mangki" {
		t.Fatalf("unexpected order: %+v", got)
	}
}

// Nothing above desa carries a kode pos, and nothing above desa may come back — a hit at another
// level would mean a seed that broke the table's own CHECK.
func TestRegionSearchByKodePos_DesaOnly(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedTree(t, db)

	resp, err := svc.RegionSearchByKodePos(context.Background(),
		connect.NewRequest(&regionv1.RegionSearchByKodePosRequest{KodePos: "237", Limit: 20}))
	if err != nil {
		t.Fatalf("RegionSearchByKodePos: %v", err)
	}

	for _, hit := range resp.Msg.GetResults() {
		if hit.GetDesaCode() == "" {
			t.Fatalf("a hit stopped above desa: %+v", hit)
		}
	}
}

// A typeahead never returns everything.
func TestRegionSearchByKodePos_HonoursLimit(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedTree(t, db)

	resp, err := svc.RegionSearchByKodePos(context.Background(),
		connect.NewRequest(&regionv1.RegionSearchByKodePosRequest{KodePos: "2377", Limit: 1}))
	if err != nil {
		t.Fatalf("RegionSearchByKodePos: %v", err)
	}

	if len(resp.Msg.GetResults()) != 1 {
		t.Fatalf("limit 1 returned %d", len(resp.Msg.GetResults()))
	}
}

// A postcode that exists nowhere is an empty list, not an error — the typeahead simply says so.
func TestRegionSearchByKodePos_UnknownCodeIsEmpty(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedTree(t, db)

	resp, err := svc.RegionSearchByKodePos(context.Background(),
		connect.NewRequest(&regionv1.RegionSearchByKodePosRequest{KodePos: "99999", Limit: 20}))
	if err != nil {
		t.Fatalf("RegionSearchByKodePos: %v", err)
	}

	if len(resp.Msg.GetResults()) != 0 {
		t.Fatalf("unknown postcode returned %d results", len(resp.Msg.GetResults()))
	}
}
