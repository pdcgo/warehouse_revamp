package inventory_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// THE BATCH, READ FROM THE BATCH LEDGER. A batch knows its own price, units and value; what it came in on — the
// delivery, its receipt, the line's broken and missing units, a product code and name — is the transaction that minted it: a
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
	ProductCode    string
	Name           string
	SupplierID     uint64
	PriceUnit      float64
	InitStockCount int64
	// What the minted units were worth at the price the batch was accepted at — kept for ever, never repriced.
	InitStockValuation float64
	Ready              int64
	StockValuation     float64
	Broken             int64
	Lost               int64
	ExpiredAt          *time.Time
	CreatedAt          time.Time
	CreatedBy          uint64
	AcceptedBy         uint64
	TxType             string
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
	b.product_id, COALESCE(i.product_code, wti.product_code, '') AS product_code, COALESCE(i.name, wti.name, '') AS name, b.supplier_id,
	b.price_unit, b.init_stock_count, b.init_stock_valuation, b.stock_count AS ready, b.stock_valuation,
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
// wrong; used is what has left since. Every batch carries its price, so the cost is always known. Money is the stored
// double, unrounded (money-is-double-in-the-api-too, the-backend-never-rounds-money).
//
// What arrived is worth at the price the batch was ACCEPTED at — the minted value per minted unit — never today's: a price
// correction reprices only the units left (a-late-cost-is-an-expense-not-a-revaluation). Until a correction the two
// agree.
func batchRowToProto(r *batchRow) *inventoryv1.StockBatch {
	arrived := r.InitStockCount + r.Broken + r.Lost

	acceptedPrice := r.PriceUnit
	if r.InitStockCount > 0 {
		acceptedPrice = r.InitStockValuation / float64(r.InitStockCount)
	}

	out := &inventoryv1.StockBatch{
		Id:             r.ID,
		DeliveryId:     r.DeliveryID,
		WarehouseId:    r.WarehouseID,
		ReceiptNo:      r.ReceiptNo,
		ProductId:      r.ProductID,
		ProductCode:    r.ProductCode,
		Name:           r.Name,
		SupplierId:     r.SupplierID,
		UnitCost:       r.PriceUnit,
		CostKnown:      true,
		Arrived:        arrived,
		Broken:         r.Broken,
		Lost:           r.Lost,
		Ready:          r.Ready,
		Used:           r.InitStockCount - r.Ready,
		LineCost:       float64(arrived) * acceptedPrice,
		ReadyValue:     r.StockValuation,
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

	// ONE PASS OVER THE BATCH'S OWN ROWS (batch_logs_batch_idx):
	//   - UNITS THAT CAME BACK — an order's take released back into this batch. An order's transaction only ever takes, so
	//     its positive rows on the batch are its rollback (a-rollback-reverses-its-log-rows).
	//   - ITS PRICE CORRECTIONS — what they changed the value by in all, and the newest one's price before it (priceExprs'
	//     arithmetic): Terpakai's value below, and the screen's *dikoreksi dari Rp …*.
	// The transaction is looked up only for a row that ADDED units (the AND stops at a take), never joined: a join over
	// every row of a long-selling batch made the planner hash the whole inventory_transactions table — 10 ms at 3 000
	// takes, growing with the table; 0.9 ms this way (TestPerf_BatchDetail_ALongCorrectedBatch).
	var logs struct {
		Qty           int64
		Last          *time.Time
		Revalued      float64
		Corrections   int64
		CorrectedFrom *float64
	}

	err = s.db.
		WithContext(ctx).
		Raw(`
			SELECT
				COALESCE(SUM(l.change_count) FILTER (WHERE l.came_back), 0) AS qty,
				MAX(l.created_at) FILTER (WHERE l.came_back) AS last,
				COALESCE(SUM(l.change_valuation) FILTER (WHERE l.change_type = @revaluation), 0) AS revalued,
				COUNT(*) FILTER (WHERE l.change_type = @revaluation) AS corrections,
				(ARRAY_AGG(l.price_unit_after - l.change_valuation / NULLIF(l.stock_count_after, 0) ORDER BY l.id DESC)
					FILTER (WHERE l.change_type = @revaluation))[1] AS corrected_from
			FROM (
				SELECT l.id, l.created_at, l.change_count, l.change_type, l.change_valuation, l.price_unit_after,
				       l.stock_count_after,
				       l.change_count > 0 AND EXISTS (
				           SELECT 1 FROM inventory_transactions t WHERE t.id = l.transaction_id AND t.tx_type = @order
				       ) AS came_back
				FROM batch_logs l
				WHERE l.batch_id = @batch
			) l`,
			map[string]any{
				"batch":       req.Msg.GetBatchId(),
				"order":       string(inventory_service_models.TxOrder),
				"revaluation": string(inventory_service_models.TxRevaluation),
			}).
		Scan(&logs).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// THE DOOR'S PROBLEM ROWS — Rusak and Hilang at the landed price they were written at; a transfer's batch has none.
	var door struct {
		Broken float64
		Lost   float64
	}

	if r.DeliveryID != 0 {
		err = s.db.
			WithContext(ctx).
			Table("restock_problem_items").
			Select(`COALESCE(SUM(total) FILTER (WHERE problem_type = 'broken'), 0) AS broken,
				COALESCE(SUM(total) FILTER (WHERE problem_type = 'missing'), 0) AS lost`).
			Where("restock_id = ? AND product_id = ?", r.DeliveryID, r.ProductID).
			Scan(&door).
			Error
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	resp := &inventoryv1.BatchDetailResponse{
		Batch:       batchRowToProto(&r),
		ReturnedQty: logs.Qty,
		BrokenValue: door.Broken,
		LostValue:   door.Lost,
		// What left, at the price each unit left at: the accepted value, moved by every correction, less what is left —
		// the sum of the batch's own unit-moving rows, never units × today's price.
		UsedValue:      r.InitStockValuation + logs.Revalued - r.StockValuation,
		PriceCorrected: logs.Corrections > 0,
	}

	if logs.CorrectedFrom != nil {
		resp.PriceCorrectedFrom = *logs.CorrectedFrom
	}

	if logs.Last != nil {
		resp.LastReturnUnix = logs.Last.Unix()
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
			GREATEST(
			    (SELECT MAX(c.created_at) FROM product_placement_logs c
			       WHERE c.product_id = l.product_id AND c.placement_id = l.placement_id AND c.change_type = ?),
			    (SELECT MAX(o.finalized_at) FROM opname_session_snapshots ss JOIN opname_sessions o ON o.id = ss.opname_session_id
			       WHERE ss.product_id = l.product_id AND ss.placement_id = l.placement_id AND o.status = 'finish')
			) AS last_opname`,
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
