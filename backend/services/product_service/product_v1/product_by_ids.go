package product_v1

import (
	"context"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
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
func (s *Service) ProductByIds(
	ctx context.Context,
	req *connect.Request[productv1.ProductByIdsRequest],
) (*connect.Response[productv1.ProductByIdsResponse], error) {
	var products []product_service_models.Product

	err := s.db.
		WithContext(ctx).
		Where("id IN ?", req.Msg.GetProductIds()).
		Find(&products).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	out := make([]*productv1.Product, 0, len(products))
	for i := range products {
		out = append(out, toProto(&products[i]))
	}

	return connect.NewResponse(&productv1.ProductByIdsResponse{Products: out}), nil
}
