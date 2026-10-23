package product_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The team's bundles by id, lines included. Another team's id, and one that does not exist, are simply absent.
func TestBundleByIds_TheTeamsOnly(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER)
	beras := insertProduct(t, db, melati, "BRS", "Beras")
	gula := insertProduct(t, db, kenanga, "GLA", "Gula")

	ours := createBundle(t, svc, ctx, melati, "Paket Hemat", lines(beras, 1, gula, 2))
	theirs := createBundle(t, svc, ctx, kenanga, "Paket Kenanga", lines(gula, 1))

	resp, err := svc.BundleByIds(ctx, connect.NewRequest(&productv1.BundleByIdsRequest{
		TeamId: melati,
		Filter: &productv1.BundleByIdsFilter{Ids: []uint64{ours.GetId(), theirs.GetId(), 999999}},
	}))
	if err != nil {
		t.Fatalf("BundleByIds: %v", err)
	}

	rows := bundleByIdsRows(resp.Msg.GetItems())
	if len(rows) != 1 {
		t.Fatalf("rows = %v, want only %d", rows, ours.GetId())
	}
	got := rows[ours.GetId()]
	if got.GetName() != "Paket Hemat" || len(got.GetLines()) != 2 || got.GetLines()[1].GetProductId() != gula {
		t.Fatalf("bundle = %+v", got)
	}
}

// The GENERAL slice answers id and name alone.
func TestBundleByIds_GeneralSlice(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER)
	beras := insertProduct(t, db, melati, "BRS", "Beras")
	b := createBundle(t, svc, ctx, melati, "3-pack", lines(beras, 3))

	resp, err := svc.BundleByIds(ctx, connect.NewRequest(&productv1.BundleByIdsRequest{
		TeamId:      melati,
		Filter:      &productv1.BundleByIdsFilter{Ids: []uint64{b.GetId()}},
		DataRequest: []productv1.BundleByIdsDataType{productv1.BundleByIdsDataType_BUNDLE_BY_IDS_DATA_TYPE_GENERAL},
	}))
	if err != nil {
		t.Fatalf("BundleByIds: %v", err)
	}

	items := resp.Msg.GetItems()[b.GetId()].GetItems()
	if len(items) != 1 || items[0].GetGeneral().GetMapData()[b.GetId()].GetName() != "3-pack" {
		t.Fatalf("items = %+v", items)
	}
}
