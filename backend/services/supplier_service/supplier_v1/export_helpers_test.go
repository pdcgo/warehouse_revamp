package supplier_v1_test

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"github.com/xuri/excelize/v2"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1/supplierv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// fakeExports keeps the stored file and names products and teams from fixed maps.
type fakeExports struct {
	content  []byte
	filename string
	teamID   uint64

	products map[uint64]supplier_v1.ExportProduct
	teams    map[uint64]string
}

func (f *fakeExports) Store(_ context.Context, teamID uint64, filename string, content []byte) (string, error) {
	f.teamID, f.filename, f.content = teamID, filename, content

	return "https://files.example/" + filename, nil
}

func (f *fakeExports) ProductNames(_ context.Context, _ uint64, ids []uint64) (map[uint64]supplier_v1.ExportProduct, error) {
	out := map[uint64]supplier_v1.ExportProduct{}
	for _, id := range ids {
		if p, ok := f.products[id]; ok {
			out[id] = p
		}
	}

	return out, nil
}

func (f *fakeExports) TeamNames(_ context.Context, ids []uint64) (map[uint64]string, error) {
	out := map[uint64]string{}
	for _, id := range ids {
		if name, ok := f.teams[id]; ok {
			out[id] = name
		}
	}

	return out, nil
}

// exportService is the service an export test runs: the selling teams, the goods fake and the export fake.
func exportService(db *gorm.DB, goods *fakeGoods, store *fakeExports) *supplier_v1.Service {
	return supplier_v1.NewService(db, sellingTeams{selling: map[uint64]bool{sellingA: true, sellingB: true}}, nil, goods, store)
}

// exportFile is what one export produced: its stream's messages and the file's rows, read raw — a number as it was
// written, never as a spreadsheet shows it.
type exportFile struct {
	messages []progressLine
	sheets   []string
	rows     map[string][][]string
	store    *fakeExports
}

type progressLine struct {
	message     string
	done, total int64
	url, name   string
}

// serve mounts the supplier handlers on a real HTTP server — a server-streaming handler cannot be called directly.
func serve(t *testing.T, svc *supplier_v1.Service) string {
	t.Helper()

	mux := http.NewServeMux()
	mux.Handle(supplierv1connect.NewSupplierChannelServiceHandler(svc))
	mux.Handle(supplierv1connect.NewSupplierAnalyticServiceHandler(svc))

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	return server.URL
}

// readFile opens what the store kept.
func readFile(t *testing.T, store *fakeExports, lines []progressLine) exportFile {
	t.Helper()

	file, err := excelize.OpenReader(bytes.NewReader(store.content))
	if err != nil {
		t.Fatalf("open the exported file: %v", err)
	}
	defer func() { _ = file.Close() }()

	out := exportFile{messages: lines, sheets: file.GetSheetList(), rows: map[string][][]string{}, store: store}

	for _, sheet := range out.sheets {
		rows, err := file.GetRows(sheet, excelize.Options{RawCellValue: true})
		if err != nil {
			t.Fatalf("read %s: %v", sheet, err)
		}

		out.rows[sheet] = rows
	}

	return out
}

// runChannelExport runs SupplierChannelExport end to end; a stream error is returned, not fatal.
func runChannelExport(t *testing.T, svc *supplier_v1.Service, store *fakeExports, req *supplierv1.SupplierChannelExportRequest) (exportFile, error) {
	t.Helper()

	client := supplierv1connect.NewSupplierChannelServiceClient(http.DefaultClient, serve(t, svc))

	stream, err := client.SupplierChannelExport(context.Background(), connect.NewRequest(req))
	if err != nil {
		return exportFile{}, err
	}
	defer func() { _ = stream.Close() }()

	var lines []progressLine
	for stream.Receive() {
		m := stream.Msg()
		lines = append(lines, progressLine{m.GetMessage(), m.GetDone(), m.GetTotal(), m.GetDownloadUrl(), m.GetFilename()})
	}

	if stream.Err() != nil {
		return exportFile{}, stream.Err()
	}

	return readFile(t, store, lines), nil
}

// runFigureExport runs SupplierFigureExport end to end; a stream error is returned, not fatal.
func runFigureExport(t *testing.T, svc *supplier_v1.Service, store *fakeExports, req *supplierv1.SupplierFigureExportRequest) (exportFile, error) {
	t.Helper()

	client := supplierv1connect.NewSupplierAnalyticServiceClient(http.DefaultClient, serve(t, svc))

	stream, err := client.SupplierFigureExport(context.Background(), connect.NewRequest(req))
	if err != nil {
		return exportFile{}, err
	}
	defer func() { _ = stream.Close() }()

	var lines []progressLine
	for stream.Receive() {
		m := stream.Msg()
		lines = append(lines, progressLine{m.GetMessage(), m.GetDone(), m.GetTotal(), m.GetDownloadUrl(), m.GetFilename()})
	}

	if stream.Err() != nil {
		return exportFile{}, stream.Err()
	}

	return readFile(t, store, lines), nil
}

// last is the stream's final message — the file's.
func (f exportFile) last(t *testing.T) progressLine {
	t.Helper()

	if len(f.messages) == 0 {
		t.Fatal("the stream sent nothing")
	}

	return f.messages[len(f.messages)-1]
}

// column is one column of a sheet's data rows, by its header.
func (f exportFile) column(t *testing.T, sheet, header string) []string {
	t.Helper()

	rows := f.rows[sheet]
	if len(rows) == 0 {
		t.Fatalf("sheet %s is empty", sheet)
	}

	at := slices.Index(rows[0], header)
	if at < 0 {
		t.Fatalf("sheet %s has no %q column: %v", sheet, header, rows[0])
	}

	out := make([]string, 0, len(rows)-1)
	for _, row := range rows[1:] {
		if at < len(row) {
			out = append(out, row[at])
		} else {
			out = append(out, "")
		}
	}

	return out
}

// assertExportPolicy pins who may export: the readers that see the figures, never a warehouse; and NOT a read, so the
// admin team's monitor and an agent are refused (the-admin-team-monitors-read-only).
func assertExportPolicy(t *testing.T, request, method string) {
	t.Helper()

	desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName(request))
	if err != nil {
		t.Fatal(err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatalf("%s has no policy", request)
	}

	want := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
		role_basev1.Role_ROLE_SELLING_CS,
	}
	if !slices.Equal(policy.GetRoles(), want) {
		t.Fatalf("roles = %v, want %v — no warehouse role reads a supplier's figures", policy.GetRoles(), want)
	}

	m, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName(method))
	if err != nil {
		t.Fatal(err)
	}

	options, _ := m.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if options.GetIdempotencyLevel() == descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatalf("%s stores a file — it must not be marked a read", method)
	}
}
