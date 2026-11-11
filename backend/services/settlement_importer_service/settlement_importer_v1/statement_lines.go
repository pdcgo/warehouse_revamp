package settlement_importer_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_marketplace"
)

// StatementLineSource is THE STATEMENT A LEDGER ROW CAME FROM — one line of an uploaded file, with the file's platform,
// period and uploader (the-shop-entries-page-is-accepted: "the statement it came from, linked to its import, and who
// uploaded it").
type StatementLineSource struct {
	SettlementLogID uint64
	UploadedFileID  uint64
	Platform        marketplacev1.Marketplace
	// The statement's own range, YYYY-MM-DD; empty when the file was never read.
	PeriodFrom  string
	PeriodTo    string
	Sheet       string
	Description string
	OrderRef    string
	// no_order · several_orders on a line posted to the shop for that reason; empty otherwise.
	Reason        string
	FoundOrderIDs []uint64
	UploadedBy    uint64
	// The upload was an override (uploaded_files.is_override) — the "by Root team" badge beside the uploader.
	UploadedByIsOverride bool
}

// StatementLinesBySettlementLogIds is an IN-PROCESS read — settlement's Shop Entries asks it through the composition
// root (cmd/app_development/settlement_statement_sources.go), never a browser: the lines naming each settlement log id,
// ONE per id — the line that POSTED the row, or, when no line did (a later file only found it), the first that found
// it. An id no line names is absent.
//
// Scoped by the files' team; the root team reads every team's, as settlement's own reads do. Over the partial index
// `uploaded_file_lines_settlement_log_idx` (00005).
func (s *Service) StatementLinesBySettlementLogIds(
	ctx context.Context,
	teamID uint64,
	logIDs []uint64,
) ([]StatementLineSource, error) {
	if len(logIDs) == 0 {
		return nil, nil
	}

	query := s.db.
		WithContext(ctx).
		Table("uploaded_file_lines AS l").
		Joins("JOIN uploaded_files AS f ON f.id = l.uploaded_file_id").
		Select(
			"DISTINCT ON (l.settlement_log_id) l.settlement_log_id, l.uploaded_file_id, l.sheet, l.description, "+
				"l.order_ref, l.outcome, l.reason, l.found_order_ids, f.platform, f.period_from, f.period_to, "+
				"f.created_by_user_id, f.is_override",
		).
		Where("l.settlement_log_id IN ?", logIDs)

	if teamID != san_auth.RootTeamID {
		query = query.Where("f.team_id = ?", teamID)
	}

	var rows []struct {
		SettlementLogID uint64
		UploadedFileID  uint64
		Sheet           string
		Description     string
		OrderRef        string
		Outcome         string
		Reason          string
		FoundOrderIDs   string `gorm:"column:found_order_ids"`
		Platform        string
		PeriodFrom      *time.Time
		PeriodTo        *time.Time
		CreatedByUserID uint64
		IsOverride      bool
	}

	// The posting line first, then the file order.
	err := query.
		Order("l.settlement_log_id").
		Order("(l.outcome <> '" + outcomePosted + "')").
		Order("l.id").
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	out := make([]StatementLineSource, 0, len(rows))

	for _, row := range rows {
		source := StatementLineSource{
			SettlementLogID:      row.SettlementLogID,
			UploadedFileID:       row.UploadedFileID,
			Platform:             san_marketplace.FromText(row.Platform),
			Sheet:                row.Sheet,
			Description:          row.Description,
			OrderRef:             row.OrderRef,
			FoundOrderIDs:        parseIDs(row.FoundOrderIDs),
			UploadedBy:           row.CreatedByUserID,
			UploadedByIsOverride: row.IsOverride,
		}

		// Why it went to the shop is said only by the line that POSTED it there.
		if row.Outcome == outcomePosted && (row.Reason == reasonNoOrder || row.Reason == reasonSeveralOrders) {
			source.Reason = row.Reason
		}

		if row.PeriodFrom != nil {
			source.PeriodFrom = row.PeriodFrom.Format(dateLayout)
		}

		if row.PeriodTo != nil {
			source.PeriodTo = row.PeriodTo.Format(dateLayout)
		}

		out = append(out, source)
	}

	return out, nil
}
