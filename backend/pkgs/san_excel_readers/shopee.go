// Package san_excel_readers parses the settlement reports that marketplace platforms
// export as spreadsheets.
//
// The reports are downloaded by hand and uploaded by hand, so a file may have been opened
// and re-saved by any spreadsheet program on the way. A reader here never assumes how a
// cell is stored — only what it says.
package san_excel_readers

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
)

// WIB is the wall clock a Shopee report is read in.
//
// The file states no timezone anywhere, so one has to be chosen, and the choice is part of
// the idempotency key: json.Marshal writes a time's OFFSET into the string that gets hashed.
// See jakarta-is-the-clock in context_decision.md.
//
// This is a fixed offset rather than time.LoadLocation("Asia/Jakarta") on purpose — Indonesia
// has had no daylight saving since 1964, so the two are identical for every date this system
// will see, and LoadLocation needs an IANA database that a stock Windows machine does not have.
var WIB = time.FixedZone("WIB", 7*60*60)

// ShopeeSettlementType is the "Tipe Transaksi" column, verbatim.
//
// The constants below are the four values measured across the sample reports. They are
// documentation, not a closed set: ShopeeFlexiExport appears exactly once in 3788 rows, so
// an unseen value is expected and is parsed rather than rejected.
type ShopeeSettlementType string

const (
	ShopeeOrderIncome ShopeeSettlementType = "Penghasilan dari Pesanan"
	ShopeeWithdrawal  ShopeeSettlementType = "Penarikan Dana"
	ShopeeAdjustment  ShopeeSettlementType = "Penyesuaian"
	ShopeeFlexiExport ShopeeSettlementType = "Program Ekspor Shopee FLEXI"
)

// Known reports whether the type is one this package has seen in a real report.
func (t ShopeeSettlementType) Known() bool {
	switch t {
	case ShopeeOrderIncome, ShopeeWithdrawal, ShopeeAdjustment, ShopeeFlexiExport:
		return true
	}
	return false
}

var (
	ErrNotShopeeReport = errors.New("san_excel_readers: not a shopee settlement report")
	ErrNoSheet         = errors.New("san_excel_readers: workbook has no sheet")
)

// ShopeeSettlementItem is one row of "Rincian Transaksi" — one movement on the seller wallet.
//
// ⚠ The fields and their json tags are the IDENTITY of the row: GenerateUniqueID hashes the
// marshalled struct, so adding, removing or renaming anything here changes every unique_id
// that has ever been generated. See hash-the-whole-struct in context_decision.md, and the
// golden test that pins the digest.
type ShopeeSettlementItem struct {
	At          time.Time            `json:"at"`           // "Tanggal Transaksi"
	Type        ShopeeSettlementType `json:"type"`         // "Tipe Transaksi"
	Description string               `json:"description"`  // "Deskripsi"
	OrderRefID  string               `json:"order_ref_id"` // "No. Pesanan", "" where the cell is "-"
	Amount      float64              `json:"amount"`       // "Jumlah", signed
	LastBalance float64              `json:"last_balance"` // "Saldo Akhir"
}

// GenerateUniqueID is the idempotency key for this row.
//
// Shopee gives no per-row identifier and does emit rows that match on date, type and amount,
// so the whole item is hashed — Deskripsi and Saldo Akhir are what separate those.
func (s *ShopeeSettlementItem) GenerateUniqueID() (string, error) {
	raw, err := json.Marshal(s)
	if err != nil {
		return "", err
	}

	sum := md5.Sum(raw)
	return hex.EncodeToString(sum[:]), nil
}

// shopeeSettlementTypes is the mapping table from context.md.
//
// It keys on "Tipe Transaksi" ALONE. That is a deliberate limit: the column is a closed
// vocabulary the platform controls, whereas "Deskripsi" is UI copy that changes without notice.
// One consequence is recorded in the clarify — a single sampled row is an AMS commission
// deduction typed "Penyesuaian", so it lands in marketplace_adjustment rather than
// external_ads_fee, and no Shopee row ever produces external_ads_fee or affiliate_fee.
//
// Every transaction type in every sample is mapped. TestShopeeSettlementTypeCoversTheSamples
// fails the day a real export carries one that is not.
var shopeeSettlementTypes = map[ShopeeSettlementType]SettlementType{
	ShopeeWithdrawal:  SettlementWithdrawal,            // 172 rows sampled
	ShopeeOrderIncome: SettlementFund,                  // 3555
	ShopeeAdjustment:  SettlementMarketplaceAdjustment, // 60
	ShopeeFlexiExport: SettlementMarketplaceProgram,    // 1
}

// SettlementType classifies the row for settlement_service.
//
// ⚠ The SIGN is not part of the classification — it rides on the amount. A withdrawal that
// FAILED is refunded by a second row, also "Penarikan Dana", with a positive amount, and both
// are withdrawal: the pair nets to zero because the changes do, not because the types differ.
// The same holds for the 34 sampled "Penghasilan dari Pesanan" rows that are negative.
//
// An unmapped type is an ERROR, never SettlementOther. Bucketing something the platform has just
// started doing into "other" is how a new behaviour gets imported silently for months — the error
// surfaces it on the first file that carries it. Every type in every sample is mapped today, so
// this path only fires on something genuinely new.
func (s *ShopeeSettlementItem) SettlementType() (SettlementType, error) {
	mapped, found := shopeeSettlementTypes[s.Type]
	if !found {
		return "", fmt.Errorf("%w: %q", ErrNoSettlementTypeMapping, s.Type)
	}

	return mapped, nil
}

// ShopeeSettlementDocument is one downloaded "Transaction Report".
//
// ⚠ It is a SLICE of the wallet ledger, not provably the whole of it: Shopee filters some
// transactions into a separate download, which shows up as a break in the Saldo Akhir chain.
type ShopeeSettlementDocument interface {
	// GetShopUsername is the "Username (Penjual)" the report was exported for.
	GetShopUsername() (string, error)
	// GetPeriod is the "Dari" and "Ke" the seller asked for, as dates in WIB.
	GetPeriod() (from time.Time, to time.Time, err error)
	// GetItems is every transaction row, in the order the file lists them (newest first).
	GetItems() ([]*ShopeeSettlementItem, error)
}

// Column and label text, as Shopee writes it.
const (
	shopeeLabelUsername = "Username (Penjual)"
	shopeeLabelFrom     = "Dari"
	shopeeLabelTo       = "Ke"

	shopeeColAt          = "Tanggal Transaksi"
	shopeeColType        = "Tipe Transaksi"
	shopeeColDescription = "Deskripsi"
	shopeeColOrderRef    = "No. Pesanan"
	shopeeColAmount      = "Jumlah"
	shopeeColBalance     = "Saldo Akhir"

	shopeeTimeLayout = "2006-01-02 15:04:05"
	shopeeDateLayout = "2006-01-02"

	// A "No. Pesanan" cell holding this means the movement has no order, not that the
	// order is called "-". See dash-is-not-a-reference in context_decision.md.
	shopeeNoOrderRef = "-"
)

type shopeeDocument struct {
	username string
	from     time.Time
	to       time.Time
	items    []*ShopeeSettlementItem
}

func (d *shopeeDocument) GetShopUsername() (string, error) {
	return d.username, nil
}

func (d *shopeeDocument) GetPeriod() (time.Time, time.Time, error) {
	return d.from, d.to, nil
}

func (d *shopeeDocument) GetItems() ([]*ShopeeSettlementItem, error) {
	return d.items, nil
}

// NewShopeeSettlementDocument reads a Shopee "Transaction Report" export.
//
// The whole file is parsed here, so a workbook that is not a Shopee report fails now rather
// than on first use.
func NewShopeeSettlementDocument(r io.Reader) (ShopeeSettlementDocument, error) {
	file, err := excelize.OpenReader(r)
	if err != nil {
		return nil, fmt.Errorf("san_excel_readers: opening workbook: %w", err)
	}
	defer file.Close()

	sheets := file.GetSheetList()
	if len(sheets) == 0 {
		return nil, ErrNoSheet
	}

	// RawCellValue keeps the stored text instead of applying the cell's number format, so a
	// locale or a format picked up from a re-save cannot change what an amount parses to.
	rows, err := file.GetRows(sheets[0], excelize.Options{RawCellValue: true})
	if err != nil {
		return nil, fmt.Errorf("san_excel_readers: reading sheet %q: %w", sheets[0], err)
	}

	header, headerAt := findShopeeHeader(rows)
	if header == nil {
		return nil, ErrNotShopeeReport
	}

	doc := &shopeeDocument{
		username: labelledValue(rows[:headerAt], shopeeLabelUsername),
	}

	doc.from, err = optionalDate(rows[:headerAt], shopeeLabelFrom)
	if err != nil {
		return nil, err
	}

	doc.to, err = optionalDate(rows[:headerAt], shopeeLabelTo)
	if err != nil {
		return nil, err
	}

	doc.items, err = parseShopeeItems(rows, header, headerAt)
	if err != nil {
		return nil, err
	}

	return doc, nil
}

// findShopeeHeader locates the "Rincian Transaksi" header by its text rather than by its row
// number. It sits at row 18 in every sample, but the preamble above it is free-form.
func findShopeeHeader(rows [][]string) (map[string]int, int) {
	for i, row := range rows {
		if len(row) == 0 || strings.TrimSpace(row[0]) != shopeeColAt {
			continue
		}

		header := map[string]int{}
		for at, cell := range row {
			name := strings.TrimSpace(cell)
			if name == "" {
				continue
			}
			header[name] = at
		}
		return header, i
	}

	return nil, -1
}

// labelledValue reads the cell beside a label in the preamble — "Username (Penjual)" in A6
// puts its value in B6.
func labelledValue(preamble [][]string, label string) string {
	for _, row := range preamble {
		if len(row) < 2 || strings.TrimSpace(row[0]) != label {
			continue
		}
		return strings.TrimSpace(row[1])
	}

	return ""
}

func optionalDate(preamble [][]string, label string) (time.Time, error) {
	raw := labelledValue(preamble, label)
	if raw == "" {
		return time.Time{}, nil
	}

	at, err := time.ParseInLocation(shopeeDateLayout, raw, WIB)
	if err != nil {
		return time.Time{}, fmt.Errorf("san_excel_readers: %q is not a date: %q", label, raw)
	}

	return at, nil
}

func parseShopeeItems(rows [][]string, header map[string]int, headerAt int) ([]*ShopeeSettlementItem, error) {
	for _, required := range []string{shopeeColType, shopeeColDescription, shopeeColOrderRef, shopeeColAmount, shopeeColBalance} {
		_, found := header[required]
		if !found {
			return nil, fmt.Errorf("%w: no %q column", ErrNotShopeeReport, required)
		}
	}

	items := []*ShopeeSettlementItem{}
	for i := headerAt + 1; i < len(rows); i++ {
		row := rows[i]

		// A sheet's used range runs past its last transaction, so blank rows are padding
		// rather than data. They are skipped, never counted.
		if blankRow(row) {
			continue
		}

		item, err := parseShopeeItem(row, header)
		if err != nil {
			// Rows are 1-based in the spreadsheet the person is looking at.
			return nil, fmt.Errorf("san_excel_readers: row %d: %w", i+1, err)
		}

		items = append(items, item)
	}

	return items, nil
}

func blankRow(row []string) bool {
	for _, cell := range row {
		if strings.TrimSpace(cell) != "" {
			return false
		}
	}

	return true
}

func parseShopeeItem(row []string, header map[string]int) (*ShopeeSettlementItem, error) {
	at, err := time.ParseInLocation(shopeeTimeLayout, cell(row, header, shopeeColAt), WIB)
	if err != nil {
		return nil, fmt.Errorf("%q is not a transaction time: %q", shopeeColAt, cell(row, header, shopeeColAt))
	}

	amount, err := parseAmount(cell(row, header, shopeeColAmount))
	if err != nil {
		return nil, fmt.Errorf("%q: %w", shopeeColAmount, err)
	}

	balance, err := parseAmount(cell(row, header, shopeeColBalance))
	if err != nil {
		return nil, fmt.Errorf("%q: %w", shopeeColBalance, err)
	}

	orderRef := cell(row, header, shopeeColOrderRef)
	if orderRef == shopeeNoOrderRef {
		orderRef = ""
	}

	item := ShopeeSettlementItem{
		At:          at,
		Type:        ShopeeSettlementType(cell(row, header, shopeeColType)),
		Description: cell(row, header, shopeeColDescription),
		OrderRefID:  orderRef,
		Amount:      amount,
		LastBalance: balance,
	}

	return &item, nil
}

// cell reads a column by its header name. A row is short when its trailing cells are empty,
// which excelize reports by truncating rather than padding.
func cell(row []string, header map[string]int, name string) string {
	at, found := header[name]
	if !found || at >= len(row) {
		return ""
	}

	return strings.TrimSpace(row[at])
}

// parseAmount reads a rupiah figure.
//
// The same report exported twice can store "8400769.00" as text and -18923082 as a number,
// so the text is parsed rather than trusted — that normalisation is what keeps
// GenerateUniqueID stable across a re-save.
func parseAmount(raw string) (float64, error) {
	if raw == "" {
		return 0, nil
	}

	amount, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, fmt.Errorf("%q is not a number", raw)
	}

	return amount, nil
}
