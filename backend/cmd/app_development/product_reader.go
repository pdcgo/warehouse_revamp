package main

import (
	"context"

	"connectrpc.com/connect"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// inventoryProductReader answers inventory's ProductReader from product_service: who owns a product, whether the owner
// locked it from other teams, its reserve, its markup, its sku and name. A restock carries only the team's own products
// (a-restock-carries-only-the-teams-own-products), the order take checks the rest before it opens a transaction
// (the-take-checks-the-product-first), and a transfer line snapshots the sku and name at create.
//
// It calls the handler directly, as productCatalog does: the calling RPC has already run its own policy against the
// caller's team, and ProductByIds is scoped to that same team.
type inventoryProductReader struct {
	products *product_v1.Service
}

func NewInventoryProductReader(products *product_v1.Service) inventory_v1.ProductReader {
	return &inventoryProductReader{products: products}
}

// productByIdsMax is ProductByIds' own cap on ids per call.
const productByIdsMax = 200

func (r *inventoryProductReader) Facts(
	ctx context.Context,
	callerTeamID uint64,
	productIDs []uint64,
) (map[uint64]inventory_v1.ProductFact, error) {
	facts := make(map[uint64]inventory_v1.ProductFact, len(productIDs))

	for start := 0; start < len(productIDs); start += productByIdsMax {
		end := min(start+productByIdsMax, len(productIDs))

		res, err := r.products.ProductByIds(ctx, connect.NewRequest(&productv1.ProductByIdsRequest{
			TeamId: callerTeamID,
			Filter: &productv1.ProductByIdsFilter{Ids: productIDs[start:end]},
			DataRequest: []productv1.ProductByIdsDataType{
				productv1.ProductByIdsDataType_PRODUCT_BY_IDS_DATA_TYPE_PRODUCT,
			},
		}))
		if err != nil {
			return nil, err
		}

		// Only products that exist come back; an absent id has no facts and is refused by the caller.
		for id, list := range res.Msg.GetItems() {
			for _, item := range list.GetItems() {
				row := item.GetProduct().GetMapData()[id]
				if row == nil {
					continue
				}

				facts[id] = inventory_v1.ProductFact{
					TeamID:         row.GetTeamId(),
					Private:        row.GetCrossLocked(),
					ReservedStock:  int64(row.GetReservedStock()),
					CrossMarkupBps: row.GetCrossMarkupBps(),
					SKU:            row.GetSku(),
					Name:           row.GetName(),
				}
			}
		}
	}

	return facts, nil
}
