package financial_account_v1

import (
	"cmp"
	"context"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_export"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// THE ACCOUNT REPORT AS A FILE (a-report-export-is-the-whole-view-as-a-file) — the view on screen, whole, in the screen's
// own words: its columns are the report's, labelled as the report labels them in Indonesian.

// reportTypes are the nine change types in the report's column order (the screen's CHANGE_TYPES), each with its label.
// ⚠ The type OPENING_BALANCE reads *Saldo awal*, as on screen — the Periode view has no opening-balance column for it to
// be mistaken for.
var reportTypes = []struct {
	column string
	label  string
}{
	{m.ChangeWithdrawal, "Penarikan"},
	{m.ChangeCapital, "Modal"},
	{m.ChangeRestock, "Restok"},
	{m.ChangeExpense, "Biaya"},
	{m.ChangeAdsExpense, "Iklan"},
	{m.ChangeTeamPayment, "Pembayaran tim"},
	{m.ChangeTransfer, "Transfer"},
	{m.ChangeAdjustment, "Penyesuaian"},
	{m.ChangeOpeningBalance, "Saldo awal"},
}

// providerLabels name a provider as the report does; an unknown provider is *Lainnya*.
var providerLabels = map[string]string{
	m.ProviderCash:      "Kas",
	m.ProviderBCA:       "BCA",
	m.ProviderBNI:       "BNI",
	m.ProviderJago:      "Jago",
	m.ProviderShopeePay: "ShopeePay",
	m.ProviderUnknown:   "Lainnya",
}

func providerLabel(provider string) string {
	if label, ok := providerLabels[provider]; ok {
		return label
	}

	return "Lainnya"
}

const (
	colOpen   = "Saldo awal"
	colChange = "Perubahan bersih"
	colClose  = "Saldo akhir"
)

// FinancialAccountReportExport writes the account report's view as a file (a-report-export-is-the-whole-view-as-a-file,
// on one-export-is-the-list-as-a-file), read exactly as the report reads it — the request's team, the window, the
// account when one is picked:
//
//   - Periode: every period of the window at the grain on screen, the quiet ones included (each still carries its
//     balance), in the order the Periode heading set — the series MetricData fills, read once for the whole window.
//     Columns: Periode, the nine change types, Perubahan bersih, Saldo akhir.
//   - Rincian: one sheet per breakdown, every row of each — Per Akun and Per Penyedia (Saldo awal, Perubahan bersih,
//     Saldo akhir, then a Total row, as the screen's table ends), ordered as the screen orders them, the largest
//     movement either way first; Per Jenis: the bridge from Saldo awal through each type that moved, money in first,
//     to Saldo akhir. With an account picked every sheet is that account's.
//
// Money is the exact figure (the-backend-never-rounds-money) — a 0 is a figure, written 0. The days are Jakarta days.
func (s *Service) FinancialAccountReportExport(
	ctx context.Context,
	req *connect.Request[financial_accountv1.FinancialAccountReportExportRequest],
	stream *connect.ServerStream[financial_accountv1.FinancialAccountReportExportResponse],
) error {
	if s.exports == nil {
		return connect.NewError(connect.CodeUnimplemented, errNoExportStore)
	}

	msg := req.Msg
	teamID := msg.GetTeamId()

	filters, err := parseMetricFilters(msg.GetFilters(), []*financeMetric{metricChanges})
	if err != nil {
		return err
	}

	view := msg.GetView()
	group := msg.GetGroupBy()

	switch view {
	case financial_accountv1.FinancialAccountReportView_FINANCIAL_ACCOUNT_REPORT_VIEW_PERIOD:
		switch group {
		case analytic_basev1.GroupType_GROUP_TYPE_DAILY, analytic_basev1.GroupType_GROUP_TYPE_MONTHLY,
			analytic_basev1.GroupType_GROUP_TYPE_YEARLY:
		default:
			return invalidMetric("Periode is read at a day, a month or a year, not %s", group)
		}
	case financial_accountv1.FinancialAccountReportView_FINANCIAL_ACCOUNT_REPORT_VIEW_BREAKDOWN:
	default:
		return invalidMetric("the report's view is Periode or Rincian, not %s", view)
	}

	progress := san_export.NewProgress(func(message string, done, total int64) error {
		return stream.Send(&financial_accountv1.FinancialAccountReportExportResponse{Message: message, Done: done, Total: total})
	})

	book, err := san_export.NewWorkbook()
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}
	defer book.Close()

	prefix := "laporan-akun-periode"

	if view == financial_accountv1.FinancialAccountReportView_FINANCIAL_ACCOUNT_REPORT_VIEW_BREAKDOWN {
		prefix = "laporan-akun-rincian"
		err = s.exportBreakdown(ctx, teamID, filters, progress, book)
	} else {
		ascending := msg.GetSortType() == analytic_basev1.SortType_SORT_TYPE_ASC
		err = s.exportPeriods(ctx, teamID, filters, group, ascending, progress, book)
	}

	if err != nil {
		return err
	}

	content, err := book.Bytes()
	if err != nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("writing the file: %w", err))
	}

	filename := san_export.Filename(prefix, s.now())

	url, err := s.exports.Store(ctx, teamID, filename, content)
	if err != nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("storing the file: %w", err))
	}

	return stream.Send(&financial_accountv1.FinancialAccountReportExportResponse{
		Message:     "the file is ready",
		Done:        progress.Done,
		Total:       progress.Total,
		DownloadUrl: url,
		Filename:    filename,
	})
}

// exportPeriods writes Periode: the window's whole series, read once (two statements, the-balance-series-is-a-running-sum),
// then written a step at a time in the screen's order.
func (s *Service) exportPeriods(
	ctx context.Context,
	teamID uint64,
	filters metricFilters,
	group analytic_basev1.GroupType,
	ascending bool,
	progress *san_export.Progress,
	book *san_export.Workbook,
) error {
	periods, err := s.series(ctx, teamID, group, filters)
	if err != nil {
		return err
	}

	// The series is oldest first; the screen opens newest first.
	if !ascending {
		slices.Reverse(periods)
	}

	progress.Total = int64(len(periods))
	progress.Info("exporting the periods", "rows", progress.Total)

	headers := []string{"Periode"}
	for _, t := range reportTypes {
		headers = append(headers, t.label)
	}

	sheet, err := book.Sheet("Periode", append(headers, colChange, colClose))
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}

	for start := 0; start < len(periods); start += san_export.Batch {
		step := periods[start:min(start+san_export.Batch, len(periods))]

		for _, p := range step {
			row := []any{reportPeriodLabel(p.key, group)}
			for _, t := range reportTypes {
				row = append(row, column(p.figures, t.column))
			}

			err = sheet.Row(append(row, p.Change, p.CloseBalance)...)
			if err != nil {
				return connect.NewError(connect.CodeInternal, fmt.Errorf("writing the file: %w", err))
			}
		}

		progress.Done += int64(len(step))
		progress.Info("rows written", "done", progress.Done, "of", progress.Total)

		err = progress.Err()
		if err != nil {
			return err
		}
	}

	return nil
}

// reportPeriodLabel is a period as the report's table reads it: `2026-10-07`, `2026-10`, `2026`.
func reportPeriodLabel(key string, group analytic_basev1.GroupType) string {
	switch group {
	case analytic_basev1.GroupType_GROUP_TYPE_MONTHLY:
		return key[:7]
	case analytic_basev1.GroupType_GROUP_TYPE_YEARLY:
		return key[:4]
	default:
		return key
	}
}

// exportBreakdown writes Rincian's three sheets from ONE read of the window per account — the read the report's
// ranking and its headline both answer from (byAccount), so the three sheets and the screen's cards agree.
func (s *Service) exportBreakdown(
	ctx context.Context,
	teamID uint64,
	filters metricFilters,
	progress *san_export.Progress,
	book *san_export.Workbook,
) error {
	rows, err := s.byAccount(ctx, teamID, filters)
	if err != nil {
		return err
	}

	accounts, err := s.reportAccounts(ctx, teamID, rows)
	if err != nil {
		return err
	}

	providers, err := idKeys(analytic_basev1.GroupType_GROUP_TYPE_PROVIDER, rows)
	if err != nil {
		return err
	}

	total := summaryOf(rows)
	bridge := bridgeOf(total)

	progress.Total = int64(len(rows) + len(providers) + len(bridge))
	progress.Info("exporting the breakdowns", "rows", progress.Total)

	// ── Per Akun ──
	byAccount := make([]keyed, 0, len(rows))
	for _, r := range rows {
		byAccount = append(byAccount, keyed{id: r.AccountID, figures: r.MetricColumns})
	}

	sheet, err := book.Sheet("Per Akun", []string{"Akun", "Penyedia", "Status", colOpen, colChange, colClose})
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}

	for _, k := range bySize(byAccount) {
		account := accounts[k.id]

		status := ""
		if account.archived {
			status = "Diarsipkan"
		}

		err = sheet.Row(account.name, providerLabel(account.provider), status, k.OpenBalance, k.Change, k.CloseBalance)
		if err != nil {
			return connect.NewError(connect.CodeInternal, fmt.Errorf("writing the file: %w", err))
		}
	}

	err = sheet.Row("Total", "", "", total.OpenBalance, total.Change, total.CloseBalance)
	if err != nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("writing the file: %w", err))
	}

	progress.Done += int64(len(rows))
	progress.Info("rows written", "done", progress.Done, "of", progress.Total)

	// ── Per Penyedia ──
	sheet, err = book.Sheet("Per Penyedia", []string{"Penyedia", colOpen, colChange, colClose})
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}

	for _, k := range bySize(providers) {
		label := providerLabel(providerText[financial_accountv1.FinancialAccountProvider(k.id)])

		err = sheet.Row(label, k.OpenBalance, k.Change, k.CloseBalance)
		if err != nil {
			return connect.NewError(connect.CodeInternal, fmt.Errorf("writing the file: %w", err))
		}
	}

	err = sheet.Row("Total", total.OpenBalance, total.Change, total.CloseBalance)
	if err != nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("writing the file: %w", err))
	}

	progress.Done += int64(len(providers))
	progress.Info("rows written", "done", progress.Done, "of", progress.Total)

	// ── Per Jenis ──
	sheet, err = book.Sheet("Per Jenis", []string{"Jenis", "Arah", "Jumlah"})
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}

	for _, line := range bridge {
		err = sheet.Row(line.label, line.direction, line.amount)
		if err != nil {
			return connect.NewError(connect.CodeInternal, fmt.Errorf("writing the file: %w", err))
		}
	}

	progress.Done += int64(len(bridge))
	progress.Info("rows written", "done", progress.Done, "of", progress.Total)

	return progress.Err()
}

// bySize is the screen's breakdown order: the largest movement EITHER WAY first, the key DESC breaking a tie
// (the-key-breaks-every-tie).
func bySize(keys []keyed) []keyed {
	out := slices.Clone(keys)

	slices.SortStableFunc(out, func(a, b keyed) int {
		c := cmp.Compare(math.Abs(b.Change), math.Abs(a.Change))
		if c != 0 {
			return c
		}

		return cmp.Compare(b.id, a.id)
	})

	return out
}

// bridgeLine is one line of Per Jenis.
type bridgeLine struct {
	label, direction string
	amount           float64
}

// bridgeOf is Mutasi per Jenis as the screen draws it: Saldo awal, every type that moved IN by size, every type that
// moved OUT by size, Saldo akhir. A type whose window nets to 0 is not a line, as on screen.
func bridgeOf(total figures) []bridgeLine {
	var in, out []bridgeLine

	for _, t := range reportTypes {
		amount := column(total, t.column)

		switch {
		case amount > 0:
			in = append(in, bridgeLine{label: t.label, direction: "Masuk", amount: amount})
		case amount < 0:
			out = append(out, bridgeLine{label: t.label, direction: "Keluar", amount: amount})
		}
	}

	larger := func(a, b bridgeLine) int { return cmp.Compare(math.Abs(b.amount), math.Abs(a.amount)) }
	slices.SortStableFunc(in, larger)
	slices.SortStableFunc(out, larger)

	lines := []bridgeLine{{label: colOpen, amount: total.OpenBalance}}
	lines = append(lines, in...)
	lines = append(lines, out...)

	return append(lines, bridgeLine{label: colClose, amount: total.CloseBalance})
}

// reportAccount is what a Per Akun row reads of an account: the name it is shown by, its provider, and whether it is
// archived.
type reportAccount struct {
	name, provider string
	archived       bool
}

// shopRef is a shop id the server wrote into an account's name — "Unknown — shop #25".
var shopRef = regexp.MustCompile(`shop #(\d+)`)

// reportAccounts names the window's accounts as the report names them (the-unknown-account-reads-lainnya): an unknown
// account by the shops whose withdrawals it holds, every other by its own name, a shop id written in a name put back as
// the shop's name. The accounts are the request team's own; the shops are named through the export store.
func (s *Service) reportAccounts(ctx context.Context, teamID uint64, rows []accountWindow) (map[uint64]reportAccount, error) {
	out := map[uint64]reportAccount{}
	if len(rows) == 0 {
		return out, nil
	}

	ids := make([]uint64, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.AccountID)
	}

	var accounts []m.FinancialAccount

	err := s.db.
		WithContext(ctx).
		Where("team_id = ? AND id IN ?", teamID, ids).
		Find(&accounts).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	var links []m.ShopAccount

	err = s.db.
		WithContext(ctx).
		Where("team_id = ? AND account_id IN ?", teamID, ids).
		Order("shop_id").
		Find(&links).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	shopsOf := map[uint64][]uint64{}
	wanted := map[uint64]bool{}

	for _, link := range links {
		shopsOf[link.AccountID] = append(shopsOf[link.AccountID], link.ShopID)
		wanted[link.ShopID] = true
	}

	for _, a := range accounts {
		for _, match := range shopRef.FindAllStringSubmatch(a.Name, -1) {
			id, err := strconv.ParseUint(match[1], 10, 64)
			if err == nil && id > 0 {
				wanted[id] = true
			}
		}
	}

	names, err := s.shopNames(ctx, wanted)
	if err != nil {
		return nil, err
	}

	for _, a := range accounts {
		out[a.ID] = reportAccount{
			name:     shownName(a, shopsOf[a.ID], names),
			provider: a.Provider,
			archived: a.Status == m.StatusArchived,
		}
	}

	return out, nil
}

// shopNames asks the store for the shops' names, 200 at a time.
func (s *Service) shopNames(ctx context.Context, wanted map[uint64]bool) (map[uint64]string, error) {
	names := map[uint64]string{}

	ids := make([]uint64, 0, len(wanted))
	for id := range wanted {
		ids = append(ids, id)
	}

	slices.Sort(ids)

	for start := 0; start < len(ids); start += san_export.Batch {
		step, err := s.exports.ShopNames(ctx, ids[start:min(start+san_export.Batch, len(ids))])
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("naming the shops: %w", err))
		}

		for id, name := range step {
			names[id] = name
		}
	}

	return names, nil
}

// shownName is the screen's accountName: an UNKNOWN account reads as its shops' names, else its stored name without
// the "Unknown — " prefix; any other account is its own name; a shop id written in it reads as the shop's name.
func shownName(a m.FinancialAccount, shops []uint64, names map[uint64]string) string {
	if a.Type == m.TypeUnknown {
		var named []string

		for _, id := range shops {
			if name := names[id]; name != "" {
				named = append(named, name)
			}
		}

		if len(named) > 0 {
			return strings.Join(named, ", ")
		}

		return strings.TrimPrefix(withShopNames(a.Name, names), "Unknown — ")
	}

	return withShopNames(a.Name, names)
}

// withShopNames puts a shop's name where the server wrote `shop #<id>`; an id that resolves to nothing stays as written.
func withShopNames(text string, names map[uint64]string) string {
	return shopRef.ReplaceAllStringFunc(text, func(written string) string {
		id, err := strconv.ParseUint(shopRef.FindStringSubmatch(written)[1], 10, 64)
		if err != nil {
			return written
		}

		if name := names[id]; name != "" {
			return name
		}

		return written
	})
}
