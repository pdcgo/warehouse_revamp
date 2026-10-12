package settlement_importer_v1

import (
	"context"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_service_models"
)

// UploadedFileList is the import screen — the team's uploads, newest first, a page at a time, filtered by
// shop, platform and status. The guideline's List shape: the ids in order, plus the slices asked for.
func (s *Service) UploadedFileList(
	ctx context.Context,
	req *connect.Request[settlement_importerv1.UploadedFileListRequest],
) (*connect.Response[settlement_importerv1.UploadedFileListResponse], error) {
	msg := req.Msg
	page := msg.GetPage()
	filter := msg.GetFilter()

	query := s.db.
		WithContext(ctx).
		Model(&settlement_importer_service_models.UploadedFile{}).
		Where("team_id = ?", msg.GetTeamId())

	if filter.GetShopId() != 0 {
		query = query.Where("shop_id = ?", filter.GetShopId())
	}

	if filter.GetPlatform() != marketplacev1.Marketplace_MARKETPLACE_UNSPECIFIED {
		query = query.Where("platform = ?", san_marketplace.ToText(filter.GetPlatform()))
	}

	if len(filter.GetStatuses()) > 0 {
		query = query.Where(statusCondition(s.db, filter.GetStatuses()))
	}

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	var files []settlement_importer_service_models.UploadedFile

	err = query.
		Order(fileOrderClause(msg.GetSort())).
		Offset(int((page.GetPage() - 1) * page.GetLimit())).
		Limit(int(page.GetLimit())).
		Find(&files).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	items, ids := s.fileListItems(files, msg.GetDataRequest())

	return connect.NewResponse(&settlement_importerv1.UploadedFileListResponse{
		Items: items,
		Ids:   ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}

// statusCondition is the status filter. RUNNING and INTERRUPTED are one stored value told apart by how
// long ago the row last moved — the same line statusOf draws, drawn here in SQL so a page is counted right.
func statusCondition(db *gorm.DB, statuses []settlement_importerv1.UploadedFileStatus) *gorm.DB {
	stale := "updated_at < NOW() - make_interval(secs => ?)"
	fresh := "updated_at >= NOW() - make_interval(secs => ?)"
	seconds := interruptedAfter.Seconds()

	condition := db.Where("FALSE")

	for _, status := range statuses {
		switch status {
		case settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_RUNNING:
			condition = condition.Or("status = ? AND "+fresh, statusRunning, seconds)
		case settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_INTERRUPTED:
			condition = condition.Or("status = ? AND "+stale, statusRunning, seconds)
		case settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_DONE:
			condition = condition.Or("status = ?", statusDone)
		case settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_FAILED:
			condition = condition.Or("status = ?", statusFailed)
		}
	}

	return condition
}

// fileOrderClause — newest upload first by default; ties broken by id so a page is stable.
func fileOrderClause(sort *settlement_importerv1.UploadedFileListFilterSort) string {
	column := "created_at"
	direction := "DESC"

	if sort != nil {
		if sort.GetSortType() == commonv1.CommonSortType_COMMON_SORT_TYPE_ASC {
			direction = "ASC"
		}

		switch s := sort.GetS().(type) {
		case *settlement_importerv1.UploadedFileListFilterSort_General:
			// GENERAL's name is the file's own range, so it sorts by where the range starts.
			if s.General == commonv1.GeneralSort_GENERAL_SORT_NAME {
				column = "period_from"
			}
		case *settlement_importerv1.UploadedFileListFilterSort_File:
			if s.File == settlement_importerv1.UploadedFileRowSort_UPLOADED_FILE_ROW_SORT_PERIOD_TO {
				column = "period_to"
			}
		}
	}

	nulls := " NULLS LAST"

	return strings.Join([]string{column + " " + direction + nulls, "id " + direction}, ", ")
}

func (s *Service) fileListItems(
	files []settlement_importer_service_models.UploadedFile,
	types []settlement_importerv1.UploadedFileListDataType,
) ([]*settlement_importerv1.UploadedFileListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []settlement_importerv1.UploadedFileListDataType{
			settlement_importerv1.UploadedFileListDataType_UPLOADED_FILE_LIST_DATA_TYPE_FILE,
		}
	}

	now := s.now()

	ids := make([]uint64, 0, len(files))
	for i := range files {
		ids = append(ids, files[i].ID)
	}

	items := make([]*settlement_importerv1.UploadedFileListResponseItem, 0, len(types))

	for _, t := range types {
		switch t {
		case settlement_importerv1.UploadedFileListDataType_UPLOADED_FILE_LIST_DATA_TYPE_GENERAL:
			general := make(map[uint64]*commonv1.GeneralItem, len(files))
			for i := range files {
				general[files[i].ID] = &commonv1.GeneralItem{Id: files[i].ID, Name: fileName(&files[i])}
			}

			items = append(items, &settlement_importerv1.UploadedFileListResponseItem{
				D: &settlement_importerv1.UploadedFileListResponseItem_General{
					General: &commonv1.GeneralMapItem{MapData: general},
				},
			})
		case settlement_importerv1.UploadedFileListDataType_UPLOADED_FILE_LIST_DATA_TYPE_FILE:
			rows := make(map[uint64]*settlement_importerv1.UploadedFile, len(files))
			for i := range files {
				rows[files[i].ID] = fileToProto(&files[i], now)
			}

			items = append(items, &settlement_importerv1.UploadedFileListResponseItem{
				D: &settlement_importerv1.UploadedFileListResponseItem_File{
					File: &settlement_importerv1.UploadedFileRowMapItem{MapData: rows},
				},
			})
		}
	}

	return items, ids
}
