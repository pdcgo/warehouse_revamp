package product_v1_test

import (
	"context"
	"slices"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// A supplier's Produk tab searches ONLY among the products bought from it (the-products-tab-searches-and-pages): by name
// or by SKU, anywhere, any case — archived ones too — and never a product outside the set, however well it matches.
func TestIDsMatchingAmong_MatchesOnlyTheGivenProducts(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	kain := insertProduct(t, db, 2, "T2-KTN-01", "Kain Katun Jepang")
	benang := insertProduct(t, db, 3, "T3-BNG-40", "Benang Polyester")
	retired := insertProduct(t, db, 2, "T2-KTN-OLD", "Kain Lama")
	outside := insertProduct(t, db, 4, "T4-KTN-09", "Kain Katun Jepang")
	percent := insertProduct(t, db, 2, "T2-DSK-50", "Diskon 50% Kain")

	err := db.
		Model(&product_service_models.Product{}).
		Where("id = ?", retired).
		Update("archived", true).
		Error
	if err != nil {
		t.Fatalf("archive: %v", err)
	}

	bought := []uint64{kain, benang, retired, percent}

	cases := []struct {
		q    string
		want []uint64
	}{
		{"katun", []uint64{kain}},
		{"KTN", []uint64{kain, retired}},           // the SKU, any case — archived in
		{"kain", []uint64{kain, retired, percent}}, // anywhere in the name
		{"bng-40", []uint64{benang}},               // part of a SKU
		{"50%", []uint64{percent}},                 // a wildcard is a character, not "anything"
		{"%", []uint64{percent}},                   // ...so a lone % matches only a name holding one
		{"zzz", nil},
		{"  ", nil}, // no term, no match — the caller asks only with one
	}

	for _, c := range cases {
		got, err := svc.IDsMatchingAmong(context.Background(), bought, c.q)
		if err != nil {
			t.Fatalf("%q: %v", c.q, err)
		}

		if slices.Contains(got, outside) {
			t.Fatalf("%q matched %d — a product outside the set", c.q, outside)
		}

		if !slices.Equal(got, c.want) {
			t.Fatalf("%q = %v, want %v", c.q, got, c.want)
		}
	}

	none, err := svc.IDsMatchingAmong(context.Background(), nil, "kain")
	if err != nil || len(none) != 0 {
		t.Fatalf("an empty set = %v, %v — want nothing", none, err)
	}
}
