package san_excel_readers

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
)

// A TikTok export is four sheets, and three of them are read here.
//
// ⚠ It is a different GRAIN from a Shopee report. A Shopee row is money moving on the wallet;
// a TikTok "Order details" row is one settled ORDER broken into 61-64 fee columns, and the
// money moving is on a separate "Withdrawal records" sheet. There is no running balance
// anywhere in the file, so there is no TikTok equivalent of Saldo Akhir.
const (
	tiktokSheetOrders      = "Order details"
	tiktokSheetReports     = "Reports"
	tiktokSheetWithdrawals = "Withdrawal records"
)

// Order details columns the item is read from. Every layout measured carries all of them, though
// not always under these names — see tiktokRenamed. The columns that come and go entirely are
// tiktokDriftingColumns.
const (
	tiktokColID         = "Order/adjustment ID"
	tiktokColType       = "Type"
	tiktokColCreatedAt  = "Order created time"
	tiktokColSettledAt  = "Order settled time"
	tiktokColCurrency   = "Currency"
	tiktokColSettlement = "Total settlement amount"
	tiktokColRevenue    = "Total Revenue"
	tiktokColFees       = "Total Fees"
	tiktokColRelatedID  = "Related order ID"
	tiktokColSource     = "Order Source"

	// The SKU list. Two exports of the SAME order list its items in a DIFFERENT ORDER, which
	// is the only column measured to be unstable across exports — so it must never reach the
	// hash, or a re-upload would import every overlapping order twice.
	tiktokColShoppingCenter = "Shopping center items"

	// Withdrawal records columns.
	tiktokColWithdrawalType = "Type"
	tiktokColReferenceID    = "Reference ID"
	tiktokColRequestTime    = "Request time"
	tiktokColAmount         = "Amount"
	tiktokColStatus         = "Status"
	tiktokColSuccessTime    = "Success time"

	// Reports sheet labels.
	tiktokLabelPeriod   = "Time period:"
	tiktokLabelTimezone = "Timezone"
	tiktokLabelCurrency = "Currency"

	tiktokDateLayout = "2006/01/02"

	// A cell holding this is TikTok's way of writing "none".
	tiktokNone = "/"
)

// tiktokRenamed is every other header text TikTok has exported a column under.
//
// The September 2026 layout renamed headers without changing what the columns hold: "Type"
// became "Transaction type" on both sheets that have one, two headers changed only their
// capitals, and two Reports labels were respelled. Only the columns the reader relies on are
// listed; every other column reaches GetDetails under whatever name the export gives it.
var tiktokRenamed = map[string][]string{
	tiktokColID:         {"Order/Adjustment ID"},
	tiktokColType:       {"Transaction type"}, // tiktokColWithdrawalType is the same "Type"
	tiktokColSource:     {"Order source"},
	tiktokLabelPeriod:   {"Time period"},
	tiktokLabelTimezone: {"Time zone"},
}

// tiktokDriftingColumns are the fee columns that appear in some exports and not others: four
// layouts across 14 samples, 61, 63, 64 and 76 columns wide.
//
// They are listed so the drift is visible in code rather than a surprise. None of them is a
// field on the item, and all of them are readable through GetDetails.
var tiktokDriftingColumns = []string{
	// In the 61- and 63-column layouts, GONE from the two widest.
	"Flat fee",
	"Sales fee",
	// In every layout before September 2026, gone from it.
	"Bonus cashback service fee",
	"Voucher Xtra service fee",
	// Only in the wider layouts.
	"Distance item fee from Horizon+ Program",
	"Distance shipping fee from Horizon+ Program",
	"Article 22 Income Tax withheld",
	"Platform special service fee",
	"GMV Max ad fee",
	// Only in the September 2026 layout.
	"Credit card installment - Handling fee",
	"Logistics service fee",
	"Insurance reimbursement",
	"Affiliate commission deposit",
	"Affiliate commission refund",
	"Growth Xtra Program service fee",
	"Growth Xtra Program Super service fee",
	"GMV Max coupon",
	"GMV Max coupon sales tax",
	"Managed service plan (Sales tax)",
	"Managed service plan (Per order fee)",
	"Failed delivery shipping fee",
	"Buyer-fault return shipping fee",
	"Insurance fee",
}

var ErrNotTiktokReport = fmt.Errorf("san_excel_readers: not a tiktok settlement report")

// TiktokSettlementItem is one row of "Order details" — one order settled to the wallet.
//
// ⚠ Every field here is measured to be IDENTICAL when the same order appears in two different
// exports (43 orders, 77 pairs, across the samples). That is what makes GenerateUniqueID safe
// to re-run over overlapping downloads. The fee breakdown is deliberately NOT here: seven fee
// columns come and go between exports, so hashing them would give one order two keys.
type TiktokSettlementItem struct {
	At                time.Time `json:"at"`                   // "Order settled time"
	CreatedAt         time.Time `json:"created_at"`           // "Order created time"
	TransactionType   string    `json:"transaction_type"`     // "Type"
	OrderRefID        string    `json:"order_ref_id"`         // "Order/adjustment ID"
	RelatedOrderRefID string    `json:"related_order_ref_id"` // "Related order ID"
	Currency          string    `json:"currency"`             // "Currency"
	Amount            float64   `json:"amount"`               // "Total settlement amount"
	Revenue           float64   `json:"revenue"`              // "Total Revenue"
	TotalFees         float64   `json:"total_fees"`           // "Total Fees"
	Source            string    `json:"source"`               // "Order Source"
}

// GenerateUniqueID is the idempotency key for this row.
//
// The order id alone is NOT one: an order can settle twice — a payment and then a reversal a
// couple of days later, both typed "Order" with the same id. The settled time and the amount
// are what separate them.
func (s *TiktokSettlementItem) GenerateUniqueID() (string, error) {
	raw, err := json.Marshal(s)
	if err != nil {
		return "", err
	}

	sum := md5.Sum(raw)
	return hex.EncodeToString(sum[:]), nil
}

// tiktokSettlementTypes is the mapping table for the "Type" column.
//
// ⚠ It is INCOMPLETE — context.md has no TikTok table, so rows are added one owner decision at a
// time and everything else returns ErrNoSettlementTypeMapping. The measured vocabulary, and what
// each unmapped one looks like (looks like is not decided — that is the point):
//
//	Order                           2710 rows sampled   looks like fund
//	GMV Payment for TikTok Ads        10                looks like external_ads_fee
//	Platform reimbursement             4                looks like marketplace_adjustment
//	Additional Campaign Package        4                ⛔ ads fee or programme, genuinely unclear
//	Logistics reimbursement            3                looks like marketplace_adjustment
//	Other adjustment                   1   ✅ mapped
//	Shipping insurance compensation    1                looks like marketplace_adjustment
//	wderror                            1                ⛔ probably a hand-edited fixture, not real
//
// ⚠ And a limit this table cannot reach past: unlike Shopee, TikTok puts affiliate and ads charges
// in COLUMNS on the order row — Affiliate Commission, GMV Max ad fee and the rest — not in rows of
// their own. A per-row settlement type cannot express those at all.
var tiktokSettlementTypes = map[string]SettlementType{
	"Other adjustment": SettlementMarketplaceAdjustment, // 1 row, cannot_open.xlsx
}

// SettlementType classifies the row for settlement_service.
//
// ⚠ Always returns ErrNoSettlementTypeMapping today — see tiktokSettlementTypes. As on the Shopee
// side, an unmapped type is an ERROR and never SettlementOther: bucketing something unrecognised
// into "other" makes it indistinguishable from a deliberate classification.
func (s *TiktokSettlementItem) SettlementType() (SettlementType, error) {
	mapped, found := tiktokSettlementTypes[s.TransactionType]
	if !found {
		return "", fmt.Errorf("%w: %q", ErrNoSettlementTypeMapping, s.TransactionType)
	}

	return mapped, nil
}

// TiktokWithdrawalItem is one row of "Withdrawal records" — this is where TikTok money actually
// moves, as opposed to "Order details", which is what each order was worth.
//
// The sheet's "Bank account" column is deliberately not carried: it is masked already, it is
// nobody's business downstream, and it would land in the hash.
type TiktokWithdrawalItem struct {
	At          time.Time `json:"at"`           // "Request time"
	SucceededAt time.Time `json:"succeeded_at"` // "Success time", zero when absent
	Type        string    `json:"type"`         // Withdrawal | Earnings | GMV Pay Deduction
	ReferenceID string    `json:"reference_id"` // "Reference ID"
	Amount      float64   `json:"amount"`       // "Amount", signed
	Status      string    `json:"status"`       // "Transferred" in every sample
}

func (w *TiktokWithdrawalItem) GenerateUniqueID() (string, error) {
	raw, err := json.Marshal(w)
	if err != nil {
		return "", err
	}

	sum := md5.Sum(raw)
	return hex.EncodeToString(sum[:]), nil
}

// TiktokSettlementDetail is every column of an "Order details" row, verbatim and by header
// text, tied to the row's key.
//
// This is where the fee breakdown lives. Keeping it off the item is what lets the 61/63/64
// column drift be a non-event: a fee column that appears in a later export shows up here
// without changing a single unique id.
type TiktokSettlementDetail struct {
	UniqueID string
	Columns  map[string]string
}

type TiktokSettlementDocument interface {
	// GetPeriod is the "Time period:" the report covers, from the Reports sheet.
	GetPeriod() (from time.Time, to time.Time, err error)
	// GetTimezone is the offset the report states, e.g. "UTC+7". Unlike Shopee, TikTok says.
	GetTimezone() (string, error)
	// GetCurrency is the "Currency" the Reports sheet states.
	GetCurrency() (string, error)
	// GetItems is every settled order, in the order the file lists them.
	GetItems() ([]*TiktokSettlementItem, error)
	// GetWithdrawals is the "Withdrawal records" sheet — where the money actually moves.
	GetWithdrawals() ([]*TiktokWithdrawalItem, error)
	// GetDetails is every column of every order row, for the fee breakdown.
	GetDetails() ([]*TiktokSettlementDetail, error)
	// GetDriftingColumns is the fee columns THIS export happens to carry that are not in every
	// export — the ones a caller comparing fees across exports cannot assume the other export
	// has. Informational, never an error: every layout measured carries some.
	GetDriftingColumns() ([]string, error)
}

type tiktokDocument struct {
	from        time.Time
	to          time.Time
	timezone    string
	currency    string
	items       []*TiktokSettlementItem
	withdrawals []*TiktokWithdrawalItem
	details     []*TiktokSettlementDetail
	drifting    []string
}

func (d *tiktokDocument) GetPeriod() (time.Time, time.Time, error) {
	return d.from, d.to, nil
}

func (d *tiktokDocument) GetTimezone() (string, error) {
	return d.timezone, nil
}

func (d *tiktokDocument) GetCurrency() (string, error) {
	return d.currency, nil
}

func (d *tiktokDocument) GetItems() ([]*TiktokSettlementItem, error) {
	return d.items, nil
}

func (d *tiktokDocument) GetWithdrawals() ([]*TiktokWithdrawalItem, error) {
	return d.withdrawals, nil
}

func (d *tiktokDocument) GetDetails() ([]*TiktokSettlementDetail, error) {
	return d.details, nil
}

func (d *tiktokDocument) GetDriftingColumns() ([]string, error) {
	return d.drifting, nil
}

// NewTiktokSettlementDocument reads a TikTok settlement export.
func NewTiktokSettlementDocument(r io.Reader) (TiktokSettlementDocument, error) {
	file, err := excelize.OpenReader(r)
	if err != nil {
		return nil, fmt.Errorf("san_excel_readers: opening workbook: %w", err)
	}
	defer file.Close()

	orders, err := sheetRows(file, tiktokSheetOrders)
	if err != nil {
		return nil, err
	}
	if len(orders) == 0 {
		return nil, fmt.Errorf("%w: no %q sheet", ErrNotTiktokReport, tiktokSheetOrders)
	}

	header := headerOf(orders[0])
	columns, err := tiktokColumns(tiktokSheetOrders, header, tiktokOrderColumns)
	if err != nil {
		return nil, err
	}

	doc := &tiktokDocument{
		timezone: "",
		currency: "",
	}

	// The Reports sheet is a labelled block, not a table: the label sits in one column and the
	// value in another, and which column the label uses encodes its depth in a totals tree.
	reports, err := sheetRows(file, tiktokSheetReports)
	if err != nil {
		return nil, err
	}

	doc.from, doc.to, err = tiktokPeriod(reports)
	if err != nil {
		return nil, err
	}

	doc.timezone = tiktokReportValue(reports, tiktokLabelTimezone)
	doc.currency = tiktokReportValue(reports, tiktokLabelCurrency)

	// The report states its own timezone, so it is read rather than assumed. Shopee states
	// none, which is why that side has to fall back to WIB (jakarta-is-the-clock).
	zone, err := tiktokZone(doc.timezone)
	if err != nil {
		return nil, err
	}

	doc.items, doc.details, err = parseTiktokOrders(orders, header, columns, zone)
	if err != nil {
		return nil, err
	}

	for _, name := range tiktokDriftingColumns {
		_, present := header[name]
		if present {
			doc.drifting = append(doc.drifting, name)
		}
	}

	withdrawals, err := sheetRows(file, tiktokSheetWithdrawals)
	if err != nil {
		return nil, err
	}

	doc.withdrawals, err = parseTiktokWithdrawals(withdrawals, zone)
	if err != nil {
		return nil, err
	}

	return doc, nil
}

// sheetRows reads a sheet by name, returning nothing when the workbook has no such sheet.
func sheetRows(file *excelize.File, name string) ([][]string, error) {
	for _, sheet := range file.GetSheetList() {
		if sheet != name {
			continue
		}

		rows, err := file.GetRows(sheet, excelize.Options{RawCellValue: true})
		if err != nil {
			return nil, fmt.Errorf("san_excel_readers: reading sheet %q: %w", name, err)
		}
		return rows, nil
	}

	return nil, nil
}

func headerOf(row []string) map[string]int {
	header := map[string]int{}
	for at, text := range row {
		// TikTok pads some header cells with trailing spaces — "Type  ", "Order/adjustment ID   ".
		name := strings.TrimSpace(text)
		if name == "" {
			continue
		}
		header[name] = at
	}

	return header
}

// The columns each item is read from. Every one is required.
var (
	tiktokOrderColumns = []string{
		tiktokColID,
		tiktokColType,
		tiktokColCreatedAt,
		tiktokColSettledAt,
		tiktokColCurrency,
		tiktokColSettlement,
		tiktokColRevenue,
		tiktokColFees,
		tiktokColRelatedID,
		tiktokColSource,
	}
	tiktokWithdrawalColumns = []string{
		tiktokColWithdrawalType,
		tiktokColReferenceID,
		tiktokColRequestTime,
		tiktokColAmount,
		tiktokColStatus,
		tiktokColSuccessTime,
	}
)

// tiktokColumns finds where each named column sits in a sheet's header, under whichever of its
// spellings this export uses, keyed by the name the reader knows it by.
//
// A column that cannot be found fails the whole read. Left alone it would read as "" or 0 on
// every row, and those values are hashed — so a header TikTok renames would silently re-key the
// export, and re-importing it would book every row twice.
func tiktokColumns(sheet string, header map[string]int, names []string) (map[string]int, error) {
	columns := map[string]int{}
	for _, name := range names {
		at, found := tiktokFind(header, name)
		if !found {
			quoted := []string{}
			for _, spelling := range tiktokSpellings(name) {
				quoted = append(quoted, strconv.Quote(spelling))
			}
			return nil, fmt.Errorf("%w: %q has no %s column", ErrNotTiktokReport, sheet, strings.Join(quoted, " or "))
		}

		columns[name] = at
	}

	return columns, nil
}

func tiktokFind(header map[string]int, name string) (int, bool) {
	for _, spelling := range tiktokSpellings(name) {
		at, found := header[spelling]
		if found {
			return at, true
		}
	}

	return 0, false
}

// tiktokSpellings is every header text a column has been exported under, oldest first.
func tiktokSpellings(name string) []string {
	return append([]string{name}, tiktokRenamed[name]...)
}

// tiktokPeriod reads "2025/12/18-2025/12/24" out of the Reports sheet.
func tiktokPeriod(reports [][]string) (time.Time, time.Time, error) {
	raw := tiktokReportValue(reports, tiktokLabelPeriod)
	if raw == "" {
		return time.Time{}, time.Time{}, nil
	}

	halves := strings.Split(raw, "-")
	if len(halves) != 2 {
		return time.Time{}, time.Time{}, fmt.Errorf("san_excel_readers: %q is not a period", raw)
	}

	from, err := time.Parse(tiktokDateLayout, strings.TrimSpace(halves[0]))
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("san_excel_readers: period start %q: %w", halves[0], err)
	}

	to, err := time.Parse(tiktokDateLayout, strings.TrimSpace(halves[1]))
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("san_excel_readers: period end %q: %w", halves[1], err)
	}

	return from, to, nil
}

// tiktokReportValue finds a label anywhere in the Reports block and returns the last non-empty
// cell on its row — the label's column encodes tree depth, so its position is not fixed.
func tiktokReportValue(reports [][]string, label string) string {
	spellings := tiktokSpellings(label)

	for _, row := range reports {
		labelled := false
		value := ""

		for _, text := range row {
			cell := strings.TrimSpace(text)
			if cell == "" {
				continue
			}
			if slices.Contains(spellings, cell) {
				labelled = true
				continue
			}
			if labelled {
				value = cell
			}
		}

		if labelled && value != "" {
			return value
		}
	}

	return ""
}

// tiktokZone turns the report's stated "UTC+7" into a location.
func tiktokZone(stated string) (*time.Location, error) {
	if stated == "" {
		return WIB, nil
	}

	offset := strings.TrimPrefix(strings.TrimSpace(stated), "UTC")
	if offset == "" {
		return time.UTC, nil
	}

	hours, err := strconv.Atoi(offset)
	if err != nil {
		return nil, fmt.Errorf("san_excel_readers: %q is not a timezone", stated)
	}

	return time.FixedZone(strings.TrimSpace(stated), hours*60*60), nil
}

// parseTiktokOrders reads each order row. The item comes from columns, the reader's own names
// for them; the detail comes from header, verbatim, so it carries whatever this export calls
// each column.
func parseTiktokOrders(rows [][]string, header map[string]int, columns map[string]int, zone *time.Location) ([]*TiktokSettlementItem, []*TiktokSettlementDetail, error) {
	items := []*TiktokSettlementItem{}
	details := []*TiktokSettlementDetail{}

	for i := 1; i < len(rows); i++ {
		row := rows[i]

		// TikTok pads its used range with blank rows — 176 of 219 in one sample.
		if blankRow(row) || cell(row, columns, tiktokColID) == "" {
			continue
		}

		item, err := parseTiktokOrder(row, columns, zone)
		if err != nil {
			return nil, nil, fmt.Errorf("san_excel_readers: row %d: %w", i+1, err)
		}

		id, err := item.GenerateUniqueID()
		if err != nil {
			return nil, nil, err
		}

		detail := TiktokSettlementDetail{
			UniqueID: id,
			Columns:  map[string]string{},
		}
		for name := range header {
			detail.Columns[name] = cell(row, header, name)
		}

		items = append(items, item)
		details = append(details, &detail)
	}

	return items, details, nil
}

func parseTiktokOrder(row []string, columns map[string]int, zone *time.Location) (*TiktokSettlementItem, error) {
	settledAt, err := tiktokDate(cell(row, columns, tiktokColSettledAt), zone)
	if err != nil {
		return nil, fmt.Errorf("%q: %w", tiktokColSettledAt, err)
	}

	createdAt, err := tiktokDate(cell(row, columns, tiktokColCreatedAt), zone)
	if err != nil {
		return nil, fmt.Errorf("%q: %w", tiktokColCreatedAt, err)
	}

	amount, err := parseAmount(cell(row, columns, tiktokColSettlement))
	if err != nil {
		return nil, fmt.Errorf("%q: %w", tiktokColSettlement, err)
	}

	revenue, err := parseAmount(cell(row, columns, tiktokColRevenue))
	if err != nil {
		return nil, fmt.Errorf("%q: %w", tiktokColRevenue, err)
	}

	fees, err := parseAmount(cell(row, columns, tiktokColFees))
	if err != nil {
		return nil, fmt.Errorf("%q: %w", tiktokColFees, err)
	}

	item := TiktokSettlementItem{
		At:                settledAt,
		CreatedAt:         createdAt,
		TransactionType:   cell(row, columns, tiktokColType),
		OrderRefID:        cell(row, columns, tiktokColID),
		RelatedOrderRefID: notNone(cell(row, columns, tiktokColRelatedID)),
		Currency:          cell(row, columns, tiktokColCurrency),
		Amount:            amount,
		Revenue:           revenue,
		TotalFees:         fees,
		Source:            cell(row, columns, tiktokColSource),
	}

	return &item, nil
}

func parseTiktokWithdrawals(rows [][]string, zone *time.Location) ([]*TiktokWithdrawalItem, error) {
	withdrawals := []*TiktokWithdrawalItem{}
	if len(rows) == 0 {
		return withdrawals, nil
	}

	// A header the reader cannot place fails the read rather than reporting no withdrawals: an
	// empty list is a claim that no money moved.
	columns, err := tiktokColumns(tiktokSheetWithdrawals, headerOf(rows[0]), tiktokWithdrawalColumns)
	if err != nil {
		return nil, err
	}

	for i := 1; i < len(rows); i++ {
		row := rows[i]
		if blankRow(row) || cell(row, columns, tiktokColReferenceID) == "" {
			continue
		}

		requestedAt, err := tiktokDate(cell(row, columns, tiktokColRequestTime), zone)
		if err != nil {
			return nil, fmt.Errorf("san_excel_readers: withdrawal row %d: %q: %w", i+1, tiktokColRequestTime, err)
		}

		succeededAt, err := tiktokOptionalDate(cell(row, columns, tiktokColSuccessTime), zone)
		if err != nil {
			return nil, fmt.Errorf("san_excel_readers: withdrawal row %d: %q: %w", i+1, tiktokColSuccessTime, err)
		}

		amount, err := parseAmount(cell(row, columns, tiktokColAmount))
		if err != nil {
			return nil, fmt.Errorf("san_excel_readers: withdrawal row %d: %q: %w", i+1, tiktokColAmount, err)
		}

		withdrawal := TiktokWithdrawalItem{
			At:          requestedAt,
			SucceededAt: succeededAt,
			Type:        cell(row, columns, tiktokColWithdrawalType),
			ReferenceID: cell(row, columns, tiktokColReferenceID),
			Amount:      amount,
			Status:      cell(row, columns, tiktokColStatus),
		}

		withdrawals = append(withdrawals, &withdrawal)
	}

	return withdrawals, nil
}

// tiktokDate reads "2025/12/23".
//
// ⚠ TikTok gives a DATE, never a time of day — unlike Shopee, which is exact to the second.
// The time is therefore midnight in the report's own zone, and that is a property of the file,
// not a value the platform supplied.
func tiktokDate(raw string, zone *time.Location) (time.Time, error) {
	at, err := time.ParseInLocation(tiktokDateLayout, raw, zone)
	if err != nil {
		return time.Time{}, fmt.Errorf("%q is not a date", raw)
	}

	return at, nil
}

func tiktokOptionalDate(raw string, zone *time.Location) (time.Time, error) {
	if raw == "" || raw == tiktokNone {
		return time.Time{}, nil
	}

	return tiktokDate(raw, zone)
}

// notNone maps TikTok's "/" placeholder to an empty string.
func notNone(raw string) string {
	if raw == tiktokNone {
		return ""
	}

	return raw
}
