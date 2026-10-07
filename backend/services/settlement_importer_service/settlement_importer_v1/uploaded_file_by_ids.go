package settlement_importer_v1

import (
	"context"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_service_models"
)

// UploadedFileByIds answers files by id — one file's page reads its own row through it. The guideline's
// ByIds shape: a map of id → the slices asked for.
//
// Another team's file is ABSENT, as if it did not exist — the team_id clause is the scope check.
func (s *Service) UploadedFileByIds(
	ctx context.Context,
	req *connect.Request[settlement_importerv1.UploadedFileByIdsRequest],
) (*connect.Response[settlement_importerv1.UploadedFileByIdsResponse], error) {
	var files []settlement_importer_service_models.UploadedFile

	err := s.db.
		WithContext(ctx).
		Where("team_id = ? AND id IN ?", req.Msg.GetTeamId(), req.Msg.GetFilter().GetIds()).
		Find(&files).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	types := req.Msg.GetDataRequest()
	if len(types) == 0 {
		types = []settlement_importerv1.UploadedFileByIdsDataType{
			settlement_importerv1.UploadedFileByIdsDataType_UPLOADED_FILE_BY_IDS_DATA_TYPE_FILE,
		}
	}

	now := s.now()
	items := make(map[uint64]*settlement_importerv1.UploadedFileByIdsResponseList, len(files))

	for i := range files {
		file := &files[i]
		list := &settlement_importerv1.UploadedFileByIdsResponseList{}

		for _, t := range types {
			switch t {
			case settlement_importerv1.UploadedFileByIdsDataType_UPLOADED_FILE_BY_IDS_DATA_TYPE_GENERAL:
				list.Items = append(list.Items, &settlement_importerv1.UploadedFileByIdsResponseItem{
					D: &settlement_importerv1.UploadedFileByIdsResponseItem_General{
						General: &commonv1.GeneralMapItem{MapData: map[uint64]*commonv1.GeneralItem{
							file.ID: {Id: file.ID, Name: fileName(file)},
						}},
					},
				})
			case settlement_importerv1.UploadedFileByIdsDataType_UPLOADED_FILE_BY_IDS_DATA_TYPE_FILE:
				list.Items = append(list.Items, &settlement_importerv1.UploadedFileByIdsResponseItem{
					D: &settlement_importerv1.UploadedFileByIdsResponseItem_File{
						File: &settlement_importerv1.UploadedFileRowMapItem{MapData: map[uint64]*settlement_importerv1.UploadedFile{
							file.ID: fileToProto(file, now),
						}},
					},
				})
			}
		}

		items[file.ID] = list
	}

	return connect.NewResponse(&settlement_importerv1.UploadedFileByIdsResponse{Items: items}), nil
}
