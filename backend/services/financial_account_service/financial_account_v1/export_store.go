package financial_account_v1

import (
	"context"
	"errors"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_export"
)

// ExportStore is where the account report's file goes, and the one name its rows need that another service holds
// (a-report-export-is-the-whole-view-as-a-file). Adapted at the composition root
// (cmd/app_development/financial_account_exports.go): the file stored through document_service AS THE CALLER, the shops
// named by selling's ShopByIds under the caller's token.
type ExportStore interface {
	san_export.Store

	// ShopNames names shops by id — an account is shown by its shop's name where the server could only write the id
	// (the-unknown-account-reads-lainnya). An id that resolves to nothing is absent, and the row keeps what was written.
	ShopNames(ctx context.Context, ids []uint64) (map[uint64]string, error)
}

var errNoExportStore = errors.New("no export store is configured")
