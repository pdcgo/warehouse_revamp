package selling_v1_test

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/pdfcpu/pdfcpu/pkg/api"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// THE UNBOXING WARNING (the-unboxing-warning-is-one-sentence-on-each-label): OrderLabels with `unboxing_warning` on
// stamps the one sentence on EVERY page of the stored PDF — a PDF label's pages and a photo's page alike, and one asked
// order too; off, the labels print as they are.

func orderLabelsWarned(svc *selling_v1.Service, teamID uint64, warn bool, orderIDs ...uint64) (*sellingv1.OrderLabelsResponse, error) {
	res, err := svc.OrderLabels(context.Background(), connect.NewRequest(&sellingv1.OrderLabelsRequest{
		TeamId:          teamID,
		OrderIds:        orderIDs,
		UnboxingWarning: warn,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// stampedLabelPages reads a stored PDF back and counts the pages whose own content draws a form writing `text`.
func stampedLabelPages(t *testing.T, content []byte, text string) (stamped, pages int) {
	t.Helper()

	ctx, err := api.ReadAndValidate(bytes.NewReader(content), nil)
	if err != nil {
		t.Fatalf("read the stored PDF back: %v", err)
	}

	want := []byte("(" + text + ") Tj")

	for i := 1; i <= ctx.PageCount; i++ {
		page, _, _, err := ctx.PageDict(i, false)
		if err != nil {
			t.Fatalf("page %d: %v", i, err)
		}

		drawn, err := ctx.PageContent(page, i)
		if err != nil {
			t.Fatalf("page %d content: %v", i, err)
		}

		resources, _ := ctx.DereferenceDict(page["Resources"])
		forms, _ := ctx.DereferenceDict(resources["XObject"])

		for name, ref := range forms {
			form, _, err := ctx.DereferenceStreamDict(ref)
			if err != nil || form == nil {
				continue
			}

			err = form.Decode()
			if err != nil {
				continue
			}

			if bytes.Contains(form.Content, want) && bytes.Contains(drawn, []byte("/"+name+" Do")) {
				stamped++

				break
			}
		}
	}

	return stamped, ctx.PageCount
}

// ON: a two-page Lazada label and a photo merge into one PDF whose every page — the photo's too — carries the sentence;
// and ONE order asked with the warning is merged and stored too (its own file has no such line), its one page stamped.
func TestOrderLabels_TheUnboxingWarningIsOnEveryPage(t *testing.T) {
	db := san_testdb.DB(t)

	lazada, lazadaPages := sampleLabel(t, "lazada_lex_03.pdf")

	linker := &fakeLinker{
		owners: map[string]uint64{"doc-lazada": 2, "doc-photo": 2},
		files: map[string]selling_v1.LabelFile{
			"doc-lazada": {Content: lazada, MimeType: "application/pdf"},
			"doc-photo":  {Content: labelPhoto(t, 300, 450), MimeType: "image/jpeg"},
		},
	}
	svc := labelService(db, linker)

	a := insertLabelOrder(t, db, testWarehouse, "doc-lazada")
	b := insertLabelOrder(t, db, testWarehouse, "doc-photo")

	res, err := orderLabelsWarned(svc, testWarehouse, true, a, b)
	if err != nil {
		t.Fatalf("OrderLabels: %v", err)
	}

	if !res.GetResults()[0].GetIncluded() || !res.GetResults()[1].GetIncluded() || len(linker.stored) != 1 {
		t.Fatalf("results %v, stored %d — want both in one stored PDF", res.GetResults(), len(linker.stored))
	}

	stamped, pages := stampedLabelPages(t, linker.stored[0], selling_v1.UnboxingWarning)
	if pages != lazadaPages+1 || stamped != pages {
		t.Fatalf("%d of %d pages carry the warning, want every one of %d", stamped, pages, lazadaPages+1)
	}

	// ONE order, with the warning: merged and stored under the warehouse — never its own unstamped file.
	res, err = orderLabelsWarned(svc, testWarehouse, true, b)
	if err != nil {
		t.Fatalf("OrderLabels one: %v", err)
	}

	if len(linker.stored) != 2 || linker.storedTeam[1] != testWarehouse ||
		!strings.HasPrefix(res.GetUrl(), "https://files.invalid/merged/labels-") || !res.GetResults()[0].GetIncluded() {
		t.Fatalf("one order with the warning: link %q, stored %d, results %v — want a stored, stamped PDF",
			res.GetUrl(), len(linker.stored), res.GetResults())
	}

	stamped, pages = stampedLabelPages(t, linker.stored[1], selling_v1.UnboxingWarning)
	if pages != 1 || stamped != 1 {
		t.Fatalf("one order: %d of %d pages carry the warning, want its one page", stamped, pages)
	}
}

// OFF: the same orders print as they are — no page carries the sentence — and one order is its own file, as before.
func TestOrderLabels_NoUnboxingWarningStampsNone(t *testing.T) {
	db := san_testdb.DB(t)

	lazada, lazadaPages := sampleLabel(t, "lazada_lex_03.pdf")

	linker := &fakeLinker{
		owners: map[string]uint64{"doc-lazada": 2, "doc-photo": 2},
		files: map[string]selling_v1.LabelFile{
			"doc-lazada": {Content: lazada, MimeType: "application/pdf"},
			"doc-photo":  {Content: labelPhoto(t, 300, 450), MimeType: "image/jpeg"},
		},
	}
	svc := labelService(db, linker)

	a := insertLabelOrder(t, db, testWarehouse, "doc-lazada")
	b := insertLabelOrder(t, db, testWarehouse, "doc-photo")

	_, err := orderLabelsWarned(svc, testWarehouse, false, a, b)
	if err != nil {
		t.Fatalf("OrderLabels: %v", err)
	}

	stamped, pages := stampedLabelPages(t, linker.stored[0], selling_v1.UnboxingWarning)
	if pages != lazadaPages+1 || stamped != 0 {
		t.Fatalf("%d of %d pages carry the warning, want none", stamped, pages)
	}

	has, err := api.HasWatermarks(bytes.NewReader(linker.stored[0]), nil)
	if err != nil || has {
		t.Fatalf("the PDF carries a stamp (%v, %v)", has, err)
	}

	res, err := orderLabelsWarned(svc, testWarehouse, false, b)
	if err != nil {
		t.Fatalf("OrderLabels one: %v", err)
	}

	if res.GetUrl() != "https://files.invalid/doc-photo" || len(linker.stored) != 1 {
		t.Fatalf("one order without the warning: link %q, stored %d — want its own file, nothing stored", res.GetUrl(), len(linker.stored))
	}
}
