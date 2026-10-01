package settlement_importer_v1

import (
	"context"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_service_models"
)

// UploadedFileLineList is one file's lines by outcome — the file page's three views: HELD, SKIPPED, and
// POSTED with NO_ORDER (posted to the shop). Paged: a statement runs to ~1,500 lines.
//
// Another team's file is NotFound — the file is checked against the team before a line is read, since the
// lines carry no team of their own.
func (s *Service) UploadedFileLineList(
	ctx context.Context,
	req *connect.Request[settlement_importerv1.UploadedFileLineListRequest],
) (*connect.Response[settlement_importerv1.UploadedFileLineListResponse], error) {
	msg := req.Msg
	page := msg.GetPage()
	filter := msg.GetFilter()

	db := s.db.WithContext(ctx)

	var owned int64

	err := db.
		Model(&settlement_importer_service_models.UploadedFile{}).
		Where("id = ? AND team_id = ?", filter.GetUploadedFileId(), msg.GetTeamId()).
		Count(&owned).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	if owned == 0 {
		return nil, notFound()
	}

	query := db.
		Model(&settlement_importer_service_models.UploadedFileLine{}).
		Where("uploaded_file_id = ?", filter.GetUploadedFileId())

	if len(filter.GetOutcomes()) > 0 {
		outcomes := make([]string, 0, len(filter.GetOutcomes()))
		for _, outcome := range filter.GetOutcomes() {
			outcomes = append(outcomes, outcomeText[outcome])
		}

		query = query.Where("outcome IN ?", outcomes)
	}

	if len(filter.GetReasons()) > 0 {
		reasons := make([]string, 0, len(filter.GetReasons()))
		for _, reason := range filter.GetReasons() {
			reasons = append(reasons, reasonText[reason])
		}

		query = query.Where("reason IN ?", reasons)
	}

	var total int64

	err = query.Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	var lines []settlement_importer_service_models.UploadedFileLine

	err = query.
		Order(lineOrderClause(msg.GetSort())).
		Offset(int((page.GetPage() - 1) * page.GetLimit())).
		Limit(int(page.GetLimit())).
		Find(&lines).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	items, ids := lineListItems(lines, msg.GetDataRequest())

	return connect.NewResponse(&settlement_importerv1.UploadedFileLineListResponse{
		Items: items,
		Ids:   ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}

// lineOrderClause — the file's own order by default (occurred_on, then the order it was read); ties by id.
func lineOrderClause(sort *settlement_importerv1.UploadedFileLineListFilterSort) string {
	direction := "ASC"

	if sort != nil && sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_DESC {
		direction = "DESC"
	}

	if sort != nil {
		switch s := sort.GetS().(type) {
		case *settlement_importerv1.UploadedFileLineListFilterSort_General:
			if s.General == commonv1.GeneralSort_GENERAL_SORT_NAME {
				return "order_ref " + direction + ", line_no " + direction + ", id " + direction
			}
		case *settlement_importerv1.UploadedFileLineListFilterSort_Line:
			if s.Line == settlement_importerv1.UploadedFileLineRowSort_UPLOADED_FILE_LINE_ROW_SORT_CHANGE {
				return "change " + direction + ", line_no " + direction + ", id " + direction
			}
		}
	}

	return "occurred_on " + direction + " NULLS LAST, line_no " + direction + ", id " + direction
}

func lineListItems(
	lines []settlement_importer_service_models.UploadedFileLine,
	types []settlement_importerv1.UploadedFileLineListDataType,
) ([]*settlement_importerv1.UploadedFileLineListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []settlement_importerv1.UploadedFileLineListDataType{
			settlement_importerv1.UploadedFileLineListDataType_UPLOADED_FILE_LINE_LIST_DATA_TYPE_LINE,
		}
	}

	ids := make([]uint64, 0, len(lines))
	for i := range lines {
		ids = append(ids, lines[i].ID)
	}

	items := make([]*settlement_importerv1.UploadedFileLineListResponseItem, 0, len(types))

	for _, t := range types {
		switch t {
		case settlement_importerv1.UploadedFileLineListDataType_UPLOADED_FILE_LINE_LIST_DATA_TYPE_GENERAL:
			general := make(map[uint64]*commonv1.GeneralItem, len(lines))
			for i := range lines {
				general[lines[i].ID] = &commonv1.GeneralItem{Id: lines[i].ID, Name: lineName(&lines[i])}
			}

			items = append(items, &settlement_importerv1.UploadedFileLineListResponseItem{
				D: &settlement_importerv1.UploadedFileLineListResponseItem_General{
					General: &commonv1.GeneralMapItem{MapData: general},
				},
			})
		case settlement_importerv1.UploadedFileLineListDataType_UPLOADED_FILE_LINE_LIST_DATA_TYPE_LINE:
			rows := make(map[uint64]*settlement_importerv1.UploadedFileLine, len(lines))
			for i := range lines {
				rows[lines[i].ID] = lineToProto(&lines[i])
			}

			items = append(items, &settlement_importerv1.UploadedFileLineListResponseItem{
				D: &settlement_importerv1.UploadedFileLineListResponseItem_Line{
					Line: &settlement_importerv1.UploadedFileLineRowMapItem{MapData: rows},
				},
			})
		}
	}

	return items, ids
}
