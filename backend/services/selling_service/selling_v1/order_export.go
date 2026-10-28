package selling_v1

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/xuri/excelize/v2"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderExportStore is where an export's file goes, and the names its rows need — other services', behind an interface
// so selling never reaches into them. Adapted at the composition root, every call made AS THE CALLER.
type OrderExportStore interface {
	// Store saves the file under the caller's team and returns an expiring download link.
	Store(ctx context.Context, teamID uint64, filename string, content []byte) (string, error)
	// TeamNames and UserNames name the rows' seller teams and creators, at most 200 ids a call. An id that does not
	// resolve is absent, and its cell is left as the id.
	TeamNames(ctx context.Context, ids []uint64) (map[uint64]string, error)
	UserNames(ctx context.Context, ids []uint64) (map[uint64]string, error)
}

// exportBatch is the rows read per step — the name lookups take at most 200 ids, and one step's rows can name 200.
const exportBatch = 200

// wib is Western Indonesia Time, UTC+7 with no daylight saving — the clock the people reading the file keep.
var wib = time.FixedZone("WIB", 7*60*60)

// OrderExport writes the list as a file (one-export-is-the-list-as-a-file): exactly the rows OrderList holds with this
// filter — scopedOrders, the status tab included — every page of them, in the reader's columns, as .xlsx. A server
// stream (code-implementation-guideline.md): every step a message, the progress on each, the link on the last.
//
// ONLY REAL DATA. A column the screen fills with an invented figure behind a ⚠ is left out: a spreadsheet cannot carry
// the mark, so an invented value would read as a fact. Each joins the file the day its field exists — as the tracking
// number, the frozen warehouse fee, the platform's two dates and the buyer's username have.
func (s *Service) OrderExport(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderExportRequest],
	stream *connect.ServerStream[sellingv1.OrderExportResponse],
) error {
	if s.exports == nil {
		return connect.NewError(connect.CodeUnimplemented, fmt.Errorf("no export store is configured"))
	}

	teamID := req.Msg.GetTeamId()
	filter := req.Msg.GetFilter()
	view := req.Msg.GetView()

	out := &exportStream{stream: stream}
	logger := slog.New(slog.NewTextHandler(out, &slog.HandlerOptions{ReplaceAttr: dropTime}))

	base := func() *gorm.DB {
		query := scopedOrders(s.db.WithContext(ctx).Model(&selling_service_models.Order{}), teamID, filter)

		if status := orderStatusToText(filter.GetStatus()); status != "" {
			query = query.Where("status = ?", status)
		}

		// The ticked rows, when the bar exports a selection (the-bulk-actions-are-always-on-screen).
		if ids := req.Msg.GetOrderIds(); len(ids) > 0 {
			query = query.Where("id IN ?", ids)
		}

		return query
	}

	err := base().Count(&out.total).Error
	if err != nil {
		return dbError(err)
	}

	logger.Info("exporting orders", "rows", out.total)

	sheet := newExportSheet(view)

	defer func() {
		_ = sheet.file.Close()
	}()

	// KEYSET, newest first: `id < last` never skips or repeats a row while orders are placed during the export.
	last := uint64(math.MaxInt64)

	for {
		var orders []selling_service_models.Order

		err = base().
			Select("orders.*, (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = orders.id) AS item_quantity").
			Where("id < ?", last).
			Order("id DESC").
			Limit(exportBatch).
			Find(&orders).
			Error
		if err != nil {
			return dbError(err)
		}

		if len(orders) == 0 {
			break
		}

		names, err := s.exportNames(ctx, orders)
		if err != nil {
			return connect.NewError(connect.CodeInternal, fmt.Errorf("naming the rows: %w", err))
		}

		for i := range orders {
			err = sheet.write(&orders[i], names)
			if err != nil {
				return connect.NewError(connect.CodeInternal, fmt.Errorf("writing the file: %w", err))
			}
		}

		out.done += int64(len(orders))
		last = orders[len(orders)-1].ID

		logger.Info("rows written", "done", out.done, "of", out.total)
	}

	content, err := sheet.bytes()
	if err != nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("writing the file: %w", err))
	}

	filename := "orders-" + time.Now().In(wib).Format("2006-01-02-150405") + ".xlsx"

	url, err := s.exports.Store(ctx, teamID, filename, content)
	if err != nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("storing the file: %w", err))
	}

	return stream.Send(&sellingv1.OrderExportResponse{
		Message:     "the file is ready",
		Done:        out.done,
		Total:       out.total,
		DownloadUrl: url,
		Filename:    filename,
	})
}

// exportRowNames is what one step's rows are named with: shops (this service's own table), seller teams and creators
// (other services', through the store).
type exportRowNames struct {
	shops map[uint64]selling_service_models.Shop
	teams map[uint64]string
	users map[uint64]string
}

func (s *Service) exportNames(ctx context.Context, orders []selling_service_models.Order) (exportRowNames, error) {
	shopIDs, teamIDs, userIDs := idSet{}, idSet{}, idSet{}

	for i := range orders {
		shopIDs.add(orders[i].ShopID)
		teamIDs.add(orders[i].TeamID)
		userIDs.add(orders[i].CreatedByUserID)
	}

	names := exportRowNames{shops: map[uint64]selling_service_models.Shop{}}

	var shops []selling_service_models.Shop

	err := s.db.WithContext(ctx).Where("id IN ?", shopIDs.list()).Find(&shops).Error
	if err != nil {
		return names, err
	}

	for _, shop := range shops {
		names.shops[shop.ID] = shop
	}

	names.teams, err = s.exports.TeamNames(ctx, teamIDs.list())
	if err != nil {
		return names, err
	}

	names.users, err = s.exports.UserNames(ctx, userIDs.list())

	return names, err
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

// exportSheet is the file being written, in one view's columns.
type exportSheet struct {
	file   *excelize.File
	writer *excelize.StreamWriter
	view   sellingv1.OrderExportView
	row    int
}

// The reader's own row, as on screen — real fields only (see OrderExport).
var (
	sellerColumns = []string{
		"Order ID", "Marketplace ref", "Shop", "Marketplace", "Status", "Created", "Created by",
		"Customer", "Buyer username", "Phone", "Courier", "Tracking number", "Qty", "Goods cost", "Warehouse fee",
		"Platform total", "Marketplace date", "Ship-by",
	}
	warehouseColumns = []string{
		"Order ID", "Created", "Created by", "Seller", "Shop", "Marketplace", "Marketplace ref", "Courier",
		"Tracking number", "Qty", "Status", "Marketplace date", "Ship-by",
	}
)

func newExportSheet(view sellingv1.OrderExportView) *exportSheet {
	file := excelize.NewFile()
	writer, _ := file.NewStreamWriter("Sheet1")

	sheet := &exportSheet{file: file, writer: writer, view: view, row: 1}

	columns := sellerColumns
	if view == sellingv1.OrderExportView_ORDER_EXPORT_VIEW_WAREHOUSE {
		columns = warehouseColumns
	}

	header := make([]any, len(columns))
	for i, name := range columns {
		header[i] = name
	}

	_ = sheet.next(header)

	return sheet
}

func (s *exportSheet) next(values []any) error {
	cell, err := excelize.CoordinatesToCellName(1, s.row)
	if err != nil {
		return err
	}

	s.row++

	return s.writer.SetRow(cell, values)
}

// write adds one order. Ids, refs and phone numbers are written as TEXT — a string value stays a string cell — so
// `0812…` keeps its 0 and a long marketplace id never becomes 5.78E+17. A money figure of 0 means "not recorded" and
// is left empty rather than written as a price of nothing.
func (s *exportSheet) write(order *selling_service_models.Order, names exportRowNames) error {
	shop := names.shops[order.ShopID]
	created := order.CreatedAt.In(wib).Format("2006-01-02 15:04")
	creator := nameOr(names.users, order.CreatedByUserID)

	if s.view == sellingv1.OrderExportView_ORDER_EXPORT_VIEW_WAREHOUSE {
		return s.next([]any{
			strconv.FormatUint(order.ID, 10),
			created,
			creator,
			nameOr(names.teams, order.TeamID),
			shop.Name,
			shop.Marketplace,
			order.OrderExternalRefID,
			order.ShippingCode,
			order.Receipt,
			order.ItemQuantity,
			order.Status,
			momentOrEmpty(order.PlatformCreatedAt),
			momentOrEmpty(order.PlatformShipmentDeadline),
		})
	}

	return s.next([]any{
		strconv.FormatUint(order.ID, 10),
		order.OrderExternalRefID,
		shop.Name,
		shop.Marketplace,
		order.Status,
		created,
		creator,
		order.CustomerName,
		// Beside the customer, as the detail shows it — blank when there is none (the-buyers-username-is-optional).
		order.BuyerUsername,
		order.CustomerPhone,
		order.ShippingCode,
		order.Receipt,
		order.ItemQuantity,
		moneyOrEmpty(order.GoodsCost),
		feeOrEmpty(order.WarehouseFee),
		moneyOrEmpty(order.PlatformTotal),
		momentOrEmpty(order.PlatformCreatedAt),
		momentOrEmpty(order.PlatformShipmentDeadline),
	})
}

// momentOrEmpty writes one of the platform's dates in the readers' own clock, and a date never recorded as an empty
// cell rather than as 1970.
func momentOrEmpty(t *time.Time) string {
	if t == nil {
		return ""
	}

	return t.In(wib).Format("2006-01-02 15:04")
}

// feeOrEmpty writes a frozen fee as it was frozen, and an order never priced as an empty cell — never a 0, which would
// read as a warehouse that charged nothing.
func feeOrEmpty(fee *float64) any {
	if fee == nil {
		return ""
	}

	return *fee
}

func (s *exportSheet) bytes() ([]byte, error) {
	err := s.writer.Flush()
	if err != nil {
		return nil, err
	}

	buf, err := s.file.WriteToBuffer()
	if err != nil {
		return nil, err
	}

	return buf.Bytes(), nil
}

// nameOr is the name, or the id when it did not resolve — never an empty cell for a person who exists. An id of 0 is
// "not recorded" and stays empty.
func nameOr(names map[uint64]string, id uint64) string {
	if id == 0 {
		return ""
	}

	name := names[id]
	if name == "" {
		return strconv.FormatUint(id, 10)
	}

	return name
}

// moneyOrEmpty leaves a 0 — "not recorded" — as an empty cell.
func moneyOrEmpty(rupiah int64) any {
	if rupiah == 0 {
		return ""
	}

	return rupiah
}

// exportStream is the guideline's binding of slog to the stream: every log line is a message, carrying the progress.
type exportStream struct {
	stream      *connect.ServerStream[sellingv1.OrderExportResponse]
	done, total int64
}

// Write implements io.Writer.
func (w *exportStream) Write(p []byte) (int, error) {
	err := w.stream.Send(&sellingv1.OrderExportResponse{
		Message: strings.TrimSpace(string(p)),
		Done:    w.done,
		Total:   w.total,
	})

	return len(p), err
}

// dropTime keeps the time out of a message line — the screen shows its own clock.
func dropTime(_ []string, a slog.Attr) slog.Attr {
	if a.Key == slog.TimeKey {
		return slog.Attr{}
	}

	return a
}
