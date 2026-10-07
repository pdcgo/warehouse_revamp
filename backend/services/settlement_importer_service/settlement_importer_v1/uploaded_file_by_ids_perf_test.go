//go:build perfaudit

// go test -tags perfaudit -run TestPerf_UploadedFileByIds -v ./backend/services/settlement_importer_service/settlement_importer_v1/
package settlement_importer_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// One file's page reads its own row (1 id); a caller may ask up to 200. Measured at 1, 20 and 200 ids —
// if the query count moved with the ids, that would be an N+1.
func TestPerf_UploadedFileByIds(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	vol := perfSeed(t, db)

	w := newWorld(t, db)
	ctx := context.Background()

	both := []settlement_importerv1.UploadedFileByIdsDataType{
		settlement_importerv1.UploadedFileByIdsDataType_UPLOADED_FILE_BY_IDS_DATA_TYPE_FILE,
		settlement_importerv1.UploadedFileByIdsDataType_UPLOADED_FILE_BY_IDS_DATA_TYPE_GENERAL,
	}

	for _, c := range []struct {
		name string
		ids  []uint64
	}{
		{"ids1", vol.teamFiles[:1]},
		{"ids20", vol.teamFiles[:20]},
		{"ids200", vol.teamFiles[:200]},
	} {
		var got int

		req := &settlement_importerv1.UploadedFileByIdsRequest{
			TeamId:      team,
			Filter:      &settlement_importerv1.UploadedFileByIdsFilter{Ids: c.ids},
			DataRequest: both,
		}

		perfRun(t, probe, "UploadedFileByIds/"+c.name, func(int) error {
			resp, err := w.svc.UploadedFileByIds(ctx, connect.NewRequest(req))
			if err != nil {
				return err
			}

			got = len(resp.Msg.GetItems())

			return nil
		})

		t.Logf("PERF| UploadedFileByIds/%s answered %d files", c.name, got)

		perfMean(t, probe, "UploadedFileByIds/"+c.name, 50, func() error {
			_, err := w.svc.UploadedFileByIds(ctx, connect.NewRequest(req))
			return err
		})

		perfExplainAll(t, db, probe)
	}
}
