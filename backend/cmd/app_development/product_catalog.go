package main

import (
	"context"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// productCatalog joins selling_service to product_service (#194): promoting a draft into an order
// needs each mapped product's sku and name, because a draft line stores only an id and an order line
// freezes the label.
//
// Same shape and same reasoning as stockPicker beside it — the composition root is the one place
// allowed to know about two services at once, selling declares the interface it needs in its own
// terms, and this adapter is the whole dependency between them.
//
// It calls the handler directly, skipping the access interceptor, on the same grounds: promote has
// already run its own policy against the selling team, and ProductByIds is scoped to that same team,
// so the check being skipped is the one that just ran. The RPC stays in the contract and stays
// policed for external callers.
type productCatalog struct {
	products *product_v1.Service
}

func NewProductCatalog(products *product_v1.Service) selling_v1.ProductCatalog {
	return &productCatalog{products: products}
}

func (c *productCatalog) Snapshots(
	ctx context.Context,
	sellingTeamID uint64,
	productIDs []uint64,
) (map[uint64]selling_v1.ProductSnapshot, error) {
	snapshots := map[uint64]selling_v1.ProductSnapshot{}

	// ProductByIds requires at least one id. An order with no lines is refused before this is
	// reached, but a lookup of nothing is still a legitimate question with an empty answer — and
	// sending it would be a validation error rather than the empty map it obviously means.
	if len(productIDs) == 0 {
		return snapshots, nil
	}

	res, err := c.products.ProductByIds(ctx, connect.NewRequest(&productv1.ProductByIdsRequest{
		TeamId:     sellingTeamID,
		ProductIds: productIDs,
	}))
	if err != nil {
		return nil, err
	}

	// Only products that EXIST come back, so the map is naturally missing the rest — which is the
	// distinction promote needs to name a dead reference.
	for _, product := range res.Msg.GetProducts() {
		snapshots[product.GetId()] = selling_v1.ProductSnapshot{
			SKU:    product.GetSku(),
			Name:   product.GetName(),
			TeamID: product.GetTeamId(),
		}
	}

	return snapshots, nil
}
