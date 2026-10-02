//go:build perfaudit

// go test -tags perfaudit -run TestPerf_UploadedFileLineList -v ./backend/services/settlement_importer_service/settlement_importer_v1/
package settlement_importer_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// One file's page over a full statement (1,500 lines, beside ~50,000 other lines): every line at two page
// sizes (the N+1 check), the page's three views — HELD, SKIPPED, POSTED + NO_ORDER — a sort by change,
// and the last page of the whole file.
func TestPerf_UploadedFileLineList(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	vol := perfSeed(t, db)

	w := newWorld(t, db)
	ctx := context.Background()

	both := []settlement_importerv1.UploadedFileLineListDataType{
		settlement_importerv1.UploadedFileLineListDataType_UPLOADED_FILE_LINE_LIST_DATA_TYPE_LINE,
		settlement_importerv1.UploadedFileLineListDataType_UPLOADED_FILE_LINE_LIST_DATA_TYPE_GENERAL,
	}

	outcomes := func(o ...settlement_importerv1.UploadedFileLineOutcome) []settlement_importerv1.UploadedFileLineOutcome {
		return o
	}

	held := settlement_importerv1.UploadedFileLineOutcome_UPLOADED_FILE_LINE_OUTCOME_HELD
	skipped := settlement_importerv1.UploadedFileLineOutcome_UPLOADED_FILE_LINE_OUTCOME_SKIPPED
	posted := settlement_importerv1.UploadedFileLineOutcome_UPLOADED_FILE_LINE_OUTCOME_POSTED
	noOrder := settlement_importerv1.UploadedFileLineReason_UPLOADED_FILE_LINE_REASON_NO_ORDER

	cases := []struct {
		name     string
		outcomes []settlement_importerv1.UploadedFileLineOutcome
		reasons  []settlement_importerv1.UploadedFileLineReason
		sort     *settlement_importerv1.UploadedFileLineListFilterSort
		page     uint32
		limit    uint32
	}{
		{"all_limit20", nil, nil, nil, 1, 20},
		{"all_limit200", nil, nil, nil, 1, 200},
		{"held_limit50", outcomes(held), nil, nil, 1, 50},
		{"skipped_limit50", outcomes(skipped), nil, nil, 1, 50},
		{"posted_no_order_limit50", outcomes(posted), []settlement_importerv1.UploadedFileLineReason{noOrder}, nil, 1, 50},
		{"all_sort_change_desc_limit50", nil, nil, &settlement_importerv1.UploadedFileLineListFilterSort{
			SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_DESC,
			S:        &settlement_importerv1.UploadedFileLineListFilterSort_Line{Line: settlement_importerv1.UploadedFileLineRowSort_UPLOADED_FILE_LINE_ROW_SORT_CHANGE},
		}, 1, 50},
		{"all_last_page_limit20", nil, nil, nil, perfFileLines / 20, 20},
	}

	for _, c := range cases {
		var got *settlement_importerv1.UploadedFileLineListResponse

		req := &settlement_importerv1.UploadedFileLineListRequest{
			TeamId: team,
			Filter: &settlement_importerv1.UploadedFileLineListFilter{
				UploadedFileId: vol.file,
				Outcomes:       c.outcomes,
				Reasons:        c.reasons,
			},
			Sort:        c.sort,
			DataRequest: both,
			Page:        &commonv1.CommonPagination{Page: c.page, Limit: c.limit},
		}

		perfRun(t, probe, "UploadedFileLineList/"+c.name, func(int) error {
			resp, err := w.svc.UploadedFileLineList(ctx, connect.NewRequest(req))
			if err != nil {
				return err
			}

			got = resp.Msg

			return nil
		})

		t.Logf("PERF| UploadedFileLineList/%s answered %d ids of %d", c.name, len(got.GetIds()), got.GetPageInfo().GetTotalItems())

		perfMean(t, probe, "UploadedFileLineList/"+c.name, 50, func() error {
			_, err := w.svc.UploadedFileLineList(ctx, connect.NewRequest(req))
			return err
		})

		perfExplainAll(t, db, probe)
	}
}
