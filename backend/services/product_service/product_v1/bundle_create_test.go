package product_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

const (
	melati  = uint64(12) // the selling team making bundles
	kenanga = uint64(13) // another selling team, whose products Melati borrows
	ani     = uint64(61)
	budi    = uint64(62)
)

// A bundle is its lines in the order they were given, recorded as made by the caller.
func TestBundleCreate_RecordsLinesAndCreator(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	beras := insertProduct(t, db, melati, "BRS", "Beras")
	gula := insertProduct(t, db, kenanga, "GLA", "Gula")

	got := createBundle(t, svc, asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER), melati, "  Paket Hemat  ", lines(gula, 2, beras, 1))

	if got.GetId() == 0 || got.GetTeamId() != melati || got.GetName() != "Paket Hemat" {
		t.Fatalf("bundle = %+v, want team %d named \"Paket Hemat\" (trimmed)", got, melati)
	}
	if got.GetCreatedByUserId() != ani {
		t.Fatalf("created_by = %d, want %d", got.GetCreatedByUserId(), ani)
	}
	ls := got.GetLines()
	if len(ls) != 2 || ls[0].GetProductId() != gula || ls[0].GetQuantity() != 2 || ls[1].GetProductId() != beras {
		t.Fatalf("lines = %+v, want Gula×2 then Beras×1", ls)
	}
	if got.GetCreatedAtUnix() == 0 || got.GetUpdatedAtUnix() == 0 {
		t.Fatalf("timestamps not set: %+v", got)
	}
}

// the-creator-or-an-admin-edits-a-bundle: a CS may make one.
func TestBundleCreate_CsMayCreate(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	beras := insertProduct(t, db, melati, "BRS", "Beras")

	got := createBundle(t, svc, asPerson(ani, role_basev1.Role_ROLE_SELLING_CS), melati, "3-pack", lines(beras, 3))
	if got.GetCreatedByUserId() != ani {
		t.Fatalf("created_by = %d, want %d", got.GetCreatedByUserId(), ani)
	}
}

// bundle-names-may-repeat: a second "Paket Hemat" in the same team is not refused.
func TestBundleCreate_NamesMayRepeat(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	beras := insertProduct(t, db, melati, "BRS", "Beras")
	ctx := asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER)

	first := createBundle(t, svc, ctx, melati, "Paket Hemat", lines(beras, 1))
	second := createBundle(t, svc, ctx, melati, "Paket Hemat", lines(beras, 2))
	if first.GetId() == second.GetId() {
		t.Fatal("two bundles of one name share an id")
	}
}

// The line rules (checkLines) on a create: each refusal is InvalidArgument, and nothing is written.
func TestBundleCreate_RefusesBadLines(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER)

	beras := insertProduct(t, db, melati, "BRS", "Beras")
	archived := insertProduct(t, db, melati, "OLD", "Archived")
	setProduct(t, db, archived, "deleted", true)
	theirsLocked := insertProduct(t, db, kenanga, "LCK", "Kenanga Locked")
	setProduct(t, db, theirsLocked, "cross_locked", true)

	cases := map[string][]*productv1.BundleLine{
		"a product twice":               lines(beras, 1, beras, 2),
		"an archived product":           lines(archived, 1),
		"another team's locked product": lines(theirsLocked, 1),
		"a product that does not exist": lines(999999, 1),
	}

	for name, ls := range cases {
		_, err := svc.BundleCreate(ctx, connect.NewRequest(&productv1.BundleCreateRequest{TeamId: melati, Name: "X", Lines: ls}))
		if codeOf(err) != connect.CodeInvalidArgument {
			t.Errorf("%s: err = %v, want InvalidArgument", name, err)
		}
	}

	var count int64
	db.Table("bundles").Where("team_id = ?", melati).Count(&count)
	if count != 0 {
		t.Fatalf("%d bundles written by refused creates", count)
	}
}

// A lock only stops OTHER teams: the owner may bundle its own locked product, and another team's unlocked one is fine.
func TestBundleCreate_LockStopsOnlyOtherTeams(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER)

	ownLocked := insertProduct(t, db, melati, "OWN", "Own Locked")
	setProduct(t, db, ownLocked, "cross_locked", true)
	theirsOpen := insertProduct(t, db, kenanga, "OPN", "Kenanga Open")

	createBundle(t, svc, ctx, melati, "Mixed", lines(ownLocked, 1, theirsOpen, 1))
}

func TestBundleCreate_RefusesABlankName(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	beras := insertProduct(t, db, melati, "BRS", "Beras")

	_, err := svc.BundleCreate(asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER), connect.NewRequest(&productv1.BundleCreateRequest{
		TeamId: melati, Name: "   ", Lines: lines(beras, 1),
	}))
	if codeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("err = %v, want InvalidArgument", err)
	}
}

// The creator is who may change a bundle later, so a create with nobody signed in is refused, not recorded as nobody's.
func TestBundleCreate_NeedsSomebodySignedIn(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	beras := insertProduct(t, db, melati, "BRS", "Beras")

	_, err := svc.BundleCreate(context.Background(), connect.NewRequest(&productv1.BundleCreateRequest{
		TeamId: melati, Name: "X", Lines: lines(beras, 1),
	}))
	if codeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("err = %v, want Unauthenticated", err)
	}
}
