package settlement_importer_v1

import (
	"bytes"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_excel_readers"
)

// THE IMPORTER'S POLICY over the Excel Reader (the-excel-reader-reads-every-statement). The reader stays a
// function; what to skip, which ref finds an order, the key's prefix, whole rupiah and the affiliate split
// are decided here.

// statement is a file, read: its own range, and every line it yields, in the order read.
type statement struct {
	periodFrom time.Time // zero when the file states none
	periodTo   time.Time
	records    []record
}

// record is one line a statement yields, and what the importer has already decided about it.
type record struct {
	sheet string

	// THE KEY — <platform>:<sheet>:<GenerateUniqueID()> (the-row-key-is-the-only-dedupe). A TikTok
	// commission is its order row's key plus ":affiliate_fee".
	key string

	// The ref that finds the order — Shopee's No. Pesanan, TikTok's Related order ID
	// (a-tiktok-row-finds-its-order-by-related-order-id). "" = the shop.
	orderRef string

	platformType string
	description  string

	// What it posts as. UNSPECIFIED when the platform's type is not mapped.
	settlementType settlementv1.SettlementType
	change         int64
	occurredOn     time.Time

	// Set when the line must NOT post: held (it cannot, yet) or skipped (it must not, by decision).
	outcome string
	reason  string
	detail  string
}

// errNotThisStatement is a file refused as a whole at extraction — the row reads FAILED, nothing posted,
// the stored file kept (the-excel-reader-reads-every-statement).
type errNotThisStatement struct{ message string }

func (e errNotThisStatement) Error() string { return e.message }

func refuse(format string, args ...any) error {
	return errNotThisStatement{message: fmt.Sprintf(format, args...)}
}

// statementReader turns a file's bytes into its lines.
type statementReader func(content []byte) (statement, error)

// ── Shopee ─────────────────────────────────────────────────────────────────────────────────────────

const (
	shopeeSheet = "Rincian Transaksi"
	shopeeKey   = "shopee:rincian_transaksi:"

	// The one Status a withdrawal is recorded under (only-a-successful-withdrawal-is-recorded).
	shopeeCompleted = "Transaksi Selesai"
)

// readShopee reads a Shopee "Transaction Report".
//
// ⚠ ONLY A SUCCESSFUL WITHDRAWAL IS RECORDED. A "Penarikan Dana" posts only when it completed AND money
// left — a Gagal debit is skipped, and so is the refund that returns it, itself "Transaksi Selesai" but
// money coming back. Skipping only the Gagal row would keep the refund and read the shop richer for good.
func readShopee(content []byte) (statement, error) {
	doc, err := san_excel_readers.NewShopeeSettlementDocument(bytes.NewReader(content))
	if err != nil {
		return statement{}, refuse("This is not a Shopee statement — %v", err)
	}

	out := statement{}

	out.periodFrom, out.periodTo, err = doc.GetPeriod()
	if err != nil {
		return statement{}, refuse("The statement's period cannot be read — %v", err)
	}

	items, err := doc.GetItems()
	if err != nil {
		return statement{}, refuse("The statement's rows cannot be read — %v", err)
	}

	details, err := doc.GetDetails()
	if err != nil || len(details) != len(items) {
		return statement{}, refuse("The statement's rows cannot be read — %v", err)
	}

	for i, item := range items {
		id, err := item.GenerateUniqueID()
		if err != nil {
			return statement{}, err
		}

		rec := record{
			sheet:        shopeeSheet,
			key:          shopeeKey + id,
			orderRef:     item.OrderRefID,
			platformType: string(item.Type),
			description:  item.Description,
			occurredOn:   item.At.In(san_excel_readers.WIB),
		}

		if item.Type == san_excel_readers.ShopeeWithdrawal &&
			(details[i].Status != shopeeCompleted || item.Amount >= 0) {
			rec.skip(reasonFailedWithdrawal, fmt.Sprintf("%s, %s", details[i].Status, details[i].Direction))
		}

		rec.classify(item.SettlementType())
		rec.amount(item.Amount)

		out.records = append(out.records, rec)
	}

	return out, nil
}

// ── TikTok ─────────────────────────────────────────────────────────────────────────────────────────

const (
	tiktokOrdersSheet      = "Order details"
	tiktokWithdrawalsSheet = "Withdrawal records"
	tiktokOrdersKey        = "tiktok:order_details:"
	tiktokWithdrawalsKey   = "tiktok:withdrawal_records:"

	// The commission's own row — its order row's key plus this (tiktok-affiliate-commission-posts-as-affiliate-fee).
	affiliateKeySuffix = ":affiliate_fee"
	// Every column whose header starts with it is commission — my proposal, so a new column in the family
	// is counted rather than left inside the fund.
	affiliatePrefix = "Affiliate"

	tiktokOrderType   = "Order"
	tiktokTransferred = "Transferred"
	tiktokWithdrawal  = "withdrawal"
)

// tiktokRepeats are the "Withdrawal records" types that repeat money the order rows already carry:
// Earnings is Order details totalled per day, and GMV Pay Deduction equals the GMV Payment for TikTok Ads
// rows to the rupiah (critique 6). Skipped — never held, since nothing would ever post them.
var tiktokRepeats = map[string]bool{
	"earnings":          true,
	"gmv pay deduction": true,
}

// readTiktok reads a TikTok settlement export — its Order details and Withdrawal records.
func readTiktok(content []byte) (statement, error) {
	doc, err := san_excel_readers.NewTiktokSettlementDocument(bytes.NewReader(content))
	if err != nil {
		return statement{}, refuse("This is not a TikTok statement — %v", err)
	}

	currency, _ := doc.GetCurrency()
	if !strings.EqualFold(strings.TrimSpace(currency), "IDR") {
		return statement{}, refuse("This statement is in %q — only rupiah (IDR) statements are imported", currency)
	}

	out := statement{}

	out.periodFrom, out.periodTo, err = doc.GetPeriod()
	if err != nil {
		return statement{}, refuse("The statement's period cannot be read — %v", err)
	}

	items, _ := doc.GetItems()
	details, _ := doc.GetDetails()

	if len(details) != len(items) {
		return statement{}, refuse("The statement's order rows cannot be read")
	}

	// ⚠ A FILE WITH NO AFFILIATE COLUMN IS REFUSED (my proposal). Posted whole, its fund would carry the
	// commission already — and a later download that has the column would add an affiliate_fee beside
	// it, under a key that is new: the commission taken twice.
	if len(items) > 0 && len(affiliateColumns(details[0].Columns)) == 0 {
		return statement{}, refuse("This TikTok statement has no Affiliate commission column — download it again from TikTok")
	}

	for i, item := range items {
		id, err := item.GenerateUniqueID()
		if err != nil {
			return statement{}, err
		}

		rec := record{
			sheet:        tiktokOrdersSheet,
			key:          tiktokOrdersKey + id,
			orderRef:     item.RelatedOrderRefID,
			platformType: item.TransactionType,
			description:  tiktokDescription(item.TransactionType, item.OrderRefID),
			occurredOn:   item.At,
		}

		rec.classify(item.SettlementType())

		if !strings.EqualFold(item.TransactionType, tiktokOrderType) {
			rec.amount(item.Amount)
			out.records = append(out.records, rec)

			continue
		}

		// AN ORDER ROW: its affiliate commission is its own row, and the fund carries the payout before it,
		// so the two still sum to TikTok's Total settlement amount.
		commission, err := affiliateCommission(details[i].Columns)
		if err != nil {
			return statement{}, refuse("Order %s: %v", item.OrderRefID, err)
		}

		rec.amount(item.Amount - commission)
		out.records = append(out.records, rec)

		if commission == 0 {
			continue
		}

		fee := record{
			sheet:          tiktokOrdersSheet,
			key:            rec.key + affiliateKeySuffix,
			orderRef:       item.RelatedOrderRefID,
			platformType:   "Affiliate commission",
			description:    "Affiliate commission — " + item.OrderRefID,
			settlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_AFFILIATE_FEE,
			occurredOn:     item.At,
		}
		fee.amount(commission)

		// The two rows are one order's payout split in two — a fund that cannot post holds its commission
		// with it, so the pair never lands half-posted.
		if rec.outcome == outcomeHeld {
			fee.hold(rec.reason, rec.detail)
		}

		out.records = append(out.records, fee)
	}

	withdrawals, _ := doc.GetWithdrawals()

	for _, w := range withdrawals {
		id, err := w.GenerateUniqueID()
		if err != nil {
			return statement{}, err
		}

		rec := record{
			sheet:        tiktokWithdrawalsSheet,
			key:          tiktokWithdrawalsKey + id,
			platformType: w.Type,
			description:  w.ReferenceID,
			occurredOn:   w.At,
		}

		switch kind := strings.ToLower(strings.TrimSpace(w.Type)); {
		case tiktokRepeats[kind]:
			rec.skip(reasonRepeatsOrderDetails, "")
		case kind == tiktokWithdrawal && !strings.EqualFold(w.Status, tiktokTransferred):
			rec.skip(reasonFailedWithdrawal, w.Status)
		}

		rec.classify(w.SettlementType())
		rec.amount(w.Amount)

		out.records = append(out.records, rec)
	}

	return out, nil
}

func tiktokDescription(transactionType, orderID string) string {
	if orderID == "" {
		return transactionType
	}

	return transactionType + " — " + orderID
}

// affiliateColumns is every header of the family, in the file's spelling.
func affiliateColumns(columns map[string]string) []string {
	out := []string{}
	for name := range columns {
		if strings.HasPrefix(name, affiliatePrefix) {
			out = append(out, name)
		}
	}

	return out
}

// affiliateCommission sums an order row's Affiliate columns — negative, as the file writes a charge.
func affiliateCommission(columns map[string]string) (float64, error) {
	total := 0.0

	for _, name := range affiliateColumns(columns) {
		raw := strings.TrimSpace(columns[name])
		if raw == "" || raw == "/" {
			continue
		}

		amount, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			return 0, fmt.Errorf("its %q is not a number: %q", name, raw)
		}

		total += amount
	}

	return total, nil
}

// ── Decisions about one line ───────────────────────────────────────────────────────────────────────

// skip marks a line that must not post, by decision. The first decision about a line stands.
func (r *record) skip(reason, detail string) {
	if r.outcome != "" {
		return
	}

	r.outcome = outcomeSkipped
	r.reason = reason
	r.detail = detail
}

func (r *record) hold(reason, detail string) {
	if r.outcome != "" {
		return
	}

	r.outcome = outcomeHeld
	r.reason = reason
	r.detail = detail
}

// classify takes the reader's type. A type nobody mapped is HELD, never guessed — the same file again
// posts it once the mapping ships (the-row-key-is-the-only-dedupe).
func (r *record) classify(settlementType san_excel_readers.SettlementType, err error) {
	if err != nil {
		if errors.Is(err, san_excel_readers.ErrNoSettlementTypeMapping) {
			r.hold(reasonUnmappedType, r.platformType)

			return
		}

		r.hold(reasonUnmappedType, err.Error())

		return
	}

	mapped, ok := settlementTypeEnum[settlementType]
	if !ok {
		r.hold(reasonUnmappedType, string(settlementType))

		return
	}

	r.settlementType = mapped
}

// amount converts to whole rupiah, or HOLDS the line — a fraction is never rounded (critique 8).
func (r *record) amount(value float64) {
	change, ok := wholeRupiah(value)
	if !ok {
		r.hold(reasonFractionalAmount, strconv.FormatFloat(value, 'f', -1, 64))

		return
	}

	r.change = change
}
