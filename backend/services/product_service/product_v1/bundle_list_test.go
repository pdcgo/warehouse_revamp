package product_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func page(n, limit uint32) *commonv1.CommonPagination {
	return &commonv1.CommonPagination{Page: n, Limit: limit}
}

// The team's own bundles, each with its lines, the last change first — and nobody else's.
func TestBundleList_OnlyTheTeamsLastChangeFirst(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER)
	beras := insertProduct(t, db, melati, "BRS", "Beras")

	older := createBundle(t, svc, ctx, melati, "Older", lines(beras, 1))
	newer := createBundle(t, svc, ctx, melati, "Newer", lines(beras, 2))
	createBundle(t, svc, ctx, kenanga, "Kenanga's", lines(beras, 1))
	db.Exec("UPDATE bundles SET updated_at = NOW() - INTERVAL '1 day' WHERE id = ?", older.GetId())

	resp, err := svc.BundleList(ctx, connect.NewRequest(&productv1.BundleListRequest{TeamId: melati, Page: page(1, 20)}))
	if err != nil {
		t.Fatalf("BundleList: %v", err)
	}

	ids := resp.Msg.GetIds()
	if len(ids) != 2 || ids[0] != newer.GetId() || ids[1] != older.GetId() {
		t.Fatalf("ids = %v, want [%d %d]", ids, newer.GetId(), older.GetId())
	}
	rows := bundleListRows(resp.Msg.GetItems())
	if got := rows[newer.GetId()].GetLines(); len(got) != 1 || got[0].GetQuantity() != 2 {
		t.Fatalf("Newer's lines = %+v", got)
	}
	if resp.Msg.GetPageInfo().GetTotalItems() != 2 {
		t.Fatalf("total = %d, want 2", resp.Msg.GetPageInfo().GetTotalItems())
	}
}

// `q` reaches into the lines: a bundle is found by its name, or by a product's name or code.
func TestBundleList_SearchesNameAndProducts(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER)
	beras := insertProduct(t, db, melati, "BRS-5K", "Beras Pandan")
	gula := insertProduct(t, db, kenanga, "GLA-1K", "Gula Pasir")

	hemat := createBundle(t, svc, ctx, melati, "Paket Hemat", lines(beras, 1, gula, 2))
	dapur := createBundle(t, svc, ctx, melati, "Paket Dapur", lines(beras, 1))

	for q, want := range map[string][]uint64{
		"hemat":   {hemat.GetId()},
		"gula":    {hemat.GetId()},
		"brs-5k":  {dapur.GetId(), hemat.GetId()},
		"nothing": {},
	} {
		resp, err := svc.BundleList(ctx, connect.NewRequest(&productv1.BundleListRequest{
			TeamId: melati, Filter: &productv1.BundleListFilter{Q: q}, Page: page(1, 20),
		}))
		if err != nil {
			t.Fatalf("q=%q: %v", q, err)
		}

		got := map[uint64]bool{}
		for _, id := range resp.Msg.GetIds() {
			got[id] = true
		}
		if len(got) != len(want) {
			t.Errorf("q=%q: ids = %v, want %v", q, resp.Msg.GetIds(), want)
			continue
		}
		for _, id := range want {
			if !got[id] {
				t.Errorf("q=%q: missing %d in %v", q, id, resp.Msg.GetIds())
			}
		}
		if resp.Msg.GetPageInfo().GetTotalItems() != uint64(len(want)) {
			t.Errorf("q=%q: total = %d, want %d — a search must not count a bundle once per matching line", q, resp.Msg.GetPageInfo().GetTotalItems(), len(want))
		}
	}
}

// By name, A to Z — and two bundles of one name keep a stable order across pages.
func TestBundleList_SortsByNameAndPages(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := asPerson(ani, role_basev1.Role_ROLE_SELLING_OWNER)
	beras := insertProduct(t, db, melati, "BRS", "Beras")

	b := createBundle(t, svc, ctx, melati, "B", lines(beras, 1))
	a1 := createBundle(t, svc, ctx, melati, "A", lines(beras, 1))
	a2 := createBundle(t, svc, ctx, melati, "A", lines(beras, 2))

	byName := &productv1.BundleListFilterSort{
		SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_ASC,
		S:        &productv1.BundleListFilterSort_Bundle{Bundle: productv1.BundleRowSort_BUNDLE_ROW_SORT_NAME},
	}

	var seen []uint64
	for n := uint32(1); n <= 3; n++ {
		resp, err := svc.BundleList(ctx, connect.NewRequest(&productv1.BundleListRequest{TeamId: melati, Sort: byName, Page: page(n, 1)}))
		if err != nil {
			t.Fatalf("page %d: %v", n, err)
		}
		seen = append(seen, resp.Msg.GetIds()...)
	}

	want := []uint64{a1.GetId(), a2.GetId(), b.GetId()}
	if len(seen) != 3 || seen[0] != want[0] || seen[1] != want[1] || seen[2] != want[2] {
		t.Fatalf("pages = %v, want %v", seen, want)
	}
}
