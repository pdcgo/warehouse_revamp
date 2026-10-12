//go:build perfaudit

// go test -tags perfaudit -run TestPerf_UploadedFileList -v ./backend/services/settlement_importer_service/settlement_importer_v1/
package settlement_importer_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The import screen over ~50,000 uploads: the default page at two sizes (the N+1 check), each filter, the
// status filter's two computed statuses (RUNNING and INTERRUPTED are one stored value, told apart by
// updated_at in SQL), a sort no index serves, and a deep page.
func TestPerf_UploadedFileList(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfSeed(t, db)

	w := newWorld(t, db)
	ctx := context.Background()

	both := []settlement_importerv1.UploadedFileListDataType{
		settlement_importerv1.UploadedFileListDataType_UPLOADED_FILE_LIST_DATA_TYPE_FILE,
		settlement_importerv1.UploadedFileListDataType_UPLOADED_FILE_LIST_DATA_TYPE_GENERAL,
	}

	page := func(p, limit uint32) *commonv1.CommonPagination {
		return &commonv1.CommonPagination{Page: p, Limit: limit}
	}

	statuses := func(s ...settlement_importerv1.UploadedFileStatus) *settlement_importerv1.UploadedFileListFilter {
		return &settlement_importerv1.UploadedFileListFilter{Statuses: s}
	}

	running := settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_RUNNING
	interrupted := settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_INTERRUPTED
	failed := settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_FAILED

	cases := []struct {
		name string
		req  *settlement_importerv1.UploadedFileListRequest
	}{
		{"default_limit20", &settlement_importerv1.UploadedFileListRequest{TeamId: team, DataRequest: both, Page: page(1, 20)}},
		{"default_limit200", &settlement_importerv1.UploadedFileListRequest{TeamId: team, DataRequest: both, Page: page(1, 200)}},
		{"shop_limit20", &settlement_importerv1.UploadedFileListRequest{
			TeamId: team, DataRequest: both, Page: page(1, 20),
			Filter: &settlement_importerv1.UploadedFileListFilter{ShopId: shopeeShop},
		}},
		{"platform_limit20", &settlement_importerv1.UploadedFileListRequest{
			TeamId: team, DataRequest: both, Page: page(1, 20),
			Filter: &settlement_importerv1.UploadedFileListFilter{Platform: marketplacev1.Marketplace_MARKETPLACE_SHOPEE},
		}},
		{"status_running", &settlement_importerv1.UploadedFileListRequest{TeamId: team, DataRequest: both, Page: page(1, 20), Filter: statuses(running)}},
		{"status_interrupted", &settlement_importerv1.UploadedFileListRequest{TeamId: team, DataRequest: both, Page: page(1, 20), Filter: statuses(interrupted)}},
		{"status_running_interrupted", &settlement_importerv1.UploadedFileListRequest{TeamId: team, DataRequest: both, Page: page(1, 20), Filter: statuses(running, interrupted)}},
		{"status_failed", &settlement_importerv1.UploadedFileListRequest{TeamId: team, DataRequest: both, Page: page(1, 20), Filter: statuses(failed)}},
		{"shop_status_interrupted", &settlement_importerv1.UploadedFileListRequest{
			TeamId: team, DataRequest: both, Page: page(1, 20),
			Filter: &settlement_importerv1.UploadedFileListFilter{ShopId: shopeeShop, Statuses: []settlement_importerv1.UploadedFileStatus{interrupted}},
		}},
		{"sort_period_to_desc", &settlement_importerv1.UploadedFileListRequest{
			TeamId: team, DataRequest: both, Page: page(1, 20),
			Sort: &settlement_importerv1.UploadedFileListFilterSort{
				SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_DESC,
				S:        &settlement_importerv1.UploadedFileListFilterSort_File{File: settlement_importerv1.UploadedFileRowSort_UPLOADED_FILE_ROW_SORT_PERIOD_TO},
			},
		}},
		{"sort_created_asc", &settlement_importerv1.UploadedFileListRequest{
			TeamId: team, DataRequest: both, Page: page(1, 20),
			Sort: &settlement_importerv1.UploadedFileListFilterSort{SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_ASC},
		}},
		{"default_page50_limit20", &settlement_importerv1.UploadedFileListRequest{TeamId: team, DataRequest: both, Page: page(50, 20)}},
	}

	for _, c := range cases {
		var got *settlement_importerv1.UploadedFileListResponse

		perfRun(t, probe, "UploadedFileList/"+c.name, func(int) error {
			resp, err := w.svc.UploadedFileList(ctx, connect.NewRequest(c.req))
			if err != nil {
				return err
			}

			got = resp.Msg

			return nil
		})

		t.Logf("PERF| UploadedFileList/%s answered %d ids of %d", c.name, len(got.GetIds()), got.GetPageInfo().GetTotalItems())

		perfMean(t, probe, "UploadedFileList/"+c.name, 50, func() error {
			_, err := w.svc.UploadedFileList(ctx, connect.NewRequest(c.req))
			return err
		})

		perfExplainAll(t, db, probe)
	}
}
