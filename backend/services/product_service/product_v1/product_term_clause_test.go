package product_v1_test

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// THE PRODUCT SEARCH FINDS A FORMER CODE (backlog #152 — a-team-code-change-recomposes-its-product-codes, its 🔄 *an old
// sticker scanned before the reprint*, owner Q1 "A"): the seller's Products list (ProductList's `q`) and the warehouse's
// (SearchAmong — its list and its picker) find a product by a code it carried before, typed WHOLE in any case — never by
// a piece of a former code — and the live code, the name and their pieces still match as before.

// ftSearchList is the seller's Products list searched for `q` — the ids found and the count, on the tab asked.
func ftSearchList(t *testing.T, svc *product_v1.Service, team uint64, q string, archived bool) ([]uint64, uint64) {
	t.Helper()

	status := productv1.ProductStatus_PRODUCT_STATUS_ACTIVE
	if archived {
		status = productv1.ProductStatus_PRODUCT_STATUS_ARCHIVED
	}

	res, err := svc.ProductList(context.Background(), connect.NewRequest(&productv1.ProductListRequest{
		TeamId: team,
		Filter: &productv1.ProductListFilter{Q: q, Status: status},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductList(q %q): %v", q, err)
	}

	ids := slices.Clone(res.Msg.GetIds())
	slices.Sort(ids)

	return ids, res.Msg.GetPageInfo().GetTotalItems()
}

// ftSearchAmong is the warehouse's search among the ids it holds.
func ftSearchAmong(t *testing.T, svc *product_v1.Service, held []uint64, q string) ([]uint64, int64) {
	t.Helper()

	rows, total, err := svc.SearchAmong(context.Background(), product_v1.ProductSearchAmong{IDs: held, Q: q, Limit: 50})
	if err != nil {
		t.Fatalf("SearchAmong(q %q): %v", q, err)
	}

	ids := make([]uint64, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.GetId())
	}

	slices.Sort(ids)

	return ids, total
}

// THE SELLER'S LIST: Melati's code went FT1-ABC → FT1-XYZ, so its shoe is FT1-XYZ-SHOE-42 and was FT1-ABC-SHOE-42. The old
// code typed whole — in any case, with spaces around — finds it; a piece of the old code finds nothing (FT1-ABC-SHOE-4,
// FT1-ABC); the live code and its piece find it as before. An archived product's former code finds it on the archived tab
// only. Another team's product that once carried the same code never shows in Melati's list.
func TestProductList_FindsAFormerCodeWhole(t *testing.T) {
	db := san_testdb.DB(t)

	shoe := insertProduct(t, db, melati, "FT1-ABC-SHOE-42", "Sepatu Lari")
	shoe4 := insertProduct(t, db, melati, "FT1-ABC-SHOE-4", "Sepatu Anak")
	bag := insertProduct(t, db, melati, "FT1-ABC-TAS-01", "Tas Ransel")
	theirs := insertProduct(t, db, kenanga, "FT1-KNG-SHOE-42", "Sepatu Mereka")

	rcArchive(t, db, bag)

	svc := product_v1.NewService(db, history, teamCodes, &fakeStock{}, nil)

	_, err := svc.RecomposeTeamCodes(context.Background(), db, melati, "FT1-ABC", "FT1-XYZ", rcActor)
	if err != nil {
		t.Fatalf("RecomposeTeamCodes: %v", err)
	}

	// Kenanga's product once carried Melati's old code too — a line the history could hold only through a dash in a team
	// code (the recompose's clash rule), seeded straight.
	err = db.Create(&product_service_models.ProductLog{
		ProductID: theirs, Kind: product_service_models.ProductLogCodeChanged, OldCode: "FT1-ABC-SHOE-42", NewCode: "FT1-KNG-SHOE-42",
	}).Error
	if err != nil {
		t.Fatal(err)
	}

	for _, c := range []struct {
		q        string
		archived bool
		want     []uint64
	}{
		{"FT1-ABC-SHOE-42", false, []uint64{shoe}},
		{"ft1-abc-shoe-42", false, []uint64{shoe}},
		{"  Ft1-Abc-Shoe-42  ", false, []uint64{shoe}},
		{"FT1-ABC-SHOE-4", false, []uint64{shoe4}}, // shoe4's own former code — whole — and never a piece of shoe's
		{"FT1-ABC", false, nil},
		{"ABC-SHOE", false, nil},
		{"FT1-XYZ-SHOE-42", false, []uint64{shoe}},
		{"XYZ-SHOE", false, []uint64{shoe, shoe4}},
		{"sepatu", false, []uint64{shoe, shoe4}},
		{"FT1-ABC-TAS-01", false, nil},
		{"FT1-ABC-TAS-01", true, []uint64{bag}},
	} {
		ids, total := ftSearchList(t, svc, melati, c.q, c.archived)
		if !slices.Equal(ids, c.want) || total != uint64(len(c.want)) {
			t.Errorf("Melati's list (archived %v) searched %q found %v (total %d), want %v", c.archived, c.q, ids, total, c.want)
		}
	}

	if ids, _ := ftSearchList(t, svc, kenanga, "FT1-ABC-SHOE-42", false); !slices.Equal(ids, []uint64{theirs}) {
		t.Errorf("Kenanga's list searched its own former code found %v, want only %d", ids, theirs)
	}
}

// THE WAREHOUSE'S LIST (SearchAmong, among the ids inventory says it holds): the old code typed whole finds a held product
// by it; a piece of it finds nothing; a product OUTSIDE the held set that carried the same code stays out — the former
// code never reaches past the products the list may show.
func TestSearchAmong_FindsAFormerCodeWhole(t *testing.T) {
	db := san_testdb.DB(t)

	shoe := insertProduct(t, db, melati, "FT2-ABC-SHOE-42", "Sepatu Lari")
	other := insertProduct(t, db, melati, "FT2-ABC-SOCK-01", "Kaus Kaki")
	outside := insertProduct(t, db, kenanga, "FT2-KNG-SHOE-42", "Sepatu Luar")

	svc := product_v1.NewService(db, history, teamCodes, &fakeStock{}, nil)

	_, err := svc.RecomposeTeamCodes(context.Background(), db, melati, "FT2-ABC", "FT2-XYZ", rcActor)
	if err != nil {
		t.Fatalf("RecomposeTeamCodes: %v", err)
	}

	err = db.Create(&product_service_models.ProductLog{
		ProductID: outside, Kind: product_service_models.ProductLogCodeChanged, OldCode: "FT2-ABC-SHOE-42", NewCode: "FT2-KNG-SHOE-42",
	}).Error
	if err != nil {
		t.Fatal(err)
	}

	held := []uint64{shoe, other}

	for _, c := range []struct {
		q    string
		want []uint64
	}{
		{"FT2-ABC-SHOE-42", []uint64{shoe}},
		{"ft2-abc-shoe-42", []uint64{shoe}},
		{"FT2-ABC-SHOE", nil},
		{"FT2-XYZ-SHOE-42", []uint64{shoe}},
		{"FT2-XYZ", []uint64{shoe, other}},
		{"", []uint64{shoe, other}},
	} {
		ids, total := ftSearchAmong(t, svc, held, c.q)
		if !slices.Equal(ids, c.want) || total != int64(len(c.want)) {
			t.Errorf("the held search for %q found %v (total %d), want %v", c.q, ids, total, c.want)
		}
	}
}
