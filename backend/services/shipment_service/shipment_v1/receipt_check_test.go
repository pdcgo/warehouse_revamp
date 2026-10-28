package shipment_v1_test

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"connectrpc.com/connect"
	"connectrpc.com/validate"
	"github.com/pdcgo/san_receipt_readers"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1/shipmentv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	shipment_service "github.com/pdcgo/warehouse_revamp/backend/services/shipment_service"
	shipment_v1 "github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
)

// ReceiptCheck touches no table, so these tests need no database: the service is built with none.
//
// The labels are the real samples the reader's own tests read (the-label-samples-may-be-committed). Their
// values are compared with what Extract itself says rather than written out here — the reader's tests
// own what a label says; these own that the RPC hands it over unchanged.

// receiptSamples is the reader's samples folder, from this package's directory.
const receiptSamples = "../../../../examples/receipt_file_samples"

func sample(t *testing.T, name string) []byte {
	t.Helper()

	data, err := os.ReadFile(filepath.Join(receiptSamples, name))
	if os.IsNotExist(err) {
		t.Skipf("no receipt sample %s", name)
	}
	if err != nil {
		t.Fatal(err)
	}

	return data
}

func receiptCheck(t *testing.T, content []byte) *shipmentv1.ReceiptCheckResponse {
	t.Helper()

	resp, err := shipment_v1.NewService(nil).ReceiptCheck(context.Background(), connect.NewRequest(&shipmentv1.ReceiptCheckRequest{
		FileContent: content,
	}))
	if err != nil {
		t.Fatalf("ReceiptCheck: an outcome about the file must be a result, never an error: %v", err)
	}

	return resp.Msg
}

// assertNothingRead — every field is "" unless the result is READ, so a file that is not a label fills
// nothing on the form and contradicts nothing.
func assertNothingRead(t *testing.T, got *shipmentv1.ReceiptCheckResponse) {
	t.Helper()

	if got.GetReceipt() != "" || got.GetOrderRefId() != "" || got.GetCustomerName() != "" || got.GetPhone() != "" || got.GetAddress() != "" {
		t.Fatalf("result %v carried fields: %+v", got.GetResult(), got)
	}
}

// A known label answers READ with BOTH numbers — the two the order form fills.
func TestReceiptCheck_AKnownLabelReturnsBothNumbers(t *testing.T) {
	for _, name := range []string{"jnttest.pdf", "shopee_spx_01.pdf", "lazada_lex_01.pdf", "tiktokshop_01.pdf"} {
		t.Run(name, func(t *testing.T) {
			got := receiptCheck(t, sample(t, name))

			if got.GetResult() != shipmentv1.ReceiptCheckResult_RECEIPT_CHECK_RESULT_READ {
				t.Fatalf("result = %v, want READ", got.GetResult())
			}
			if got.GetReceipt() == "" || got.GetOrderRefId() == "" {
				t.Fatalf("receipt = %q, order_ref_id = %q: a known label carries both", got.GetReceipt(), got.GetOrderRefId())
			}
			if got.GetReceipt() == got.GetOrderRefId() {
				t.Fatalf("the receipt and the order ref are the same string %q", got.GetReceipt())
			}
		})
	}
}

// receipt-check-returns-what-the-library-reads: on EVERY sample the response is Extract's ReceiptData field
// for field — READ exactly when Extract read it, and nothing added, dropped or renamed on the way.
func TestReceiptCheck_ReturnsWhatTheLibraryReads(t *testing.T) {
	entries, err := os.ReadDir(receiptSamples)
	if os.IsNotExist(err) {
		t.Skipf("no receipt samples at %s", receiptSamples)
	}
	if err != nil {
		t.Fatal(err)
	}

	checked := 0
	for _, entry := range entries {
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".pdf") {
			continue
		}
		checked++

		t.Run(entry.Name(), func(t *testing.T) {
			content := sample(t, entry.Name())

			want, extractErr := san_receipt_readers.Extract(bytes.NewReader(content))
			got := receiptCheck(t, content)

			if extractErr != nil {
				if got.GetResult() == shipmentv1.ReceiptCheckResult_RECEIPT_CHECK_RESULT_READ {
					t.Fatalf("Extract refused it (%v) and the RPC says READ", extractErr)
				}
				assertNothingRead(t, got)

				return
			}

			if got.GetResult() != shipmentv1.ReceiptCheckResult_RECEIPT_CHECK_RESULT_READ {
				t.Fatalf("Extract read it and the RPC says %v", got.GetResult())
			}

			pairs := []struct{ field, got, want string }{
				{"receipt", got.GetReceipt(), want.Receipt},
				{"order_ref_id", got.GetOrderRefId(), want.OrderID},
				{"customer_name", got.GetCustomerName(), want.CustomerName},
				{"phone", got.GetPhone(), want.Phone},
				{"address", got.GetAddress(), want.Address},
			}
			for _, p := range pairs {
				if p.got != p.want {
					t.Errorf("%s differs from what Extract read", p.field)
				}
			}
		})
	}

	if checked == 0 {
		t.Skipf("no .pdf in %s", receiptSamples)
	}
}

// a-label-outcome-is-a-result-not-an-error: a file READ and found to be no courier's label (the Canva address
// labels, a screenshot of a note) is NOT_SHIPPING_LABEL in a successful response.
func TestReceiptCheck_NotALabelIsAResult(t *testing.T) {
	names := []string{"pdc_sample_01.pdf", "pdc_sample_02.pdf", "pdc_sample_03.pdf"}

	extra, err := os.ReadDir(filepath.Join(receiptSamples, "pdc_samples"))
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	for _, entry := range extra {
		if !entry.IsDir() && strings.EqualFold(filepath.Ext(entry.Name()), ".pdf") {
			names = append(names, filepath.Join("pdc_samples", entry.Name()))
		}
	}

	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			got := receiptCheck(t, sample(t, name))

			if got.GetResult() != shipmentv1.ReceiptCheckResult_RECEIPT_CHECK_RESULT_NOT_SHIPPING_LABEL {
				t.Fatalf("result = %v, want NOT_SHIPPING_LABEL", got.GetResult())
			}
			assertNothingRead(t, got)
		})
	}
}

// …and a file that could not be read at all is UNREADABLE, never an error — the order form says "this file
// can't be opened" and the person types the numbers.
func TestReceiptCheck_AnUnreadableFileIsAResult(t *testing.T) {
	for name, content := range map[string][]byte{
		"not a pdf":       []byte("hello, this is not a label"),
		"a png":           {0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a},
		"a header only":   []byte("%PDF-1.4 e2e receipt"),
		"a truncated pdf": sample(t, "jnttest.pdf")[:400],
	} {
		t.Run(name, func(t *testing.T) {
			got := receiptCheck(t, content)

			if got.GetResult() != shipmentv1.ReceiptCheckResult_RECEIPT_CHECK_RESULT_UNREADABLE {
				t.Fatalf("result = %v, want UNREADABLE", got.GetResult())
			}
			assertNothingRead(t, got)
		})
	}
}

// ⚠ A BULK PRINT IS UNKNOWN_LABEL FOR NOW. The reader refuses a file of several labels — it never reads page
// 1 — but its error for that is unexported (receipt_readers critique 4), so the RPC cannot tell it from a
// label it has not learned. Nothing is filled either way. This test changes to MULTIPLE_LABELS the day the
// reader exports the error.
func TestReceiptCheck_SeveralLabelsAreUnknownUntilTheReaderNamesThem(t *testing.T) {
	// One page alone IS a label — so the bulk print below is refused for being two, not for its layout.
	one := receiptCheck(t, labelPDF(jntPage("JY1234567890", "581234567890123456")))
	if one.GetResult() != shipmentv1.ReceiptCheckResult_RECEIPT_CHECK_RESULT_READ || one.GetReceipt() != "JY1234567890" {
		t.Fatalf("one synthetic label: %+v, want READ JY1234567890", one)
	}

	got := receiptCheck(t, labelPDF(
		jntPage("JY1234567890", "581234567890123456"),
		jntPage("JY0987654321", "589876543210987654"),
	))

	if got.GetResult() != shipmentv1.ReceiptCheckResult_RECEIPT_CHECK_RESULT_UNKNOWN_LABEL {
		t.Fatalf("result = %v, want UNKNOWN_LABEL", got.GetResult())
	}
	assertNothingRead(t, got)
}

// receipt-check-logs-only-the-result: the log line names the result and the size, and never a number, a name
// or an address off the label.
func TestReceiptCheck_LogsOnlyTheResult(t *testing.T) {
	var logged bytes.Buffer

	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logged, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	content := sample(t, "shopee_spx_01.pdf")
	got := receiptCheck(t, content)

	line := logged.String()
	if !strings.Contains(line, "result=RECEIPT_CHECK_RESULT_READ") || !strings.Contains(line, fmt.Sprintf("size=%d", len(content))) {
		t.Fatalf("the log line must carry the result and the size: %q", line)
	}

	for field, value := range map[string]string{
		"receipt":       got.GetReceipt(),
		"order_ref_id":  got.GetOrderRefId(),
		"customer_name": got.GetCustomerName(),
		"address":       got.GetAddress(),
	} {
		if value != "" && strings.Contains(line, value) {
			t.Errorf("the log line carries the label's %s", field)
		}
	}
}

// an-attached-file-is-up-to-15-mb-and-two-checks-run-at-once: two checks run at once, and a third is refused AT ONCE
// with ResourceExhausted — not queued behind the two, and never handed to the reader. When one of the two finishes,
// its slot serves the next call.
func TestReceiptCheck_TwoChecksRunAtOnceAndTheThirdIsRefused(t *testing.T) {
	entered := make(chan struct{}, 2)
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })

	var reads atomic.Int32

	// A file reading "hold" stays in the reader until the test releases it — no real label is slow enough to race
	// against. Anything else is answered at once.
	svc := shipment_v1.NewServiceWithExtract(func(r io.Reader) (san_receipt_readers.ReceiptData, error) {
		reads.Add(1)

		body, _ := io.ReadAll(r)
		if string(body) == "hold" {
			entered <- struct{}{}
			<-release
		}

		return san_receipt_readers.ReceiptData{}, san_receipt_readers.ErrUnreadable
	})

	check := func(content string) error {
		_, err := svc.ReceiptCheck(context.Background(), connect.NewRequest(&shipmentv1.ReceiptCheckRequest{
			FileContent: []byte(content),
		}))

		return err
	}

	// answered fails the test when `ch` has said nothing in time — for a call, that means it WAITED for a slot.
	answered := func(what string, ch <-chan error) error {
		t.Helper()

		select {
		case err := <-ch:
			return err
		case <-time.After(5 * time.Second):
			t.Fatalf("%s never answered", what)

			return nil
		}
	}

	async := func(content string) <-chan error {
		ch := make(chan error, 1)
		go func() { ch <- check(content) }()

		return ch
	}

	// The two held checks answer on ONE channel: which of them a release lets go is the runtime's choice.
	held := make(chan error, 2)
	for range 2 {
		go func() { held <- check("hold") }()
	}

	for i := range 2 {
		select {
		case <-entered:
		case <-time.After(5 * time.Second):
			t.Fatalf("held check %d never reached the reader", i+1)
		}
	}

	err := answered("the third check, with two held", async("quick"))
	if connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("the third check: %v, want ResourceExhausted", err)
	}
	if got := reads.Load(); got != 2 {
		t.Fatalf("the reader ran %d times, want 2 — a refused check must never reach it", got)
	}

	// One of the two finishes, and its slot is free again — while the other still holds its own.
	release <- struct{}{}

	err = answered("a released check", held)
	if err != nil {
		t.Fatalf("a held check, released: %v", err)
	}

	err = answered("a check after one finished", async("quick"))
	if err != nil {
		t.Fatalf("a check after one of the two finished: %v, want it served", err)
	}

	release <- struct{}{}

	err = answered("the other held check", held)
	if err != nil {
		t.Fatalf("the other held check, released: %v", err)
	}
}

// ── mounted, as service_api.go mounts it ─────────────────────────────────────────────────────────────

// noRoles is a caller who belongs to no team at all — and the check needs none (receipt-check-needs-a-login).
type noRoles struct{}

func (noRoles) Resolve(context.Context, uint64, uint64) (access_interceptors.Access, error) {
	return access_interceptors.Access{}, nil
}

func (noRoles) Invalidate(context.Context, uint64) error { return nil }

// mountedReceipt serves shipment_service through its register.go behind the app's own chain (the validator,
// then the access interceptor), and returns a client and a token for a user in no team.
func mountedReceipt(t *testing.T, opts ...connect.ClientOption) (shipmentv1connect.ReceiptServiceClient, string) {
	t.Helper()

	signer := san_auth.NewSigner("receipt-check-test", time.Hour)
	chain := connect.WithInterceptors(validate.NewInterceptor(), access_interceptors.NewInterceptor(signer, noRoles{}))

	mux := http.NewServeMux()
	san_grpc.Register(mux, shipment_service.NewRegister(mux, shipment_v1.NewService(nil), chain))

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	token, err := signer.Sign(&role_basev1.Identity{
		IdentityId:   61,
		Username:     "cs",
		IdentityType: role_basev1.IdentityType_IDENTITY_TYPE_GENERAL_USER,
	}, time.Now())
	if err != nil {
		t.Fatal(err)
	}

	return shipmentv1connect.NewReceiptServiceClient(server.Client(), server.URL, opts...), token
}

func call(client shipmentv1connect.ReceiptServiceClient, token string, content []byte) (*shipmentv1.ReceiptCheckResponse, error) {
	req := connect.NewRequest(&shipmentv1.ReceiptCheckRequest{FileContent: content})
	if token != "" {
		req.Header().Set("Authorization", "Bearer "+token)
	}

	resp, err := client.ReceiptCheck(context.Background(), req)
	if err != nil {
		return nil, err
	}

	return resp.Msg, nil
}

// receipt-check-needs-a-login: no token is refused; any valid token is enough, with no role in any team.
func TestReceiptCheck_NeedsALoginAndNothingMore(t *testing.T) {
	client, token := mountedReceipt(t)
	label := sample(t, "jnttest.pdf")

	_, err := call(client, "", label)
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("no token: %v, want Unauthenticated", err)
	}

	got, err := call(client, token, label)
	if err != nil {
		t.Fatalf("a signed-in user in no team: %v", err)
	}
	if got.GetResult() != shipmentv1.ReceiptCheckResult_RECEIPT_CHECK_RESULT_READ {
		t.Fatalf("result = %v, want READ", got.GetResult())
	}
}

// receipt-check-caps-the-body-before-reading: a body over 3 MB is refused by the TRANSPORT — ResourceExhausted,
// before the validator could say InvalidArgument — while a file over 2 MB under that body cap is the
// validator's InvalidArgument, and the largest file the browser may send, as JSON, still fits.
func TestReceiptCheck_CapsTheBodyBeforeReading(t *testing.T) {
	pdfOf := func(n int) []byte {
		return append([]byte("%PDF-1.4\n"), make([]byte, n-len("%PDF-1.4\n"))...)
	}

	t.Run("a body over 3 MB is never read", func(t *testing.T) {
		client, token := mountedReceipt(t)

		_, err := call(client, token, pdfOf(3<<20+1))
		if connect.CodeOf(err) != connect.CodeResourceExhausted {
			t.Fatalf("err = %v, want ResourceExhausted", err)
		}
	})

	t.Run("a file over 2 MB is invalid", func(t *testing.T) {
		client, token := mountedReceipt(t)

		_, err := call(client, token, pdfOf(2<<20+1))
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("err = %v, want InvalidArgument", err)
		}
	})

	t.Run("a 2 MB file sent as JSON fits under the cap", func(t *testing.T) {
		client, token := mountedReceipt(t, connect.WithProtoJSON())

		got, err := call(client, token, pdfOf(2<<20))
		if err != nil {
			t.Fatalf("a 2 MB file as base64 JSON was refused: %v", err)
		}
		if got.GetResult() != shipmentv1.ReceiptCheckResult_RECEIPT_CHECK_RESULT_UNREADABLE {
			t.Fatalf("result = %v, want UNREADABLE (a header and zeros)", got.GetResult())
		}
	})
}

// ── a synthetic bulk print ───────────────────────────────────────────────────────────────────────────

// labelText is one string drawn on a synthetic page.
type labelText struct {
	x, y, size float64
	s          string
	rotated    bool
}

// jntPage is a J&T label's structure with invented numbers — the page the reader's own tests draw
// (jntPage in its receipt_test.go). Those helpers are its package's, so the page is repeated here.
func jntPage(tracking, orderID string) []labelText {
	return []labelText{
		{x: 130, y: 396, size: 20, s: "ECO"},
		{x: 284, y: 300, size: 6, s: tracking, rotated: true},
		{x: 20, y: 375, size: 7, s: "Pengirim : Toko Contoh"},
		{x: 20, y: 282, size: 6, s: "Weight : 0.400 KG"},
		{x: 150, y: 282, size: 6, s: "Ship : 01-01-2026"},
		{x: 140, y: 250, size: 30, s: "COD"},
		{x: 120, y: 160, size: 20, s: "000-XXX00-00"},
		{x: 120, y: 80, size: 20, s: tracking},
		{x: 60, y: 70, size: 5, s: "Syarat dan ketentuan pengiriman dapat dilihat pada website www.jet.co.id"},
		{x: 20, y: 55, size: 7, s: "Order Id :"},
		{x: 70, y: 55, size: 7, s: orderID},
		{x: 180, y: 55, size: 7, s: "Estimated Date:"},
	}
}

// labelPDF writes one Helvetica page per argument. Helvetica carries no widths, so character spacing (Tc)
// advances each glyph by half its size, the way the J&T generator positions every glyph itself.
func labelPDF(pages ...[]labelText) []byte {
	// 1 the catalog, 2 the page tree, 3 the font, then a content stream and a page per page.
	objects := []string{"", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"}
	kids := []string{}

	for _, page := range pages {
		var content strings.Builder
		for _, t := range page {
			matrix := "1 0 0 1"
			if t.rotated {
				matrix = "0 1 -1 0"
			}
			fmt.Fprintf(&content, "BT /F1 %g Tf %g Tc %s %g %g Tm (%s) Tj ET\n", t.size, t.size*0.5, matrix, t.x, t.y, t.s)
		}

		objects = append(objects, fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", content.Len(), content.String()))
		objects = append(objects, fmt.Sprintf(
			"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 420] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>",
			len(objects),
		))
		kids = append(kids, fmt.Sprintf("%d 0 R", len(objects)))
	}

	objects[0] = "<< /Type /Catalog /Pages 2 0 R >>"
	objects[1] = fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), len(kids))

	var b bytes.Buffer
	b.WriteString("%PDF-1.4\n")

	offsets := make([]int, len(objects))
	for i, object := range objects {
		offsets[i] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, object)
	}

	// Every xref entry is exactly 20 bytes, its own line ending included.
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
	for _, offset := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, xref)

	return b.Bytes()
}
