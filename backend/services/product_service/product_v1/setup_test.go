package product_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

func newService(t *testing.T, db *gorm.DB) *product_v1.Service {
	t.Helper()

	return product_v1.NewService(db)
}

// listRows pulls the PRODUCT (row) slice out of a guideline list response, keyed by product id. The
// list handlers default an empty data_request to the PRODUCT slice, so callers that don't set one get
// it here.
func listRows(items []*productv1.ProductListResponseItem) map[uint64]*productv1.ProductRowItem {
	for _, it := range items {
		row := it.GetProduct()
		if row != nil {
			return row.GetMapData()
		}
	}

	return map[uint64]*productv1.ProductRowItem{}
}

// byIdsRows flattens a by-ids response (map id -> list of slices) to the PRODUCT row per id.
func byIdsRows(items map[uint64]*productv1.ProductByIdsResponseList) map[uint64]*productv1.ProductRowItem {
	out := map[uint64]*productv1.ProductRowItem{}

	for id, list := range items {
		for _, it := range list.GetItems() {
			row := it.GetProduct()
			if row == nil {
				continue
			}

			r, ok := row.GetMapData()[id]
			if ok {
				out[id] = r
			}
		}
	}

	return out
}

// insertProduct seeds an active product directly and returns its id.
func insertProduct(t *testing.T, db *gorm.DB, teamID uint64, sku, name string) uint64 {
	t.Helper()

	p := product_service_models.Product{TeamID: teamID, SKU: sku, Name: name}

	err := db.Create(&p).Error
	if err != nil {
		t.Fatalf("insert product: %v", err)
	}

	return p.ID
}

// ── Bundles ─────────────────────────────────────────────────────────────────────────────────────────

// asPerson is a request context as the access interceptor leaves it for a bundle handler: who is calling, and their
// role in the scoped team. ROLE_UNSPECIFIED is Root or the Administrator, in by the root-team bypass.
func asPerson(userID uint64, role role_basev1.Role) context.Context {
	ctx := san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: userID})

	return san_auth.WithCallerRole(ctx, role)
}

// lines builds a bundle's lines from (product id, quantity) pairs.
func lines(pairs ...uint64) []*productv1.BundleLine {
	out := make([]*productv1.BundleLine, 0, len(pairs)/2)
	for i := 0; i+1 < len(pairs); i += 2 {
		out = append(out, &productv1.BundleLine{ProductId: pairs[i], Quantity: uint32(pairs[i+1])})
	}

	return out
}

// createBundle makes a bundle through the handler and fails the test if it is refused.
func createBundle(t *testing.T, svc *product_v1.Service, ctx context.Context, teamID uint64, name string, ls []*productv1.BundleLine) *productv1.BundleRowItem {
	t.Helper()

	resp, err := svc.BundleCreate(ctx, connect.NewRequest(&productv1.BundleCreateRequest{TeamId: teamID, Name: name, Lines: ls}))
	if err != nil {
		t.Fatalf("BundleCreate %q: %v", name, err)
	}

	return resp.Msg.GetBundle()
}

// bundleListRows pulls the BUNDLE slice out of a list response, keyed by bundle id.
func bundleListRows(items []*productv1.BundleListResponseItem) map[uint64]*productv1.BundleRowItem {
	for _, it := range items {
		row := it.GetBundle()
		if row != nil {
			return row.GetMapData()
		}
	}

	return map[uint64]*productv1.BundleRowItem{}
}

// bundleByIdsRows flattens a by-ids response to the BUNDLE row per id.
func bundleByIdsRows(items map[uint64]*productv1.BundleByIdsResponseList) map[uint64]*productv1.BundleRowItem {
	out := map[uint64]*productv1.BundleRowItem{}

	for id, list := range items {
		for _, it := range list.GetItems() {
			row := it.GetBundle()
			if row == nil {
				continue
			}

			r, ok := row.GetMapData()[id]
			if ok {
				out[id] = r
			}
		}
	}

	return out
}

// setProduct changes one column of a seeded product — its owner locking it, or archiving it.
func setProduct(t *testing.T, db *gorm.DB, productID uint64, column string, value any) {
	t.Helper()

	err := db.Model(&product_service_models.Product{}).Where("id = ?", productID).Update(column, value).Error
	if err != nil {
		t.Fatalf("set product %d %s: %v", productID, column, err)
	}
}

// codeOf is the Connect code of an error, or 0 for nil.
func codeOf(err error) connect.Code {
	if err == nil {
		return 0
	}

	return connect.CodeOf(err)
}
