package inventory_v1

import (
	"context"
	"errors"
	"math"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// THE BATCH, READ FROM THE BATCH LEDGER. A batch knows its own price, units and value; what it came in on — the
// delivery, its receipt, the line's broken and missing units, a sku and name — is the transaction that minted it: a
// restock's accept (`restocks.transaction_id`) or a transfer's in-leg (`warehouse_transfers.inbound_transaction_id`).
// A product appears once per restock (a-product-appears-once-per-restock), so a batch finds its restock line by product.

// batchRow is the resolved shape of a batch, shared by BatchList, BatchDetail and OwnerBatchList so they cannot disagree
// about what a batch looks like.
type batchRow struct {
	ID             uint64
	DeliveryID     uint64
	WarehouseID    uint64
	ReceiptNo      string
	ProductID      uint64
	SKU            string
	Name           string
	SupplierID     uint64
	PriceUnit      float64
	InitStockCount int64
	Ready          int64
	StockValuation float64
	Broken         int64
	Lost           int64
	ExpiredAt      *time.Time
	CreatedAt      time.Time
	CreatedBy      uint64
	AcceptedBy     uint64
	TxType         string
}

// The restock line's problem rows, by kind (#227): missing is LOST on this screen, broken is BROKEN. A problem row is
// keyed by restock and product, which is how it finds the batch's line.
const (
	brokenExpr = `COALESCE((SELECT SUM(p.count) FROM restock_problem_items p WHERE p.restock_id = r.id AND p.product_id = b.product_id AND p.problem_type = 'broken'), 0)`
	lostExpr   = `COALESCE((SELECT SUM(p.count) FROM restock_problem_items p WHERE p.restock_id = r.id AND p.product_id = b.product_id AND p.problem_type = 'missing'), 0)`
)

// batchSelect is the projection over batchQuery. The caller adds the WHERE and the paging.
const batchSelect = `
	b.id, COALESCE(r.id, 0) AS delivery_id, b.warehouse_id, COALESCE(r.receipt, '') AS receipt_no,
	b.product_id, COALESCE(i.sku, wti.sku, '') AS sku, COALESCE(i.name, wti.name, '') AS name, b.supplier_id,
	b.price_unit, b.init_stock_count, b.stock_count AS ready, b.stock_valuation,
	` + brokenExpr + ` AS broken,
	` + lostExpr + ` AS lost,
	b.expired_at, b.created_at,
	COALESCE(r.created_by_user_id, t.create_by_user_id) AS created_by, t.create_by_user_id AS accepted_by, t.tx_type`

// batchQuery is a batch joined to the transaction that minted it and, through it, to its restock line or transfer line.
func batchQuery(db *gorm.DB) *gorm.DB {
	return db.
		Table("batches AS b").
		Joins("JOIN inventory_transactions t ON t.id = b.transaction_id").
		Joins("LEFT JOIN restocks r ON r.transaction_id = b.transaction_id").
		Joins("LEFT JOIN restock_items i ON i.restock_id = r.id AND i.product_id = b.product_id").
		Joins("LEFT JOIN warehouse_transfers wt ON wt.inbound_transaction_id = b.transaction_id").
		Joins("LEFT JOIN warehouse_transfer_items wti ON wti.transfer_id = wt.id AND wti.product_id = b.product_id")
}

// batchRowToProto maps a batch. Arrived = broken + lost + used + ready: the good units minted plus what the door found
// wrong; used is what has left since. Every batch carries its price, so the cost is always known. Money is whole rupiah
// on this contract until it turns `double` (money-is-double-in-the-api-too).
func batchRowToProto(r *batchRow) *inventoryv1.StockBatch {
	arrived := r.InitStockCount + r.Broken + r.Lost

	out := &inventoryv1.StockBatch{
		Id:             r.ID,
		DeliveryId:     r.DeliveryID,
		WarehouseId:    r.WarehouseID,
		ReceiptNo:      r.ReceiptNo,
		ProductId:      r.ProductID,
		Sku:            r.SKU,
		Name:           r.Name,
		SupplierId:     r.SupplierID,
		UnitCost:       int64(math.Round(r.PriceUnit)),
		CostKnown:      true,
		Arrived:        arrived,
		Broken:         r.Broken,
		Lost:           r.Lost,
		Ready:          r.Ready,
		Used:           r.InitStockCount - r.Ready,
		LineCost:       int64(math.Round(float64(arrived) * r.PriceUnit)),
		ReadyValue:     int64(math.Round(r.StockValuation)),
		CreatedAtUnix:  r.CreatedAt.Unix(),
		AcceptedAtUnix: r.CreatedAt.Unix(),
		CreatedBy:      r.CreatedBy,
		AcceptedBy:     r.AcceptedBy,
		Origin:         batchOriginOf(r.TxType),
	}

	if r.ExpiredAt != nil {
		out.ExpiresOnUnix = r.ExpiredAt.Unix()
	}

	return out
}

// batchOriginOf names how a batch came to exist from the transaction that minted it (#218). A transfer's or an
// adjustment's batch has no origin of its own on this contract yet, and reads as unspecified.
func batchOriginOf(txType string) inventoryv1.BatchOrigin {
	switch inventory_service_models.TxType(txType) {
	case inventory_service_models.TxRestock:
		return inventoryv1.BatchOrigin_BATCH_ORIGIN_RESTOCK
	case inventory_service_models.TxReturn:
		return inventoryv1.BatchOrigin_BATCH_ORIGIN_RETURN
	default:
		return inventoryv1.BatchOrigin_BATCH_ORIGIN_UNSPECIFIED
	}
}

// BatchDetail is one batch's full record (#209), scoped to the warehouse — a batch of another warehouse reads as
// NotFound, so its id cannot be used to probe another building's stock.
func (s *Service) BatchDetail(
	ctx context.Context,
	req *connect.Request[inventoryv1.BatchDetailRequest],
) (*connect.Response[inventoryv1.BatchDetailResponse], error) {
	var r batchRow

	err := batchQuery(s.db.WithContext(ctx)).
		Select(batchSelect).
		Where("b.id = ? AND b.warehouse_id = ?", req.Msg.GetBatchId(), req.Msg.GetTeamId()).
		Take(&r).
		Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("batch not found"))
	}

	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// UNITS THAT CAME BACK — an order's take released back into this batch. An order's transaction only ever takes, so
	// its positive rows on the batch are its rollback (a-rollback-reverses-its-log-rows).
	var returned struct {
		Qty  int64
		Last *time.Time
	}

	err = s.db.
		WithContext(ctx).
		Table("batch_logs AS l").
		Joins("JOIN inventory_transactions t ON t.id = l.transaction_id").
		Select("COALESCE(SUM(l.change_count), 0) AS qty, MAX(l.created_at) AS last").
		Where("l.batch_id = ? AND t.tx_type = ? AND l.change_count > 0",
			req.Msg.GetBatchId(), string(inventory_service_models.TxOrder)).
		Scan(&returned).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	resp := &inventoryv1.BatchDetailResponse{
		Batch:       batchRowToProto(&r),
		ReturnedQty: returned.Qty,
	}

	if returned.Last != nil {
		resp.LastReturnUnix = returned.Last.Unix()
	}

	return connect.NewResponse(resp), nil
}

// BatchPlacementList is WHERE A BATCH'S UNITS WERE PUT AWAY when it was minted — the batch-detail Placements tab
// (a-batch-shows-the-racks-it-was-put-on). A rack counts units per product, never per batch, so where they sit NOW is
// the product's racks; this is the minting transaction's own rack rows for the batch's product, with when each rack
// was last counted. Scoped to the warehouse through the batch.
func (s *Service) BatchPlacementList(
	ctx context.Context,
	req *connect.Request[inventoryv1.BatchPlacementListRequest],
) (*connect.Response[inventoryv1.BatchPlacementListResponse], error) {
	page := req.Msg.GetPage()

	base := func() *gorm.DB {
		return s.db.
			WithContext(ctx).
			Table("batches AS b").
			Joins("JOIN product_placement_logs l ON l.transaction_id = b.transaction_id AND l.product_id = b.product_id").
			Where("b.id = ? AND b.warehouse_id = ? AND l.stock_change > 0",
				req.Msg.GetFilter().GetBatchId(), req.Msg.GetTeamId())
	}

	var total int64

	err := base().Count(&total).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var rows []struct {
		RackID     uint64
		Qty        int64
		LastOpname *time.Time
	}

	offset := int((page.GetPage() - 1) * page.GetLimit())

	err = base().
		Select(`l.placement_id AS rack_id, l.stock_change AS qty,
			(SELECT MAX(c.created_at) FROM product_placement_logs c
			   WHERE c.product_id = l.product_id AND c.placement_id = l.placement_id AND c.change_type = ?) AS last_opname`,
			string(inventory_service_models.TxAdjustment)).
		Order("l.placement_id ASC").
		Offset(offset).
		Limit(int(page.GetLimit())).
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	shelves := make([]*inventoryv1.BatchShelf, 0, len(rows))
	for i := range rows {
		shelf := &inventoryv1.BatchShelf{RackId: rows[i].RackID, Qty: rows[i].Qty}
		if rows[i].LastOpname != nil {
			shelf.LastOpnameUnix = rows[i].LastOpname.Unix()
		}

		shelves = append(shelves, shelf)
	}

	items, ids := batchPlacementItems(shelves, req.Msg.GetDataRequest())

	return connect.NewResponse(&inventoryv1.BatchPlacementListResponse{
		Items: items,
		Ids:   ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   pageCount(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}
