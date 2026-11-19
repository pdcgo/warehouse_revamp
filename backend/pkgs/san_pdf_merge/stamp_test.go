package san_pdf_merge_test

import (
	"bytes"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_pdf_merge"
)

// THE UNBOXING WARNING (the-unboxing-warning-is-one-sentence-on-each-label): one line on EVERY page of the merged PDF,
// or on none.

const line = "Wajib video unboxing saat membuka paket"

// everyLabel is every committed label, a JPEG photo and a PNG — a picture's page must carry the line as a PDF's does.
func everyLabel(t *testing.T) []san_pdf_merge.File {
	t.Helper()

	files := []san_pdf_merge.File{}
	for _, path := range samplePDFs(t) {
		files = append(files, san_pdf_merge.File{Content: read(t, path), MimeType: "application/pdf"})
	}

	return append(files,
		san_pdf_merge.File{Content: picture(t, jpegOf, 400, 300), MimeType: "image/jpeg"},
		san_pdf_merge.File{Content: picture(t, pngOf, 300, 420), MimeType: "image/png"},
	)
}

// stampedPages reads the merged PDF back and counts the pages whose own content DRAWS a form that writes the line — the
// stamp is on the page only when the page invokes it, not when the form merely sits in the file.
func stampedPages(t *testing.T, content []byte, text string) (stamped, pages int) {
	t.Helper()

	ctx, err := api.ReadAndValidate(bytes.NewReader(content), nil)
	if err != nil {
		t.Fatalf("read the merged PDF back: %v", err)
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

// ON: every page — each label's every page, and each photo's — draws the line, the page count is unchanged and the file
// keeps its plain form (no object streams).
func TestMerge_TheStampIsOnEveryPage(t *testing.T) {
	files := everyLabel(t)

	plain, _, err := san_pdf_merge.Merge(files)
	if err != nil {
		t.Fatalf("Merge: %v", err)
	}

	out, results, err := san_pdf_merge.Merge(files, san_pdf_merge.StampEveryPage(line))
	if err != nil {
		t.Fatalf("Merge stamped: %v", err)
	}

	for i, result := range results {
		if result.Err != nil {
			t.Fatalf("file %d refused: %v", i, result.Err)
		}
	}

	stamped, pages := stampedPages(t, out, line)
	if pages != pagesOf(t, plain) {
		t.Fatalf("the stamped PDF has %d pages, the plain one %d", pages, pagesOf(t, plain))
	}

	if pages < len(files) || stamped != pages {
		t.Fatalf("%d of %d pages carry the line, want every one", stamped, pages)
	}

	if bytes.Contains(out, []byte("/ObjStm")) {
		t.Fatal("the stamped file holds object streams")
	}
}

// OFF: no option, or an empty line, stamps nothing — the labels print as they are.
func TestMerge_NoStampStampsNone(t *testing.T) {
	files := everyLabel(t)

	for name, opts := range map[string][]san_pdf_merge.Option{
		"no option":  nil,
		"empty line": {san_pdf_merge.StampEveryPage("  ")},
	} {
		out, _, err := san_pdf_merge.Merge(files, opts...)
		if err != nil {
			t.Fatalf("%s: Merge: %v", name, err)
		}

		stamped, pages := stampedPages(t, out, line)
		if stamped != 0 || pages == 0 {
			t.Fatalf("%s: %d of %d pages carry a line, want none", name, stamped, pages)
		}

		has, err := api.HasWatermarks(bytes.NewReader(out), nil)
		if err != nil || has {
			t.Fatalf("%s: the file carries a stamp (%v, %v)", name, has, err)
		}
	}
}
