package product_v1

import (
	"context"
	"slices"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
)

// ProductTagsByIds answers the tags of KNOWN products — for a page that names a product by id and has no owner's read to
// carry them: the warehouse's product page (read-only chips under the code, the-team-code-and-product-tags-prototype-is-
// accepted). Each side reads only its own (products-have-their-own-tag-list, its 🔄 *who sees*) — readableByIds, the rule
// ProductCodesByIds reads by too:
//
//   - the scoped team's OWN products — the owner reads its tags wherever it stands;
//   - for a WAREHOUSE, the products it has held — every product with a batch there, at 0 too, the very set its Products
//     list shows (a-warehouses-products-is-what-it-holds). Inventory knows it; it is asked in-process through the
//     StockNarrower seam (HeldAmong, over inventory's own batches — HARD RULE 3), only for the ids the team does not own.
//
// Any other id — another team's product a Discover page names, an unknown id — is ABSENT, never refused: one id the
// caller may not see never blanks the rest. A seen product with no tags carries an empty set. With no stock seam (a
// test's nil) a warehouse reads none: the answer never reaches past what can be proven. A read.
func (s *Service) ProductTagsByIds(
	ctx context.Context,
	req *connect.Request[productv1.ProductTagsByIdsRequest],
) (*connect.Response[productv1.ProductTagsByIdsResponse], error) {
	teamID := req.Msg.GetTeamId()

	ids := slices.Clone(req.Msg.GetProductIds())
	slices.Sort(ids)
	ids = slices.Compact(ids)

	db := s.db.WithContext(ctx)

	visible, err := s.readableByIds(ctx, db, teamID, ids)
	if err != nil {
		return nil, err
	}

	tags, err := productTagsOf(db, visible)
	if err != nil {
		return nil, dbError(err)
	}

	items := make(map[uint64]*productv1.ProductTagSet, len(visible))
	for _, id := range visible {
		items[id] = &productv1.ProductTagSet{Tags: tags[id]}
	}

	return connect.NewResponse(&productv1.ProductTagsByIdsResponse{Items: items}), nil
}
