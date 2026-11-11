package settlement_v1

import (
	"context"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
)

// StatementSources answers THE STATEMENT A SHOP ROW CAME FROM (the-shop-entries-page-is-accepted): the importer's line
// whose `settlement_log_id` is the row. Settlement holds no file id and reads none of the importer's tables (HARD RULE
// 3), so it asks — an interface settlement owns, answered in-process at the composition root.
type StatementSources interface {
	// StatementLines returns, per settlement log id, the line that POSTED it (or, when none did, the first line that
	// found it). A row no line names is absent. teamID is the reading scope — the root team reads every team's.
	StatementLines(ctx context.Context, teamID uint64, logIDs []uint64) (map[uint64]StatementLine, error)
}

// StatementLine is what the importer tells about one line.
type StatementLine struct {
	UploadedFileID uint64
	Platform       marketplacev1.Marketplace
	// The statement's own range, YYYY-MM-DD; empty when the file was never read.
	PeriodFrom  string
	PeriodTo    string
	Sheet       string
	Description string
	OrderRef    string
	// The importer's reason text — "no_order", "several_orders", or empty for a line that names no order.
	Reason        string
	FoundOrderIDs []uint64
	// Who uploaded the file, and whether that upload was an override (the "by Root team" badge).
	UploadedBy           uint64
	UploadedByIsOverride bool
}

// UserNames turns user ids into display names — the existing user read (UserByIDs), in-process. Unknown ids are
// absent.
type UserNames interface {
	UserNames(ctx context.Context, ids []uint64) (map[uint64]string, error)
}

// noStatementSources is a settlement with no importer wired: no row has a statement — every row reads as posted by
// hand would, never a guessed file.
type noStatementSources struct{}

func (noStatementSources) StatementLines(context.Context, uint64, []uint64) (map[uint64]StatementLine, error) {
	return map[uint64]StatementLine{}, nil
}

// noUserNames is a settlement with no user service wired: the screen falls back to the id.
type noUserNames struct{}

func (noUserNames) UserNames(context.Context, []uint64) (map[uint64]string, error) {
	return map[uint64]string{}, nil
}
