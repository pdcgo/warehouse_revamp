package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// OwnerStockByIds answers, for a set of the CALLER'S OWN products, what stock exists behind each one
// across every warehouse holding it (or one warehouse, with the lens set).
//
// ── Why the joins look like this ────────────────────────────────────────────────────────────────
//
// inventory_service does not know who owns a product: `product_id` is an opaque id and stock rows
// carry no owner. What it does know is how stock GOT here — every unit arrived on an accepted restock
// line, and a restock names the team that raised it. So ownership is derived, not asserted:
//
//	stock_shelf_batches → stock_batches → restock_request_items → restock_requests.requesting_team_id
//
// That chain is the authorization. A caller passing another team's product id joins to none of its
// rows and gets nothing back — no ownership table, no trust in the client, and no new column that
// could disagree with the restock it came from.
//
// ── Why four queries and not one ────────────────────────────────────────────────────────────────
//
// Ready, the cost spread and the oldest batch come off the SHELF grain; ongoing comes off restock
// lines that have no shelves yet. Fusing them would need a FULL OUTER JOIN between "what is here" and
// "what is coming", and every product that is only one of the two would land in the null half. Four
// aggregates keyed by product, merged in Go, stay readable and each stays a plain GROUP BY.
func (s *Service) OwnerStockByIds(
	ctx context.Context,
	req *connect.Request[inventoryv1.OwnerStockByIdsRequest],
) (*connect.Response[inventoryv1.OwnerStockByIdsResponse], error) {
	teamID := req.Msg.GetTeamId()
	productIDs := req.Msg.GetFilter().GetProductIds()
	warehouseID := req.Msg.GetFilter().GetWarehouseId()

	db := s.db.WithContext(ctx)

	items := map[uint64]*inventoryv1.OwnerStockItem{}

	// at returns the row for a product, creating it on first touch — a product may appear in any of
	// the four queries and in none of the others.
	at := func(productID uint64) *inventoryv1.OwnerStockItem {
		it, ok := items[productID]
		if !ok {
			it = &inventoryv1.OwnerStockItem{}
			items[productID] = it
		}

		return it
	}

	err := ownerReadyRows(db, teamID, warehouseID, productIDs, at)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	err = ownerOngoingRows(db, teamID, warehouseID, productIDs, at)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	err = ownerLastRestockRows(db, teamID, warehouseID, productIDs, at)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&inventoryv1.OwnerStockByIdsResponse{
		Items: ownerStockByIdsMap(items, req.Msg.GetDataRequest()),
	}), nil
}

// ownerReadyScan is one product's shelf-side aggregate: what is on a shelf, what it cost, the spread
// of those costs and how old the oldest of them is.
type ownerReadyScan struct {
	ProductID uint64
	Qty       int64
	Value     int64
	// Nullable: a product can have ready units and no recorded cost on any of them (#74).
	CostMin *int64
	CostMax *int64
	// Nullable: no ready units at all means no oldest batch.
	OldestUnix *int64
}

// ownerReadyRows fills ready_qty / ready_value / the cost spread / oldest_batch_unix.
//
// The value and the spread deliberately disagree about which rows they look at: SUM(qty * unit_cost)
// skips unknown-cost batches (they add units, not money), while MIN/MAX only ever see the batches
// that HAVE a cost. Both are the same rule stated twice — an unknown cost is not a zero.
func ownerReadyRows(
	db *gorm.DB,
	teamID, warehouseID uint64,
	productIDs []uint64,
	at func(uint64) *inventoryv1.OwnerStockItem,
) error {
	var rows []ownerReadyScan

	query := db.
		Table("stock_shelf_batches AS sb").
		Select(`b.product_id AS product_id,
		        COALESCE(SUM(sb.qty), 0) AS qty,
		        COALESCE(SUM(sb.qty * COALESCE(b.unit_cost, 0)), 0) AS value,
		        MIN(b.unit_cost) AS cost_min,
		        MAX(b.unit_cost) AS cost_max,
		        EXTRACT(EPOCH FROM MIN(b.accepted_at))::bigint AS oldest_unix`).
		Joins("JOIN stock_batches b ON b.id = sb.batch_id").
		Joins("JOIN restock_request_items ri ON ri.id = b.restock_request_item_id").
		Joins("JOIN restock_requests r ON r.id = ri.restock_request_id").
		Where("r.requesting_team_id = ?", teamID).
		Where("b.product_id IN ?", productIDs).
		// A shelf row at 0 is not stock — it is a shelf that used to hold some. Counting it would date
		// the "oldest batch" from goods that left months ago.
		Where("sb.qty > 0").
		Group("b.product_id")

	if warehouseID > 0 {
		query = query.Where("b.warehouse_id = ?", warehouseID)
	}

	err := query.Scan(&rows).Error
	if err != nil {
		return err
	}

	for _, row := range rows {
		it := at(row.ProductID)
		it.ReadyQty = row.Qty
		it.ReadyValue = row.Value

		if row.CostMin != nil && row.CostMax != nil {
			it.CostKnown = true
			it.CostMin = *row.CostMin
			it.CostMax = *row.CostMax
		}

		if row.OldestUnix != nil {
			it.OldestBatchUnix = *row.OldestUnix
		}
	}

	return nil
}

type ownerOngoingScan struct {
	ProductID uint64
	Qty       int64
	Value     int64
}

// ownerOngoingRows fills ongoing_qty / ongoing_value_est from restock lines the warehouse has not
// accepted yet. `total_price` is the LINE total, which is exactly what "what will this cost me" means
// here — no per-unit division, and therefore no rounding to argue about later.
func ownerOngoingRows(
	db *gorm.DB,
	teamID, warehouseID uint64,
	productIDs []uint64,
	at func(uint64) *inventoryv1.OwnerStockItem,
) error {
	var rows []ownerOngoingScan

	query := db.
		Table("restock_request_items AS ri").
		Select(`ri.product_id AS product_id,
		        COALESCE(SUM(ri.quantity), 0) AS qty,
		        COALESCE(SUM(ri.total_price), 0) AS value`).
		Joins("JOIN restock_requests r ON r.id = ri.restock_request_id").
		Where("r.requesting_team_id = ?", teamID).
		Where("r.status = ?", restockStatusPending).
		Where("ri.product_id IN ?", productIDs).
		Group("ri.product_id")

	if warehouseID > 0 {
		query = query.Where("r.warehouse_id = ?", warehouseID)
	}

	err := query.Scan(&rows).Error
	if err != nil {
		return err
	}

	for _, row := range rows {
		it := at(row.ProductID)
		it.OngoingQty = row.Qty
		it.OngoingValueEst = row.Value
	}

	return nil
}

type ownerLastRestockScan struct {
	ProductID uint64
	Unix      int64
}

// ownerLastRestockRows fills last_restock_unix: when stock for this product last ARRIVED.
//
// Over batches rather than over ready shelf rows, unlike the oldest-batch figure above: a delivery
// that has since sold out still happened, and "last restocked in March" is the answer either way.
func ownerLastRestockRows(
	db *gorm.DB,
	teamID, warehouseID uint64,
	productIDs []uint64,
	at func(uint64) *inventoryv1.OwnerStockItem,
) error {
	var rows []ownerLastRestockScan

	query := db.
		Table("stock_batches AS b").
		Select(`b.product_id AS product_id,
		        EXTRACT(EPOCH FROM MAX(b.accepted_at))::bigint AS unix`).
		Joins("JOIN restock_request_items ri ON ri.id = b.restock_request_item_id").
		Joins("JOIN restock_requests r ON r.id = ri.restock_request_id").
		Where("r.requesting_team_id = ?", teamID).
		Where("b.product_id IN ?", productIDs).
		Group("b.product_id")

	if warehouseID > 0 {
		query = query.Where("b.warehouse_id = ?", warehouseID)
	}

	err := query.Scan(&rows).Error
	if err != nil {
		return err
	}

	for _, row := range rows {
		at(row.ProductID).LastRestockUnix = row.Unix
	}

	return nil
}

// ownerStockByIdsMap wraps the per-product rows in the guideline's by-ids envelope, defaulting an
// empty data_request to the STOCK slice.
func ownerStockByIdsMap(
	items map[uint64]*inventoryv1.OwnerStockItem,
	types []inventoryv1.OwnerStockDataType,
) map[uint64]*inventoryv1.OwnerStockByIdsResponseList {
	if len(types) == 0 {
		types = []inventoryv1.OwnerStockDataType{inventoryv1.OwnerStockDataType_OWNER_STOCK_DATA_TYPE_STOCK}
	}

	out := make(map[uint64]*inventoryv1.OwnerStockByIdsResponseList, len(items))

	for productID, item := range items {
		slices := make([]*inventoryv1.OwnerStockByIdsResponseItem, 0, len(types))

		for _, t := range types {
			if t != inventoryv1.OwnerStockDataType_OWNER_STOCK_DATA_TYPE_STOCK {
				continue
			}

			slices = append(slices, &inventoryv1.OwnerStockByIdsResponseItem{
				D: &inventoryv1.OwnerStockByIdsResponseItem_Stock{
					Stock: &inventoryv1.OwnerStockMapItem{
						MapData: map[uint64]*inventoryv1.OwnerStockItem{productID: item},
					},
				},
			})
		}

		out[productID] = &inventoryv1.OwnerStockByIdsResponseList{Items: slices}
	}

	return out
}
