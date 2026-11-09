package inventory_v1

import (
	"context"
	"fmt"
	"strings"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// OpnameRowList is the admin's watch page: every row of a count WITH the book figure, by rack code then product name,
// paged (RULE 9). The policy keeps staff out — a counter who could read it would no longer count blind
// (a-count-is-blind-then-revealed).
func (s *Service) OpnameRowList(
	ctx context.Context,
	req *connect.Request[inventoryv1.OpnameRowListRequest],
) (*connect.Response[inventoryv1.OpnameRowListResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	filter := req.Msg.GetFilter()
	page := req.Msg.GetPage()
	db := s.db.WithContext(ctx)

	session, err := opnameSessionOf(db, warehouseID, filter.GetSessionId(), "")
	if err != nil {
		return nil, opnameErr(err)
	}

	query := db.Table("opname_session_snapshots AS s").
		Joins("JOIN placements p ON p.id = s.placement_id").
		Where("s.opname_session_id = ?", session.ID)

	if placementID := filter.GetPlacementId(); placementID != 0 {
		query = query.Where("s.placement_id = ?", placementID)
	}

	switch filter.GetStatus() {
	case inventoryv1.OpnameRowStatus_OPNAME_ROW_STATUS_CREATED:
		query = query.Where("s.status = ?", models.OpnameRowCreated)
	case inventoryv1.OpnameRowStatus_OPNAME_ROW_STATUS_COUNTED:
		query = query.Where("s.status = ?", models.OpnameRowCounted)
	}

	if filter.GetOnlyDifferences() {
		query = query.Where("s.recounted_stock_count IS NOT NULL AND s.recounted_stock_count <> s.system_stock_count")
	}

	if q := strings.TrimSpace(filter.GetQ()); q != "" {
		like := "%" + strings.ToLower(escapeLike(q)) + "%"
		query = query.Where("(LOWER(s.product_code) LIKE ? OR LOWER(s.product_name) LIKE ?)", like, like)
	}

	var total int64

	err = query.Count(&total).Error
	if err != nil {
		return nil, opnameErr(err)
	}

	// The page, its racks' codes with it (the join is already there for the order).
	var paged []struct {
		models.OpnameSessionSnapshot
		PlacementCode string
	}

	err = query.Select("s.*, p.code AS placement_code").
		Order("p.code, s.product_name, s.id").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Scan(&paged).Error
	if err != nil {
		return nil, opnameErr(err)
	}

	rows := make([]models.OpnameSessionSnapshot, 0, len(paged))
	codes := make(map[uint64]string, len(paged))

	for _, r := range paged {
		rows = append(rows, r.OpnameSessionSnapshot)
		codes[r.PlacementID] = r.PlacementCode
	}

	mapped, err := opnameRowsProto(db, session.ID, rows, codes, false)
	if err != nil {
		return nil, opnameErr(err)
	}

	ids := make([]uint64, 0, len(mapped))
	m := make(map[uint64]*inventoryv1.OpnameRow, len(mapped))

	for _, r := range mapped {
		ids = append(ids, r.GetId())
		m[r.GetId()] = r
	}

	types := req.Msg.GetDataRequest()
	if len(types) == 0 {
		types = []inventoryv1.OpnameRowListDataType{inventoryv1.OpnameRowListDataType_OPNAME_ROW_LIST_DATA_TYPE_ROW}
	}

	items := make([]*inventoryv1.OpnameRowListResponseItem, 0, len(types))

	for _, kind := range types {
		switch kind {
		case inventoryv1.OpnameRowListDataType_OPNAME_ROW_LIST_DATA_TYPE_GENERAL:
			items = append(items, &inventoryv1.OpnameRowListResponseItem{
				D: &inventoryv1.OpnameRowListResponseItem_General{General: generalOf(ids, func(id uint64) string {
					return fmt.Sprintf("%s · %s", m[id].GetProductName(), m[id].GetPlacementCode())
				})},
			})
		case inventoryv1.OpnameRowListDataType_OPNAME_ROW_LIST_DATA_TYPE_ROW:
			items = append(items, &inventoryv1.OpnameRowListResponseItem{
				D: &inventoryv1.OpnameRowListResponseItem_Row{Row: &inventoryv1.OpnameRowMapItem{MapData: m}},
			})
		}
	}

	return connect.NewResponse(&inventoryv1.OpnameRowListResponse{
		Items:    items,
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	}), nil
}
