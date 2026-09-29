package settlement_importer_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	settlement_importer_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_v1"
)

func listLines(
	t *testing.T,
	w *world,
	fileID uint64,
	outcomes []settlement_importerv1.UploadedFileLineOutcome,
	reasons []settlement_importerv1.UploadedFileLineReason,
) (*settlement_importerv1.UploadedFileLineListResponse, error) {
	t.Helper()

	resp, err := w.svc.UploadedFileLineList(context.Background(), connect.NewRequest(&settlement_importerv1.UploadedFileLineListRequest{
		TeamId: team,
		Filter: &settlement_importerv1.UploadedFileLineListFilter{UploadedFileId: fileID, Outcomes: outcomes, Reasons: reasons},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		return nil, err
	}

	return resp.Msg, nil
}

func linesOf(resp *settlement_importerv1.UploadedFileLineListResponse) []*settlement_importerv1.UploadedFileLine {
	out := []*settlement_importerv1.UploadedFileLine{}

	for _, item := range resp.GetItems() {
		if item.GetLine() == nil {
			continue
		}

		for _, id := range resp.GetIds() {
			out = append(out, item.GetLine().GetMapData()[id])
		}
	}

	return out
}

// The file page's three views over one imported statement: HELD, SKIPPED, and POSTED with NO_ORDER — the
// lines posted to the shop because their order was not found.
func TestUploadedFileLineList_TheFilePagesThreeViews(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)
	w.orders.byRef["2509AAA"] = []settlement_importer_v1.OrderRef{{OrderID: 501, ShopID: shopeeShop, CreatedByUserID: orderMaker}}

	w.importShopee(t, shopeeShop, sevenShopeeRows(t))
	fileID := fileRows(t, db)[0].ID

	held, err := listLines(t, w, fileID, []settlement_importerv1.UploadedFileLineOutcome{
		settlement_importerv1.UploadedFileLineOutcome_UPLOADED_FILE_LINE_OUTCOME_HELD,
	}, nil)
	if err != nil {
		t.Fatalf("held: %v", err)
	}

	if len(linesOf(held)) != 2 {
		t.Fatalf("%d held lines, want 2", len(linesOf(held)))
	}

	unmapped := linesOf(held)[0]
	if unmapped.GetReason() != settlement_importerv1.UploadedFileLineReason_UPLOADED_FILE_LINE_REASON_UNMAPPED_TYPE ||
		unmapped.GetSettlementType() != settlementv1.SettlementType_SETTLEMENT_TYPE_UNSPECIFIED ||
		unmapped.GetPlatformType() != "Biaya Program Baru" || unmapped.GetOccurredOn() != "2026-09-05" {
		t.Errorf("the unmapped line = %+v", unmapped)
	}

	skipped, err := listLines(t, w, fileID, []settlement_importerv1.UploadedFileLineOutcome{
		settlement_importerv1.UploadedFileLineOutcome_UPLOADED_FILE_LINE_OUTCOME_SKIPPED,
	}, nil)
	if err != nil {
		t.Fatalf("skipped: %v", err)
	}

	if len(linesOf(skipped)) != 2 {
		t.Fatalf("%d skipped lines, want the failed withdrawal and its refund", len(linesOf(skipped)))
	}

	toShop, err := listLines(t, w, fileID,
		[]settlement_importerv1.UploadedFileLineOutcome{settlement_importerv1.UploadedFileLineOutcome_UPLOADED_FILE_LINE_OUTCOME_POSTED},
		[]settlement_importerv1.UploadedFileLineReason{settlement_importerv1.UploadedFileLineReason_UPLOADED_FILE_LINE_REASON_NO_ORDER},
	)
	if err != nil {
		t.Fatalf("to the shop: %v", err)
	}

	lines := linesOf(toShop)
	if len(lines) != 1 || lines[0].GetOrderRef() != "2509ZZZ" || lines[0].GetOrderId() != 0 || lines[0].GetSettlementLogId() == 0 {
		t.Fatalf("the to-the-shop view = %+v", lines)
	}
}

// Another team's file is NotFound — its lines are never read.
func TestUploadedFileLineList_AnotherTeamsFileIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)

	theirs := insertFile(t, db, 13, 90, "shopee", "done", time.Hour)

	_, err := listLines(t, w, theirs, nil, nil)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}
