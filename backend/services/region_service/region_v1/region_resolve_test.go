package region_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	regionv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/region/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The whole point of RegionResolve: one code in, the complete flattened address out — exactly what a
// consumer snapshots onto its record.
func TestRegionResolve_FullAncestryOfADesa(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedTree(t, db)

	resp, err := svc.RegionResolve(context.Background(), connect.NewRequest(&regionv1.RegionResolveRequest{
		Code: "11.01.01.2001",
	}))
	if err != nil {
		t.Fatalf("RegionResolve: %v", err)
	}

	got := resp.Msg.GetAncestry()

	if got.GetProvinsiCode() != "11" || got.GetProvinsiName() != "Aceh" {
		t.Fatalf("provinsi wrong: %+v", got)
	}
	if got.GetKabupatenCode() != "11.01" || got.GetKabupatenName() != "Kabupaten Aceh Selatan" {
		t.Fatalf("kabupaten wrong: %+v", got)
	}
	if got.GetKecamatanCode() != "11.01.01" || got.GetKecamatanName() != "Bakongan" {
		t.Fatalf("kecamatan wrong: %+v", got)
	}
	if got.GetDesaCode() != "11.01.01.2001" || got.GetDesaName() != "Keude Bakongan" {
		t.Fatalf("desa wrong: %+v", got)
	}
	if got.GetKodePos() != "23773" {
		t.Fatalf("kode pos = %q, want 23773", got.GetKodePos())
	}
}

// Resolving a code ABOVE desa fills what exists and leaves the rest empty — there is no desa to name.
func TestRegionResolve_PartialAncestry(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedTree(t, db)

	resp, err := svc.RegionResolve(context.Background(), connect.NewRequest(&regionv1.RegionResolveRequest{
		Code: "11.01",
	}))
	if err != nil {
		t.Fatalf("RegionResolve: %v", err)
	}

	got := resp.Msg.GetAncestry()

	if got.GetProvinsiName() != "Aceh" || got.GetKabupatenName() != "Kabupaten Aceh Selatan" {
		t.Fatalf("filled levels wrong: %+v", got)
	}

	if got.GetKecamatanCode() != "" || got.GetDesaCode() != "" || got.GetKodePos() != "" {
		t.Fatalf("levels below the resolved code should be empty: %+v", got)
	}
}

// A provinsi resolves to just itself.
func TestRegionResolve_Provinsi(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedTree(t, db)

	resp, err := svc.RegionResolve(context.Background(), connect.NewRequest(&regionv1.RegionResolveRequest{
		Code: "12",
	}))
	if err != nil {
		t.Fatalf("RegionResolve: %v", err)
	}

	got := resp.Msg.GetAncestry()
	if got.GetProvinsiName() != "Sumatera Utara" || got.GetKabupatenCode() != "" {
		t.Fatalf("provinsi ancestry wrong: %+v", got)
	}
}

func TestRegionResolve_UnknownIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedTree(t, db)

	_, err := svc.RegionResolve(context.Background(), connect.NewRequest(&regionv1.RegionResolveRequest{
		Code: "99.99.99.9999",
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("unknown code = %v, want NotFound", connect.CodeOf(err))
	}
}
