package inventory_v1

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_export"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// restockExportColumns are the selling list's columns, in the screen's order (the-restock-list-leads-with-its-references):
// its Referensi cell's two references, each its own column; where it was bought; where it went; what is in it; what it
// cost; who carries it; where it has got to; and its two dates, each with who did it beside it. The row's actions are
// not data and stay out.
var restockExportColumns = []string{
	"Order ID", "Resi", "Pemasok", "Gudang", "Produk", "Total", "Kurir", "Status", "Dibuat", "Dibuat oleh", "Diterima",
	"Diterima oleh",
}

// RestockRequestExport writes the selling restock list as a file (the-restock-list-exports-and-filters-by-courier, on
// one-export-is-the-list-as-a-file and a-report-export-is-the-whole-view-as-a-file): exactly the restocks
// RestockRequestList holds with this filter — THE LIST'S ONE PREDICATE (restockListScope), the status tab, the courier
// and every other filter included — every page of them, in the list's order, in the screen's columns, as .xlsx. A
// server stream: every step a message with the progress, the expiring link to the stored file on the last.
//
// The raising side only, as the list's statistics read it (RestockSellingStat): `team_id` = the caller's team. A
// selling team is never a restock's warehouse, so for one this narrows nothing the list shows; for any other team it
// keeps the warehouse side's restocks — and their money — out of the file (the-warehouse-sees-the-cod-it-paid).
//
// Per step of 200 restocks: their lines (one query, as the list preloads them), who acted from outside the team (the
// list's one trail lookup), and the names other services hold — the lines' suppliers and stores, the warehouses, the
// couriers and the people — through the ExportStore, by id, as the caller.
func (s *Service) RestockRequestExport(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestExportRequest],
	stream *connect.ServerStream[inventoryv1.RestockRequestExportResponse],
) error {
	if s.exports == nil {
		return connect.NewError(connect.CodeUnimplemented, errNoExportStore)
	}

	teamID := req.Msg.GetTeamId()
	filter := req.Msg.GetFilter()
	db := s.db.WithContext(ctx)

	// The list's set, the raising side only.
	base := func() *gorm.DB {
		return restockListScope(db, teamID, filter).
			Where("restocks.team_id = ?", teamID)
	}

	progress := san_export.NewProgress(func(message string, done, total int64) error {
		return stream.Send(&inventoryv1.RestockRequestExportResponse{Message: message, Done: done, Total: total})
	})

	err := base().
		Count(&progress.Total).
		Error
	if err != nil {
		return restockErr(err)
	}

	progress.Info("exporting restocks", "rows", progress.Total)

	err = progress.Err()
	if err != nil {
		return err
	}

	book, err := san_export.NewWorkbook()
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}
	defer book.Close()

	sheet, err := book.Sheet("Restok", restockExportColumns)
	if err != nil {
		return connect.NewError(connect.CodeInternal, err)
	}

	// KEYSET in the list's order, newest first: `id < last` never skips or repeats a restock raised while the file is
	// being written (OrderExport's walk).
	last := uint64(math.MaxInt64)

	for {
		var rows []inventory_service_models.Restock

		err = base().
			Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
			Where("restocks.id < ?", last).
			Order("id DESC").
			Limit(san_export.Batch).
			Find(&rows).
			Error
		if err != nil {
			return restockErr(err)
		}

		if len(rows) == 0 {
			break
		}

		// The by-lines' "by Root team" (an-override-shows-a-platform-badge) — the list's own one lookup per page.
		overrides, err := restockStepOverrides(db, rows)
		if err != nil {
			return restockErr(err)
		}

		names, err := s.restockExportNames(ctx, teamID, rows)
		if err != nil {
			return connect.NewError(connect.CodeInternal, fmt.Errorf("naming the rows: %w", err))
		}

		for i := range rows {
			err = sheet.Row(restockExportRow(&rows[i], overrides[rows[i].ID], names)...)
			if err != nil {
				return connect.NewError(connect.CodeInternal, fmt.Errorf("writing the file: %w", err))
			}
		}

		progress.Done += int64(len(rows))
		last = rows[len(rows)-1].ID

		progress.Info("rows written", "done", progress.Done, "of", progress.Total)

		err = progress.Err()
		if err != nil {
			return err
		}

		if len(rows) < san_export.Batch {
			break
		}
	}

	content, err := book.Bytes()
	if err != nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("writing the file: %w", err))
	}

	filename := san_export.Filename("restok", time.Now())

	url, err := s.exports.Store(ctx, teamID, filename, content)
	if err != nil {
		return connect.NewError(connect.CodeInternal, fmt.Errorf("storing the file: %w", err))
	}

	return stream.Send(&inventoryv1.RestockRequestExportResponse{
		Message:     "the file is ready",
		Done:        progress.Done,
		Total:       progress.Total,
		DownloadUrl: url,
		Filename:    filename,
	})
}

// restockExportNames is what one step's rows are named with — other services' names, by id.
type restockExportNames struct {
	suppliers, stores, warehouses, couriers, people map[uint64]string
}

// restockExportNames reads one step's names: each set at most 200 ids a call, as the by-id reads take — a step of 200
// restocks can name more people (who raised it, who accepted it) or suppliers than that.
func (s *Service) restockExportNames(
	ctx context.Context,
	teamID uint64,
	rows []inventory_service_models.Restock,
) (restockExportNames, error) {
	suppliers, stores, warehouses, couriers, people := exportIDs{}, exportIDs{}, exportIDs{}, exportIDs{}, exportIDs{}

	for i := range rows {
		r := &rows[i]

		warehouses.add(r.WarehouseID)
		couriers.add(r.ShipmentID)
		people.add(r.CreatedByUserID)
		people.add(r.AcceptedByUserID)

		for l := range r.Items {
			suppliers.add(idOrZero(r.Items[l].SupplierID))
			stores.add(idOrZero(r.Items[l].SupplierChannelID))
		}
	}

	var names restockExportNames

	var err error

	names.suppliers, err = exportNamesOf(ctx, suppliers, func(ctx context.Context, ids []uint64) (map[uint64]string, error) {
		return s.exports.SupplierNames(ctx, teamID, ids)
	})
	if err != nil {
		return names, err
	}

	names.stores, err = exportNamesOf(ctx, stores, func(ctx context.Context, ids []uint64) (map[uint64]string, error) {
		return s.exports.StoreNames(ctx, teamID, ids)
	})
	if err != nil {
		return names, err
	}

	names.warehouses, err = exportNamesOf(ctx, warehouses, s.exports.TeamNames)
	if err != nil {
		return names, err
	}

	names.couriers, err = exportNamesOf(ctx, couriers, s.exports.ChannelNames)
	if err != nil {
		return names, err
	}

	names.people, err = exportNamesOf(ctx, people, s.exports.UserNames)

	return names, err
}

// exportIDs collects distinct non-zero ids, in the order first met — 0 means "none" and is never looked up.
type exportIDs struct {
	seen map[uint64]bool
	list []uint64
}

func (e *exportIDs) add(id uint64) {
	if id == 0 || e.seen[id] {
		return
	}

	if e.seen == nil {
		e.seen = map[uint64]bool{}
	}

	e.seen[id] = true
	e.list = append(e.list, id)
}

// exportNamesOf asks a by-id lookup for every collected id, san_export.Batch ids a call.
func exportNamesOf(
	ctx context.Context,
	ids exportIDs,
	lookup func(ctx context.Context, ids []uint64) (map[uint64]string, error),
) (map[uint64]string, error) {
	out := map[uint64]string{}

	for start := 0; start < len(ids.list); start += san_export.Batch {
		end := min(start+san_export.Batch, len(ids.list))

		got, err := lookup(ctx, ids.list[start:end])
		if err != nil {
			return nil, err
		}

		for id, name := range got {
			out[id] = name
		}
	}

	return out, nil
}

// restockExportRow is one restock, as its row on the selling list reads (index.tsx):
//
//	Order ID, Resi      the Referensi cell's two references, as text (an id or a resi keeps its leading 0)
//	Pemasok             EVERY line's supplier and store, each pair once in line order — the cell shows the first and
//	                    "+N pemasok lain"; a restock connected to none says so, as the cell does
//	Gudang              the warehouse's name
//	Produk              "N produk · M pcs", the pieces ORDERED, then every line's product code
//	Total               goods + shipping, exact (the-backend-never-rounds-money) — committedValue's sum
//	Kurir               the courier's name, as its badge reads; empty for none
//	Status              the badge's word
//	Dibuat, Diterima    the moment in WIB, date and time as the cell prints it (a-table-date-is-short-and-every-time-is-wib);
//	                    Diterima empty until accepted
//	… oleh              who, with the cell's "oleh tim Root" when Root did it from outside the team
//	                    (an-override-shows-a-platform-badge); empty when not recorded
func restockExportRow(r *inventory_service_models.Restock, override restockOverrides, names restockExportNames) []any {
	accepted, acceptedBy := "", ""
	if r.AcceptedAt != nil {
		accepted = exportMoment(*r.AcceptedAt)
		acceptedBy = exportPerson(names.people, r.AcceptedByUserID, override.Accepted)
	}

	return []any{
		strings.TrimSpace(r.InvoiceRefID),
		strings.TrimSpace(r.Receipt),
		exportSuppliers(r.Items, names),
		exportNameOr(names.warehouses, r.WarehouseID, "Gudang #"),
		exportProducts(r.Items),
		exportTotal(r),
		exportCourier(names.couriers, r.ShipmentID),
		restockStatusWord(r.Status),
		exportMoment(r.CreatedAt),
		exportPerson(names.people, r.CreatedByUserID, override.Created),
		accepted,
		acceptedBy,
	}
}

// exportSuppliers is every line's supplier and store, each pair once, in line order: "Supplier · Toko", "Supplier ·
// tanpa toko" for a line bought with no store, the screen's "Supplier #id" / "Toko #id" for a name that did not resolve.
func exportSuppliers(items []inventory_service_models.RestockItem, names restockExportNames) string {
	seen := map[[2]uint64]bool{}

	var out []string

	for i := range items {
		supplierID := idOrZero(items[i].SupplierID)
		if supplierID == 0 {
			continue
		}

		storeID := idOrZero(items[i].SupplierChannelID)

		key := [2]uint64{supplierID, storeID}
		if seen[key] {
			continue
		}

		seen[key] = true

		store := "tanpa toko"
		if storeID != 0 {
			store = exportNameOr(names.stores, storeID, "Toko #")
		}

		out = append(out, exportNameOr(names.suppliers, supplierID, "Supplier #")+" · "+store)
	}

	if len(out) == 0 {
		return "Belum terhubung ke supplier"
	}

	return strings.Join(out, "; ")
}

// exportProducts is the cell's "N produk · M pcs" — the pieces ORDERED (askedQuantity) — then every line's product code.
func exportProducts(items []inventory_service_models.RestockItem) string {
	if len(items) == 0 {
		return ""
	}

	var pieces int64

	codes := make([]string, 0, len(items))

	for i := range items {
		pieces += items[i].Count
		codes = append(codes, items[i].ProductCode)
	}

	return fmt.Sprintf("%d produk · %d pcs (%s)", len(items), pieces, strings.Join(codes, ", "))
}

// exportTotal is the row's Total: the lines' totals, then the shipping — added in the screen's order (committedValue),
// so the double is the very one the row rounds. The courier's charge at the door stays out
// (the-couriers-charge-stays-out-of-total).
func exportTotal(r *inventory_service_models.Restock) float64 {
	var goods float64

	for i := range r.Items {
		goods += r.Items[i].Total
	}

	return goods + r.ShipmentCost
}

// exportCourier is the courier's name, `#id` for an id that resolved to nothing, empty for a restock naming none.
func exportCourier(couriers map[uint64]string, id uint64) string {
	if id == 0 {
		return ""
	}

	return exportNameOr(couriers, id, "#")
}

// exportPerson is who acted, with the screen's "oleh tim Root" when Root or the System Administrator did it from
// outside the team; empty when the record does not say who.
func exportPerson(people map[uint64]string, id uint64, override bool) string {
	if id == 0 {
		return ""
	}

	name := exportNameOr(people, id, "#")
	if override {
		name += " (oleh tim Root)"
	}

	return name
}

// exportNameOr is the name, or the prefix and the id when it did not resolve — never an empty cell for a thing that
// exists.
func exportNameOr(names map[uint64]string, id uint64, prefix string) string {
	name := names[id]
	if name == "" {
		return prefix + strconv.FormatUint(id, 10)
	}

	return name
}

// exportMoment is an instant in WIB, date and time — the day it belongs to in Jakarta, and the time the cell prints
// beside it.
func exportMoment(t time.Time) string {
	if t.IsZero() {
		return ""
	}

	return t.In(san_export.WIB).Format("2006-01-02 15:04")
}

// restockStatusWord is the status badge's word on the selling list (restock.status in id.json).
func restockStatusWord(status string) string {
	switch status {
	case restockStatusOngoing:
		return "Dalam Perjalanan"
	case restockStatusArrived:
		return "Tiba"
	case restockStatusAccepted:
		return "Diterima"
	case restockStatusLost:
		return "Hilang"
	case restockStatusCancelled:
		return "Dibatalkan"
	default:
		return status
	}
}
