package product_v1

import (
	"context"
	"errors"
	"slices"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// ProductByIds resolves ids the caller ALREADY HOLDS into products, whoever owns them (#138).
//
// It exists because a warehouse physically holds other teams' goods: a selling team raises a restock
// for its own product, and fulfilling it puts that product on the warehouse's shelf. So "what is on
// rack A-01-3" starts from stock rows whose product ids belong to somebody else's catalogue, and a
// screen that could only name the warehouse's OWN products would silently omit half the shelf.
//
// Like ProductDiscover it does NOT filter by team — `team_id` on the request only authorizes the
// caller (use_scope), and each returned Product still carries its owning team_id. Unlike Discover, it
// serves WAREHOUSE roles too, which is the whole point: Discover is a selling team's "find things to
// sell", and a warehouse's question is "what is this box on my shelf?".
//
// It does not paginate, and does not need to: the caller supplies the set, so the response can never
// exceed what was asked for. The contract's max_items is what stops this becoming a bulk export.
//
// A missing id is ABSENT from the response, not an error — a caller holding a stock row for a product
// that was since deleted is asking a reasonable question, and failing the whole lookup would blank a
// rack over one dead id. Note this DOES return soft-deleted products: stock outlives a catalogue entry,
// and a shelf holding a deleted product should name it rather than show a blank. `Product.deleted` is
// on the wire, so a caller that cares can tell.
//
// ── The IMAGES slice is Discover's ─────────────────────────────────────────────────────────────────
//
// A by-ids row carries the cover alone; the whole gallery is the IMAGES slice, asked by the discover detail so a team
// reading ANOTHER team's product sees its pictures as the owner's page shows them (the-discover-detail-shows-no-markup).
// It is the pictures and nothing else — ProductDetail, the one other read of the gallery, answers only the owning team
// and carries the whole record. Discover serves no warehouse (ProductDiscover's policy), so neither does this slice: a
// warehouse role asking for it is refused, while the rest of this read still answers a warehouse as it always has. The
// proto has no words for "this slice, these roles", so the handler narrows (san_auth.GetCallerRole — it may refuse what
// the policy let in, never admit what it refused).
func (s *Service) ProductByIds(
	ctx context.Context,
	req *connect.Request[productv1.ProductByIdsRequest],
) (*connect.Response[productv1.ProductByIdsResponse], error) {
	withImages := slices.Contains(req.Msg.GetDataRequest(), productv1.ProductByIdsDataType_PRODUCT_BY_IDS_DATA_TYPE_IMAGES)

	if withImages && isWarehouseRole(san_auth.GetCallerRole(ctx)) {
		return nil, connect.NewError(connect.CodePermissionDenied, errImagesAreDiscovers)
	}

	var products []product_service_models.Product

	err := s.db.
		WithContext(ctx).
		Where("id IN ?", req.Msg.GetFilter().GetIds()).
		Find(&products).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	var images map[uint64][]product_service_models.ProductImage

	if withImages && len(products) > 0 {
		images, err = s.galleriesOf(ctx, products)
		if err != nil {
			return nil, dbError(err)
		}
	}

	return connect.NewResponse(&productv1.ProductByIdsResponse{
		Items: productByIdsMap(products, req.Msg.GetDataRequest(), images),
	}), nil
}

// errImagesAreDiscovers is the IMAGES slice refused to a warehouse role — Discover's rule.
var errImagesAreDiscovers = errors.New("a product's gallery is read on Discover, which serves selling teams only")

// isWarehouseRole is whether the caller's role in the scoped team is a warehouse's.
func isWarehouseRole(role role_basev1.Role) bool {
	switch role {
	case role_basev1.Role_ROLE_WAREHOUSE_OWNER, role_basev1.Role_ROLE_WAREHOUSE_ADMIN, role_basev1.Role_ROLE_WAREHOUSE_STAFF:
		return true
	default:
		return false
	}
}

// galleriesOf reads the found products' images in ONE statement, each product's in gallery order (position, then id —
// ProductDetail's order), over product_images_product_idx (product_id, position). At most 200 products × 5 pictures.
func (s *Service) galleriesOf(
	ctx context.Context,
	products []product_service_models.Product,
) (map[uint64][]product_service_models.ProductImage, error) {
	ids := make([]uint64, 0, len(products))
	for i := range products {
		ids = append(ids, products[i].ID)
	}

	var rows []product_service_models.ProductImage

	err := s.db.
		WithContext(ctx).
		Where("product_id IN ?", ids).
		Order("product_id ASC").
		Order("position ASC").
		Order("id ASC").
		Find(&rows).
		Error
	if err != nil {
		return nil, err
	}

	out := make(map[uint64][]product_service_models.ProductImage, len(products))
	for _, row := range rows {
		out[row.ProductID] = append(out[row.ProductID], row)
	}

	return out, nil
}
