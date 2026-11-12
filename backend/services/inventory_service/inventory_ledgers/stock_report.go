package inventory_ledgers

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// THE STOCK TRANSACTION AND ITS REPORTS (docs/business/analytic/rpc_provide_decision.md —
// ready-stock-is-folded-in-the-stock-changes-own-step: "every stock change … writes its daily change row in its own
// transaction … the report rows are the transaction's LAST locks").
//
// Every `batch_logs` row is written by one of three functions here — MintBatches, BatchWrites.Flush and Revalue — and
// each NOTES what it wrote on the transaction's StockReport: the units and value per (warehouse, owner, product,
// supplier, change type). A restock or return accept also notes its door rows (NoteDoor). StockTransaction then writes
// both reports as the transaction's last statements, each ONE multi-row upsert in key order:
//
//	inventory_door_daily_reports   — broken / missing at a restock's or a return's door
//	inventory_stock_daily_changes  — every change, netted per day, key and type: Restock, Transfer, Returned stock and
//	                                  Ready stock all read it
//
// A ledger write OUTSIDE a StockTransaction is refused (ErrNoStockReport): a new stock writer cannot skip the report by
// forgetting it — its first test fails instead. So Σ change_count / change_value = Σ batch_logs per key and day, by
// construction, and the logs and the report share one clock (the transaction's `now`, stamped on every log row it
// writes), so a transaction spanning midnight still lands on one day in both.
//
// CONCURRENCY: each upsert's conflict takes the existing row's lock and adds — two writers into one row queue and
// neither is lost. Keys are summed first (a statement may not touch a row twice) and written sorted, so two
// transactions touching several rows take them in the same order; the door rows come before the change rows, always;
// and nothing locks anything after them (lock-order.md).

// ErrNoStockReport is a ledger write made outside StockTransaction — its change would be missing from the report.
var ErrNoStockReport = errors.New("a stock change outside a stock transaction (inventory_ledgers.StockTransaction)")

// reportDayLayout is a Jakarta day as the reports key it (a-day-is-a-jakarta-date-string).
const reportDayLayout = "2006-01-02"

// reportBatchSize keeps a multi-row upsert well under Postgres's 65 535 parameters (8 per row).
const reportBatchSize = 1000

// The door sources.
const (
	DoorRestock = "restock"
	DoorReturn  = "return"
)

type stockReportKey struct{}

type stockNowKey struct{}

// WithNow sets the clock a StockTransaction reads — its day and its log rows' time. Production never sets it (the
// transaction reads time.Now()); a test that walks a transfer across days does.
func WithNow(ctx context.Context, now time.Time) context.Context {
	return context.WithValue(ctx, stockNowKey{}, now)
}

func nowOf(ctx context.Context) time.Time {
	now, ok := ctx.Value(stockNowKey{}).(time.Time)
	if ok {
		return now
	}

	return time.Now()
}

// NowOf is the clock a stock transaction or a stock report read takes from ctx: time.Now(), or a test's WithNow.
func NowOf(ctx context.Context) time.Time {
	return nowOf(ctx)
}

// TxNow is the time of the stock transaction tx runs in — the day its report rows and log rows land on — or time.Now()
// outside one. A status a stock transaction moves (a transfer's accept, its cancel) is stamped with it, so the status's
// day and the stock's day are one day even across midnight.
func TxNow(tx *gorm.DB) time.Time {
	report := reportOf(tx)
	if report != nil {
		return report.now
	}

	return time.Now()
}

// ChangeKey is one inventory_stock_daily_changes row's identity, the day aside.
type ChangeKey struct {
	WarehouseID uint64
	TeamID      uint64
	ProductID   uint64
	SupplierID  uint64
	ChangeType  string
}

// ChangeSum is what a transaction moved under one key.
type ChangeSum struct {
	Count int64
	Value float64
}

// DoorKey is one inventory_door_daily_reports row's identity, the day aside.
type DoorKey struct {
	WarehouseID uint64
	TeamID      uint64
	ProductID   uint64
	SupplierID  uint64
	Source      string
}

// DoorSum is what a door found under one key.
type DoorSum struct {
	Broken  int64
	Missing int64
}

// StockReport is ONE stock transaction's report rows, gathered in memory until StockTransaction writes them.
type StockReport struct {
	now     time.Time
	changes map[ChangeKey]*ChangeSum
	door    map[DoorKey]*DoorSum
}

// Now is the transaction's time — the day its rows land on.
func (r *StockReport) Now() time.Time {
	return r.now
}

// Changes is what the transaction has noted so far, by key — read by tests and by nothing else.
func (r *StockReport) Changes() map[ChangeKey]ChangeSum {
	out := make(map[ChangeKey]ChangeSum, len(r.changes))
	for k, v := range r.changes {
		out[k] = *v
	}

	return out
}

func newStockReport(now time.Time) *StockReport {
	return &StockReport{now: now, changes: map[ChangeKey]*ChangeSum{}, door: map[DoorKey]*DoorSum{}}
}

func reportOf(tx *gorm.DB) *StockReport {
	ctx := tx.Statement.Context
	if ctx == nil {
		return nil
	}

	report, _ := ctx.Value(stockReportKey{}).(*StockReport)

	return report
}

// ReportOf is the transaction's StockReport, nil outside a StockTransaction.
func ReportOf(tx *gorm.DB) *StockReport {
	return reportOf(tx)
}

// StockTransaction runs fn in ONE database transaction that may change stock, then writes the stock reports as its last
// statements. Every handler that moves a batch runs in one. Called inside another StockTransaction (one context), it is
// a plain nested transaction sharing the outer report, which the outer writes.
func StockTransaction(db *gorm.DB, fn func(tx *gorm.DB) error) error {
	if reportOf(db) != nil {
		return db.Transaction(fn)
	}

	return db.Transaction(func(tx *gorm.DB) error {
		ctx := tx.Statement.Context
		if ctx == nil {
			ctx = context.Background()
		}

		report := newStockReport(nowOf(ctx))

		tx = tx.WithContext(context.WithValue(ctx, stockReportKey{}, report))

		err := fn(tx)
		if err != nil {
			return err
		}

		return report.write(tx)
	})
}

// noteLogs adds written log rows to the report and stamps each with the transaction's time. `batchOf` names each row's
// batch — its product and supplier, which the log row does not carry.
func noteLogs(tx *gorm.DB, logs []inventory_service_models.BatchLog, batchOf func(id uint64) *inventory_service_models.Batch) error {
	report := reportOf(tx)
	if report == nil {
		return ErrNoStockReport
	}

	for i := range logs {
		l := &logs[i]
		l.CreatedAt = report.now

		b := batchOf(l.BatchID)
		if b == nil {
			return fmt.Errorf("stock report: batch %d of a log row was not read", l.BatchID)
		}

		key := ChangeKey{
			WarehouseID: l.WarehouseID, TeamID: l.TeamID, ProductID: b.ProductID, SupplierID: b.SupplierID,
			ChangeType: l.ChangeType,
		}

		sum := report.changes[key]
		if sum == nil {
			sum = &ChangeSum{}
			report.changes[key] = sum
		}

		sum.Count += l.ChangeCount
		sum.Value += l.ChangeValuation
	}

	return nil
}

// DoorRow is units a restock's or a return's door found broken or missing — never stock.
type DoorRow struct {
	WarehouseID uint64
	TeamID      uint64
	ProductID   uint64
	SupplierID  uint64
	Source      string
	Broken      int64
	Missing     int64
}

// NoteDoor adds door rows to the transaction's report; a row with neither broken nor missing is skipped.
func NoteDoor(tx *gorm.DB, rows ...DoorRow) error {
	report := reportOf(tx)
	if report == nil {
		return ErrNoStockReport
	}

	for _, r := range rows {
		if r.Broken <= 0 && r.Missing <= 0 {
			continue
		}

		key := DoorKey{
			WarehouseID: r.WarehouseID, TeamID: r.TeamID, ProductID: r.ProductID, SupplierID: r.SupplierID, Source: r.Source,
		}

		sum := report.door[key]
		if sum == nil {
			sum = &DoorSum{}
			report.door[key] = sum
		}

		sum.Broken += max(r.Broken, 0)
		sum.Missing += max(r.Missing, 0)
	}

	return nil
}

// write is the transaction's last statements: the door rows, then the change rows — each sorted, each one upsert per
// thousand keys.
func (r *StockReport) write(tx *gorm.DB) error {
	day := r.now.In(wib).Format(reportDayLayout)

	err := r.writeDoor(tx, day)
	if err != nil {
		return err
	}

	return r.writeChanges(tx, day)
}

func (r *StockReport) writeDoor(tx *gorm.DB, day string) error {
	keys := make([]DoorKey, 0, len(r.door))
	for k := range r.door {
		keys = append(keys, k)
	}

	slices.SortFunc(keys, func(a, b DoorKey) int {
		return cmp.Or(
			cmp.Compare(a.WarehouseID, b.WarehouseID),
			cmp.Compare(a.TeamID, b.TeamID),
			cmp.Compare(a.ProductID, b.ProductID),
			cmp.Compare(a.SupplierID, b.SupplierID),
			cmp.Compare(a.Source, b.Source),
		)
	})

	for start := 0; start < len(keys); start += reportBatchSize {
		chunk := keys[start:min(start+reportBatchSize, len(keys))]

		values := make([]string, 0, len(chunk))
		args := make([]any, 0, len(chunk)*8)

		for _, k := range chunk {
			s := r.door[k]
			values = append(values, "(CAST(? AS date), ?, ?, ?, ?, ?, ?, ?, NOW())")
			args = append(args, day, k.WarehouseID, k.TeamID, k.ProductID, k.SupplierID, k.Source, s.Broken, s.Missing)
		}

		err := tx.Exec(`
INSERT INTO inventory_door_daily_reports
    (day, warehouse_id, team_id, product_id, supplier_id, source, broken_count, missing_count, last_updated)
VALUES `+strings.Join(values, ", ")+`
ON CONFLICT (day, warehouse_id, team_id, product_id, supplier_id, source) DO UPDATE SET
    broken_count  = inventory_door_daily_reports.broken_count + EXCLUDED.broken_count,
    missing_count = inventory_door_daily_reports.missing_count + EXCLUDED.missing_count,
    last_updated  = NOW()`, args...).Error
		if err != nil {
			return fmt.Errorf("door report: %w", err)
		}
	}

	return nil
}

func (r *StockReport) writeChanges(tx *gorm.DB, day string) error {
	keys := make([]ChangeKey, 0, len(r.changes))

	for k, s := range r.changes {
		// A key the transaction moved and moved back (or a revaluation of a batch with no units) changes nothing.
		if s.Count == 0 && s.Value == 0 {
			continue
		}

		keys = append(keys, k)
	}

	slices.SortFunc(keys, func(a, b ChangeKey) int {
		return cmp.Or(
			cmp.Compare(a.WarehouseID, b.WarehouseID),
			cmp.Compare(a.TeamID, b.TeamID),
			cmp.Compare(a.ProductID, b.ProductID),
			cmp.Compare(a.SupplierID, b.SupplierID),
			cmp.Compare(a.ChangeType, b.ChangeType),
		)
	})

	for start := 0; start < len(keys); start += reportBatchSize {
		chunk := keys[start:min(start+reportBatchSize, len(keys))]

		values := make([]string, 0, len(chunk))
		args := make([]any, 0, len(chunk)*8)

		for _, k := range chunk {
			s := r.changes[k]
			// The exact double the log rows sum to (the-backend-never-rounds-money) — no numeric cast, no rounding.
			values = append(values, "(CAST(? AS date), ?, ?, ?, ?, ?, ?, CAST(? AS double precision), NOW())")
			args = append(args, day, k.WarehouseID, k.TeamID, k.ProductID, k.SupplierID, k.ChangeType, s.Count, s.Value)
		}

		err := tx.Exec(`
INSERT INTO inventory_stock_daily_changes
    (day, warehouse_id, team_id, product_id, supplier_id, change_type, change_count, change_value, last_updated)
VALUES `+strings.Join(values, ", ")+`
ON CONFLICT (day, warehouse_id, team_id, product_id, supplier_id, change_type) DO UPDATE SET
    change_count = inventory_stock_daily_changes.change_count + EXCLUDED.change_count,
    change_value = inventory_stock_daily_changes.change_value + EXCLUDED.change_value,
    last_updated = NOW()`, args...).Error
		if err != nil {
			return fmt.Errorf("stock change report: %w", err)
		}
	}

	return nil
}
