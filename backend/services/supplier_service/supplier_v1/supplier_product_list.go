package supplier_v1

import (
	"context"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// SupplierProductList pages ANY team's live supplier's products — the Produk tab on the My Supplier and the Discover
// Supplier detail alike (supplier-detail-has-channels-and-products-tabs): one row per link of
// `supplier_channel_products`, the product with its name, SKU and picture, whose it is, the store it was bought at (none
// for a line naming the supplier alone — its cell reads "—", a-line-with-no-store-links-under-the-supplier), the first
// and the last restock (a-link-remembers-its-last-restock), and its Terjual and Siap (the-detail-tabs-show-sold-and-ready).
//
// ── Who sees what ───────────────────────────────────────────────────────────────────────────────
//
// The same rows and the same figures for EVERY selling team — the supplier's own team and any team reading it on
// Discover: nothing about a supplier is private, its products included (another-team-sees-everything-of-a-supplier), and
// every team's figures are every team's to read (every-selling-team-sees-every-teams-figures). So `team_id` authorizes
// and never narrows. No row carries a price or a cost — the link holds none, and the figures are counts and dates.
//
// ── The page ────────────────────────────────────────────────────────────────────────────────────
//
// productSet narrows the supplier's links — a link of a deleted store hides with it (a-store-delete-is-soft-too) — by the
// team, the store (or no store) and the search (the product's name or SKU through product_service, or the store's name),
// newest restock first (the-products-tab-searches-and-pages, the-products-tab-filters-by-team-and-store). Then, for the
// page's rows only: ONE ProductCards call names them (product_service, in-process) and ONE StoreProductGoods call reads
// their figures (inventory, in-process) — never a call per row.
//
// ── Under a warehouse chip ──────────────────────────────────────────────────────────────────────
//
// `warehouse_id` is the page's GUDANG TERKAIT chip (a-supplier-page-is-scoped-by-its-warehouses): only the links whose
// product has goods of this supplier, bought at the link's store (or none), received at that warehouse — the (store,
// product) pairs inventory answers by the chips' own test (WarehouseGoods.StoreProductsAtWarehouse), asked ONCE and bound
// before the count and the page — and each row's Terjual and Siap are that warehouse's. Terakhir dibeli stays the link's
// own: the link remembers its last restock, wherever it was received.
func (s *Service) SupplierProductList(
	ctx context.Context,
	req *connect.Request[supplierv1.SupplierProductListRequest],
) (*connect.Response[supplierv1.SupplierProductListResponse], error) {
	msg := req.Msg
	filter := msg.GetFilter()
	page := msg.GetPage()
	db := s.db.WithContext(ctx)

	_, err := liveSupplier(db, filter.GetSupplierId())
	if err != nil {
		return nil, err
	}

	set, err := s.productSetOf(ctx, db, filter)
	if err != nil {
		return nil, err
	}

	links, total, err := set.page(db, pageOffset(page), int(page.GetLimit()))
	if err != nil {
		return nil, internal(err)
	}

	rows, err := s.productRows(ctx, filter.GetSupplierId(), filter.GetWarehouseId(), links)
	if err != nil {
		return nil, err
	}

	byID := make(map[uint64]*supplierv1.SupplierProduct, len(rows))
	ids := make([]uint64, 0, len(rows))

	for _, row := range rows {
		byID[row.GetId()] = row
		ids = append(ids, row.GetId())
	}

	return connect.NewResponse(&supplierv1.SupplierProductListResponse{
		Items: []*supplierv1.SupplierProductListResponseItem{{
			D: &supplierv1.SupplierProductListResponseItem_Product{
				Product: &supplierv1.SupplierProductMapItem{MapData: byID},
			},
		}},
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	}), nil
}

// productSet is the Produk tab's set — one supplier's links, narrowed by the tab's filter. The list and its export
// (SupplierProductExport) read it, so the file holds exactly the rows the tab pages through.
type productSet struct {
	filter *supplierv1.SupplierProductListFilter
	// The search as an ILIKE pattern; "" = none.
	pattern string
	// The supplier's products whose name or SKU holds the search — product_service's answer, asked once.
	matched []uint64
	// The (store, product) pairs of the supplier's goods received at the chip's warehouse — inventory's answer, asked
	// once. Read only when the filter names a warehouse.
	atWarehouse []StoreProduct
}

// productSetOf builds the set; with a warehouse chip it first asks inventory which (store, product) pairs had goods
// received there, and with a search it then asks product_service which of the supplier's products match — among the
// products of the links the other filters keep, never the whole catalogue.
func (s *Service) productSetOf(ctx context.Context, db *gorm.DB, filter *supplierv1.SupplierProductListFilter) (productSet, error) {
	set := productSet{filter: filter, pattern: likePattern(filter.GetQ())}

	if warehouseID := filter.GetWarehouseId(); warehouseID != 0 {
		at, ok := s.goods.(WarehouseGoods)
		if !ok {
			return set, internal(errNoWarehouseGoods)
		}

		pairs, err := at.StoreProductsAtWarehouse(ctx, filter.GetSupplierId(), warehouseID)
		if err != nil {
			return set, internal(err)
		}

		set.atWarehouse = pairs
	}

	if set.pattern == "" {
		return set, nil
	}

	var candidates []uint64

	err := set.narrowed(db.Table("supplier_channel_products AS l")).
		Distinct("l.product_id").
		Order("l.product_id").
		Pluck("l.product_id", &candidates).
		Error
	if err != nil {
		return set, internal(err)
	}

	if len(candidates) == 0 {
		return set, nil
	}

	set.matched, err = s.products.ProductIDsMatching(ctx, candidates, strings.TrimSpace(filter.GetQ()))
	if err != nil {
		return set, connect.NewError(connect.CodeInternal, fmt.Errorf("searching the supplier's products: %w", err))
	}

	return set, nil
}

// narrowed applies the supplier, the team, the store and the warehouse chip to a query over `supplier_channel_products AS l`.
func (set productSet) narrowed(query *gorm.DB) *gorm.DB {
	query = query.Where("l.supplier_id = ?", set.filter.GetSupplierId())

	if team := set.filter.GetProductTeamId(); team > 0 {
		query = query.Where("l.team_id = ?", team)
	}

	switch {
	case set.filter.GetNoStore():
		query = query.Where("l.channel_id IS NULL")
	case set.filter.GetStoreId() > 0:
		query = query.Where("l.channel_id = ?", set.filter.GetStoreId())
	}

	// The chip: a link stays when its (store, product) — store 0 for none — had goods received at the warehouse. The
	// pairs go in as two id arrays read side by side; none received there is no row.
	if set.filter.GetWarehouseId() != 0 {
		if len(set.atWarehouse) == 0 {
			return query.Where("FALSE")
		}

		stores := make([]uint64, 0, len(set.atWarehouse))
		products := make([]uint64, 0, len(set.atWarehouse))

		for _, pair := range set.atWarehouse {
			stores = append(stores, pair.StoreID)
			products = append(products, pair.ProductID)
		}

		query = query.Where(
			"(COALESCE(l.channel_id, 0), l.product_id) IN "+
				"(SELECT w.store_id, w.product_id FROM unnest(CAST(? AS bigint[]), CAST(? AS bigint[])) AS w(store_id, product_id))",
			idArray(stores), idArray(products),
		)
	}

	return query
}

// query is the whole set: the supplier's links with their live store (or none), narrowed by the filter and the search.
func (set productSet) query(db *gorm.DB) *gorm.DB {
	query := set.narrowed(db.
		Table("supplier_channel_products AS l").
		Joins("LEFT JOIN supplier_channels c ON c.id = l.channel_id").
		// A link hides with its deleted store (a-store-delete-is-soft-too); a store-less link has none to hide with.
		Where("l.channel_id IS NULL OR (c.id IS NOT NULL AND c.deleted_at IS NULL)"))

	if set.pattern == "" {
		return query
	}

	// The product's name or SKU (product_service's match), or the store's name.
	if len(set.matched) == 0 {
		return query.Where("c.name ILIKE ?", set.pattern)
	}

	return query.Where("c.name ILIKE ? OR l.product_id = ANY(CAST(? AS bigint[]))", set.pattern, idArray(set.matched))
}

// productLink is one link as the page reads it, with its store's name and type.
type productLink struct {
	supplier_service_models.SupplierChannelProduct

	ChannelName string
	ChannelType string
	Total       int64
}

// productOrder is the tab's order — the newest restock first, a store that stopped selling a product sinking
// (a-link-remembers-its-last-restock); the newest link breaks a tie. `supplier_channel_products_newest_idx` reads it.
const productOrder = "l.last_restocked_at DESC, l.id DESC"

// page reads one window of the set and the count of the whole of it, in ONE statement (COUNT(*) OVER (), taken before
// the LIMIT), so a bound id array is sent once. A window past the last row carries no count: then it counts alone.
func (set productSet) page(db *gorm.DB, offset, limit int) ([]productLink, int64, error) {
	var links []productLink

	err := set.query(db).
		Select("l.*, c.name AS channel_name, c.channel_type, COUNT(*) OVER () AS total").
		Order(productOrder).
		Offset(offset).
		Limit(limit).
		Scan(&links).
		Error
	if err != nil {
		return nil, 0, err
	}

	var total int64

	switch {
	case len(links) > 0:
		total = links[0].Total
	case offset > 0:
		err = set.query(db).
			Count(&total).
			Error
		if err != nil {
			return nil, 0, err
		}
	}

	return links, total, nil
}

// productRows turns one page of links into rows — named by ONE product_service call and filled by ONE inventory call
// for the page's (store, product) pairs; under a warehouse chip, with that warehouse's figures (0 = every warehouse).
func (s *Service) productRows(
	ctx context.Context,
	supplierID, warehouseID uint64,
	links []productLink,
) ([]*supplierv1.SupplierProduct, error) {
	if len(links) == 0 {
		return nil, nil
	}

	goods, ok := s.goods.(ProductGoods)
	if !ok {
		return nil, internal(errNoProductGoods)
	}

	productIDs := make([]uint64, 0, len(links))
	pairs := make([]StoreProduct, 0, len(links))
	seen := map[uint64]bool{}

	for i := range links {
		pairs = append(pairs, StoreProduct{StoreID: links[i].storeID(), ProductID: links[i].ProductID})

		if !seen[links[i].ProductID] {
			seen[links[i].ProductID] = true
			productIDs = append(productIDs, links[i].ProductID)
		}
	}

	cards, err := s.products.ProductCards(ctx, productIDs)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("naming the supplier's products: %w", err))
	}

	figures, err := goods.StoreProductGoods(ctx, supplierID, warehouseID, pairs)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("reading the products' figures: %w", err))
	}

	rows := make([]*supplierv1.SupplierProduct, 0, len(links))

	for i := range links {
		link := &links[i]
		card := cards[link.ProductID]

		row := &supplierv1.SupplierProduct{
			Id:                  link.ID,
			ProductId:           link.ProductID,
			TeamId:              link.TeamID,
			ProductName:         card.Name,
			ProductCode:         card.Code,
			ProductThumbnailUrl: card.ThumbnailURL,
			ChannelId:           link.storeID(),
			ChannelName:         link.ChannelName,
			ChannelType:         san_marketplace.FromText(link.ChannelType),
			FirstRestockedUnix:  link.FirstRestockedAt.Unix(),
			LastRestockedUnix:   link.LastRestockedAt.Unix(),
		}

		if f, found := figures[StoreProduct{StoreID: link.storeID(), ProductID: link.ProductID}]; found {
			row.Figures = &supplierv1.SupplierProductFigures{
				SoldUnits:     f.Sold,
				Orders:        f.Orders,
				LastOrderUnix: f.LastOrderUnix,
				ReadyUnits:    f.Ready,
			}
		}

		rows = append(rows, row)
	}

	return rows, nil
}

// storeID is the link's store; 0 = none.
func (l *productLink) storeID() uint64 {
	if l.ChannelID == nil {
		return 0
	}

	return *l.ChannelID
}
