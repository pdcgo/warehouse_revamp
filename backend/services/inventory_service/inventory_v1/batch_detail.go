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
	Ready      int64
	ExpiresOn  *time.Time
	CreatedAt  time.Time
	AcceptedAt time.Time
	CreatedBy  uint64
	AcceptedBy uint64
}

// batchSelect is the projection over `stock_batches AS b` joined to its line and delivery. The caller
// adds the WHERE (warehouse + product for the list, warehouse + id for the detail) and the paging.
const batchSelect = `
	b.id, b.delivery_id, r.receipt AS receipt_no,
	b.product_id, i.sku, i.name, COALESCE(r.supplier_id, 0) AS supplier_id,
	b.unit_cost, b.arrived_qty AS arrived, b.damaged_qty AS damaged,
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
		Arrived:        r.Arrived,
		Damaged:        r.Damaged,
		Ready:          r.Ready,
		Used:           r.Arrived - r.Damaged - r.Ready,
		LineCost:       r.Arrived * unitCost,
		ReadyValue:     r.Ready * unitCost,
		CreatedAtUnix:  r.CreatedAt.Unix(),
		AcceptedAtUnix: r.AcceptedAt.Unix(),
		CreatedBy:      r.CreatedBy,
		AcceptedBy:     r.AcceptedBy,
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

	return connect.NewResponse(&inventoryv1.BatchDetailResponse{Batch: batchRowToProto(&r)}), nil
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
		RackID *uint64
		Qty    int64
	}

	var rows []row

	offset := int((page.GetPage() - 1) * page.GetLimit())

	err = base().
		Select("sb.rack_id, sb.qty").
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
