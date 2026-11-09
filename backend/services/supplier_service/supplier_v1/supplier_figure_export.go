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
)

// figureColumns are a figures row's columns after its key, as the Statistik tab heads them (sales-sit-beside-restocked,
// the-loss-rates-are-their-own-columns): each figure's units and its rupiah — one cell on screen, the units over the
// value, two in a file — and each loss followed by its own rate.
var figureColumns = []string{
	"Direstok (unit)", "Direstok (Rp)",
	"Penjualan (unit)", "Penjualan (Rp)",
	"Hilang di pengiriman (unit)", "Hilang di pengiriman (Rp)", "Tingkat hilang",
	"Rusak di pengiriman (unit)", "Rusak di pengiriman (Rp)", "Tingkat rusak",
}

// SupplierFigureExport writes the Statistik tab's view as a file (each-supplier-tab-exports-its-own-table, on
// one-export-is-the-list-as-a-file): the view on screen over the tab's own filters, every page of it, as .xlsx.
//
//   - Per Periode (DAILY, MONTHLY, YEARLY): every period of the window at its grain, NEWEST first, the quiet ones
//     included — the spine the tab lists itself — each filled by the tab's own MetricData read.
//   - Per Produk (PRODUCT): every product the tab's MetricSearch ranks, by restocked value, largest first, each filled
//     by its MetricData read and named as the tab names it — the team column only while no team is picked.
//
// Money is the metric's exact figure (the-backend-never-rounds-money); a rate is the exact share under a 0.0% format,
// empty where nothing arrived (no rate, which is not a rate of 0). The days are the report's Jakarta days.
func (s *Service) SupplierFigureExport(
	ctx context.Context,
	req *connect.Request[supplierv1.SupplierFigureExportRequest],
	stream *connect.ServerStream[supplierv1.SupplierFigureExportResponse],
) error {
	if s.exports == nil {
		return connect.NewError(connect.CodeUnimplemented, errNoExportStore)
	}

	msg := req.Msg

	scope, err := parseFilters(msg.GetFilters())
	if err != nil {
		return err
	}

	// The tab is ONE supplier's: a file of every supplier is the Supplier Report's (SupplierReportExport).
	if scope.supplierID == 0 {
		return invalid("the Statistik tab is one supplier's — a supplier filter is required")
	}

	progress := san_export.NewProgress(func(message string, done, total int64) error {
		return stream.Send(&supplierv1.SupplierFigureExportResponse{Message: message, Done: done, Total: total})
	})

	book, err := san_export.NewWorkbook()
	if err != nil {
		return internal(err)
	}
	defer book.Close()

	switch msg.GetGroupBy() {
	case analytic_basev1.GroupType_GROUP_TYPE_DAILY, analytic_basev1.GroupType_GROUP_TYPE_MONTHLY,
		analytic_basev1.GroupType_GROUP_TYPE_YEARLY, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT:
	default:
		return invalid("the Statistik tab is Per Periode (a day, month or year) or Per Produk, not %s", msg.GetGroupBy())
	}

	prefix := "statistik-pemasok-per-periode"

	if msg.GetGroupBy() == analytic_basev1.GroupType_GROUP_TYPE_PRODUCT {
		prefix = "statistik-pemasok-per-produk"
		err = s.exportFiguresByProduct(ctx, msg.GetTeamId(), scope, progress, book)
	} else {
		err = s.exportFiguresByPeriod(ctx, scope, msg.GetGroupBy(), progress, book)
	}

	if err != nil {
		return err
	}

	content, err := book.Bytes()
	if err != nil {
		return internal(fmt.Errorf("writing the file: %w", err))
	}

	filename := san_export.Filename(prefix, time.Now())

	url, err := s.exports.Store(ctx, msg.GetTeamId(), filename, content)
	if err != nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("storing the file: %w", err))
	}

	return stream.Send(&supplierv1.SupplierFigureExportResponse{
		Message:     "the file is ready",
		Done:        progress.Done,
		Total:       progress.Total,
		DownloadUrl: url,
		Filename:    filename,
	})
}

// exportFiguresByPeriod writes Per Periode: the window's periods newest first, a step at a time through MetricData.
func (s *Service) exportFiguresByPeriod(
	ctx context.Context,
	scope metricScope,
	groupBy analytic_basev1.GroupType,
	progress *san_export.Progress,
	book *san_export.Workbook,
) error {
	periods := periodSpine(scope.start, scope.end, groupBy)

	progress.Total = int64(len(periods))
	progress.Info("exporting the periods", "rows", progress.Total)

	sheet, err := book.Sheet("Per Periode", append([]string{"Periode"}, figureColumns...))
	if err != nil {
		return internal(err)
	}

	for start := 0; start < len(periods); start += san_export.Batch {
		keys := periods[start:min(start+san_export.Batch, len(periods))]

		data, err := s.supplierMetricData(ctx, scope, groupBy, &analytic_basev1.MetricKeys{
			K: &analytic_basev1.MetricKeys_Days{Days: &analytic_basev1.DayList{Days: keys}},
		})
		if err != nil {
			return err
		}

		byDay := data.GetSupplierByDay().GetItems()

		for _, key := range keys {
			err = sheet.Row(append([]any{periodLabel(key, groupBy)}, figureCells(byDay[key])...)...)
			if err != nil {
				return internal(fmt.Errorf("writing the file: %w", err))
			}
		}

		progress.Done += int64(len(keys))
		progress.Info("rows written", "done", progress.Done, "of", progress.Total)

		err = progress.Err()
		if err != nil {
			return err
		}
	}

	return nil
}

// exportFiguresByProduct writes Per Produk: every key the tab's search ranks (restocked value, largest first, the key
// breaking a tie), then each step filled and named.
func (s *Service) exportFiguresByProduct(
	ctx context.Context,
	teamID uint64,
	scope metricScope,
	progress *san_export.Progress,
	book *san_export.Workbook,
) error {
	ranked, err := s.rankedProducts(ctx, teamID, scope)
	if err != nil {
		return err
	}

	progress.Total = int64(len(ranked))
	progress.Info("exporting the products", "rows", progress.Total)

	// The Team column goes when one team is picked — it would say the same name on every row, as on screen.
	showTeam := scope.restockTeamID == 0

	headers := []string{"Produk", "SKU"}
	if showTeam {
		headers = append(headers, "Tim")
	}

	sheet, err := book.Sheet("Per Produk", append(headers, figureColumns...))
	if err != nil {
		return internal(err)
	}

	for start := 0; start < len(ranked); start += san_export.Batch {
		ids := ranked[start:min(start+san_export.Batch, len(ranked))]

		data, err := s.supplierMetricData(ctx, scope, analytic_basev1.GroupType_GROUP_TYPE_PRODUCT, &analytic_basev1.MetricKeys{
			K: &analytic_basev1.MetricKeys_Ids{Ids: &analytic_basev1.IDList{Ids: ids}},
		})
		if err != nil {
			return err
		}

		products, err := s.exports.ProductNames(ctx, teamID, ids)
		if err != nil {
			return connect.NewError(connect.CodeInternal, fmt.Errorf("naming the products: %w", err))
		}

		owners := idSet{}
		for _, product := range products {
			owners.add(product.TeamID)
		}

		teams := map[uint64]string{}
		if showTeam && len(owners) > 0 {
			teams, err = s.exports.TeamNames(ctx, owners.list())
			if err != nil {
				return connect.NewError(connect.CodeInternal, fmt.Errorf("naming the teams: %w", err))
			}
		}

		byID := data.GetSupplierById().GetItems()

		for _, id := range ids {
			product := products[id]

			name := product.Name
			if name == "" {
				name = "Produk #" + strconv.FormatUint(id, 10)
			}

			row := []any{name, product.Code}

			if showTeam {
				row = append(row, teamLabel(teams, product.TeamID))
			}

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

	return nil
}

// rankedProducts is every key the Per Produk table pages through — MetricSearch with the tab's own sort, 200 a call,
// until no page follows.
func (s *Service) rankedProducts(ctx context.Context, teamID uint64, scope metricScope) ([]uint64, error) {
	filters := scopeFilters(scope)

	var ids []uint64

	for offset := int32(0); ; offset += san_export.Batch {
		res, err := s.MetricSearch(ctx, connect.NewRequest(&supplierv1.MetricSearchRequest{
			TeamId:  teamID,
			GroupBy: analytic_basev1.GroupType_GROUP_TYPE_PRODUCT,
			Filters: filters,
			Sort: &analytic_basev1.MetricSort{
				MetricId: supplierMetricOption.GetMetricId(),
				Field:    "restock_valuation",
				SortType: analytic_basev1.SortType_SORT_TYPE_DESC,
			},
			Page: &analytic_basev1.PaginationFilter{Offset: offset, Limit: san_export.Batch},
		}))
		if err != nil {
			return nil, err
		}

		ids = append(ids, res.Msg.GetKeys().GetIds().GetIds()...)

		if !res.Msg.GetHasNext() {
			return ids, nil
		}
	}
}

// scopeFilters writes a scope back as the filters it was read from — the window, the supplier, and the team when one
// is picked — so the ranking reads exactly what the tab's search reads.
func scopeFilters(scope metricScope) []*analytic_basev1.FilterItem {
	filters := []*analytic_basev1.FilterItem{
		{F: &analytic_basev1.FilterItem_DateRangeFilter{DateRangeFilter: &analytic_basev1.DateRangeFilter{
			DateMin: scope.start.Format(dateLayout),
			DateMax: scope.end.Format(dateLayout),
		}}},
		{F: &analytic_basev1.FilterItem_SupplierFilter{SupplierFilter: &analytic_basev1.SupplierFilter{
			SupplierId: scope.supplierID,
		}}},
	}

	if scope.restockTeamID != 0 {
		filters = append(filters, &analytic_basev1.FilterItem{F: &analytic_basev1.FilterItem_TeamFilter{
			TeamFilter: &analytic_basev1.TeamFilter{TeamId: scope.restockTeamID},
		}})
	}

	return filters
}

// periodSpine is every period of [start, end] at the grain, keyed by its first day, NEWEST first — the tab's own
// bucketSpine, reversed. A quiet period is a row too.
func periodSpine(start, end time.Time, groupBy analytic_basev1.GroupType) []string {
	var keys []string

	seen := map[string]bool{}

	for day := start; !day.After(end); day = day.AddDate(0, 0, 1) {
		key := bucketStart(groupBy, day).Format(dateLayout)
		if !seen[key] {
			seen[key] = true
			keys = append(keys, key)
		}
	}

	for i, j := 0, len(keys)-1; i < j; i, j = i+1, j-1 {
		keys[i], keys[j] = keys[j], keys[i]
	}

	return keys
}

// indonesianMonths name a month as the tab reads it in Indonesian (a-period-reads-as-its-grain): *Oktober 2026*.
var indonesianMonths = [...]string{
	"Januari", "Februari", "Maret", "April", "Mei", "Juni",
	"Juli", "Agustus", "September", "Oktober", "November", "Desember",
}

// periodLabel is a period as it reads at its grain: `2026-10-07`, `Oktober 2026`, `2026`.
func periodLabel(key string, groupBy analytic_basev1.GroupType) string {
	day, err := time.Parse(dateLayout, key)
	if err != nil {
		return key
	}

	switch groupBy {
	case analytic_basev1.GroupType_GROUP_TYPE_MONTHLY:
		return indonesianMonths[day.Month()-1] + " " + strconv.Itoa(day.Year())
	case analytic_basev1.GroupType_GROUP_TYPE_YEARLY:
		return strconv.Itoa(day.Year())
	default:
		return key
	}
}

// figureCells is one row's figures: units and rupiah per figure, each loss's rate after it. A missing metric is all
// zero, as the tab reads it.
func figureCells(m *supplierv1.SupplierMetric) []any {
	units := m.GetRestockCount() + m.GetShippingLostCount() + m.GetShippingBrokenCount()

	return []any{
		m.GetRestockCount(), m.GetRestockValuation(),
		m.GetSalesCount(), m.GetSalesValue(),
		m.GetShippingLostCount(), m.GetShippingLostValuation(), rateCell(m.GetShippingLostCount(), units),
		m.GetShippingBrokenCount(), m.GetShippingBrokenValuation(), rateCell(m.GetShippingBrokenCount(), units),
	}
}

// rateCell is a share of the units received — empty when nothing arrived, which has no rate.
func rateCell(count, units int64) any {
	if units == 0 {
		return ""
	}

	return san_export.Percent(float64(count) / float64(units))
}

// teamLabel is a team's name, or `Tim #<id>` as the tab reads an unresolved one; no team, no label.
func teamLabel(names map[uint64]string, id uint64) string {
	if id == 0 {
		return ""
	}

	if name := names[id]; name != "" {
		return name
	}

	return "Tim #" + strconv.FormatUint(id, 10)
}

// idSet collects distinct non-zero ids — 0 means "not recorded" and is never looked up.
type idSet map[uint64]struct{}

func (s idSet) add(id uint64) {
	if id > 0 {
		s[id] = struct{}{}
	}
}

func (s idSet) list() []uint64 {
	out := make([]uint64, 0, len(s))
	for id := range s {
		out = append(out, id)
	}

	return out
}
