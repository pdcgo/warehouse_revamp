package inventory_v1_test

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"connectrpc.com/validate"
	"github.com/xuri/excelize/v2"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1/inventoryv1connect"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
)

// THE SELLING RESTOCK LIST AS A FILE (the-restock-list-exports-and-filters-by-courier, on
// one-export-is-the-list-as-a-file and a-report-export-is-the-whole-view-as-a-file) — RestockRequestExport.

// exportColumns is the file's header row — the screen's columns, its Referensi cell split in two and each date's
// by-line beside it.
var exportColumns = []string{
	"Order ID", "Resi", "Pemasok", "Gudang", "Produk", "Total", "Kurir", "Status", "Tag", "Dibuat", "Dibuat oleh",
	"Diterima", "Diterima oleh",
}

// fakeRestockExports keeps the stored file and names everything from fixed maps; it records each lookup's size, which
// the by-id reads cap at 200.
type fakeRestockExports struct {
	content  []byte
	filename string
	teamID   uint64

	suppliers, stores, teams, couriers, people map[uint64]string

	largest int
	calls   int
}

func (f *fakeRestockExports) Store(_ context.Context, teamID uint64, filename string, content []byte) (string, error) {
	f.teamID, f.filename, f.content = teamID, filename, content

	return "https://files.example/" + filename, nil
}

func (f *fakeRestockExports) pick(names map[uint64]string, ids []uint64) map[uint64]string {
	f.calls++
	f.largest = max(f.largest, len(ids))

	out := map[uint64]string{}
	for _, id := range ids {
		if name, ok := names[id]; ok {
			out[id] = name
		}
	}

	return out
}

func (f *fakeRestockExports) SupplierNames(_ context.Context, _ uint64, ids []uint64) (map[uint64]string, error) {
	return f.pick(f.suppliers, ids), nil
}

func (f *fakeRestockExports) StoreNames(_ context.Context, _ uint64, ids []uint64) (map[uint64]string, error) {
	return f.pick(f.stores, ids), nil
}

func (f *fakeRestockExports) TeamNames(_ context.Context, ids []uint64) (map[uint64]string, error) {
	return f.pick(f.teams, ids), nil
}

func (f *fakeRestockExports) ChannelNames(_ context.Context, ids []uint64) (map[uint64]string, error) {
	return f.pick(f.couriers, ids), nil
}

func (f *fakeRestockExports) UserNames(_ context.Context, ids []uint64) (map[uint64]string, error) {
	return f.pick(f.people, ids), nil
}

// exportNames is the fixture's names — some ids deliberately left unresolved (warehouse 6, supplier 503, store 699,
// person 11), so the file says the id where the screen does.
func exportNames() *fakeRestockExports {
	return &fakeRestockExports{
		suppliers: map[uint64]string{501: "Sumber Rejeki", 502: "CV Abadi"},
		stores:    map[uint64]string{601: "Toko Melati", 602: "Toko Kenanga"},
		teams:     map[uint64]string{5: "Gudang Pusat"},
		couriers:  map[uint64]string{91: "JNE Reguler", 92: "J&T Express"},
		people:    map[uint64]string{7: "Rina", 8: "Budi", 9: "Sari", 10: "Dewi"},
	}
}

// exportService is the service under test with the export store wired as the 10th dependency.
func exportService(db *gorm.DB, store *fakeRestockExports) *inventory_v1.Service {
	return inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, nil, store)
}

// restockFile is one export: the stream's messages and the sheet's rows, read raw.
type restockFile struct {
	messages []*inventoryv1.RestockRequestExportResponse
	sheets   []string
	rows     [][]string
}

// runRestockExport mounts the handler on a real HTTP server — a server stream cannot be called directly — and runs the
// export to its end; a stream error is returned, not fatal.
func runRestockExport(t *testing.T, svc *inventory_v1.Service, store *fakeRestockExports, team uint64, filter *inventoryv1.RestockRequestListFilter) (restockFile, error) {
	t.Helper()

	mux := http.NewServeMux()
	mux.Handle(inventoryv1connect.NewRestockRequestServiceHandler(svc))

	server := httptest.NewServer(mux)
	defer server.Close()

	client := inventoryv1connect.NewRestockRequestServiceClient(server.Client(), server.URL)

	stream, err := client.RestockRequestExport(context.Background(), connect.NewRequest(&inventoryv1.RestockRequestExportRequest{
		TeamId: team,
		Filter: filter,
	}))
	if err != nil {
		return restockFile{}, err
	}
	defer func() { _ = stream.Close() }()

	var out restockFile

	for stream.Receive() {
		out.messages = append(out.messages, stream.Msg())
	}

	if stream.Err() != nil {
		return restockFile{}, stream.Err()
	}

	file, err := excelize.OpenReader(bytes.NewReader(store.content))
	if err != nil {
		t.Fatalf("open the exported file: %v", err)
	}
	defer func() { _ = file.Close() }()

	out.sheets = file.GetSheetList()

	out.rows, err = file.GetRows(out.sheets[0], excelize.Options{RawCellValue: true})
	if err != nil {
		t.Fatalf("read the sheet: %v", err)
	}

	// A row's trailing empty cells are not stored; pad to the header's width so a row compares cell for cell.
	for i := range out.rows {
		for len(out.rows[i]) < len(exportColumns) {
			out.rows[i] = append(out.rows[i], "")
		}
	}

	return out, nil
}

// statusWords are the selling list's status badges (restock.status in id.json).
var statusWords = map[inventoryv1.RestockRequestStatus]string{
	inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ONGOING:   "Dalam Perjalanan",
	inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ARRIVED:   "Tiba",
	inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED:  "Diterima",
	inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_LOST:      "Hilang",
	inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_CANCELLED: "Dibatalkan",
}

// expectedRow is what the file must hold for a row of the LIST — derived from the list's own answer
// (RestockRequestList), never from the export's code: the references as typed, every line's supplier and store, the
// warehouse, the lines summed, the money exact, the courier, the status's word, its tags as the list reads them (backlog
// #87), both moments in WIB and who acted.
func expectedRow(r *inventoryv1.RestockRequest, names *fakeRestockExports) []string {
	name := func(m map[uint64]string, id uint64, prefix string) string {
		if n, ok := m[id]; ok {
			return n
		}

		return prefix + strconv.FormatUint(id, 10)
	}

	person := func(id uint64, override bool) string {
		if id == 0 {
			return ""
		}

		n := name(names.people, id, "#")
		if override {
			n += " (oleh tim Root)"
		}

		return n
	}

	var pairs []string

	seen := map[string]bool{}

	var pieces int64

	codes := []string{}

	var goods float64

	for _, line := range r.GetItems() {
		pieces += line.GetCount()
		codes = append(codes, line.GetProductCode())
		goods += line.GetTotal()

		if line.GetSupplierId() == 0 {
			continue
		}

		store := "tanpa toko"
		if line.GetSupplierChannelId() != 0 {
			store = name(names.stores, line.GetSupplierChannelId(), "Toko #")
		}

		pair := name(names.suppliers, line.GetSupplierId(), "Supplier #") + " · " + store
		if !seen[pair] {
			seen[pair] = true
			pairs = append(pairs, pair)
		}
	}

	suppliers := strings.Join(pairs, "; ")
	if len(pairs) == 0 {
		suppliers = "Belum terhubung ke supplier"
	}

	courier := ""
	if r.GetShipmentId() != 0 {
		courier = name(names.couriers, r.GetShipmentId(), "#")
	}

	accepted, acceptedBy := "", ""
	if r.GetAcceptedAtUnix() > 0 {
		accepted = time.Unix(r.GetAcceptedAtUnix(), 0).In(wibZone).Format("2006-01-02 15:04")
		acceptedBy = person(r.GetAcceptedByUserId(), r.GetAcceptedByIsOverride())
	}

	tags := make([]string, 0, len(r.GetTags()))
	for _, tag := range r.GetTags() {
		tags = append(tags, tag.GetName())
	}

	return []string{
		strings.TrimSpace(r.GetInvoiceRefId()),
		strings.TrimSpace(r.GetReceipt()),
		suppliers,
		name(names.teams, r.GetWarehouseId(), "Gudang #"),
		fmt.Sprintf("%d produk · %d pcs (%s)", len(r.GetItems()), pieces, strings.Join(codes, ", ")),
		// committedValue: the lines' totals, then the shipping.
		strconv.FormatFloat(goods+r.GetShipmentCost(), 'f', -1, 64),
		courier,
		statusWords[r.GetStatus()],
		strings.Join(tags, ", "),
		time.Unix(r.GetCreatedAtUnix(), 0).In(wibZone).Format("2006-01-02 15:04"),
		person(r.GetCreatedByUserId(), r.GetCreatedByIsOverride()),
		accepted,
		acceptedBy,
	}
}

// seedExportFixture writes 500 restocks straight into `restocks` / `restock_items` / `restock_logs`: team 2's 459 and
// team 3's 41 (every twelfth), into warehouses 5 and 6, every status with its own dates spread over two months, three
// couriers (one 0), four creators (one 0, one unnamed), two acceptors, references with a leading 0 and none, one to
// three lines naming two suppliers' stores, a store none, an unknown supplier or no supplier at all, line totals and
// freight with fractions, and a trail where Root raised every tenth and counted in every seventh accepted one from
// outside. Returns team 2's restock ids, newest first.
func seedExportFixture(t *testing.T, db *gorm.DB) []uint64 {
	t.Helper()

	now := time.Now()
	statuses := []string{"ongoing", "arrived", "accepted", "lost", "cancelled"}
	products := []struct {
		id         uint64
		code, name string
	}{
		{100, "SKU-100", "Beras Pandan"},
		{101, "SKU-101", "Kopi Arabika"},
		{102, "TMB-500-005", "Teh Melati"},
		{103, "SKU-103", "Gula Pasir"},
	}
	suppliers := []struct{ supplier, store *uint64 }{
		{ptr(501), ptr(601)},
		{ptr(502), ptr(602)},
		{ptr(501), nil},
		{ptr(503), ptr(699)},
		{nil, nil},
	}

	restocks := make([]inventory_service_models.Restock, 0, 500)

	for i := range 500 {
		at := func(hours int) *time.Time {
			v := now.Add(-time.Duration(1500-3*i+hours) * time.Hour)
			return &v
		}

		status := statuses[i%len(statuses)]

		r := inventory_service_models.Restock{
			TeamID:          2,
			WarehouseID:     uint64(5 + (i/3)%2),
			Status:          status,
			ShipmentID:      []uint64{91, 92, 0}[i%3],
			CreatedByUserID: []uint64{7, 8, 0, 11}[i%4],
			ShipmentCost:    float64(1000*(i%7)) + 0.5*float64(i%2),
			CreatedAt:       *at(0),
			UpdatedAt:       now,
		}

		if i%12 == 11 {
			r.TeamID = 3
		}

		switch i % 4 {
		case 0:
			r.Receipt = fmt.Sprintf("0812%05d", i)
			r.InvoiceRefID = fmt.Sprintf("007-%d", i)
		case 1:
			r.Receipt = fmt.Sprintf(" JNE%05d ", i)
		case 2:
			r.InvoiceRefID = fmt.Sprintf("PO#41%03d", i)
		}

		switch status {
		case "arrived":
			r.ArrivedAt = at(-20)
			r.ArrivedByUserID = 9
		case "accepted":
			r.ArrivedAt = at(-20)
			r.AcceptedAt = at(-30)
			r.AcceptedByUserID = []uint64{9, 10}[i%2]
		case "lost":
			r.LostAt = at(-40)
		case "cancelled":
			r.CancelledAt = at(-10)
		}

		var subtotal float64

		for l := range 1 + i%3 {
			p := products[(i+l)%len(products)]
			s := suppliers[(i+l)%len(suppliers)]
			count := int64(2 + (i+l)%5)
			total := float64(count)*float64(1000*(1+l)) + 0.2857*float64((i+l)%3)
			subtotal += total

			r.Items = append(r.Items, inventory_service_models.RestockItem{
				ProductID: p.id, ProductCode: p.code, Name: p.name,
				Count: count, Total: total, PriceUnit: total / float64(count),
				SupplierID: s.supplier, SupplierChannelID: s.store,
				CreatedAt: now, UpdatedAt: now,
			})
		}

		r.Subtotal = subtotal
		r.Total = subtotal + r.ShipmentCost

		restocks = append(restocks, r)
	}

	err := db.CreateInBatches(&restocks, 100).Error
	if err != nil {
		t.Fatalf("seed restocks: %v", err)
	}

	var logs []inventory_service_models.RestockLog

	var ids []uint64

	for i := range restocks {
		r := &restocks[i]

		logs = append(logs, inventory_service_models.RestockLog{
			RestockID: r.ID, ToStatus: "ongoing", ActorUserID: r.CreatedByUserID, IsOverride: i%10 == 0,
			Description: "created", CreatedAt: r.CreatedAt,
		})

		if r.Status == "accepted" {
			logs = append(logs, inventory_service_models.RestockLog{
				RestockID: r.ID, FromStatus: "arrived", ToStatus: "accepted", ActorUserID: r.AcceptedByUserID,
				IsOverride: i%7 == 0, Description: "accepted", CreatedAt: *r.AcceptedAt,
			})
		}

		if r.TeamID == 2 {
			ids = append(ids, r.ID)
		}
	}

	err = db.CreateInBatches(&logs, 200).Error
	if err != nil {
		t.Fatalf("seed trail: %v", err)
	}

	// TAGS (backlog #87): every fourth restock carries *Prioritas*, every sixth *Lebaran 2026*, the app's *Barang
	// kurang* every ninth accepted one — so a row with two, one and none, and the tag filter's any-of.
	prioritas := seedTag(t, db, "Prioritas", "custom")
	lebaran := seedTag(t, db, "Lebaran 2026", "custom")
	kurang := appTagID(t, db, "restock.problem.missing")

	for i := range restocks {
		if i%4 == 0 {
			tagOn(t, db, restocks[i].ID, prioritas)
		}

		if i%6 == 0 {
			tagOn(t, db, restocks[i].ID, lebaran)
		}

		if i%9 == 2 && restocks[i].Status == "accepted" {
			tagOn(t, db, restocks[i].ID, kurang)
		}
	}

	slices.Reverse(ids)

	return ids
}

func ptr(v uint64) *uint64 { return &v }

// THE FILE IS THE LIST, EVERY PAGE — for every filter the list offers (each tab, the courier, the warehouse, who raised
// and who accepted it, each date field's window, a free-text search, an id, and several at once), the file's rows are
// exactly the list's rows read page after page, in the list's order, each cell what the screen's row says. The
// unfiltered file runs past two steps of 200 (459 restocks), so the walk from step to step is covered; every name
// lookup stays within 200 ids; the stream reports the list's total and ends on the file's link, stored under the
// caller's team as `restok-<WIB stamp>.xlsx`. Team 3's restocks never appear.
func TestRestockRequestExport_TheFileIsTheListEveryPage(t *testing.T) {
	db := san_testdb.DB(t)
	ids := seedExportFixture(t, db)

	now := time.Now()
	window := func(field inventoryv1.RestockDateField, fromHours, toHours int) *inventoryv1.RestockRequestListFilter {
		return &inventoryv1.RestockRequestListFilter{
			DateField: field,
			FromUnix:  now.Add(-time.Duration(fromHours) * time.Hour).Unix(),
			ToUnix:    now.Add(-time.Duration(toHours) * time.Hour).Unix(),
		}
	}

	cases := []struct {
		name   string
		filter *inventoryv1.RestockRequestListFilter
	}{
		{"every restock", nil},
		{"tab ongoing", &inventoryv1.RestockRequestListFilter{Status: inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ONGOING}},
		{"tab arrived", &inventoryv1.RestockRequestListFilter{Status: inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ARRIVED}},
		{"tab accepted", &inventoryv1.RestockRequestListFilter{Status: inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED}},
		{"tab lost", &inventoryv1.RestockRequestListFilter{Status: inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_LOST}},
		{"tab cancelled", &inventoryv1.RestockRequestListFilter{Status: inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_CANCELLED}},
		{"courier 91", &inventoryv1.RestockRequestListFilter{ShipmentId: 91}},
		{"courier 92, tab accepted", &inventoryv1.RestockRequestListFilter{
			ShipmentId: 92, Status: inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED,
		}},
		{"warehouse 6", &inventoryv1.RestockRequestListFilter{WarehouseId: 6}},
		{"created by 7", &inventoryv1.RestockRequestListFilter{CreatedByUserId: 7}},
		{"accepted by 10", &inventoryv1.RestockRequestListFilter{AcceptedByUserId: 10}},
		{"product 102", &inventoryv1.RestockRequestListFilter{ProductId: 102}},
		{"created, a window", window(inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_CREATED, 900, 300)},
		{"accepted, a window", window(inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_ACCEPTED, 900, 0)},
		{"arrived, a window", window(inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_ARRIVED, 1200, 200)},
		{"q resi", &inventoryv1.RestockRequestListFilter{Q: "jne"}},
		{"q product code", &inventoryv1.RestockRequestListFilter{Q: "tmb-500"}},
		{"q #id", &inventoryv1.RestockRequestListFilter{Q: "#" + strconv.FormatUint(ids[17], 10)}},
		{"several at once", &inventoryv1.RestockRequestListFilter{
			Status: inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED, ShipmentId: 91, WarehouseId: 5,
			DateField: inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_CREATED,
			FromUnix:  now.Add(-1400 * time.Hour).Unix(), ToUnix: now.Unix(), Q: "sku",
		}},
		{"tag prioritas", &inventoryv1.RestockRequestListFilter{TagIds: []uint64{exportTag(t, db, "Prioritas")}}},
		{"tags prioritas or lebaran", &inventoryv1.RestockRequestListFilter{
			TagIds: []uint64{exportTag(t, db, "Prioritas"), exportTag(t, db, "Lebaran 2026")},
		}},
		{"tag barang kurang, tab accepted", &inventoryv1.RestockRequestListFilter{
			TagIds: []uint64{exportTag(t, db, "Barang kurang")}, Status: inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED,
		}},
		{"nothing matches", &inventoryv1.RestockRequestListFilter{Q: "no such restock"}},
	}

	stamp := regexp.MustCompile(`^restok-\d{4}-\d{2}-\d{2}-\d{6}\.xlsx$`)

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			store := exportNames()
			svc := exportService(db, store)

			listed := listRows(t, svc, 2, c.filter)
			if (len(listed) == 0) != (c.name == "nothing matches") {
				t.Fatalf("the list holds %d restocks — a case that narrows to nothing proves nothing", len(listed))
			}

			t.Logf("%d restocks", len(listed))

			file, err := runRestockExport(t, svc, store, 2, c.filter)
			if err != nil {
				t.Fatalf("export: %v", err)
			}

			if !slices.Equal(file.sheets, []string{"Restok"}) {
				t.Fatalf("sheets = %v, want [Restok]", file.sheets)
			}

			if !slices.Equal(file.rows[0], exportColumns) {
				t.Fatalf("header = %v, want %v", file.rows[0], exportColumns)
			}

			got := file.rows[1:]
			if len(got) != len(listed) {
				t.Fatalf("the file holds %d restocks, the list %d", len(got), len(listed))
			}

			for i, r := range listed {
				want := expectedRow(r, store)
				if !slices.Equal(got[i], want) {
					t.Fatalf("row %d (restock %d):\n got  %q\n want %q", i+1, r.GetId(), got[i], want)
				}
			}

			if store.largest > 200 {
				t.Fatalf("a name lookup asked for %d ids — the by-id reads take at most 200", store.largest)
			}

			last := file.messages[len(file.messages)-1]
			if last.GetTotal() != int64(len(listed)) || last.GetDone() != int64(len(listed)) {
				t.Fatalf("the last message says %d of %d, want %d of %d", last.GetDone(), last.GetTotal(), len(listed), len(listed))
			}

			if last.GetDownloadUrl() != "https://files.example/"+store.filename || !stamp.MatchString(last.GetFilename()) ||
				last.GetFilename() != store.filename || store.teamID != 2 {
				t.Fatalf("the file = %q at %q under team %d, want restok-<stamp>.xlsx under team 2", last.GetFilename(), last.GetDownloadUrl(), store.teamID)
			}

			for _, m := range file.messages[:len(file.messages)-1] {
				if m.GetDownloadUrl() != "" || m.GetTotal() != int64(len(listed)) {
					t.Fatalf("a progress message %v carries a link or another total", m)
				}
			}

			if c.filter == nil {
				// 459 restocks: the count's line, three steps (200, 200, 59), then the file.
				if len(listed) != 459 || len(file.messages) != 5 {
					t.Fatalf("every restock: %d rows over %d messages, want 459 over 5", len(listed), len(file.messages))
				}

				if file.messages[1].GetDone() != 200 || file.messages[2].GetDone() != 400 {
					t.Fatalf("the steps reported %d then %d, want 200 then 400", file.messages[1].GetDone(), file.messages[2].GetDone())
				}
			}
		})
	}
}

// THE COLUMNS, CELL BY CELL, on known restocks: the header; a reference with a leading 0 stays text; a resi typed with
// spaces is written as the screen shows it; every line's supplier and store, each pair once, an unknown one by its id
// and a line with no store said so; the warehouse unnamed by its id; the products with their codes; the money exact to
// its fraction; the courier's name; the status's word; the moments in WIB; and Root's acts marked as the screen marks
// them.
func TestRestockRequestExport_Columns(t *testing.T) {
	db := san_testdb.DB(t)
	store := exportNames()
	svc := exportService(db, store)

	created := time.Date(2026, 11, 3, 23, 30, 0, 0, time.UTC) // 4 Nov 06:30 WIB — the Jakarta day, not UTC's
	accepted := time.Date(2026, 11, 5, 17, 5, 0, 0, time.UTC) // 6 Nov 00:05 WIB

	full := inventory_service_models.Restock{
		TeamID: 2, WarehouseID: 6, Status: "accepted", ShipmentID: 92, CreatedByUserID: 7, AcceptedByUserID: 11,
		InvoiceRefID: "0071234", Receipt: "  081234567890 ", ShipmentCost: 12_500.75,
		CreatedAt: created, UpdatedAt: created, ArrivedAt: &accepted, AcceptedAt: &accepted,
		Items: []inventory_service_models.RestockItem{
			{ProductID: 1, ProductCode: "SKU-1", Name: "Satu", Count: 7, Total: 82_000.2857, SupplierID: ptr(501), SupplierChannelID: ptr(601)},
			{ProductID: 2, ProductCode: "SKU-2", Name: "Dua", Count: 3, Total: 30_000, SupplierID: ptr(501), SupplierChannelID: ptr(601)},
			{ProductID: 3, ProductCode: "SKU-3", Name: "Tiga", Count: 1, Total: 1_000, SupplierID: ptr(503), SupplierChannelID: ptr(699)},
			{ProductID: 4, ProductCode: "SKU-4", Name: "Empat", Count: 2, Total: 2_000, SupplierID: ptr(502)},
		},
	}
	bare := inventory_service_models.Restock{
		TeamID: 2, WarehouseID: 5, Status: "ongoing", CreatedAt: created.Add(time.Hour), UpdatedAt: created,
		Items: []inventory_service_models.RestockItem{{ProductID: 1, ProductCode: "SKU-1", Name: "Satu", Count: 1, Total: 500}},
	}

	for _, r := range []*inventory_service_models.Restock{&full, &bare} {
		err := db.Create(r).Error
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	// Its tags, in the chips' order whatever order they went on in: the system's first, then by name.
	tagOn(t, db, full.ID, seedTag(t, db, "Retur ke Supplier", "custom"))
	tagOn(t, db, full.ID, appTagID(t, db, "restock.problem.broken"))
	tagOn(t, db, full.ID, seedTag(t, db, "Lebaran 2026", "custom"))

	err := db.Create(&[]inventory_service_models.RestockLog{
		{RestockID: full.ID, ToStatus: "ongoing", ActorUserID: 7, CreatedAt: created},
		{RestockID: full.ID, FromStatus: "arrived", ToStatus: "accepted", ActorUserID: 11, IsOverride: true, CreatedAt: accepted},
		{RestockID: bare.ID, ToStatus: "ongoing", IsOverride: true, CreatedAt: created},
	}).Error
	if err != nil {
		t.Fatalf("seed trail: %v", err)
	}

	file, err := runRestockExport(t, svc, store, 2, nil)
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	want := [][]string{
		exportColumns,
		// Newest first, as the list: bare was raised an hour later. Its creator is not recorded — the trail's override
		// stands for nobody, so the cell stays empty.
		{"", "", "Belum terhubung ke supplier", "Gudang Pusat", "1 produk · 1 pcs (SKU-1)", "500", "", "Dalam Perjalanan",
			"", "2026-11-04 07:30", "", "", ""},
		{"0071234", "081234567890", "Sumber Rejeki · Toko Melati; Supplier #503 · Toko #699; CV Abadi · tanpa toko",
			"Gudang #6", "4 produk · 13 pcs (SKU-1, SKU-2, SKU-3, SKU-4)", "127501.0357", "J&T Express", "Diterima",
			"Barang rusak, Lebaran 2026, Retur ke Supplier", "2026-11-04 06:30", "Rina", "2026-11-06 00:05", "#11 (oleh tim Root)"},
	}

	if len(file.rows) != len(want) {
		t.Fatalf("rows = %q", file.rows)
	}

	for i := range want {
		if !slices.Equal(file.rows[i], want[i]) {
			t.Fatalf("row %d:\n got  %q\n want %q", i, file.rows[i], want[i])
		}
	}
}

// THE RAISING SIDE ONLY. The list shows a team the restocks it raised AND those coming to it as a warehouse; the file,
// as the statistics, carries only the ones it raised — another team's money never reaches it
// (the-warehouse-sees-the-cod-it-paid). A warehouse, asked by Root (the only caller the policy lets near it), raised
// nothing: an empty file, never an error. Another selling team's restocks are not in the file.
func TestRestockRequestExport_OnlyWhatTheTeamRaised(t *testing.T) {
	db := san_testdb.DB(t)
	store := exportNames()
	svc := exportService(db, store)

	now := time.Now()

	for _, r := range []inventory_service_models.Restock{
		{TeamID: 2, WarehouseID: 5, Status: "ongoing", Receipt: "OWN", CreatedAt: now, UpdatedAt: now},
		{TeamID: 3, WarehouseID: 2, Status: "ongoing", Receipt: "INBOUND", CreatedAt: now, UpdatedAt: now},
		{TeamID: 3, WarehouseID: 5, Status: "ongoing", Receipt: "THEIRS", CreatedAt: now, UpdatedAt: now},
	} {
		err := db.Create(&r).Error
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	if listed := tabTotal(t, svc, 2, nil); listed != 2 {
		t.Fatalf("the list reads %d for team 2, want 2 (its own and the one coming to it)", listed)
	}

	file, err := runRestockExport(t, svc, store, 2, nil)
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	if len(file.rows) != 2 || file.rows[1][1] != "OWN" {
		t.Fatalf("team 2's file = %q, want its own restock only", file.rows)
	}

	warehouse, err := runRestockExport(t, svc, store, 5, nil)
	if err != nil {
		t.Fatalf("export as warehouse 5: %v", err)
	}

	if len(warehouse.rows) != 1 || warehouse.messages[len(warehouse.messages)-1].GetTotal() != 0 {
		t.Fatalf("warehouse 5's file = %q, want the header alone", warehouse.rows)
	}
}

// A STEP NAMES MORE PEOPLE THAN ONE LOOKUP TAKES: 200 restocks, each raised and accepted by someone else — 400 people in
// one step. The names are asked 200 ids at a time, and every one of them reaches its row.
func TestRestockRequestExport_ANameLookupAsksAtMost200(t *testing.T) {
	db := san_testdb.DB(t)
	store := exportNames()
	svc := exportService(db, store)

	now := time.Now()
	restocks := make([]inventory_service_models.Restock, 0, 200)

	for i := range 200 {
		creator, acceptor := uint64(1000+i), uint64(2000+i)
		store.people[creator] = fmt.Sprintf("Pembuat %d", i)
		store.people[acceptor] = fmt.Sprintf("Penerima %d", i)

		restocks = append(restocks, inventory_service_models.Restock{
			TeamID: 2, WarehouseID: 5, Status: "accepted", CreatedByUserID: creator, AcceptedByUserID: acceptor,
			CreatedAt: now, UpdatedAt: now, AcceptedAt: &now,
		})
	}

	err := db.CreateInBatches(&restocks, 100).Error
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	file, err := runRestockExport(t, svc, store, 2, nil)
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	if store.largest > 200 {
		t.Fatalf("a name lookup asked for %d ids, want at most 200", store.largest)
	}

	if len(file.rows) != 201 {
		t.Fatalf("%d rows, want 200 and the header", len(file.rows)-1)
	}

	for _, row := range file.rows[1:] {
		// The by-lines sit after the Tag column (backlog #87): Dibuat oleh 10, Diterima oleh 12.
		if !strings.HasPrefix(row[10], "Pembuat ") || !strings.HasPrefix(row[12], "Penerima ") {
			t.Fatalf("a row's people went unnamed: %q", row)
		}
	}
}

// With no export store wired, the export answers Unimplemented rather than a file that goes nowhere.
func TestRestockRequestExport_NoStoreIsUnimplemented(t *testing.T) {
	db := san_testdb.DB(t)

	mux := http.NewServeMux()
	mux.Handle(inventoryv1connect.NewRestockRequestServiceHandler(newService(t, db)))

	server := httptest.NewServer(mux)
	defer server.Close()

	client := inventoryv1connect.NewRestockRequestServiceClient(server.Client(), server.URL)

	stream, err := client.RestockRequestExport(context.Background(), connect.NewRequest(&inventoryv1.RestockRequestExportRequest{TeamId: 2}))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = stream.Close() }()

	for stream.Receive() {
		t.Fatalf("a message with no store: %v", stream.Msg())
	}

	if connect.CodeOf(stream.Err()) != connect.CodeUnimplemented {
		t.Fatalf("err = %v, want Unimplemented", stream.Err())
	}
}

// Who may export: whoever may read the selling list — its selling roles, Root and the Administrator (OrderExport's
// rule) — and no warehouse role, which sees no restock money (the-warehouse-sees-the-cod-it-paid). NOT a read: it stores
// a file, so the admin team's monitor and an agent's credential are refused (monitoring-keeps-what-only-reads).
func TestRestockRequestExport_Policy(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.RestockRequestExportRequest")
	if err != nil {
		t.Fatal(err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatal("RestockRequestExportRequest has no policy")
	}

	want := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
		role_basev1.Role_ROLE_SELLING_CS,
	}
	if !slices.Equal(policy.GetRoles(), want) {
		t.Fatalf("roles = %v, want %v", policy.GetRoles(), want)
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.RestockRequestService.RestockRequestExport")
	if err != nil {
		t.Fatal(err)
	}

	md := method.(protoreflect.MethodDescriptor)
	if !md.IsStreamingServer() || md.IsStreamingClient() {
		t.Fatal("RestockRequestExport must be a server stream")
	}

	opts, _ := md.Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() == descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatal("RestockRequestExport stores a file — it must not be marked a read")
	}
}

// exportAccess is a caller's access per (user, team), as the access interceptor resolves it — the admin team's role
// rides on every team's answer.
type exportAccess map[[2]uint64]access_interceptors.Access

func (a exportAccess) Resolve(_ context.Context, user, team uint64) (access_interceptors.Access, error) {
	return a[[2]uint64{user, team}], nil
}

func (exportAccess) Invalidate(context.Context, uint64) error { return nil }

// everyTeamMonitorable is team_service's answer for the fixture: every team is a selling or a warehouse team.
type everyTeamMonitorable struct{}

func (everyTeamMonitorable) Monitorable(context.Context, uint64) (bool, error) { return true, nil }

// MOUNTED AS THE APP MOUNTS IT — inventory's register behind the validator and the access interceptor, the admin team's
// monitoring switched on: the selling team's Owner and CS export their own list; the warehouse's Owner is refused on
// its own team (no warehouse role) and a selling Owner on another team (the scope); and the admin team's monitor —
// who READS the same list in the same team — is refused the export, which is not marked a read.
func TestRestockRequestExport_TheWarehouseAnotherTeamAndTheMonitorAreRefused(t *testing.T) {
	db := san_testdb.DB(t)
	store := exportNames()
	svc := exportService(db, store)

	now := time.Now()

	err := db.Create(&inventory_service_models.Restock{TeamID: 2, WarehouseID: 5, Status: "ongoing", CreatedAt: now, UpdatedAt: now}).Error
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	const owner, cs, keeper, monitor uint64 = 71, 72, 73, 74

	access := exportAccess{
		{owner, 2}:   {Role: role_basev1.Role_ROLE_SELLING_OWNER},
		{cs, 2}:      {Role: role_basev1.Role_ROLE_SELLING_CS},
		{keeper, 5}:  {Role: role_basev1.Role_ROLE_WAREHOUSE_OWNER},
		{monitor, 2}: {AdminTeamRole: role_basev1.Role_ROLE_ADMIN_OWNER},
	}

	signer := san_auth.NewSigner("restock-export-test", time.Hour)
	chain := connect.WithInterceptors(
		validate.NewInterceptor(),
		access_interceptors.NewInterceptor(signer, access, access_interceptors.WithTeamKinds(everyTeamMonitorable{})),
	)

	mux := http.NewServeMux()
	san_grpc.Register(mux, inventory_service.NewRegister(mux, svc, chain))

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	client := inventoryv1connect.NewRestockRequestServiceClient(server.Client(), server.URL)

	bearer := func(user uint64) string {
		t.Helper()

		token, err := signer.Sign(&role_basev1.Identity{
			IdentityId:   user,
			Username:     fmt.Sprintf("u%d", user),
			IdentityType: role_basev1.IdentityType_IDENTITY_TYPE_GENERAL_USER,
		}, time.Now())
		if err != nil {
			t.Fatal(err)
		}

		return "Bearer " + token
	}

	export := func(user, team uint64) (int, error) {
		t.Helper()

		req := connect.NewRequest(&inventoryv1.RestockRequestExportRequest{TeamId: team})
		req.Header().Set("Authorization", bearer(user))

		stream, err := client.RestockRequestExport(context.Background(), req)
		if err != nil {
			return 0, err
		}
		defer func() { _ = stream.Close() }()

		messages := 0
		for stream.Receive() {
			messages++
		}

		return messages, stream.Err()
	}

	for _, user := range []uint64{owner, cs} {
		messages, err := export(user, 2)
		if err != nil || messages == 0 {
			t.Fatalf("user %d on their own team: %d messages, %v", user, messages, err)
		}
	}

	_, err = export(keeper, 5)
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("the warehouse's Owner on its own team: %v, want PermissionDenied", err)
	}

	_, err = export(owner, 3)
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a selling Owner on another team: %v, want PermissionDenied", err)
	}

	// The monitor reads the list — a marked read — in the very team it is refused the file in.
	list := connect.NewRequest(&inventoryv1.RestockRequestListRequest{
		TeamId: 2,
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
	})
	list.Header().Set("Authorization", bearer(monitor))

	_, err = client.RestockRequestList(context.Background(), list)
	if err != nil {
		t.Fatalf("the monitor reading the list: %v", err)
	}

	_, err = export(monitor, 2)
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("the monitor exporting: %v, want PermissionDenied", err)
	}
}
