package settlement_importer_v1

import (
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_excel_readers"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_service_models"
)

// The texts are the contract with the database — renaming a proto constant is free, changing one of
// these strings rewrites history.

var outcomeEnum = map[string]settlement_importerv1.UploadedFileLineOutcome{
	outcomePosted:   settlement_importerv1.UploadedFileLineOutcome_UPLOADED_FILE_LINE_OUTCOME_POSTED,
	outcomeExisting: settlement_importerv1.UploadedFileLineOutcome_UPLOADED_FILE_LINE_OUTCOME_EXISTING,
	outcomeHeld:     settlement_importerv1.UploadedFileLineOutcome_UPLOADED_FILE_LINE_OUTCOME_HELD,
	outcomeSkipped:  settlement_importerv1.UploadedFileLineOutcome_UPLOADED_FILE_LINE_OUTCOME_SKIPPED,
}

var outcomeText = reverseOf(outcomeEnum)

var reasonEnum = map[string]settlement_importerv1.UploadedFileLineReason{
	reasonNoOrder:             settlement_importerv1.UploadedFileLineReason_UPLOADED_FILE_LINE_REASON_NO_ORDER,
	reasonUnmappedType:        settlement_importerv1.UploadedFileLineReason_UPLOADED_FILE_LINE_REASON_UNMAPPED_TYPE,
	reasonFractionalAmount:    settlement_importerv1.UploadedFileLineReason_UPLOADED_FILE_LINE_REASON_FRACTIONAL_AMOUNT,
	reasonRefused:             settlement_importerv1.UploadedFileLineReason_UPLOADED_FILE_LINE_REASON_REFUSED,
	reasonRepeatsOrderDetails: settlement_importerv1.UploadedFileLineReason_UPLOADED_FILE_LINE_REASON_REPEATS_ORDER_DETAILS,
	reasonFailedWithdrawal:    settlement_importerv1.UploadedFileLineReason_UPLOADED_FILE_LINE_REASON_FAILED_WITHDRAWAL,
}

var reasonText = reverseOf(reasonEnum)

// settlementTypeEnum maps the reader's classification — which IS settlement's text, read from the same
// list (docs/business/settlement/context.md) — onto the contract settlement takes.
var settlementTypeEnum = map[san_excel_readers.SettlementType]settlementv1.SettlementType{
	san_excel_readers.SettlementInitialTotal:          settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL,
	san_excel_readers.SettlementInitialTotalCancel:    settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL_CANCEL,
	san_excel_readers.SettlementFund:                  settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
	san_excel_readers.SettlementWithdrawal:            settlementv1.SettlementType_SETTLEMENT_TYPE_WITHDRAWAL,
	san_excel_readers.SettlementExternalAdsFee:        settlementv1.SettlementType_SETTLEMENT_TYPE_EXTERNAL_ADS_FEE,
	san_excel_readers.SettlementAffiliateFee:          settlementv1.SettlementType_SETTLEMENT_TYPE_AFFILIATE_FEE,
	san_excel_readers.SettlementLogisticReimbursement: settlementv1.SettlementType_SETTLEMENT_TYPE_LOGISTIC_REIMBURSEMENT,
	san_excel_readers.SettlementPlatformReimbursement: settlementv1.SettlementType_SETTLEMENT_TYPE_PLATFORM_REIMBURSEMENT,
	san_excel_readers.SettlementShipmentAdjustment:    settlementv1.SettlementType_SETTLEMENT_TYPE_SHIPMENT_ADJUSTMENT,
	san_excel_readers.SettlementMarketplaceAdjustment: settlementv1.SettlementType_SETTLEMENT_TYPE_MARKETPLACE_ADJUSTMENT,
	san_excel_readers.SettlementMarketplaceProgram:    settlementv1.SettlementType_SETTLEMENT_TYPE_MARKETPLACE_PROGRAM,
	san_excel_readers.SettlementSystemAdjustment:      settlementv1.SettlementType_SETTLEMENT_TYPE_SYSTEM_ADJUSTMENT,
	san_excel_readers.SettlementOther:                 settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER,
}

var settlementTypeText = func() map[settlementv1.SettlementType]string {
	out := make(map[settlementv1.SettlementType]string, len(settlementTypeEnum))
	for text, enum := range settlementTypeEnum {
		out[enum] = string(text)
	}

	return out
}()

func reverseOf[E comparable](forward map[string]E) map[E]string {
	back := make(map[E]string, len(forward))
	for text, enum := range forward {
		back[enum] = text
	}

	return back
}

// statusOf is the file's status as the screen reads it. INTERRUPTED is never stored: a running row whose
// updated_at has not moved for interruptedAfter is a file the server stopped in the middle of.
func statusOf(file *settlement_importer_service_models.UploadedFile, now time.Time) settlement_importerv1.UploadedFileStatus {
	switch file.Status {
	case statusDone:
		return settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_DONE
	case statusFailed:
		return settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_FAILED
	case statusRunning:
		if now.Sub(file.UpdatedAt) > interruptedAfter {
			return settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_INTERRUPTED
		}

		return settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_RUNNING
	default:
		return settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_UNSPECIFIED
	}
}

func fileToProto(file *settlement_importer_service_models.UploadedFile, now time.Time) *settlement_importerv1.UploadedFile {
	out := &settlement_importerv1.UploadedFile{
		Id:            file.ID,
		TeamId:        file.TeamID,
		ShopId:        file.ShopID,
		Platform:      san_marketplace.FromText(file.Platform),
		DocumentId:    file.DocumentID,
		ContentSha256: file.ContentSha256,
		Status:        statusOf(file, now),
		Failure:       file.Failure,
		Tally: &settlement_importerv1.UploadedFileTally{
			Total:        uint32(file.RowsTotal),
			Posted:       uint32(file.RowsPosted),
			Existing:     uint32(file.RowsExisting),
			Held:         uint32(file.RowsHeld),
			Skipped:      uint32(file.RowsSkipped),
			PostedToShop: uint32(file.RowsPostedToShop),
		},
		CreatedByUserId: file.CreatedByUserID,
		CreatedAt:       timestamppb.New(file.CreatedAt),
		UpdatedAt:       timestamppb.New(file.UpdatedAt),
	}

	if file.PeriodFrom != nil {
		out.PeriodFrom = file.PeriodFrom.Format(dateLayout)
	}

	if file.PeriodTo != nil {
		out.PeriodTo = file.PeriodTo.Format(dateLayout)
	}

	if file.FinishedAt != nil {
		out.FinishedAt = timestamppb.New(*file.FinishedAt)
	}

	return out
}

// fileName is the GENERAL slice's name — the statement's own range, which is how the list tells files
// apart; a file not yet read has none, so its id stands in.
func fileName(file *settlement_importer_service_models.UploadedFile) string {
	if file.PeriodFrom == nil || file.PeriodTo == nil {
		return "#" + formatID(file.ID)
	}

	return file.PeriodFrom.Format(dateLayout) + " – " + file.PeriodTo.Format(dateLayout)
}

func lineToProto(line *settlement_importer_service_models.UploadedFileLine) *settlement_importerv1.UploadedFileLine {
	out := &settlement_importerv1.UploadedFileLine{
		Id:              line.ID,
		UploadedFileId:  line.UploadedFileID,
		Sheet:           line.Sheet,
		OrderRef:        line.OrderRef,
		PlatformType:    line.PlatformType,
		Description:     line.Description,
		SettlementType:  settlementTypeEnum[san_excel_readers.SettlementType(line.SettlementType)],
		Change:          line.Change,
		OrderId:         line.OrderID,
		Outcome:         outcomeEnum[line.Outcome],
		Reason:          reasonEnum[line.Reason],
		Detail:          line.Detail,
		SettlementLogId: line.SettlementLogID,
	}

	if line.OccurredOn != nil {
		out.OccurredOn = line.OccurredOn.Format(dateLayout)
	}

	return out
}

// lineName is the GENERAL slice's name — the line's order ref, or its description when it has none.
func lineName(line *settlement_importer_service_models.UploadedFileLine) string {
	if line.OrderRef != "" {
		return line.OrderRef
	}

	return line.Description
}
