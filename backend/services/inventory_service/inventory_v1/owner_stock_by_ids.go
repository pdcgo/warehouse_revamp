package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// OwnerStockByIds answers, for a set of the CALLER'S OWN products, what stock exists behind each one
// across every warehouse holding it (or one warehouse, with the lens set).
//
// ── Who owns it ─────────────────────────────────────────────────────────────────────────────────
//
// A batch carries its owner, written at mint (a-batch-carries-its-owner): `batches.team_id`. A caller
// passing another team's product id matches none of its batches and gets nothing back — no trust in
// the client.
//
// ── Why four queries and not one ────────────────────────────────────────────────────────────────
//
// Ready, the cost spread and the oldest batch come off the BATCH grain; ongoing comes off restock
// lines that have no shelves yet; in transit off the lines of transfers between their two legs.
// Fusing them would need a FULL OUTER JOIN between "what is here" and "what is coming", and every
// product that is only one of them would land in the null half. Four aggregates keyed by product,
// merged in Go, stay readable and each stays a plain GROUP BY — one statement each per PAGE, whatever
// its size, never one per product.
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

	err = ownerInTransitRows(db, teamID, warehouseID, productIDs, at)
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
	Value     float64
	// Nullable: a product can have ready units and no recorded cost on any of them (#74).
	CostMin *float64
	CostMax *float64
	// Nullable: no ready units at all means no oldest batch.
	OldestUnix *int64
}

// ownerReadyRows fills ready_qty / ready_value / the cost spread / oldest_batch_unix.
//
// Every batch carries its price, so the spread is always known. Only batches still holding units count: an emptied
// batch is not stock, and dating the "oldest batch" from it would date goods that left months ago.
func ownerReadyRows(
	db *gorm.DB,
	teamID, warehouseID uint64,
	productIDs []uint64,
	at func(uint64) *inventoryv1.OwnerStockItem,
) error {
	var rows []ownerReadyScan

	query := db.
		Table("batches AS b").
		Select(`b.product_id AS product_id,
		        COALESCE(SUM(b.stock_count), 0) AS qty,
		        COALESCE(SUM(b.stock_valuation), 0) AS value,
		        MIN(b.price_unit) AS cost_min,
		        MAX(b.price_unit) AS cost_max,
		        EXTRACT(EPOCH FROM MIN(b.created_at))::bigint AS oldest_unix`).
		Where("b.team_id = ?", teamID).
		Where("b.product_id IN ?", productIDs).
		Where("b.stock_count > 0").
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
	Value     float64
}

// ownerOngoingRows fills ongoing_qty / ongoing_value_est from restock lines the warehouse has not
// accepted yet. `total` is the LINE total, which is exactly what "what will this cost me" means here — no per-unit
// division. The exact double, never rounded (the-backend-never-rounds-money).
func ownerOngoingRows(
	db *gorm.DB,
	teamID, warehouseID uint64,
	productIDs []uint64,
	at func(uint64) *inventoryv1.OwnerStockItem,
) error {
	var rows []ownerOngoingScan

	query := db.
		Table("restock_items AS ri").
		Select(`ri.product_id AS product_id,
		        COALESCE(SUM(ri.count), 0) AS qty,
		        COALESCE(SUM(ri.total), 0) AS value`).
		Joins("JOIN restocks r ON r.id = ri.restock_id").
		Where("r.team_id = ?", teamID).
		Where("r.status IN ?", restockInboundStatuses).
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
// Over every batch a RESTOCK minted, emptied ones included, unlike the oldest-batch figure above: a delivery that has
// since sold out still happened, and "last restocked in March" is the answer either way. A transfer's batch is not a
// restock.
func ownerLastRestockRows(
	db *gorm.DB,
	teamID, warehouseID uint64,
	productIDs []uint64,
	at func(uint64) *inventoryv1.OwnerStockItem,
) error {
	var rows []ownerLastRestockScan

	query := db.
		Table("batches AS b").
		Select(`b.product_id AS product_id,
		        EXTRACT(EPOCH FROM MAX(b.created_at))::bigint AS unix`).
		Joins("JOIN inventory_transactions t ON t.id = b.transaction_id").
		Where("b.team_id = ? AND t.tx_type = ?", teamID, string(inventory_service_models.TxRestock)).
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

// transferInTransitWhere is the in-transit definition as SQL over `warehouse_transfers t`: a transfer whose out-leg is
// written and whose units no warehouse has booked again (the-transfer-is-where-goods-in-transit-are) — created,
// process, shipped, arrived, and LOST: no ledger moves at a loss, so a lost box stays in transit until it turns up and
// is accepted (cancel-before-processed-lost-only-in-transit). The same set the Transfer metric's in transit reads for
// today (`inventory_metric_transfer.go`: neither accepted nor cancelled), so the two screens agree.
//
// Read by STATUS, never by "no inbound transaction": a cancel rolls the out-leg back but keeps its id on the row, so
// `inbound_transaction_id IS NULL` alone would count every cancelled transfer. The statuses are LITERALS, not bound
// parameters, so a partial index over the same predicate stays matchable.
const transferInTransitWhere = `t.outbound_transaction_id IS NOT NULL
	AND t.status IN ('created', 'process', 'shipped', 'arrived', 'lost')`

type ownerInTransitScan struct {
	ProductID uint64
	Qty       int64
	Value     float64
}

// ownerInTransitRows fills in_transit_qty / in_transit_value from the lines of the team's transfers between their two
// legs — the units out of the sender's book and not yet in the receiver's. The value is the lines' `total`, what the
// out-leg took (the-system-fills-a-transfers-prices), exact. Under the lens a transfer counts for its RECEIVING
// warehouse only — the Transfer metric's rule (the-inventory-metrics-prototype-is-accepted); the sender's book already
// shows the units gone. One statement for the whole page.
//
// The open transfers are fenced first — `transfer_id = ANY(ARRAY(…))`, an InitPlan (a team has a few hundred open
// at most, by `warehouse_transfers_in_transit_idx`) — and the page's lines are then read by the line key
// `(transfer_id, product_id)`. A plain join let the planner hash it and SCAN every transfer line ever written for the
// page's product filter: a cost that grows with every team's whole transfer history (rpc.md, In transit).
func ownerInTransitRows(
	db *gorm.DB,
	teamID, warehouseID uint64,
	productIDs []uint64,
	at func(uint64) *inventoryv1.OwnerStockItem,
) error {
	var rows []ownerInTransitScan

	open := db.
		Table("warehouse_transfers AS t").
		Select("t.id").
		Where("t.team_id = ?", teamID).
		Where(transferInTransitWhere)

	if warehouseID > 0 {
		open = open.Where("t.to_warehouse_id = ?", warehouseID)
	}

	query := db.
		Table("warehouse_transfer_items AS i").
		Select(`i.product_id AS product_id,
		        COALESCE(SUM(i.count), 0) AS qty,
		        COALESCE(SUM(i.total), 0) AS value`).
		Where("i.transfer_id = ANY(ARRAY(?))", open).
		Where("i.product_id IN ?", productIDs).
		Group("i.product_id")

	err := query.Scan(&rows).Error
	if err != nil {
		return err
	}

	for _, row := range rows {
		it := at(row.ProductID)
		it.InTransitQty = row.Qty
		it.InTransitValue = row.Value
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
