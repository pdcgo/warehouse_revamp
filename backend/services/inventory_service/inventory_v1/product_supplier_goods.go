package inventory_v1

import (
	"context"
	"fmt"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// ProductSupplierGoods is PEMASOK — who supplies a product, the Per Gudang tab of its own page and of its discover
// detail (the-suppliers-are-a-tab-of-their-own, the-supplier-tab-names-the-store, the-discover-detail-has-the-warehouse-
// zone): one row per supplier and the store it was bought at, with how many deliveries, how many units, when the last
// was accepted, and — to the owning team only — the last unit cost.
//
// ── The owner's batches, read for anybody ────────────────────────────────────────────────────────
//
// A restock line copies its supplier and store onto the batch it mints at accept (a-batch-keeps-its-supplier), and every
// unit of the product sits in its OWNER's batches (a-batch-carries-its-owner) — so the rows are the owner's whoever asks:
// the owner is read from product_service (ProductReader.Facts, as DiscoverStockHistory does) and `team_id` only
// authorizes (another-team-sees-everything-of-a-supplier, stock-history-is-everyones).
//
// ── What a delivery is ──────────────────────────────────────────────────────────────────────────
//
//	delivery   a batch a RESTOCK minted (its transaction's type is restock). A transfer-in copies the supplier onto the
//	           batch it mints too, and a return onto its own — neither is a delivery (SupplierGoods' rule, and
//	           a-supplier-page-is-scoped-by-its-warehouses: where the restocks were received). A cancelled restock never
//	           minted a batch (a-restock-is-cancelled-only-while-ongoing, an-accepted-restock-cannot-be-cancelled).
//	           A received-count correction of a line that arrived with NO good unit mints the line's batch later, under
//	           its own adjustment transaction — that batch is still its restock's delivery, dated at the accept.
//	Kiriman    the distinct restock transactions among them.
//	Unit       the good units those restocks accepted — the batch's init_stock_count (each-figure-is-read-at-the-accept)
//	           — with every received-count correction since counted in (a-received-count-correction-counts-on-its-own-
//	           day: accepted 20, corrected to 18, reads 18).
//	terakhir   the newest delivery's accept time, and its batch's unit cost as the batch holds it now — the page's own
//	           *Modal* (Harga Modal's layers), never the supplier's line price.
//	store 0    lines that named the supplier and no store (a-line-with-no-store-links-under-the-supplier); a line naming
//	           no supplier is no row.
//
// ── The warehouse picker ────────────────────────────────────────────────────────────────────────
//
// `warehouse_id` is the page's Per Gudang picker (the-warehouse-picker-splits-the-page): only the deliveries received in
// that warehouse. 0 = every warehouse.
//
// ── The cost is the owner's ─────────────────────────────────────────────────────────────────────
//
// *Modal terakhir* shows on the owner's page only (the-supplier-tab-names-the-store); the discover detail never shows
// another team's cost. So the field is SET only when `team_id` is the product's owner — another team's answer carries no
// cost at all, not a zero.
//
// One statement: the product's batches once (a MATERIALIZED CTE — every warehouse has no full (team_id, product_id)
// index, so the scan is paid once, not three times), its deliveries and its corrections aggregated per (supplier, store),
// and the page with its total.
func (s *Service) ProductSupplierGoods(
	ctx context.Context,
	req *connect.Request[inventoryv1.ProductSupplierGoodsRequest],
) (*connect.Response[inventoryv1.ProductSupplierGoodsResponse], error) {
	filter := req.Msg.GetFilter()
	page := req.Msg.GetPage()
	productID := filter.GetProductId()

	facts, err := s.products.Facts(ctx, req.Msg.GetTeamId(), []uint64{productID})
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("ask product facts: %w", err))
	}

	// A product nobody owns (unknown) has no batches: an empty page.
	fact, ok := facts[productID]
	if !ok {
		return productSupplierGoodsResponse(nil, req.Msg.GetDataRequest(), page, 0), nil
	}

	owner := fact.TeamID == req.Msg.GetTeamId()

	scope := `b.team_id = ? AND b.product_id = ? AND b.supplier_id > 0`
	args := []any{fact.TeamID, productID}

	warehouseID := filter.GetWarehouseId()
	if warehouseID > 0 {
		scope += ` AND b.warehouse_id = ?`
		args = append(args, warehouseID)
	}

	statement := productSupplierGoodsSQL(scope)

	type row struct {
		SupplierID   uint64
		StoreID      uint64
		Deliveries   int64
		Units        int64
		LastDelivery time.Time
		LastCost     float64
		Total        int64
	}

	var rows []row

	err = s.db.
		WithContext(ctx).
		Raw(statement, append(args, int(page.GetLimit()), pageOffset(page))...).
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("product supplier goods: %w", err))
	}

	var total int64
	if len(rows) > 0 {
		total = rows[0].Total
	} else if page.GetPage() > 1 {
		// A page past the end holds no row to carry the total: count alone.
		err = s.db.
			WithContext(ctx).
			Raw("SELECT COUNT(*) FROM ("+statement+") x", append(args, -1, 0)...).
			Scan(&total).
			Error
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("product supplier goods count: %w", err))
		}
	}

	goods := make([]*inventoryv1.ProductSupplierGoods, 0, len(rows))
	first := uint64(pageOffset(page)) + 1

	for i := range rows {
		r := &rows[i]

		g := &inventoryv1.ProductSupplierGoods{
			Id:               first + uint64(i),
			SupplierId:       r.SupplierID,
			StoreId:          r.StoreID,
			Deliveries:       r.Deliveries,
			Units:            r.Units,
			LastDeliveryUnix: r.LastDelivery.Unix(),
		}

		// THE OWNER'S COST, to the owner alone — another team's answer has no such field.
		if owner {
			cost := r.LastCost
			g.LastUnitCost = &cost
		}

		goods = append(goods, g)
	}

	return productSupplierGoodsResponse(goods, req.Msg.GetDataRequest(), page, total), nil
}

// productSupplierGoodsSQL is the read over the batches `scope` picks (its placeholders come first, then LIMIT and
// OFFSET; a LIMIT of -1 is no limit — the count's). `scope` is built from constants only, never caller text.
func productSupplierGoodsSQL(scope string) string {
	return `
		WITH own AS MATERIALIZED (
			SELECT b.id, b.supplier_id, b.supplier_channel_id, b.transaction_id, b.init_stock_count, b.price_unit,
			       b.created_at
			FROM batches b
			WHERE ` + scope + `
		),
		lots AS (
			-- a delivery: the batch minted at the accept of a restock
			SELECT o.id, o.supplier_id, o.supplier_channel_id, o.transaction_id AS delivery, o.created_at AS delivered_at,
			       o.init_stock_count AS units, o.price_unit
			FROM own o
			JOIN inventory_transactions t ON t.id = o.transaction_id
			WHERE t.tx_type = '` + string(models.TxRestock) + `'
			UNION ALL
			-- a line that arrived with no good unit, its batch minted by a later received-count correction: still the
			-- delivery of that restock, dated at the accept; its units come in with the corrections below
			SELECT o.id, o.supplier_id, o.supplier_channel_id, r.transaction_id, COALESCE(r.accepted_at, o.created_at), 0,
			       o.price_unit
			FROM own o
			JOIN restock_count_corrections c ON c.batch_id = o.id AND c.transaction_id = o.transaction_id
			JOIN restocks r ON r.id = c.restock_id
		),
		fixes AS (
			SELECT o.supplier_id, o.supplier_channel_id, SUM(-c.units_out) AS units
			FROM own o
			JOIN restock_count_corrections c ON c.batch_id = o.id
			GROUP BY o.supplier_id, o.supplier_channel_id
		),
		groups AS (
			SELECT l.supplier_id, l.supplier_channel_id,
			       COUNT(DISTINCT l.delivery) AS deliveries,
			       SUM(l.units) AS units,
			       MAX(l.delivered_at) AS last_delivery,
			       (ARRAY_AGG(l.price_unit ORDER BY l.delivered_at DESC, l.id DESC))[1] AS last_cost
			FROM lots l
			GROUP BY l.supplier_id, l.supplier_channel_id
		)
		SELECT g.supplier_id, g.supplier_channel_id AS store_id, g.deliveries,
		       g.units + COALESCE(f.units, 0) AS units, g.last_delivery, g.last_cost,
		       COUNT(*) OVER () AS total
		FROM groups g
		LEFT JOIN fixes f ON f.supplier_id = g.supplier_id AND f.supplier_channel_id = g.supplier_channel_id
		ORDER BY g.last_delivery DESC, g.supplier_id, g.supplier_channel_id
		LIMIT NULLIF(?, -1) OFFSET ?`
}

// productSupplierGoodsResponse wraps a page of rows in the guideline's slices — the GOODS slice unless asked otherwise —
// keyed by the row's position.
func productSupplierGoodsResponse(
	goods []*inventoryv1.ProductSupplierGoods,
	types []inventoryv1.ProductSupplierGoodsDataType,
	page *commonv1.CommonPagination,
	total int64,
) *connect.Response[inventoryv1.ProductSupplierGoodsResponse] {
	if len(types) == 0 {
		types = []inventoryv1.ProductSupplierGoodsDataType{
			inventoryv1.ProductSupplierGoodsDataType_PRODUCT_SUPPLIER_GOODS_DATA_TYPE_GOODS,
		}
	}

	ids := make([]uint64, 0, len(goods))
	for _, g := range goods {
		ids = append(ids, g.GetId())
	}

	items := make([]*inventoryv1.ProductSupplierGoodsResponseItem, 0, len(types))

	for _, t := range types {
		switch t {
		case inventoryv1.ProductSupplierGoodsDataType_PRODUCT_SUPPLIER_GOODS_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(goods))
			for _, g := range goods {
				m[g.GetId()] = &commonv1.GeneralItem{Id: g.GetId()}
			}

			items = append(items, &inventoryv1.ProductSupplierGoodsResponseItem{
				D: &inventoryv1.ProductSupplierGoodsResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case inventoryv1.ProductSupplierGoodsDataType_PRODUCT_SUPPLIER_GOODS_DATA_TYPE_GOODS:
			m := make(map[uint64]*inventoryv1.ProductSupplierGoods, len(goods))
			for _, g := range goods {
				m[g.GetId()] = g
			}

			items = append(items, &inventoryv1.ProductSupplierGoodsResponseItem{
				D: &inventoryv1.ProductSupplierGoodsResponseItem_Goods{Goods: &inventoryv1.ProductSupplierGoodsMapItem{MapData: m}},
			})
		}
	}

	return connect.NewResponse(&inventoryv1.ProductSupplierGoodsResponse{
		Items:    items,
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	})
}
