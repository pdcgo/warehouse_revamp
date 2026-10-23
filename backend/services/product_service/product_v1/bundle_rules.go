package product_v1

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// The rules a bundle write keeps that no proto field can say (docs/business/product/product_bundle_decision.md,
// docs/services/product_service/rpc.md#what-a-write-checks).

var errBundleMissing = errors.New("bundle not found")

func bundleNotFound() error {
	return connect.NewError(connect.CodeNotFound, errBundleMissing)
}

// callerID is the signed-in person — who a new bundle is recorded as made by. A write with no identity is refused
// rather than recorded as made by nobody: the creator is who may change the bundle later.
func callerID(ctx context.Context) (uint64, error) {
	identity, err := san_auth.GetIdentity(ctx)
	if err != nil || identity.GetIdentityId() == 0 {
		return 0, connect.NewError(connect.CodeUnauthenticated, errors.New("no signed-in person to record as the bundle's creator"))
	}

	return identity.GetIdentityId(), nil
}

// mayChangeBundle NARROWS BundleUpdate and BundleDelete to the creator when the caller's only role in the team is
// SELLING_CS (the-creator-or-an-admin-edits-a-bundle). The proto policy already let the call in — every selling role,
// Root and the Administrator — and cannot say "only your own"; this is the part it cannot say.
//
// It reads the role the access interceptor resolved for this request's scope (san_auth.GetCallerRole). A Root or the
// Administrator reached here through the root-team bypass and holds no role in the team (ROLE_UNSPECIFIED), so they are
// not narrowed. ⚠ One edge, accepted: a person who is Root AND a CS in this team reads as the CS here.
func mayChangeBundle(ctx context.Context, bundle *product_service_models.Bundle) error {
	if san_auth.GetCallerRole(ctx) != role_basev1.Role_ROLE_SELLING_CS {
		return nil
	}

	me, err := callerID(ctx)
	if err != nil {
		return err
	}

	if bundle.CreatedByUserID != me {
		return connect.NewError(connect.CodePermissionDenied,
			errors.New("only the bundle's creator or an Admin can change it"))
	}

	return nil
}

// checkLines keeps the rules on a bundle's lines:
//
//   - each product once — the quantity is the only place the count lives (a-bundle-line-carries-its-quantity);
//   - a product the save ADDS exists and is not archived;
//   - another team's product the save ADDS only while it is not cross-locked
//     (a-borrowed-product-never-blocks-its-owner). The reserve is a stock fact, checked when an order takes the stock.
//
// `kept` holds the product ids already in the bundle: an update keeps them whatever their product has become since,
// because the owner's lock or archive never changes somebody else's bundle.
//
// ONE query for every added product, never one per line.
func checkLines(tx *gorm.DB, teamID uint64, lines []*productv1.BundleLine, kept map[uint64]bool) error {
	seen := make(map[uint64]bool, len(lines))
	added := make([]uint64, 0, len(lines))

	for _, l := range lines {
		if seen[l.GetProductId()] {
			return connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("product %d is in the bundle twice — set its quantity instead", l.GetProductId()))
		}
		seen[l.GetProductId()] = true

		if !kept[l.GetProductId()] {
			added = append(added, l.GetProductId())
		}
	}

	if len(added) == 0 {
		return nil
	}

	var products []product_service_models.Product

	err := tx.
		Select("id", "team_id", "name", "deleted", "cross_locked").
		Where("id IN ?", added).
		Find(&products).
		Error
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}

	found := make(map[uint64]*product_service_models.Product, len(products))
	for i := range products {
		found[products[i].ID] = &products[i]
	}

	for _, id := range added {
		p, ok := found[id]
		if !ok || p.Deleted {
			return connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("product %d does not exist", id))
		}

		if p.TeamID != teamID && p.CrossLocked {
			return connect.NewError(connect.CodeInvalidArgument,
				fmt.Errorf("%s is locked by its owner and cannot be added", p.Name))
		}
	}

	return nil
}

// modelLines turns the request's lines into rows, in the order given — which is the order they are read back in.
func modelLines(bundleID uint64, lines []*productv1.BundleLine) []product_service_models.BundleProduct {
	out := make([]product_service_models.BundleProduct, 0, len(lines))
	for _, l := range lines {
		out = append(out, product_service_models.BundleProduct{BundleID: bundleID, ProductID: l.GetProductId(), Quantity: l.GetQuantity()})
	}

	return out
}
