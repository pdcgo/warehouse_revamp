package inventory_v1

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// OpnameSessionList is the warehouse's counts, newest first, paged (RULE 9) — every member reads it, staff to find the
// active one to count (one-active-count-per-warehouse). A counter's read of an unfinished count carries no difference
// count: it would leak the book (a-count-is-blind-then-revealed).
func (s *Service) OpnameSessionList(
	ctx context.Context,
	req *connect.Request[inventoryv1.OpnameSessionListRequest],
) (*connect.Response[inventoryv1.OpnameSessionListResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	page := req.Msg.GetPage()
	db := s.db.WithContext(ctx)

	query := db.Model(&models.OpnameSession{}).Where("warehouse_id = ?", warehouseID)
	if status := opnameStatusOf(req.Msg.GetFilter().GetStatus()); status != "" {
		query = query.Where("status = ?", status)
	}

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, opnameErr(err)
	}

	var sessions []models.OpnameSession

	err = query.Order("id DESC").Offset(pageOffset(page)).Limit(int(page.GetLimit())).Find(&sessions).Error
	if err != nil {
		return nil, opnameErr(err)
	}

	progress, err := opnameProgressOf(db, sessions)
	if err != nil {
		return nil, opnameErr(err)
	}

	blind := isCounterRead(ctx)
	ids := make([]uint64, 0, len(sessions))
	m := make(map[uint64]*inventoryv1.OpnameSession, len(sessions))

	for _, session := range sessions {
		ids = append(ids, session.ID)
		m[session.ID] = opnameSessionProto(session, progress[session.ID], blind)
	}

	types := req.Msg.GetDataRequest()
	if len(types) == 0 {
		types = []inventoryv1.OpnameSessionListDataType{inventoryv1.OpnameSessionListDataType_OPNAME_SESSION_LIST_DATA_TYPE_SESSION}
	}

	items := make([]*inventoryv1.OpnameSessionListResponseItem, 0, len(types))

	for _, kind := range types {
		switch kind {
		case inventoryv1.OpnameSessionListDataType_OPNAME_SESSION_LIST_DATA_TYPE_GENERAL:
			items = append(items, &inventoryv1.OpnameSessionListResponseItem{
				D: &inventoryv1.OpnameSessionListResponseItem_General{
					General: generalOf(ids, func(id uint64) string { return fmt.Sprintf("Count #%d", id) }),
				},
			})
		case inventoryv1.OpnameSessionListDataType_OPNAME_SESSION_LIST_DATA_TYPE_SESSION:
			items = append(items, &inventoryv1.OpnameSessionListResponseItem{
				D: &inventoryv1.OpnameSessionListResponseItem_Session{Session: &inventoryv1.OpnameSessionMapItem{MapData: m}},
			})
		}
	}

	return connect.NewResponse(&inventoryv1.OpnameSessionListResponse{
		Items:    items,
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	}), nil
}
