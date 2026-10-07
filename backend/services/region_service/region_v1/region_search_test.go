package region_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	regionv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/region/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The picker's fast path: a hit carries its FULL ancestry, so choosing it back-fills every level
// without a second round-trip. A bare name would be ambiguous — 83.762 desa share a lot of names.
func TestRegionSearch_HitsCarryTheirAncestry(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedTree(t, db)

	resp, err := svc.RegionSearch(context.Background(), connect.NewRequest(&regionv1.RegionSearchRequest{
		Q: "keude", Limit: 20,
	}))
	if err != nil {
		t.Fatalf("RegionSearch: %v", err)
	}

	got := resp.Msg.GetResults()
	if len(got) != 2 {
		t.Fatalf("results = %d, want 2 (%+v)", len(got), got)
	}

	// Name-ordered: Keude Bakongan, then Keude Baru.
	first := got[0]
	if first.GetDesaName() != "Keude Bakongan" || first.GetKodePos() != "23773" {
		t.Fatalf("first hit wrong: %+v", first)
	}

	// The whole chain came back with it.
	if first.GetProvinsiName() != "Aceh" ||
		first.GetKabupatenName() != "Kabupaten Aceh Selatan" ||
		first.GetKecamatanName() != "Bakongan" {
		t.Fatalf("hit is missing its ancestry: %+v", first)
	}
}

// Case-insensitive, and it matches on a PREFIX (which is what the LOWER(name) index serves).
func TestRegionSearch_IsCaseInsensitive(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedTree(t, db)

	resp, err := svc.RegionSearch(context.Background(), connect.NewRequest(&regionv1.RegionSearchRequest{
		Q: "SUMATERA", Limit: 20,
	}))
	if err != nil {
		t.Fatalf("RegionSearch: %v", err)
	}

	got := resp.Msg.GetResults()
	if len(got) != 1 || got[0].GetProvinsiName() != "Sumatera Utara" {
		t.Fatalf("case-insensitive search failed: %+v", got)
	}
}

// "Aceh" is both a provinsi and (here) part of a desa name; the level filter separates them.
func TestRegionSearch_LevelFilter(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedTree(t, db)

	// Unfiltered: the provinsi AND the desa.
	resp, err := svc.RegionSearch(context.Background(), connect.NewRequest(&regionv1.RegionSearchRequest{
		Q: "aceh", Limit: 20,
	}))
	if err != nil {
		t.Fatalf("RegionSearch: %v", err)
	}

	if len(resp.Msg.GetResults()) != 2 {
		t.Fatalf("unfiltered = %d, want 2 (%+v)", len(resp.Msg.GetResults()), resp.Msg.GetResults())
	}

	// Filtered to desa: only Aceh Jaya, and it comes back as a desa (not as a provinsi).
	resp, err = svc.RegionSearch(context.Background(), connect.NewRequest(&regionv1.RegionSearchRequest{
		Q: "aceh", Level: regionv1.RegionLevel_REGION_LEVEL_DESA, Limit: 20,
	}))
	if err != nil {
		t.Fatalf("RegionSearch (level): %v", err)
	}

	got := resp.Msg.GetResults()
	if len(got) != 1 || got[0].GetDesaName() != "Aceh Jaya" {
		t.Fatalf("level-filtered = %+v, want only the desa Aceh Jaya", got)
	}

	if got[0].GetProvinsiName() != "Aceh" {
		t.Fatalf("the desa hit should still carry its provinsi: %+v", got[0])
	}
}

// A typeahead never returns everything — the limit is honoured.
func TestRegionSearch_HonoursLimit(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedTree(t, db)

	resp, err := svc.RegionSearch(context.Background(), connect.NewRequest(&regionv1.RegionSearchRequest{
		Q: "keude", Limit: 1,
	}))
	if err != nil {
		t.Fatalf("RegionSearch: %v", err)
	}

	if len(resp.Msg.GetResults()) != 1 {
		t.Fatalf("limit 1 returned %d", len(resp.Msg.GetResults()))
	}
}

// A LIKE wildcard typed by the user is a literal, not a match-everything.
func TestRegionSearch_EscapesWildcards(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedTree(t, db)

	resp, err := svc.RegionSearch(context.Background(), connect.NewRequest(&regionv1.RegionSearchRequest{
		Q: "%%", Limit: 20,
	}))
	if err != nil {
		t.Fatalf("RegionSearch: %v", err)
	}

	if len(resp.Msg.GetResults()) != 0 {
		t.Fatalf("a literal %%%% should match nothing, got %d", len(resp.Msg.GetResults()))
	}
}
