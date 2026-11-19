package inventory_v1

import (
	"context"
	"errors"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_export"
)

// ExportStore is where the selling restock list's file goes, and the names its rows need that other services hold
// (the-restock-list-exports-and-filters-by-courier, on one-export-is-the-list-as-a-file). Adapted at the composition root
// (cmd/app_development/restock_exports.go): the file stored through document_service AS THE CALLER as a private
// TABLE_EXPORT behind an expiring link; the names read by id, as the caller, from the services that own them — the
// same by-id reads the screen names its rows with. Every lookup takes at most 200 ids (san_export.Batch); an id that
// resolves to nothing is absent, and its cell says the id.
type ExportStore interface {
	san_export.Store

	// SupplierNames names the lines' suppliers — any team's (a-line-connects-to-any-teams-supplier-from-a-popup), a
	// deleted one included — asked under the exporting team.
	SupplierNames(ctx context.Context, teamID uint64, ids []uint64) (map[uint64]string, error)
	// StoreNames names the lines' stores (supplier channels), deleted ones included.
	StoreNames(ctx context.Context, teamID uint64, ids []uint64) (map[uint64]string, error)
	// TeamNames names the restocks' warehouses.
	TeamNames(ctx context.Context, ids []uint64) (map[uint64]string, error)
	// ChannelNames names the restocks' couriers by their shipment channel's NAME, as the row's badge reads it — a deleted
	// channel still resolves (a-deleted-channel-still-resolves-by-id).
	ChannelNames(ctx context.Context, ids []uint64) (map[uint64]string, error)
	// UserNames names who raised and who accepted each restock — and who started the stock count a refusal names
	// (count_lock_names.go, an-abandoned-count-waits-for-the-admin).
	UserNames(ctx context.Context, ids []uint64) (map[uint64]string, error)
}

var errNoExportStore = errors.New("no export store is configured")
