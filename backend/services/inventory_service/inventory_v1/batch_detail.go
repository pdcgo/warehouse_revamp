package inventory_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// batchRow is the resolved shape of a batch — its delivery/line joins plus the derived Ready — shared
// by BatchList and BatchDetail so the two cannot disagree about what a batch looks like.
type batchRow struct {
	ID         uint64
	DeliveryID uint64
	ReceiptNo  string
	ProductID  uint64
	SKU        string
	Name       string
	SupplierID uint64
	UnitCost   *int64
	Arrived    int64
	Damaged    int64
	Lost       int64
	Ready      int64
	ExpiresOn  *time.Time
	CreatedAt  time.Time
	AcceptedAt time.Time
	CreatedBy  uint64
	AcceptedBy uint64
}

// lostExpr sums the units recorded LOST (missing/shrinkage) at acceptance; the rest of the damaged
// bucket is broken (#227). restock_damaged_units carries the per-reason type and damaged_qty is their
// total, so the split needs no schema change: broken = damaged − lost, and the identity
// arrived = broken + lost + used + ready still holds.
const lostExpr = `COALESCE((SELECT SUM(du.quantity) FROM restock_damaged_units du WHERE du.restock_request_item_id = b.restock_request_item_id AND du.damage_type = 'lost'), 0)`

// batchSelect is the projection over `stock_batches AS b` joined to its line and delivery. The caller
// adds the WHERE (warehouse + product for the list, warehouse + id for the detail) and the paging.
const batchSelect = `
	b.id, b.delivery_id, r.receipt AS receipt_no,
	b.product_id, i.sku, i.name, COALESCE(r.supplier_id, 0) AS supplier_id,
	b.unit_cost, b.arrived_qty AS arrived, b.damaged_qty AS damaged,
	` + lostExpr + ` AS lost,
	COALESCE((SELECT SUM(sb.qty) FROM stock_shelf_batches sb WHERE sb.batch_id = b.id), 0) AS ready,
	b.expires_on, b.created_at, b.accepted_at, b.created_by, b.accepted_by`

func batchRowToProto(r *batchRow) *inventoryv1.StockBatch {
	costKnown := r.UnitCost != nil
	var unitCost int64
	if costKnown {
		unitCost = *r.UnitCost
	}

	out := &inventoryv1.StockBatch{
		Id:             r.ID,
		DeliveryId:     r.DeliveryID,
		ReceiptNo:      r.ReceiptNo,
		ProductId:      r.ProductID,
		Sku:            r.SKU,
		Name:           r.Name,
		SupplierId:     r.SupplierID,
		UnitCost:       unitCost,
		CostKnown:      costKnown,
		Arrived: r.Arrived,
		// Damaged split into its two reasons (#227): lost is what the damage records typed as lost, and
		// broken is the remainder of the bucket.
		Broken:         r.Damaged - r.Lost,
		Lost:           r.Lost,
		Ready:          r.Ready,
		Used:           r.Arrived - r.Damaged - r.Ready,
		LineCost:       r.Arrived * unitCost,
		ReadyValue:     r.Ready * unitCost,
		CreatedAtUnix:  r.CreatedAt.Unix(),
		AcceptedAtUnix: r.AcceptedAt.Unix(),
		CreatedBy:      r.CreatedBy,
		AcceptedBy:     r.AcceptedBy,
		// Every batch today is minted from a restock delivery (#230); returns do not yet mint batches.
		Origin: inventoryv1.BatchOrigin_BATCH_ORIGIN_RESTOCK,
	}

	if r.ExpiresOn != nil {
		out.ExpiresOnUnix = r.ExpiresOn.Unix()
	}

	return out
}

// BatchDetail is one batch's full record (#209), scoped to the warehouse — a batch of another warehouse
// reads as NotFound, so its id cannot be used to probe another building's stock.
func (s *Service) BatchDetail(
	ctx context.Context,
	req *connect.Request[inventoryv1.BatchDetailRequest],
) (*connect.Response[inventoryv1.BatchDetailResponse], error) {
	var r batchRow

	err := s.db.
		WithContext(ctx).
		Table("stock_batches AS b").
		Joins("JOIN restock_request_items i ON i.id = b.restock_request_item_id").
		Joins("JOIN restock_requests r ON r.id = b.delivery_id").
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

	// Return summary (#228): how many of this batch's units came BACK (RETURN movements) and when the
	// last one did. Aggregated server-side — the ledger is paginated, so the client cannot total it.
	type retAgg struct {
		Qty  int64
		Last *time.Time
	}

	var ra retAgg

	err = s.db.
		WithContext(ctx).
		Table("stock_movements").
		Select("COALESCE(SUM(delta), 0) AS qty, MAX(created_at) AS last").
		Where("batch_id = ? AND kind = ?",
			req.Msg.GetBatchId(),
			int32(inventoryv1.MovementKind_MOVEMENT_KIND_RETURN)).
		Scan(&ra).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	resp := &inventoryv1.BatchDetailResponse{
		Batch:       batchRowToProto(&r),
		ReturnedQty: ra.Qty,
	}
	if ra.Last != nil {
		resp.LastReturnUnix = ra.Last.Unix()
	}

	return connect.NewResponse(resp), nil
}

// BatchPlacementList is where a batch's ready units sit right now (#209) — the batch-detail Placements
// tab. Only shelves that still hold some of it; scoped to the warehouse via the batch.
func (s *Service) BatchPlacementList(
	ctx context.Context,
	req *connect.Request[inventoryv1.BatchPlacementListRequest],
) (*connect.Response[inventoryv1.BatchPlacementListResponse], error) {
	page := req.Msg.GetPage()

	base := func() *gorm.DB {
		return s.db.
			WithContext(ctx).
			Table("stock_shelf_batches AS sb").
			Joins("JOIN stock_batches b ON b.id = sb.batch_id").
			Where("sb.batch_id = ? AND b.warehouse_id = ? AND sb.qty > 0", req.Msg.GetBatchId(), req.Msg.GetTeamId())
	}

	var total int64

	err := base().Count(&total).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	type row struct {
		RackID     *uint64
		Qty        int64
		LastOpname *time.Time
	}

	var rows []row

	offset := int((page.GetPage() - 1) * page.GetLimit())

	// Last opname (#226): when this shelf was last COUNTED — the last ADJUST on (this warehouse, this
	// product, this rack), the same rule the product placement tab uses. Batch-agnostic on purpose: a
	// shelf recount reconciles every batch on it, so the count is a fact about the RACK.
	err = base().
		Select(`sb.rack_id, sb.qty,
			(SELECT MAX(m.created_at) FROM stock_movements m
			   WHERE m.warehouse_id = b.warehouse_id AND m.product_id = b.product_id
			     AND m.rack_id IS NOT DISTINCT FROM sb.rack_id AND m.kind = ?) AS last_opname`,
			int32(inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST)).
		Order("sb.rack_id ASC NULLS LAST").
		Offset(offset).
		Limit(int(page.GetLimit())).
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	shelves := make([]*inventoryv1.BatchShelf, 0, len(rows))
	for i := range rows {
		shelf := &inventoryv1.BatchShelf{Qty: rows[i].Qty}
		if rows[i].RackID != nil {
			shelf.RackId = *rows[i].RackID
		}
		if rows[i].LastOpname != nil {
			shelf.LastOpnameUnix = rows[i].LastOpname.Unix()
		}
		shelves = append(shelves, shelf)
	}

	return connect.NewResponse(&inventoryv1.BatchPlacementListResponse{
		Shelves: shelves,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   pageCount(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}
