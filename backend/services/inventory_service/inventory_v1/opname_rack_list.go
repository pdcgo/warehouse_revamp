package inventory_v1

import (
	"context"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// OpnameRackList is the racks a counter visits, by code, each with how many of its rows are counted — paged (RULE 9). An
// `all` count lists EVERY rack of the warehouse, empty ones too, so a carton on the wrong rack is found where it is
// (an-all-count-visits-every-rack); any other plan lists the racks of its rows (the-plan-target-is-only-a-filter).
func (s *Service) OpnameRackList(
	ctx context.Context,
	req *connect.Request[inventoryv1.OpnameRackListRequest],
) (*connect.Response[inventoryv1.OpnameRackListResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	filter := req.Msg.GetFilter()
	page := req.Msg.GetPage()
	db := s.db.WithContext(ctx)

	session, err := opnameSessionOf(db, warehouseID, filter.GetSessionId(), "")
	if err != nil {
		return nil, opnameErr(err)
	}

	query := opnameRacksQuery(db, session)

	if q := strings.TrimSpace(filter.GetQ()); q != "" {
		query = query.Where("racks.code LIKE ?", "%"+models.CleanRackCode(escapeLike(q))+"%")
	}

	var total int64

	err = query.Session(&gorm.Session{}).Count(&total).Error
	if err != nil {
		return nil, opnameErr(err)
	}

	var racks []opnameRackRow

	err = query.
		Order("racks.code, racks.placement_id").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Scan(&racks).Error
	if err != nil {
		return nil, opnameErr(err)
	}

	ids := make([]uint64, 0, len(racks))
	m := make(map[uint64]*inventoryv1.OpnameRack, len(racks))

	for _, r := range racks {
		ids = append(ids, r.PlacementID)
		m[r.PlacementID] = r.proto()
	}

	types := req.Msg.GetDataRequest()
	if len(types) == 0 {
		types = []inventoryv1.OpnameRackListDataType{inventoryv1.OpnameRackListDataType_OPNAME_RACK_LIST_DATA_TYPE_RACK}
	}

	items := make([]*inventoryv1.OpnameRackListResponseItem, 0, len(types))

	for _, kind := range types {
		switch kind {
		case inventoryv1.OpnameRackListDataType_OPNAME_RACK_LIST_DATA_TYPE_GENERAL:
			items = append(items, &inventoryv1.OpnameRackListResponseItem{
				D: &inventoryv1.OpnameRackListResponseItem_General{General: generalOf(ids, func(id uint64) string { return m[id].GetCode() })},
			})
		case inventoryv1.OpnameRackListDataType_OPNAME_RACK_LIST_DATA_TYPE_RACK:
			items = append(items, &inventoryv1.OpnameRackListResponseItem{
				D: &inventoryv1.OpnameRackListResponseItem_Rack{Rack: &inventoryv1.OpnameRackMapItem{MapData: m}},
			})
		}
	}

	return connect.NewResponse(&inventoryv1.OpnameRackListResponse{
		Items:    items,
		Ids:      ids,
		PageInfo: pageInfo(page, total),
	}), nil
}

// opnameRackRow is one rack with its rows' progress.
type opnameRackRow struct {
	PlacementID     uint64
	Code            string
	RowCount        int64
	CountedRowCount int64
}

func (r opnameRackRow) proto() *inventoryv1.OpnameRack {
	return &inventoryv1.OpnameRack{
		PlacementId: r.PlacementID, Code: r.Code, RowCount: r.RowCount, CountedRowCount: r.CountedRowCount,
	}
}

// opnameRacksQuery is a session's racks with their progress, as `racks` (placement_id, code, row_count,
// counted_row_count): for `all`, every live rack of the warehouse — through its own index — plus any rack a row sits on
// that has since been deleted; otherwise the racks its rows sit on.
func opnameRacksQuery(db *gorm.DB, session models.OpnameSession) *gorm.DB {
	const cols = "p.id AS placement_id, p.code, COUNT(s.id) AS row_count, " +
		"COUNT(s.id) FILTER (WHERE s.status = 'counted') AS counted_row_count"

	rowsOf := db.Session(&gorm.Session{NewDB: true}).Table("placements AS p").Select(cols).
		Joins("JOIN opname_session_snapshots s ON s.placement_id = p.id AND s.opname_session_id = ?", session.ID)

	if session.Plan != models.OpnamePlanAll {
		return db.Session(&gorm.Session{NewDB: true}).Table("(?) AS racks", rowsOf.Group("p.id, p.code"))
	}

	live := db.Session(&gorm.Session{NewDB: true}).Table("placements AS p").Select(cols).
		Joins("LEFT JOIN opname_session_snapshots s ON s.placement_id = p.id AND s.opname_session_id = ?", session.ID).
		Where("p.warehouse_id = ? AND p.deleted_at IS NULL", session.WarehouseID).
		Group("p.id, p.code")

	gone := rowsOf.Where("p.deleted_at IS NOT NULL").Group("p.id, p.code")

	return db.Session(&gorm.Session{NewDB: true}).Table("(? UNION ALL ?) AS racks", live, gone)
}
