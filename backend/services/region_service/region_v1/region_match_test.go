package region_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	regionv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/region/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// seedMatchTree plants the cases the matcher must tell apart:
//
//	Jawa Barat (32)
//	  Kabupaten Bogor (32.01)
//	    Cibinong (32.01.01) — Pakansari (…1001, 16915)
//	    Bogor Barat (32.01.02) — Menteng (…1001)                ← a twin of Kota Bogor's, by name
//	  Kota Bogor (32.71)
//	    Bogor Barat (32.71.01) — Menteng (…1001)
//	    Bogor Tengah (32.71.02) — Paledang (…1001, 16122)
//	Jambi (15)
//	  Kabupaten Tanjung Jabung Barat (15.07)
//	    Merlung (15.07.01) — Merlung (…1001) and Merlung (…2001)   ← two desa of one name in one kecamatan, as in the seed
//	Daerah Khusus Ibukota Jakarta (31)
//	  Kota Administrasi Jakarta Utara  (31.72, with the seed's trailing space)
//	    Koja (31.72.03) — Tugu Utara (…1001)
func seedMatchTree(t *testing.T, db *gorm.DB) {
	t.Helper()

	insertRegion(t, db, "32", "", 1, "Jawa Barat", "")
	insertRegion(t, db, "32.01", "32", 2, "Kabupaten Bogor", "")
	insertRegion(t, db, "32.01.01", "32.01", 3, "Cibinong", "")
	insertRegion(t, db, "32.01.01.1001", "32.01.01", 4, "Pakansari", "16915")
	insertRegion(t, db, "32.01.02", "32.01", 3, "Bogor Barat", "")
	insertRegion(t, db, "32.01.02.1001", "32.01.02", 4, "Menteng", "16111")
	insertRegion(t, db, "32.71", "32", 2, "Kota Bogor", "")
	insertRegion(t, db, "32.71.01", "32.71", 3, "Bogor Barat", "")
	insertRegion(t, db, "32.71.01.1001", "32.71.01", 4, "Menteng", "16111")
	insertRegion(t, db, "32.71.02", "32.71", 3, "Bogor Tengah", "")
	insertRegion(t, db, "32.71.02.1001", "32.71.02", 4, "Paledang", "16122")
	insertRegion(t, db, "15", "", 1, "Jambi", "")
	insertRegion(t, db, "15.07", "15", 2, "Kabupaten Tanjung Jabung Barat", "")
	insertRegion(t, db, "15.07.01", "15.07", 3, "Merlung", "")
	insertRegion(t, db, "15.07.01.1001", "15.07.01", 4, "Merlung", "36554")
	insertRegion(t, db, "15.07.01.2001", "15.07.01", 4, "Merlung", "36554")
	insertRegion(t, db, "31", "", 1, "Daerah Khusus Ibukota Jakarta", "")
	insertRegion(t, db, "31.72", "31", 2, "Kota Administrasi Jakarta Utara ", "")
	insertRegion(t, db, "31.72.03", "31.72", 3, "Koja", "")
	insertRegion(t, db, "31.72.03.1001", "31.72.03", 4, "Tugu Utara", "14260")
}

func match(t *testing.T, db *gorm.DB, provinsi, kabupaten, kecamatan, desa string) *regionv1.RegionMatchResponse {
	t.Helper()

	resp, err := newService(t, db).RegionMatch(context.Background(), connect.NewRequest(&regionv1.RegionMatchRequest{
		ProvinsiName:  provinsi,
		KabupatenName: kabupaten,
		KecamatanName: kecamatan,
		DesaName:      desa,
	}))
	if err != nil {
		t.Fatalf("RegionMatch: %v", err)
	}

	return resp.Msg
}

// The pre-fill: four names that name one place give that place — its codes, the region list's own spelling and the
// desa's kode pos — whatever the case and spacing the marketplace wrote them in.
func TestRegionMatch_ExactNamesGiveTheOnePlace(t *testing.T) {
	db := san_testdb.DB(t)
	seedMatchTree(t, db)

	got := match(t, db, "JAWA BARAT", "kabupaten  bogor", " Cibinong ", "pakansari")

	if got.GetMatches() != 1 || got.GetMatch() == nil {
		t.Fatalf("want one match, got %d (%+v)", got.GetMatches(), got.GetMatch())
	}

	m := got.GetMatch()
	if m.GetProvinsiCode() != "32" || m.GetKabupatenCode() != "32.01" || m.GetKecamatanCode() != "32.01.01" ||
		m.GetDesaCode() != "32.01.01.1001" {
		t.Fatalf("codes wrong: %+v", m)
	}

	if m.GetKabupatenName() != "Kabupaten Bogor" || m.GetDesaName() != "Pakansari" || m.GetKodePos() != "16915" {
		t.Fatalf("the region list's own names and kode pos expected: %+v", m)
	}
}

// Every way a marketplace writes the kabupaten's kind settles to the place's own; a kind that DISAGREES is no match.
func TestRegionMatch_KabupatenPrefixVariants(t *testing.T) {
	db := san_testdb.DB(t)
	seedMatchTree(t, db)

	for _, kabupaten := range []string{"Kabupaten Bogor", "Kab. Bogor", "KAB.Bogor", "Kab Bogor", "Bogor"} {
		got := match(t, db, "Jawa Barat", kabupaten, "Cibinong", "Pakansari")
		if got.GetMatches() != 1 || got.GetMatch().GetDesaCode() != "32.01.01.1001" {
			t.Fatalf("%q: want Pakansari of Kabupaten Bogor, got %d %+v", kabupaten, got.GetMatches(), got.GetMatch())
		}
	}

	for _, kabupaten := range []string{"Kota Bogor", "KOTA BOGOR"} {
		got := match(t, db, "Jawa Barat", kabupaten, "Bogor Tengah", "Paledang")
		if got.GetMatches() != 1 || got.GetMatch().GetDesaCode() != "32.71.02.1001" {
			t.Fatalf("%q: want Paledang of Kota Bogor, got %d %+v", kabupaten, got.GetMatches(), got.GetMatch())
		}
	}

	// Cibinong is the Kabupaten's — a Kota prefix names the other Bogor, where it is not.
	got := match(t, db, "Jawa Barat", "Kota Bogor", "Cibinong", "Pakansari")
	if got.GetMatches() != 0 || got.GetMatch() != nil {
		t.Fatalf("a disagreeing prefix must not match: %d %+v", got.GetMatches(), got.GetMatch())
	}

	// Jakarta's "Kota Administrasi …" (and the seed's trailing space) answer to plain "Kota Jakarta Utara".
	got = match(t, db, "Daerah Khusus Ibukota Jakarta", "Kota Jakarta Utara", "Koja", "Tugu Utara")
	if got.GetMatches() != 1 || got.GetMatch().GetDesaCode() != "31.72.03.1001" {
		t.Fatalf("Kota Administrasi: want Tugu Utara, got %d %+v", got.GetMatches(), got.GetMatch())
	}
}

// Ambiguous is no pre-fill: a prefix-less name that fits a Kota and a Kabupaten, or two desa of one name in one
// kecamatan. The count says it was several, not none.
func TestRegionMatch_AmbiguousGivesNoPlace(t *testing.T) {
	db := san_testdb.DB(t)
	seedMatchTree(t, db)

	got := match(t, db, "Jawa Barat", "Bogor", "Bogor Barat", "Menteng")
	if got.GetMatches() != 2 || got.GetMatch() != nil {
		t.Fatalf("Bogor with no prefix fits both: want 2 and no match, got %d %+v", got.GetMatches(), got.GetMatch())
	}

	// The prefix settles it.
	got = match(t, db, "Jawa Barat", "Kab. Bogor", "Bogor Barat", "Menteng")
	if got.GetMatches() != 1 || got.GetMatch().GetDesaCode() != "32.01.02.1001" {
		t.Fatalf("Kab. settles it: got %d %+v", got.GetMatches(), got.GetMatch())
	}

	got = match(t, db, "Jambi", "Kabupaten Tanjung Jabung Barat", "Merlung", "Merlung")
	if got.GetMatches() != 2 || got.GetMatch() != nil {
		t.Fatalf("two Merlung desa: want 2 and no match, got %d %+v", got.GetMatches(), got.GetMatch())
	}
}

// No match: a level spelled otherwise (no fuzzy guessing — an alias like "DKI Jakarta" is the person's to pick), a
// desa that is not there, and a blank level.
func TestRegionMatch_NoMatch(t *testing.T) {
	db := san_testdb.DB(t)
	seedMatchTree(t, db)

	cases := [][4]string{
		{"DKI Jakarta", "Kota Jakarta Utara", "Koja", "Tugu Utara"},
		{"Jawa Barat", "Kabupaten Bogor", "Cibinong", "Pakansar"},
		{"Jawa Barat", "Kabupaten Bogor", "Bogor Tengah", "Paledang"},
		{"Jawa Barat", "Kabupaten Bogor", "Cibinong", ""},
		{"Jawa Barat", "Kab.", "Cibinong", "Pakansari"},
	}

	for _, c := range cases {
		got := match(t, db, c[0], c[1], c[2], c[3])
		if got.GetMatches() != 0 || got.GetMatch() != nil {
			t.Fatalf("%v: want no match, got %d %+v", c, got.GetMatches(), got.GetMatch())
		}
	}
}
