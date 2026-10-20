package inventory_v1

import (
	"context"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// WarehouseTransferList serves every side: the selling team its own transfers, a warehouse those leaving it and those
// coming to it. Newest first, paginated; the trail is left out (Detail carries it).
func (s *Service) WarehouseTransferList(
	ctx context.Context,
	req *connect.Request[inventoryv1.WarehouseTransferListRequest],
) (*connect.Response[inventoryv1.WarehouseTransferListResponse], error) {
	teamID := req.Msg.GetTeamId()
	filter := req.Msg.GetFilter()
	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&models.WarehouseTransfer{}).
		Where("(team_id = ? OR from_warehouse_id = ? OR to_warehouse_id = ?)", teamID, teamID, teamID)

	// A warehouse's view: leaving it (it is A) or coming to it (it is B).
	switch filter.GetDirection() {
	case inventoryv1.WarehouseTransferDirection_WAREHOUSE_TRANSFER_DIRECTION_OUTGOING:
		query = query.Where("from_warehouse_id = ?", teamID)
	case inventoryv1.WarehouseTransferDirection_WAREHOUSE_TRANSFER_DIRECTION_INCOMING:
		query = query.Where("to_warehouse_id = ?", teamID)
	}

	if status := transferStatusFromProto(filter.GetStatus()); status != "" {
		query = query.Where("status = ?", status)
	}

	// A warehouse at either end — for a warehouse, the other end.
	if warehouseID := filter.GetWarehouseId(); warehouseID != 0 {
		query = query.Where("(from_warehouse_id = ? OR to_warehouse_id = ?)", warehouseID, warehouseID)
	}

	if owner := filter.GetOwnerTeamId(); owner != 0 {
		query = query.Where("team_id = ?", owner)
	}

	if from := filter.GetFromUnix(); from != 0 {
		query = query.Where("created_at >= ?", time.Unix(from, 0))
	}

	if to := filter.GetToUnix(); to != 0 {
		query = query.Where("created_at <= ?", time.Unix(to, 0))
	}

	query = applyTransferSearch(query, filter.GetQ())

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, transferErr(err)
	}

	var rows []models.WarehouseTransfer

	err = query.
		Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		Preload("Problems", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
		Order("id DESC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&rows).
		Error
	if err != nil {
		return nil, transferErr(err)
	}

	picks, putaway, err := loadLegRacks(s.db.WithContext(ctx), rows)
	if err != nil {
		return nil, transferErr(err)
	}

	out := make([]*inventoryv1.WarehouseTransfer, 0, len(rows))
	for i := range rows {
		out = append(out, transferToProto(&rows[i], picks, putaway, false))
	}

	items, ids := warehouseTransferListItems(out, req.Msg.GetDataRequest())

	return connect.NewResponse(&inventoryv1.WarehouseTransferListResponse{
		Items:    items,
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	}), nil
}

// applyTransferSearch narrows by free text over its number (a whole id only, with or without its #), the tracking
// number, and a line's SKU or name. The lines match with EXISTS, so a transfer is never counted once per matching line.
func applyTransferSearch(query *gorm.DB, q string) *gorm.DB {
	q = strings.TrimSpace(q)
	if q == "" {
		return query
	}

	like := "%" + strings.ToLower(q) + "%"

	conditions := []string{
		"LOWER(receipt) LIKE ?",
		"EXISTS (SELECT 1 FROM warehouse_transfer_items i " +
			"WHERE i.transfer_id = warehouse_transfers.id AND (LOWER(i.sku) LIKE ? OR LOWER(i.name) LIKE ?))",
	}
	args := []any{like, like, like}

	id, err := strconv.ParseUint(strings.TrimPrefix(q, "#"), 10, 64)
	if err == nil && id != 0 {
		conditions = append(conditions, "warehouse_transfers.id = ?")
		args = append(args, id)
	}

	return query.Where("("+strings.Join(conditions, " OR ")+")", args...)
}

// warehouseTransferListItems is the columnar list shape: one map per data type asked, the ids in order beside them.
// Nothing asked means the transfers.
func warehouseTransferListItems(
	transfers []*inventoryv1.WarehouseTransfer,
	types []inventoryv1.WarehouseTransferListDataType,
) ([]*inventoryv1.WarehouseTransferListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []inventoryv1.WarehouseTransferListDataType{
			inventoryv1.WarehouseTransferListDataType_WAREHOUSE_TRANSFER_LIST_DATA_TYPE_WAREHOUSE_TRANSFER,
		}
	}

	ids := make([]uint64, 0, len(transfers))
	for _, t := range transfers {
		ids = append(ids, t.GetId())
	}

	items := make([]*inventoryv1.WarehouseTransferListResponseItem, 0, len(types))

	for _, kind := range types {
		switch kind {
		case inventoryv1.WarehouseTransferListDataType_WAREHOUSE_TRANSFER_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(transfers))
			for _, t := range transfers {
				m[t.GetId()] = &commonv1.GeneralItem{Id: t.GetId()}
			}

			items = append(items, &inventoryv1.WarehouseTransferListResponseItem{
				D: &inventoryv1.WarehouseTransferListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case inventoryv1.WarehouseTransferListDataType_WAREHOUSE_TRANSFER_LIST_DATA_TYPE_WAREHOUSE_TRANSFER:
			m := make(map[uint64]*inventoryv1.WarehouseTransfer, len(transfers))
			for _, t := range transfers {
				m[t.GetId()] = t
			}

			items = append(items, &inventoryv1.WarehouseTransferListResponseItem{
				D: &inventoryv1.WarehouseTransferListResponseItem_WarehouseTransfer{
					WarehouseTransfer: &inventoryv1.WarehouseTransferMapItem{MapData: m},
				},
			})
		}
	}

	return items, ids
}
