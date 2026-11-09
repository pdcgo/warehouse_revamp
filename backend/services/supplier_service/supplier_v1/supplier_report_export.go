package supplier_v1

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_export"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

// reportColumns are a ranked row's columns before its figures, as the Supplier Report heads them: the rank, the
// supplier, its deleted mark (the badge beside its name), and the team that keeps it.
var reportColumns = []string{"Peringkat", "Pemasok", "Status", "Dikelola oleh"}

// SupplierReportExport writes the Supplier Report as a file (a-report-export-is-the-whole-view-as-a-file, on
// one-export-is-the-list-as-a-file): the WHOLE ranking as narrowed — the report's window, team and search, in its own
// order — every page of it, each supplier with its figures, as .xlsx.
//
//   - The ranking is the report's own MetricSearch (grouped by SUPPLIER, its sort, the rate's minimum sample
//     included), paged 200 at a time until no page follows; each step is filled by the report's MetricData and named
//     from the suppliers table — a DELETED supplier too, marked, its figures kept (a-deleted-supplier-is-kept-for-its-figures).
//   - The rank is the row's place in the whole ranking, 1-based, as the screen counts it across pages.
//
// Money is the metric's exact figure (the-backend-never-rounds-money); a rate is the exact share under a 0.0% format,
// empty where nothing arrived. The days are the report's Jakarta days.
func (s *Service) SupplierReportExport(
	ctx context.Context,
	req *connect.Request[supplierv1.SupplierReportExportRequest],
	stream *connect.ServerStream[supplierv1.SupplierReportExportResponse],
) error {
	if s.exports == nil {
		return connect.NewError(connect.CodeUnimplemented, errNoExportStore)
	}

	msg := req.Msg

	scope, err := parseFilters(msg.GetFilters())
	if err != nil {
		return err
	}

	// The report ranks EVERY supplier: one supplier's file is its Statistik tab's (SupplierFigureExport).
	if scope.supplierID != 0 {
		return invalid("the Supplier Report ranks every supplier — one supplier's figures are its Statistik tab's export")
	}

	if msg.GetSort().GetMetricId() != supplierMetricOption.GetMetricId() {
		return invalid("the Supplier Report ranks by a field of %q", supplierMetricOption.GetMetricId())
	}

	ranked, err := s.rankedSuppliers(ctx, scope, msg.GetSort())
	if err != nil {
		return err
	}

	progress := san_export.NewProgress(func(message string, done, total int64) error {
		return stream.Send(&supplierv1.SupplierReportExportResponse{Message: message, Done: done, Total: total})
	})

	progress.Total = int64(len(ranked))
	progress.Info("exporting the ranking", "rows", progress.Total)

	book, err := san_export.NewWorkbook()
	if err != nil {
		return internal(err)
	}
	defer book.Close()

	sheet, err := book.Sheet("Peringkat", append(append([]string{}, reportColumns...), figureColumns...))
	if err != nil {
		return internal(err)
	}

	for start := 0; start < len(ranked); start += san_export.Batch {
		ids := ranked[start:min(start+san_export.Batch, len(ranked))]

		data, err := s.supplierMetricData(ctx, scope, analytic_basev1.GroupType_GROUP_TYPE_SUPPLIER, &analytic_basev1.MetricKeys{
			K: &analytic_basev1.MetricKeys_Ids{Ids: &analytic_basev1.IDList{Ids: ids}},
		})
		if err != nil {
			return err
		}

		suppliers, err := s.suppliersOf(ctx, ids)
		if err != nil {
			return err
		}

		owners := idSet{}
		for _, supplier := range suppliers {
			owners.add(supplier.TeamID)
		}

		teams := map[uint64]string{}
		if len(owners) > 0 {
			teams, err = s.exports.TeamNames(ctx, owners.list())
			if err != nil {
				return connect.NewError(connect.CodeInternal, fmt.Errorf("naming the teams: %w", err))
			}
		}

		byID := data.GetSupplierById().GetItems()

		for i, id := range ids {
			supplier := suppliers[id]

			name := supplier.Name
			if name == "" {
				name = "Pemasok #" + strconv.FormatUint(id, 10)
			}

			status := ""
			if supplier.DeletedAt != nil {
				status = "Dihapus"
			}

			row := []any{int64(start + i + 1), name, status, teamLabel(teams, supplier.TeamID)}

			err = sheet.Row(append(row, figureCells(byID[id])...)...)
			if err != nil {
				return internal(fmt.Errorf("writing the file: %w", err))
			}
		}

		progress.Done += int64(len(ids))
		progress.Info("rows written", "done", progress.Done, "of", progress.Total)

		err = progress.Err()
		if err != nil {
			return err
		}
	}

	content, err := book.Bytes()
	if err != nil {
		return internal(fmt.Errorf("writing the file: %w", err))
	}

	filename := san_export.Filename("laporan-pemasok", time.Now())

	url, err := s.exports.Store(ctx, msg.GetTeamId(), filename, content)
	if err != nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("storing the file: %w", err))
	}

	return stream.Send(&supplierv1.SupplierReportExportResponse{
		Message:     "the file is ready",
		Done:        progress.Done,
		Total:       progress.Total,
		DownloadUrl: url,
		Filename:    filename,
	})
}

// rankedSuppliers is every key the report's ranking pages through — MetricSearch's own statement grouped by SUPPLIER,
// with the report's filters and sort (the rate's minimum sample included), read WHOLE in one statement: a page at a
// time it re-sums the window once per 200 suppliers.
func (s *Service) rankedSuppliers(ctx context.Context, scope metricScope, sort *analytic_basev1.MetricSort) ([]uint64, error) {
	group, err := groupOf(analytic_basev1.GroupType_GROUP_TYPE_SUPPLIER)
	if err != nil {
		return nil, err
	}

	order, err := sortOrder(sort)
	if err != nil {
		return nil, err
	}

	var ids []uint64

	err = s.ranking(ctx, scope, group, order).
		Pluck("g.key", &ids).
		Error
	if err != nil {
		return nil, internal(err)
	}

	return ids, nil
}

// suppliersOf reads a step's suppliers by id, DELETED ONES INCLUDED — SupplierByIds' read, since a ranked supplier may
// be gone with its figures kept. An unknown id is absent.
func (s *Service) suppliersOf(ctx context.Context, ids []uint64) (map[uint64]supplier_service_models.Supplier, error) {
	var rows []supplier_service_models.Supplier

	err := s.db.
		WithContext(ctx).
		Where("id IN ?", ids).
		Find(&rows).
		Error
	if err != nil {
		return nil, internal(err)
	}

	out := make(map[uint64]supplier_service_models.Supplier, len(rows))
	for _, row := range rows {
		out[row.ID] = row
	}

	return out, nil
}
