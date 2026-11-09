package supplier_v1

import (
	"context"
	"errors"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_export"
)

// ExportStore is where a supplier tab's file goes, and the names its rows need that other services hold
// (each-supplier-tab-exports-its-own-table, on one-export-is-the-list-as-a-file). Adapted at the composition root
// (cmd/app_development/supplier_exports.go): the file stored through document_service AS THE CALLER, the names read
// in-process from product_service and team_service.
type ExportStore interface {
	san_export.Store

	// ProductNames names products by id — any team's, as the Statistik tab names them; at most 200 ids. An id that
	// resolves to nothing is absent, and its cell keeps the id.
	ProductNames(ctx context.Context, teamID uint64, ids []uint64) (map[uint64]ExportProduct, error)

	// TeamNames names teams by id, at most 200; absent = unresolved.
	TeamNames(ctx context.Context, ids []uint64) (map[uint64]string, error)
}

// ExportProduct is what a product row of a file reads: its name, its SKU and the team it belongs to.
type ExportProduct struct {
	Name, Code string
	TeamID     uint64
}

var errNoExportStore = errors.New("no export store is configured")
