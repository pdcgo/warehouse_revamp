package product_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func update(id uint64, name string, ls []*productv1.BundleLine) *connect.Request[productv1.BundleUpdateRequest] {
	return connect.NewRequest(&productv1.BundleUpdateRequest{TeamId: melati, BundleId: id, Name: name, Lines: ls})
}

// An update replaces the name and EVERY line, and moves the bundle's last change.
func TestBundleUpdate_ReplacesEverything(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER)
	beras := insertProduct(t, db, melati, "BRS", "Beras")
	gula := insertProduct(t, db, kenanga, "GLA", "Gula")
	b := createBundle(t, svc, ctx, melati, "Old", lines(beras, 1, gula, 2))
	db.Exec("UPDATE bundles SET updated_at = NOW() - INTERVAL '1 day' WHERE id = ?", b.GetId())

	resp, err := svc.BundleUpdate(ctx, update(b.GetId(), "New", lines(gula, 3)))
	if err != nil {
		t.Fatalf("BundleUpdate: %v", err)
	}

	got := resp.Msg.GetBundle()
	if got.GetName() != "New" || len(got.GetLines()) != 1 || got.GetLines()[0].GetQuantity() != 3 {
		t.Fatalf("bundle = %+v", got)
	}

	var count int64
	db.Table("bundle_products").Where("bundle_id = ?", b.GetId()).Count(&count)
	if count != 1 {
		t.Fatalf("%d lines stored, want 1 — the old ones must go", count)
	}
	if got.GetUpdatedAtUnix() <= b.GetUpdatedAtUnix()-86000 {
		t.Fatalf("updated_at did not move: %d", got.GetUpdatedAtUnix())
	}
}

// the-creator-or-an-admin-edits-a-bundle: a CS changes her own; another's is PermissionDenied; an Admin changes any;
// Root (no role in the team — the root bypass) changes any.
func TestBundleUpdate_WhoMayChange(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	beras := insertProduct(t, db, melati, "BRS", "Beras")
	anis := createBundle(t, svc, asPerson(ani, role_basev1.Role_ROLE_SELLING_CS), melati, "Ani's", lines(beras, 1))
	budis := createBundle(t, svc, asPerson(budi, role_basev1.Role_ROLE_SELLING_CS), melati, "Budi's", lines(beras, 1))

	cases := []struct {
		who  string
		ctx  role_basev1.Role
		id   uint64
		want connect.Code
	}{
		{"a CS, her own", role_basev1.Role_ROLE_SELLING_CS, anis.GetId(), 0},
		{"a CS, someone else's", role_basev1.Role_ROLE_SELLING_CS, budis.GetId(), connect.CodePermissionDenied},
		{"an Admin, someone else's", role_basev1.Role_ROLE_SELLING_ADMIN, budis.GetId(), 0},
		{"the Owner, someone else's", role_basev1.Role_ROLE_SELLING_OWNER, budis.GetId(), 0},
		{"Root, through the bypass", role_basev1.Role_ROLE_UNSPECIFIED, budis.GetId(), 0},
	}

	for _, c := range cases {
		_, err := svc.BundleUpdate(asPerson(ani, c.ctx), update(c.id, "Renamed", lines(beras, 2)))
		if codeOf(err) != c.want {
			t.Errorf("%s: err = %v, want code %v", c.who, err, c.want)
		}
	}
}

// a-borrowed-product-never-blocks-its-owner: Kenanga locks — then archives — the Gula in Melati's bundle. The line stays,
// and the bundle still saves with it; only a line the save ADDS must be shareable.
func TestBundleUpdate_KeepsALineMadeUnavailableSince(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER)
	beras := insertProduct(t, db, melati, "BRS", "Beras")
	gula := insertProduct(t, db, kenanga, "GLA", "Gula")
	b := createBundle(t, svc, ctx, melati, "Paket Hemat", lines(beras, 1, gula, 2))

	setProduct(t, db, gula, "cross_locked", true)
	_, err := svc.BundleUpdate(ctx, update(b.GetId(), "Renamed", lines(beras, 1, gula, 2)))
	if err != nil {
		t.Fatalf("a kept locked line refused: %v", err)
	}

	setProduct(t, db, gula, "deleted", true)
	_, err = svc.BundleUpdate(ctx, update(b.GetId(), "Renamed again", lines(beras, 1, gula, 3)))
	if err != nil {
		t.Fatalf("a kept archived line refused: %v", err)
	}
}

// …but a line the save ADDS is checked: another team's locked product, or an archived one, is refused.
func TestBundleUpdate_RefusesAddingAnUnavailableProduct(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER)
	beras := insertProduct(t, db, melati, "BRS", "Beras")
	locked := insertProduct(t, db, kenanga, "LCK", "Locked")
	setProduct(t, db, locked, "cross_locked", true)
	archived := insertProduct(t, db, melati, "OLD", "Archived")
	setProduct(t, db, archived, "deleted", true)
	b := createBundle(t, svc, ctx, melati, "Paket", lines(beras, 1))

	for name, ls := range map[string][]*productv1.BundleLine{
		"another team's locked product": lines(beras, 1, locked, 1),
		"an archived product":           lines(beras, 1, archived, 1),
		"a product twice":               lines(beras, 1, beras, 1),
	} {
		_, err := svc.BundleUpdate(ctx, update(b.GetId(), "Paket", ls))
		if codeOf(err) != connect.CodeInvalidArgument {
			t.Errorf("%s: err = %v, want InvalidArgument", name, err)
		}
	}

	// Nothing of a refused save was written.
	var count int64
	db.Table("bundle_products").Where("bundle_id = ?", b.GetId()).Count(&count)
	if count != 1 {
		t.Fatalf("%d lines after refused saves, want the original 1", count)
	}
}

// Another team's bundle is NotFound — the same answer as one that does not exist.
func TestBundleUpdate_AnotherTeamsIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER)
	gula := insertProduct(t, db, kenanga, "GLA", "Gula")
	theirs := createBundle(t, svc, ctx, kenanga, "Paket Kenanga", lines(gula, 1))

	_, err := svc.BundleUpdate(ctx, update(theirs.GetId(), "Mine now", lines(gula, 1)))
	if codeOf(err) != connect.CodeNotFound {
		t.Fatalf("err = %v, want NotFound", err)
	}
}
