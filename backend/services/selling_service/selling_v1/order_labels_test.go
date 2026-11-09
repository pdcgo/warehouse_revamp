package selling_v1_test

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"github.com/pdfcpu/pdfcpu/pkg/api"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// fakeLinker is document_service's label door: it signs and reads only the documents it holds, for their owner, and
// keeps what is stored back.
type fakeLinker struct {
	// document id → owner team
	owners map[string]uint64
	// document id → the stored bytes and type; a held document missing here reads as nil content (gone from storage)
	files map[string]selling_v1.LabelFile
	// every document id asked for, by LabelURL and LabelFiles alike
	asked []string
	err   error

	// what StoreOrderLabels was given
	stored     [][]byte
	storedTeam []uint64
	storeErr   error
}

func (f *fakeLinker) LabelFiles(_ context.Context, labels []selling_v1.LabelRef) (map[string]selling_v1.LabelFile, error) {
	if f.err != nil {
		return nil, f.err
	}

	out := map[string]selling_v1.LabelFile{}

	for _, label := range labels {
		f.asked = append(f.asked, label.DocumentID)

		if owner, ok := f.owners[label.DocumentID]; !ok || owner != label.OwnerTeamID {
			continue
		}

		out[label.DocumentID] = f.files[label.DocumentID]
	}

	return out, nil
}

func (f *fakeLinker) StoreOrderLabels(_ context.Context, teamID uint64, filename string, content []byte) (string, time.Time, error) {
	if f.storeErr != nil {
		return "", time.Time{}, f.storeErr
	}

	f.stored = append(f.stored, content)
	f.storedTeam = append(f.storedTeam, teamID)

	return "https://files.invalid/merged/" + filename, time.Unix(1_900_000_100, 0), nil
}

func (f *fakeLinker) LabelURL(_ context.Context, ownerTeamID uint64, documentID string) (string, time.Time, error) {
	f.asked = append(f.asked, documentID)

	if f.err != nil {
		return "", time.Time{}, f.err
	}

	if owner, ok := f.owners[documentID]; !ok || owner != ownerTeamID {
		return "", time.Time{}, connect.NewError(connect.CodeNotFound, errors.New("document not found"))
	}

	return "https://files.invalid/" + documentID, time.Unix(1_900_000_000, 0), nil
}

func labelService(db *gorm.DB, linker selling_v1.LabelLinker) *selling_v1.Service {
	return selling_v1.NewService(db, &fakePicker{}, nil, &fakeCatalog{}, &fakeCredit{}, everyoneMayWrite{}, nil, nil, linker, nil)
}

// insertLabelOrder writes an order of selling team 2 shipping from `warehouse`, with a label file or none.
func insertLabelOrder(t *testing.T, db *gorm.DB, warehouse uint64, documentID string) uint64 {
	t.Helper()

	// A shop of its own per order: two orders may name the same label file.
	shop := insertShop(t, db, 2, "Toko Label", "LBL-"+newOrderKey(), "shopee")

	order := selling_service_models.Order{
		IdempotencyKey:    newOrderKey(),
		TeamID:            2,
		ShopID:            shop,
		WarehouseID:       warehouse,
		Status:            "processed",
		Address:           &selling_service_models.OrderAddress{CustomerName: "Budi"},
		ReceiptDocumentID: documentID,
		ReceiptFilename:   "label.pdf",
		ReceiptMimeType:   "application/pdf",
	}

	err := db.Create(&order).Error
	if err != nil {
		t.Fatalf("insert order: %v", err)
	}

	return order.ID
}

func orderLabels(svc *selling_v1.Service, teamID uint64, orderIDs ...uint64) (*sellingv1.OrderLabelsResponse, error) {
	res, err := svc.OrderLabels(context.Background(), connect.NewRequest(&sellingv1.OrderLabelsRequest{
		TeamId:   teamID,
		OrderIds: orderIDs,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// a-warehouse-prints-the-labels-of-orders-it-ships: the warehouse an order ships from gets a link to its label — the
// seller's document, signed for the seller's team as its owner, without any share.
func TestOrderLabels_TheShippingWarehouseGetsTheLink(t *testing.T) {
	db := san_testdb.DB(t)
	linker := &fakeLinker{owners: map[string]uint64{"doc-label": 2}}
	svc := labelService(db, linker)

	order := insertLabelOrder(t, db, testWarehouse, "doc-label")

	res, err := orderLabels(svc, testWarehouse, order)
	if err != nil {
		t.Fatalf("OrderLabels: %v", err)
	}

	if res.GetUrl() != "https://files.invalid/doc-label" || res.GetExpiresAtUnix() != 1_900_000_000 {
		t.Fatalf("link = %q, expires %d", res.GetUrl(), res.GetExpiresAtUnix())
	}

	if len(res.GetResults()) != 1 || !res.GetResults()[0].GetIncluded() || res.GetResults()[0].GetOrderId() != order ||
		res.GetResults()[0].GetReason() != sellingv1.OrderLabelReason_ORDER_LABEL_REASON_UNSPECIFIED {
		t.Fatalf("results = %v", res.GetResults())
	}

	// The root team opens any order's label.
	root, err := orderLabels(svc, san_auth.RootTeamID, order)
	if err != nil || !root.GetResults()[0].GetIncluded() {
		t.Fatalf("root: %v, %v", root, err)
	}
}

// Another warehouse is refused — NOT_SHIPPED_HERE, the same answer as an id that does not exist, and document_service
// is never asked.
func TestOrderLabels_AnotherWarehouseIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	linker := &fakeLinker{owners: map[string]uint64{"doc-label": 2}}
	svc := labelService(db, linker)

	order := insertLabelOrder(t, db, testWarehouse, "doc-label")

	for name, id := range map[string]uint64{"another warehouse's order": order, "no such order": order + 10_000} {
		res, err := orderLabels(svc, testWarehouse+1, id)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		got := res.GetResults()[0]
		if got.GetIncluded() || got.GetReason() != sellingv1.OrderLabelReason_ORDER_LABEL_REASON_NOT_SHIPPED_HERE ||
			res.GetUrl() != "" || res.GetExpiresAtUnix() != 0 {
			t.Fatalf("%s: %v", name, res)
		}
	}

	if len(linker.asked) != 0 {
		t.Fatalf("document_service was asked for %v before the check passed", linker.asked)
	}
}

// An order with no label attached is NO_LABEL; so is one whose file document_service no longer holds for the seller.
func TestOrderLabels_NoLabelIsSaid(t *testing.T) {
	db := san_testdb.DB(t)
	linker := &fakeLinker{owners: map[string]uint64{"doc-other-team": 3}}
	svc := labelService(db, linker)

	for name, document := range map[string]string{"none attached": "", "the file is not the seller's": "doc-other-team"} {
		order := insertLabelOrder(t, db, testWarehouse, document)

		res, err := orderLabels(svc, testWarehouse, order)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		got := res.GetResults()[0]
		if got.GetIncluded() || got.GetReason() != sellingv1.OrderLabelReason_ORDER_LABEL_REASON_NO_LABEL || res.GetUrl() != "" {
			t.Fatalf("%s: %v", name, res)
		}
	}
}

// A document_service failure that is not "not there" is the call's error, never a quiet NO_LABEL.
func TestOrderLabels_ALinkerFailureIsAnError(t *testing.T) {
	db := san_testdb.DB(t)
	svc := labelService(db, &fakeLinker{err: connect.NewError(connect.CodeUnavailable, errors.New("down"))})

	order := insertLabelOrder(t, db, testWarehouse, "doc-label")

	_, err := orderLabels(svc, testWarehouse, order)
	if connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("err = %v, want Unavailable", err)
	}

	if _, err = orderLabels(labelService(db, nil), testWarehouse, order); connect.CodeOf(err) != connect.CodeUnimplemented {
		t.Fatalf("no linker: %v, want Unimplemented", err)
	}
}

// Who may ask: the warehouse's three roles and Root and the Administrator — never a selling role, who keeps reading its
// own labels with GetDownloadUrl. A read: an agent and the monitor may call it.
func TestOrderLabels_Policy(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.selling.v1.OrderLabelsRequest")
	if err != nil {
		t.Fatal(err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatal("OrderLabelsRequest has no policy")
	}

	want := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	}
	if !slices.Equal(policy.GetRoles(), want) {
		t.Fatalf("roles = %v, want %v", policy.GetRoles(), want)
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.selling.v1.OrderService.OrderLabels")
	if err != nil {
		t.Fatal(err)
	}

	opts, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatal("OrderLabels must be marked NO_SIDE_EFFECTS")
	}
}

// ── several labels, one PDF (a-warehouse-prints-the-labels-of-orders-it-ships) ────────────────────────────────────

// labelSamples are the committed marketplace labels (the-label-samples-may-be-committed).
const labelSamples = "../../../../examples/receipt_file_samples"

// sampleLabel reads one committed label and its page count.
func sampleLabel(t *testing.T, name string) ([]byte, int) {
	t.Helper()

	content, err := os.ReadFile(filepath.Join(labelSamples, name))
	if err != nil {
		t.Skipf("label sample %s: %v", name, err)
	}

	return content, pdfPages(t, content)
}

func pdfPages(t *testing.T, content []byte) int {
	t.Helper()

	n, err := api.PageCount(bytes.NewReader(content), nil)
	if err != nil {
		t.Fatalf("page count: %v", err)
	}

	return n
}

// labelPhoto is a JPEG of w×h — a photo of a courier's slip.
func labelPhoto(t *testing.T, w, h int) []byte {
	t.Helper()

	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := range w {
		for y := range h {
			img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 120, A: 255})
		}
	}

	var buf bytes.Buffer

	err := jpeg.Encode(&buf, img, nil)
	if err != nil {
		t.Fatal(err)
	}

	return buf.Bytes()
}

// SEVERAL ORDERS PRINT AS ONE PDF: the merged file holds exactly the sum of the labels' pages — a PDF its own pages, a
// photo one — is stored once, under the warehouse, and the link is that file.
func TestOrderLabels_SeveralMergeIntoOnePDF(t *testing.T) {
	db := san_testdb.DB(t)

	shopee, shopeePages := sampleLabel(t, "shopee_reg_01.pdf")
	lazada, lazadaPages := sampleLabel(t, "lazada_lex_01.pdf")

	linker := &fakeLinker{
		owners: map[string]uint64{"doc-shopee": 2, "doc-lazada": 2, "doc-photo": 2},
		files: map[string]selling_v1.LabelFile{
			"doc-shopee": {Content: shopee, MimeType: "application/pdf"},
			"doc-lazada": {Content: lazada, MimeType: "application/pdf"},
			"doc-photo":  {Content: labelPhoto(t, 300, 450), MimeType: "image/jpeg"},
		},
	}
	svc := labelService(db, linker)

	a := insertLabelOrder(t, db, testWarehouse, "doc-shopee")
	b := insertLabelOrder(t, db, testWarehouse, "doc-photo")
	c := insertLabelOrder(t, db, testWarehouse, "doc-lazada")

	res, err := orderLabels(svc, testWarehouse, a, b, c)
	if err != nil {
		t.Fatalf("OrderLabels: %v", err)
	}

	for _, result := range res.GetResults() {
		if !result.GetIncluded() || result.GetReason() != sellingv1.OrderLabelReason_ORDER_LABEL_REASON_UNSPECIFIED {
			t.Fatalf("results = %v", res.GetResults())
		}
	}

	if !strings.HasPrefix(res.GetUrl(), "https://files.invalid/merged/labels-") || !strings.HasSuffix(res.GetUrl(), ".pdf") ||
		res.GetExpiresAtUnix() != 1_900_000_100 {
		t.Fatalf("link = %q, expires %d", res.GetUrl(), res.GetExpiresAtUnix())
	}

	if len(linker.stored) != 1 || linker.storedTeam[0] != testWarehouse {
		t.Fatalf("stored %d files under %v, want one under the warehouse", len(linker.stored), linker.storedTeam)
	}

	if got, want := pdfPages(t, linker.stored[0]), shopeePages+1+lazadaPages; got != want {
		t.Fatalf("merged PDF has %d pages, want %d (%d + the photo + %d)", got, want, shopeePages, lazadaPages)
	}

	// THE PAGE ORDER IS THE ASKED ORDER: the photo's page (its own 300×450) comes right after the Shopee label's pages.
	dims, err := api.PageDims(bytes.NewReader(linker.stored[0]), nil)
	if err != nil {
		t.Fatal(err)
	}

	if photo := dims[shopeePages]; photo.Width != 300 || photo.Height != 450 {
		t.Fatalf("page %d is %vx%v, want the photo's 300x450", shopeePages+1, photo.Width, photo.Height)
	}

	// Asked the other way round, the photo is page 1.
	_, err = orderLabels(svc, testWarehouse, b, a)
	if err != nil {
		t.Fatal(err)
	}

	dims, err = api.PageDims(bytes.NewReader(linker.stored[1]), nil)
	if err != nil || dims[0].Width != 300 || dims[0].Height != 450 {
		t.Fatalf("page 1 = %v, %v — want the photo", dims, err)
	}
}

// EVERY REFUSAL IS ITS OWN ORDER'S, and the rest still merge: no label attached, a file that is not the seller's, a
// broken file, a file gone from storage, and another warehouse's order — beside two good labels.
func TestOrderLabels_EachRefusalIsPerOrder(t *testing.T) {
	db := san_testdb.DB(t)

	good, goodPages := sampleLabel(t, "shopee_reg_01.pdf")

	linker := &fakeLinker{
		owners: map[string]uint64{
			"doc-good": 2, "doc-good-2": 2, "doc-broken": 2, "doc-gone": 2, "doc-other-team": 3, "doc-elsewhere": 2,
		},
		files: map[string]selling_v1.LabelFile{
			"doc-good":      {Content: good, MimeType: "application/pdf"},
			"doc-good-2":    {Content: good, MimeType: "application/pdf"},
			"doc-broken":    {Content: []byte("%PDF-1.7 this is not really a pdf"), MimeType: "application/pdf"},
			"doc-elsewhere": {Content: good, MimeType: "application/pdf"},
			// doc-gone is held but has no bytes: gone from storage.
		},
	}
	svc := labelService(db, linker)

	okA := insertLabelOrder(t, db, testWarehouse, "doc-good")
	none := insertLabelOrder(t, db, testWarehouse, "")
	notTheSellers := insertLabelOrder(t, db, testWarehouse, "doc-other-team")
	broken := insertLabelOrder(t, db, testWarehouse, "doc-broken")
	gone := insertLabelOrder(t, db, testWarehouse, "doc-gone")
	elsewhere := insertLabelOrder(t, db, testWarehouse+1, "doc-elsewhere")
	okB := insertLabelOrder(t, db, testWarehouse, "doc-good-2")

	asked := []uint64{okA, none, notTheSellers, broken, gone, elsewhere, okB}

	res, err := orderLabels(svc, testWarehouse, asked...)
	if err != nil {
		t.Fatalf("OrderLabels: %v", err)
	}

	want := map[uint64]sellingv1.OrderLabelReason{
		okA:           sellingv1.OrderLabelReason_ORDER_LABEL_REASON_UNSPECIFIED,
		none:          sellingv1.OrderLabelReason_ORDER_LABEL_REASON_NO_LABEL,
		notTheSellers: sellingv1.OrderLabelReason_ORDER_LABEL_REASON_NO_LABEL,
		broken:        sellingv1.OrderLabelReason_ORDER_LABEL_REASON_UNREADABLE,
		gone:          sellingv1.OrderLabelReason_ORDER_LABEL_REASON_UNREADABLE,
		elsewhere:     sellingv1.OrderLabelReason_ORDER_LABEL_REASON_NOT_SHIPPED_HERE,
		okB:           sellingv1.OrderLabelReason_ORDER_LABEL_REASON_UNSPECIFIED,
	}

	for i, result := range res.GetResults() {
		if result.GetOrderId() != asked[i] {
			t.Fatalf("result %d is order %d, want %d — results come back in the asked order", i, result.GetOrderId(), asked[i])
		}

		reason := want[result.GetOrderId()]
		included := reason == sellingv1.OrderLabelReason_ORDER_LABEL_REASON_UNSPECIFIED

		if result.GetReason() != reason || result.GetIncluded() != included {
			t.Errorf("order %d: included %v reason %v, want included %v reason %v",
				result.GetOrderId(), result.GetIncluded(), result.GetReason(), included, reason)
		}
	}

	if len(linker.stored) != 1 || pdfPages(t, linker.stored[0]) != 2*goodPages {
		t.Fatalf("stored %d files, want one of %d pages", len(linker.stored), 2*goodPages)
	}

	// ANOTHER WAREHOUSE'S ORDER IS NEVER READ: document_service is not asked for its file.
	if slices.Contains(linker.asked, "doc-elsewhere") {
		t.Fatalf("document_service was asked for another warehouse's label: %v", linker.asked)
	}
}

// Nothing printable among several: no link, nothing stored — and still a reason per order.
func TestOrderLabels_NothingPrintableStoresNothing(t *testing.T) {
	db := san_testdb.DB(t)
	linker := &fakeLinker{
		owners: map[string]uint64{"doc-broken": 2},
		files:  map[string]selling_v1.LabelFile{"doc-broken": {Content: []byte("nope"), MimeType: "image/png"}},
	}
	svc := labelService(db, linker)

	broken := insertLabelOrder(t, db, testWarehouse, "doc-broken")
	none := insertLabelOrder(t, db, testWarehouse, "")

	res, err := orderLabels(svc, testWarehouse, broken, none)
	if err != nil {
		t.Fatalf("OrderLabels: %v", err)
	}

	if res.GetUrl() != "" || res.GetExpiresAtUnix() != 0 || len(linker.stored) != 0 {
		t.Fatalf("link %q, stored %d", res.GetUrl(), len(linker.stored))
	}

	if res.GetResults()[0].GetReason() != sellingv1.OrderLabelReason_ORDER_LABEL_REASON_UNREADABLE ||
		res.GetResults()[1].GetReason() != sellingv1.OrderLabelReason_ORDER_LABEL_REASON_NO_LABEL {
		t.Fatalf("results = %v", res.GetResults())
	}
}

// Two orders naming the SAME file — one label for both parcels — print it once, and both are in.
func TestOrderLabels_ASharedFilePrintsOnce(t *testing.T) {
	db := san_testdb.DB(t)

	label, pages := sampleLabel(t, "shopee_reg_01.pdf")

	linker := &fakeLinker{
		owners: map[string]uint64{"doc-shared": 2},
		files:  map[string]selling_v1.LabelFile{"doc-shared": {Content: label, MimeType: "application/pdf"}},
	}
	svc := labelService(db, linker)

	a := insertLabelOrder(t, db, testWarehouse, "doc-shared")
	b := insertLabelOrder(t, db, testWarehouse, "doc-shared")

	res, err := orderLabels(svc, testWarehouse, a, b)
	if err != nil {
		t.Fatalf("OrderLabels: %v", err)
	}

	if !res.GetResults()[0].GetIncluded() || !res.GetResults()[1].GetIncluded() {
		t.Fatalf("results = %v", res.GetResults())
	}

	if got := pdfPages(t, linker.stored[0]); got != pages {
		t.Fatalf("merged %d pages, want the one file's %d", got, pages)
	}
}

// ONE ID WORKS AS BEFORE: the link is that order's own file — nothing is read, merged or stored, and a photo label
// stays a photo.
func TestOrderLabels_OneIDIsItsOwnFile(t *testing.T) {
	db := san_testdb.DB(t)
	linker := &fakeLinker{
		owners: map[string]uint64{"doc-photo": 2},
		files:  map[string]selling_v1.LabelFile{"doc-photo": {Content: labelPhoto(t, 20, 30), MimeType: "image/jpeg"}},
	}
	svc := labelService(db, linker)

	order := insertLabelOrder(t, db, testWarehouse, "doc-photo")

	res, err := orderLabels(svc, testWarehouse, order)
	if err != nil {
		t.Fatalf("OrderLabels: %v", err)
	}

	if res.GetUrl() != "https://files.invalid/doc-photo" || !res.GetResults()[0].GetIncluded() || len(linker.stored) != 0 {
		t.Fatalf("link %q, results %v, stored %d", res.GetUrl(), res.GetResults(), len(linker.stored))
	}
}

// Root merges any warehouse's orders, and the file is stored under the root team it asked as.
func TestOrderLabels_RootMergesAnyWarehouses(t *testing.T) {
	db := san_testdb.DB(t)

	label, pages := sampleLabel(t, "shopee_reg_01.pdf")

	linker := &fakeLinker{
		owners: map[string]uint64{"doc-a": 2, "doc-b": 2},
		files: map[string]selling_v1.LabelFile{
			"doc-a": {Content: label, MimeType: "application/pdf"},
			"doc-b": {Content: label, MimeType: "application/pdf"},
		},
	}
	svc := labelService(db, linker)

	a := insertLabelOrder(t, db, testWarehouse, "doc-a")
	b := insertLabelOrder(t, db, testWarehouse+1, "doc-b")

	res, err := orderLabels(svc, san_auth.RootTeamID, a, b)
	if err != nil || !res.GetResults()[0].GetIncluded() || !res.GetResults()[1].GetIncluded() {
		t.Fatalf("root: %v, %v", res, err)
	}

	if linker.storedTeam[0] != san_auth.RootTeamID || pdfPages(t, linker.stored[0]) != 2*pages {
		t.Fatalf("stored under %v, %d pages", linker.storedTeam, pdfPages(t, linker.stored[0]))
	}
}

// A failure reading or storing the files is the call's error, never a quiet refusal.
func TestOrderLabels_AMergeFailureIsAnError(t *testing.T) {
	db := san_testdb.DB(t)

	label, _ := sampleLabel(t, "shopee_reg_01.pdf")

	a := insertLabelOrder(t, db, testWarehouse, "doc-a")
	b := insertLabelOrder(t, db, testWarehouse, "doc-b")

	readFails := &fakeLinker{err: connect.NewError(connect.CodeUnavailable, errors.New("down"))}

	_, err := orderLabels(labelService(db, readFails), testWarehouse, a, b)
	if connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("read failure = %v, want Unavailable", err)
	}

	storeFails := &fakeLinker{
		owners: map[string]uint64{"doc-a": 2, "doc-b": 2},
		files: map[string]selling_v1.LabelFile{
			"doc-a": {Content: label, MimeType: "application/pdf"},
			"doc-b": {Content: label, MimeType: "application/pdf"},
		},
		storeErr: connect.NewError(connect.CodeInternal, errors.New("disk full")),
	}

	_, err = orderLabels(labelService(db, storeFails), testWarehouse, a, b)
	if connect.CodeOf(err) != connect.CodeInternal {
		t.Fatalf("store failure = %v, want Internal", err)
	}
}

// The cap: up to 50 ids, the warehouse list's largest page — and no repeat, no zero.
func TestOrderLabels_UpToFiftyIDs(t *testing.T) {
	v, err := protovalidate.New()
	if err != nil {
		t.Fatal(err)
	}

	ids := func(n int) []uint64 {
		out := make([]uint64, 0, n)
		for i := range n {
			out = append(out, uint64(i+1))
		}

		return out
	}

	err = v.Validate(&sellingv1.OrderLabelsRequest{TeamId: testWarehouse, OrderIds: ids(50)})
	if err != nil {
		t.Fatalf("50 ids refused: %v", err)
	}

	for name, req := range map[string]*sellingv1.OrderLabelsRequest{
		"51 ids":    {TeamId: testWarehouse, OrderIds: ids(51)},
		"no id":     {TeamId: testWarehouse},
		"a repeat":  {TeamId: testWarehouse, OrderIds: []uint64{7, 7}},
		"no team":   {OrderIds: []uint64{7}},
		"a zero id": {TeamId: testWarehouse, OrderIds: []uint64{0}},
	} {
		if v.Validate(req) == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
