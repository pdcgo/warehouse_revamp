package supplier_v1

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_export"
)

// productExportColumns are the Produk tab's columns, as the screen heads them (a-supplier-product-row-says-whose-where-
// and-when, the-detail-tabs-show-sold-and-ready): the product in two cells — its name, then its SKU under it on screen —
// whose it is, the store in two cells — its name, then its type — the last restock and the first under it, each figure
// beside the date under it. Tim goes when one team is picked, as on screen.
var (
	productExportLead   = []string{"Produk", "SKU"}
	productExportFigure = []string{
		"Toko pemasok", "Jenis toko", "Terakhir dibeli", "Pertama dibeli", "Terjual", "Pesanan terakhir", "Siap",
	}
)

// SupplierProductExport writes the Produk tab as a file (each-supplier-tab-exports-its-own-table, on
// a-report-export-is-the-whole-view-as-a-file): exactly the rows SupplierProductList holds with this filter — productSet,
// the same set, in its order — every page of them, as .xlsx. A server stream: every step a message with the progress, the
// link on the last.
//
// Each step of 200 rows is the list's own page: productRows names it (ONE product_service call) and fills its figures
// (ONE inventory call for the step's store × product pairs) — the very rows the tab shows, never a call per row. The teams
// are named per step through the ExportStore, as the Statistik tab's Per Produk file names them. Every team's rows and
// figures, as on screen (another-team-sees-everything-of-a-supplier, every-selling-team-sees-every-teams-figures); no
// price, no cost — the tab shows none. Under the page's Gudang terkait chip the file is the tab under it: the same
// productSet narrowed to that warehouse, each row with that warehouse's figures (a-supplier-page-is-scoped-by-its-warehouses).
func (s *Service) SupplierProductExport(
	ctx context.Context,
	req *connect.Request[supplierv1.SupplierProductExportRequest],
	stream *connect.ServerStream[supplierv1.SupplierProductExportResponse],
) error {
	if s.exports == nil {
		return connect.NewError(connect.CodeUnimplemented, errNoExportStore)
	}

	msg := req.Msg
	filter := msg.GetFilter()
	db := s.db.WithContext(ctx)

	// A deleted or unknown supplier is NotFound, as the list answers it.
	_, err := liveSupplier(db, filter.GetSupplierId())
	if err != nil {
		return err
	}

	set, err := s.productSetOf(ctx, db, filter)
	if err != nil {
		return err
	}

	progress := san_export.NewProgress(func(message string, done, total int64) error {
		return stream.Send(&supplierv1.SupplierProductExportResponse{Message: message, Done: done, Total: total})
	})

	err = set.query(db).Count(&progress.Total).Error
	if err != nil {
		return internal(err)
	}

	progress.Info("exporting supplier products", "rows", progress.Total)

	book, err := san_export.NewWorkbook()
	if err != nil {
		return internal(err)
	}
	defer book.Close()

	// The Team column goes when one team is picked — it would say the same name on every row, as on screen.
	showTeam := filter.GetProductTeamId() == 0

	headers := append([]string{}, productExportLead...)
	if showTeam {
		headers = append(headers, "Tim")
	}

	sheet, err := book.Sheet("Produk", append(headers, productExportFigure...))
	if err != nil {
		return internal(err)
	}

	// The list's own order, a step of rows at a time: the same pages the tab turns through, end to end.
	for offset := 0; ; offset += san_export.Batch {
		links, _, err := set.page(db, offset, san_export.Batch)
		if err != nil {
			return internal(err)
		}

		if len(links) == 0 {
			break
		}

		rows, err := s.productRows(ctx, filter.GetSupplierId(), filter.GetWarehouseId(), links)
		if err != nil {
			return err
		}

		teams := map[uint64]string{}
		if showTeam {
			owners := idSet{}
			for _, row := range rows {
				owners.add(row.GetTeamId())
			}

			teams, err = s.exports.TeamNames(ctx, owners.list())
			if err != nil {
				return connect.NewError(connect.CodeInternal, fmt.Errorf("naming the teams: %w", err))
			}
		}

		for _, row := range rows {
			err = sheet.Row(productExportRow(row, showTeam, teams)...)
			if err != nil {
				return internal(fmt.Errorf("writing the file: %w", err))
			}
		}

		progress.Done += int64(len(rows))
		progress.Info("rows written", "done", progress.Done, "of", progress.Total)

		err = progress.Err()
		if err != nil {
			return err
		}

		if len(links) < san_export.Batch {
			break
		}
	}

	content, err := book.Bytes()
	if err != nil {
		return internal(fmt.Errorf("writing the file: %w", err))
	}

	filename := san_export.Filename("produk-pemasok", time.Now())

	url, err := s.exports.Store(ctx, msg.GetTeamId(), filename, content)
	if err != nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("storing the file: %w", err))
	}

	return stream.Send(&supplierv1.SupplierProductExportResponse{
		Message:     "the file is ready",
		Done:        progress.Done,
		Total:       progress.Total,
		DownloadUrl: url,
		Filename:    filename,
	})
}

// productExportRow is one link, as its tab row reads: text cells for the product and the store (empty for a line that
// named no store — the tab's "—"), the restock days, the units as numbers beside the last order's day. A product none of
// whose goods arrived reads empty figure cells, as the tab's dash; an unresolved product keeps its id, as the tab does.
func productExportRow(row *supplierv1.SupplierProduct, showTeam bool, teams map[uint64]string) []any {
	name := row.GetProductName()
	if name == "" {
		name = "Produk #" + strconv.FormatUint(row.GetProductId(), 10)
	}

	out := []any{name, row.GetProductCode()}

	if showTeam {
		out = append(out, teamLabel(teams, row.GetTeamId()))
	}

	out = append(out,
		row.GetChannelName(),
		marketplaceLabel(row.GetChannelType()),
		san_export.DayOfUnix(row.GetLastRestockedUnix()),
		san_export.DayOfUnix(row.GetFirstRestockedUnix()),
	)

	figures := row.GetFigures()
	if figures == nil {
		return append(out, "", "", "")
	}

	return append(out,
		figures.GetSoldUnits(),
		san_export.DayOfUnix(figures.GetLastOrderUnix()),
		figures.GetReadyUnits(),
	)
}
