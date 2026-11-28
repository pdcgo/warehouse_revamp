package main

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// inventoryProductReader answers inventory's ProductReader from product_service: who owns a product, whether the owner
// locked it from other teams, its reserve, its markup, its product code and name. A restock carries only the team's own products
// (a-restock-carries-only-the-teams-own-products), the order take checks the rest before it opens a transaction
// (the-take-checks-the-product-first), and a transfer line snapshots the product code and name at create.
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
					ProductCode:    row.GetProductCode(),
					Name:           row.GetName(),
				}
			}
		}
	}

	return facts, nil
}

// Search answers inventory's WarehouseProductSearch (a-warehouse-picks-only-what-it-has-held) and WarehouseStockList
// (the-stock-screen-lists-what-the-warehouse-has-held): inventory hands over the ids of every product that has had a
// batch in the warehouse, and product_service searches its names and codes among them — or, with no term, lists them —
// SearchAmong, a plain method, because the id list is inventory's and must never come from a browser. The warehouse's
// own policy already ran on the RPC that asks. The Stock screen's Tag filter and its rows' tags ride the same call
// (products-have-their-own-tag-list: every warehouse holding a product sees its tags, and every id here is held).
func (r *inventoryProductReader) Search(
	ctx context.Context,
	_ uint64,
	search inventory_v1.ProductSearch,
) (inventory_v1.ProductSearchPage, error) {
	rows, total, err := r.products.SearchAmong(ctx, product_v1.ProductSearchAmong{
		IDs:      search.ProductIDs,
		Q:        search.Q,
		TagIDs:   search.TagIDs,
		WithTags: search.WithTags,
		Offset:   search.Offset,
		Limit:    search.Limit,
	})
	if err != nil {
		return inventory_v1.ProductSearchPage{}, err
	}

	page := inventory_v1.ProductSearchPage{
		Products: make([]inventory_v1.ProductMatch, 0, len(rows)),
		Total:    total,
	}

	for _, row := range rows {
		page.Products = append(page.Products, inventory_v1.ProductMatch{
			ID:          row.GetId(),
			TeamID:      row.GetTeamId(),
			ProductCode: row.GetProductCode(),
			Name:        row.GetName(),
			Archived:    row.GetArchived(),
			Tags:        row.GetTags(),
		})
	}

	return page, nil
}

// THE REPRINT OF CHANGED CODES (backlog #151; products-have-their-own-tag-list, its 🔄 *what clears*) — product_service's
// `product_reprint_waits` and `need_reprint_code`, asked by inventory's Cetak Ulang Kode, its recorded print and a
// transfer accept. Domain methods, not RPCs: the waits have no wire surface of their own, and the two writes run on the
// CALLER'S transaction (the liabilityPoster shape), so inventory's accept and product_service's waits commit as one.

func (r *inventoryProductReader) ReprintWaits(
	ctx context.Context,
	warehouseID uint64,
	offset, limit int,
) (inventory_v1.ReprintWaitPage, error) {
	waits, total, err := r.products.ReprintWaitsOf(ctx, warehouseID, offset, limit)
	if err != nil {
		return inventory_v1.ReprintWaitPage{}, err
	}

	page := inventory_v1.ReprintWaitPage{Waits: make([]inventory_v1.ReprintWait, 0, len(waits)), Total: total}
	for _, w := range waits {
		page.Waits = append(page.Waits, inventory_v1.ReprintWait{
			ProductID:   w.ProductID,
			ProductCode: w.ProductCode,
			Name:        w.Name,
			FormerCode:  w.FormerCode,
		})
	}

	return page, nil
}

func (r *inventoryProductReader) ReprintWaitingCount(ctx context.Context, warehouseID uint64) (int64, error) {
	return r.products.ReprintWaitingCount(ctx, warehouseID)
}

func (r *inventoryProductReader) RecordReprint(
	ctx context.Context,
	tx *gorm.DB,
	warehouseID uint64,
	printed []inventory_v1.ReprintPrinted,
) (inventory_v1.ReprintRecorded, error) {
	asked := make([]product_v1.ReprintPrinted, 0, len(printed))
	for _, p := range printed {
		asked = append(asked, product_v1.ReprintPrinted{ProductID: p.ProductID, ProductCode: p.ProductCode})
	}

	recorded, err := r.products.RecordReprint(ctx, tx, warehouseID, asked)
	if err != nil {
		return inventory_v1.ReprintRecorded{}, err
	}

	return inventory_v1.ReprintRecorded{
		Cleared:     recorded.Cleared,
		CodeChanged: recorded.CodeChanged,
		Untagged:    recorded.Untagged,
	}, nil
}

func (r *inventoryProductReader) ReprintArrivals(ctx context.Context, tx *gorm.DB, warehouseID uint64, productIDs []uint64) error {
	_, err := r.products.AddArrivalReprintWaits(ctx, tx, warehouseID, productIDs)

	return err
}
