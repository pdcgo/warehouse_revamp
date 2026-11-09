package inventory_v1

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// FoundRequestList lists a warehouse's found requests, newest first, paged (RULE 9) — the Owner's and Admin's approval
// list and its history, filtered by one status (an-adjust-found-waits-for-the-owner-or-admin). A READ: no row, no event.
//
// Each waiting request says what approving it would post NOW — the oldest open losses claimed back at their price, then
// the mint at the team's newest price here — worked out by the stock count's own settlement over one plain read
// (inventory_mutations.PreviewFound); an approved one says what it posted; `block` says why THIS caller may not approve
// it. A staff caller sees only the requests they reported (staff-may-report-a-found,
// the-reporter-may-withdraw-their-found) — filtered here, not on the screen.
func (s *Service) FoundRequestList(
	ctx context.Context,
	req *connect.Request[inventoryv1.FoundRequestListRequest],
) (*connect.Response[inventoryv1.FoundRequestListResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	page := req.Msg.GetPage()
	actor := actorFrom(ctx)
	db := s.db.WithContext(ctx)

	query := db.Model(&models.FoundRequest{}).Where("warehouse_id = ?", warehouseID)
	if status := foundStatusOf(req.Msg.GetFilter().GetStatus()); status != "" {
		query = query.Where("status = ?", status)
	}

	if isFoundStaff(ctx) {
		query = query.Where("reported_by_id = ?", actor)
	}

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, foundErr(err)
	}

	var rows []models.FoundRequest

	err = query.Order("id DESC").Offset(pageOffset(page)).Limit(int(page.GetLimit())).Find(&rows).Error
	if err != nil {
		return nil, foundErr(err)
	}

	ids := make([]uint64, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}

	types := req.Msg.GetDataRequest()
	if len(types) == 0 {
		types = []inventoryv1.FoundRequestListDataType{inventoryv1.FoundRequestListDataType_FOUND_REQUEST_LIST_DATA_TYPE_REQUEST}
	}

	items := make([]*inventoryv1.FoundRequestListResponseItem, 0, len(types))

	for _, kind := range types {
		switch kind {
		case inventoryv1.FoundRequestListDataType_FOUND_REQUEST_LIST_DATA_TYPE_GENERAL:
			items = append(items, &inventoryv1.FoundRequestListResponseItem{
				D: &inventoryv1.FoundRequestListResponseItem_General{
					General: generalOf(ids, func(id uint64) string { return fmt.Sprintf("Found #%d", id) }),
				},
			})
		case inventoryv1.FoundRequestListDataType_FOUND_REQUEST_LIST_DATA_TYPE_REQUEST:
			mapped, mapErr := foundRequestsProto(db, actor, rows)
			if mapErr != nil {
				return nil, foundErr(mapErr)
			}

			items = append(items, &inventoryv1.FoundRequestListResponseItem{
				D: &inventoryv1.FoundRequestListResponseItem_Request{Request: &inventoryv1.FoundRequestMapItem{MapData: mapped}},
			})
		}
	}

	return connect.NewResponse(&inventoryv1.FoundRequestListResponse{
		Items:    items,
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	}), nil
}
