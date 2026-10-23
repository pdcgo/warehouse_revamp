package product_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func remove(teamID, id uint64) *connect.Request[productv1.BundleDeleteRequest] {
	return connect.NewRequest(&productv1.BundleDeleteRequest{TeamId: teamID, BundleId: id})
}

// A HARD delete: the bundle and its lines are gone (the-order-keeps-only-product-lines).
func TestBundleDelete_RemovesTheBundleAndItsLines(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER)
	beras := insertProduct(t, db, melati, "BRS", "Beras")
	b := createBundle(t, svc, ctx, melati, "Paket", lines(beras, 1))

	_, err := svc.BundleDelete(ctx, remove(melati, b.GetId()))
	if err != nil {
		t.Fatalf("BundleDelete: %v", err)
	}

	var bundles, lineRows int64
	db.Table("bundles").Where("id = ?", b.GetId()).Count(&bundles)
	db.Table("bundle_products").Where("bundle_id = ?", b.GetId()).Count(&lineRows)
	if bundles != 0 || lineRows != 0 {
		t.Fatalf("left behind: %d bundles, %d lines", bundles, lineRows)
	}

	// The product it held is untouched.
	var products int64
	db.Table("products").Where("id = ?", beras).Count(&products)
	if products != 1 {
		t.Fatal("deleting a bundle removed its product")
	}
}

// A CS deletes only her own (the-creator-or-an-admin-edits-a-bundle).
func TestBundleDelete_ACsDeletesOnlyHerOwn(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	beras := insertProduct(t, db, melati, "BRS", "Beras")
	budis := createBundle(t, svc, asPerson(budi, role_basev1.Role_ROLE_SELLING_CS), melati, "Budi's", lines(beras, 1))
	anis := createBundle(t, svc, asPerson(ani, role_basev1.Role_ROLE_SELLING_CS), melati, "Ani's", lines(beras, 1))

	_, err := svc.BundleDelete(asPerson(ani, role_basev1.Role_ROLE_SELLING_CS), remove(melati, budis.GetId()))
	if codeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("someone else's: err = %v, want PermissionDenied", err)
	}

	_, err = svc.BundleDelete(asPerson(ani, role_basev1.Role_ROLE_SELLING_CS), remove(melati, anis.GetId()))
	if err != nil {
		t.Fatalf("her own: %v", err)
	}
}

func TestBundleDelete_AnotherTeamsIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER)
	gula := insertProduct(t, db, kenanga, "GLA", "Gula")
	theirs := createBundle(t, svc, ctx, kenanga, "Paket Kenanga", lines(gula, 1))

	_, err := svc.BundleDelete(ctx, remove(melati, theirs.GetId()))
	if codeOf(err) != connect.CodeNotFound {
		t.Fatalf("err = %v, want NotFound", err)
	}
}
