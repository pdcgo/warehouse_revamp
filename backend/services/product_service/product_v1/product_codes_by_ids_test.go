package product_v1_test

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// THE CODES THAT STILL FIND A PRODUCT (backlog #152, #141 P4 — a-team-code-change-recomposes-its-product-codes, its 🔄 *an
// old sticker scanned before the reprint*, owner Q1 "A"): each known product's code now and every code it carried before,
// read once per pick page by its item scan. The history lines are the team code change's own (RecomposeTeamCodes), so the
// former codes are what a real change leaves behind.

// fcCodes reads ProductCodesByIds as `team`.
func fcCodes(t *testing.T, svc *product_v1.Service, team uint64, ids ...uint64) map[uint64]*productv1.ProductCodes {
	t.Helper()

	res, err := svc.ProductCodesByIds(ptCtx(ptSeller), connect.NewRequest(&productv1.ProductCodesByIdsRequest{TeamId: team, ProductIds: ids}))
	if err != nil {
		t.Fatalf("ProductCodesByIds as team %d: %v", team, err)
	}

	return res.Msg.GetItems()
}

// EACH SIDE READS ITS OWN — the owning team reads its products' codes, the former ones too; a warehouse reads those of the
// products it has held (inventory's answer through the seam) and nothing else; another selling team reads none; an
// unknown id is absent; with no seam a warehouse reads none. A product whose code never changed carries no former code.
func TestProductCodesByIds_EachSideReadsItsOwn(t *testing.T) {
	db := san_testdb.DB(t)

	held := insertProduct(t, db, melati, "FC1-ABC-SHOE-42", "Sepatu")
	notHeld := insertProduct(t, db, melati, "FC1-ABC-TAS-01", "Tas")
	plain := insertProduct(t, db, melati, "PLAIN-01", "Polos")

	stock := &fakeStock{held: map[uint64][]uint64{ptWarehouse: {held, plain}}}
	svc := product_v1.NewService(db, history, teamCodes, stock, nil)

	_, err := svc.RecomposeTeamCodes(context.Background(), db, melati, "FC1-ABC", "FC1-XYZ", rcActor)
	if err != nil {
		t.Fatalf("RecomposeTeamCodes: %v", err)
	}

	all := []uint64{held, notHeld, plain, 999_999_999, held}

	owner := fcCodes(t, svc, melati, all...)
	if len(owner) != 3 {
		t.Fatalf("the owner reads %v — want its three products", owner)
	}

	if got := owner[held]; got.GetProductCode() != "FC1-XYZ-SHOE-42" || !slices.Equal(got.GetFormerCodes(), []string{"FC1-ABC-SHOE-42"}) {
		t.Errorf("the owner reads %d as %v — want FC1-XYZ-SHOE-42, formerly FC1-ABC-SHOE-42", held, got)
	}

	if got := owner[notHeld]; got.GetProductCode() != "FC1-XYZ-TAS-01" || !slices.Equal(got.GetFormerCodes(), []string{"FC1-ABC-TAS-01"}) {
		t.Errorf("the owner reads %d as %v", notHeld, got)
	}

	if got := owner[plain]; got.GetProductCode() != "PLAIN-01" || len(got.GetFormerCodes()) != 0 {
		t.Errorf("a product whose code never changed reads %v — want PLAIN-01, no former code", got)
	}

	house := fcCodes(t, svc, ptWarehouse, all...)
	if len(house) != 2 || house[held].GetProductCode() != "FC1-XYZ-SHOE-42" ||
		!slices.Equal(house[held].GetFormerCodes(), []string{"FC1-ABC-SHOE-42"}) || house[plain].GetProductCode() != "PLAIN-01" {
		t.Fatalf("the holding warehouse reads %v — want the two products it holds, the old sticker's code on one", house)
	}

	if _, ok := house[notHeld]; ok {
		t.Fatal("the warehouse reads the codes of a product it never held")
	}

	if other := fcCodes(t, svc, ptElsewhere, all...); len(other) != 0 {
		t.Fatalf("a warehouse holding none reads %v", other)
	}

	if other := fcCodes(t, svc, kenanga, all...); len(other) != 0 {
		t.Fatalf("another selling team reads %v", other)
	}

	if noSeam := fcCodes(t, newService(t, db), ptWarehouse, all...); len(noSeam) != 0 {
		t.Fatalf("with no stock seam a warehouse reads %v", noSeam)
	}
}

// EVERY FORMER CODE, NEWEST FIRST, EACH ONCE, NEVER THE LIVE ONE: ABC → XYZ → QWE leaves both former codes, the latest
// first; the team taking its own former code back (QWE → ABC, allowed by TeamCodeUpdate) wears ABC-… live again, so ABC-…
// is not a former code then, while QWE-… is — and XYZ-… is listed once, compared case-insensitively.
func TestProductCodesByIds_EveryFormerCodeNewestFirstOnce(t *testing.T) {
	db := san_testdb.DB(t)

	shoe := insertProduct(t, db, melati, "FC2-ABC-SHOE-42", "Sepatu")

	svc := product_v1.NewService(db, history, teamCodes, &fakeStock{}, nil)

	for _, step := range [][2]string{{"FC2-ABC", "FC2-XYZ"}, {"FC2-XYZ", "FC2-QWE"}} {
		_, err := svc.RecomposeTeamCodes(context.Background(), db, melati, step[0], step[1], rcActor)
		if err != nil {
			t.Fatalf("RecomposeTeamCodes %s → %s: %v", step[0], step[1], err)
		}
	}

	got := fcCodes(t, svc, melati, shoe)[shoe]
	if got.GetProductCode() != "FC2-QWE-SHOE-42" || !slices.Equal(got.GetFormerCodes(), []string{"FC2-XYZ-SHOE-42", "FC2-ABC-SHOE-42"}) {
		t.Fatalf("after two changes the product reads %v — want FC2-QWE-SHOE-42, formerly FC2-XYZ-SHOE-42 then FC2-ABC-SHOE-42", got)
	}

	_, err := svc.RecomposeTeamCodes(context.Background(), db, melati, "FC2-QWE", "FC2-ABC", rcActor)
	if err != nil {
		t.Fatalf("RecomposeTeamCodes back to the own former code: %v", err)
	}

	// The same former code a second time, in another case — one line the history could hold after a hand repair.
	err = db.Create(&product_service_models.ProductLog{
		ProductID: shoe, Kind: product_service_models.ProductLogCodeChanged, OldCode: "fc2-xyz-shoe-42", NewCode: "FC2-QWE-SHOE-42",
	}).Error
	if err != nil {
		t.Fatal(err)
	}

	got = fcCodes(t, svc, melati, shoe)[shoe]
	if got.GetProductCode() != "FC2-ABC-SHOE-42" || !slices.Equal(got.GetFormerCodes(), []string{"fc2-xyz-shoe-42", "FC2-QWE-SHOE-42"}) {
		t.Fatalf("back on its own former code the product reads %v — want FC2-ABC-SHOE-42 live, formerly fc2-xyz-shoe-42 (the "+
			"newest line, once) then FC2-QWE-SHOE-42, never its live code", got)
	}
}

// WHO MAY ASK: ProductTagsByIds' readers — every role of the owning team and of a warehouse, a READ (a monitor and an
// agent's credential reach it), scoped by the team.
func TestProductCodesByIds_Policy(t *testing.T) {
	roles, scoped, read := ptPolicy(t, "ProductCodesByIdsRequest", "ProductCodesByIds")
	tagRoles, _, _ := ptPolicy(t, "ProductTagsByIdsRequest", "ProductTagsByIds")

	want := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
		role_basev1.Role_ROLE_SELLING_CS,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	}

	if !slices.Equal(roles, want) || !slices.Equal(roles, tagRoles) || !scoped || !read {
		t.Fatalf("ProductCodesByIds: roles %v (tags' %v), scoped %v, read %v — want ProductTagsByIds' readers, scoped, a read",
			roles, tagRoles, scoped, read)
	}
}
