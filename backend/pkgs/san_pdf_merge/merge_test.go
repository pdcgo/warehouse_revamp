package san_pdf_merge_test

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"testing"

	"github.com/pdfcpu/pdfcpu/pkg/api"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_pdf_merge"
)

// samples are the committed marketplace labels (the-label-samples-may-be-committed).
const samples = "../../../examples/receipt_file_samples"

func samplePDFs(t testing.TB) []string {
	t.Helper()

	paths, err := filepath.Glob(filepath.Join(samples, "*.pdf"))
	if err != nil {
		t.Fatal(err)
	}

	if len(paths) == 0 {
		t.Skip("no label samples in " + samples)
	}

	sort.Strings(paths)

	return paths
}

func read(t testing.TB, path string) []byte {
	t.Helper()

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	return content
}

func pagesOf(t testing.TB, content []byte) int {
	t.Helper()

	n, err := api.PageCount(bytes.NewReader(content), nil)
	if err != nil {
		t.Fatalf("page count: %v", err)
	}

	return n
}

func picture(t testing.TB, encode func(*bytes.Buffer, image.Image) error, w, h int) []byte {
	t.Helper()

	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := range w {
		for y := range h {
			img.Set(x, y, color.RGBA{R: uint8(x), G: uint8(y), B: 90, A: 255})
		}
	}

	var buf bytes.Buffer

	err := encode(&buf, img)
	if err != nil {
		t.Fatal(err)
	}

	return buf.Bytes()
}

func pngOf(buf *bytes.Buffer, img image.Image) error  { return png.Encode(buf, img) }
func jpegOf(buf *bytes.Buffer, img image.Image) error { return jpeg.Encode(buf, img, nil) }

// Every committed label merges, and the merged PDF holds exactly the sum of their pages, file by file.
func TestMerge_EveryLabelAddsItsPages(t *testing.T) {
	paths := samplePDFs(t)

	files := make([]san_pdf_merge.File, 0, len(paths))
	want := 0

	for _, path := range paths {
		content := read(t, path)
		files = append(files, san_pdf_merge.File{Content: content, MimeType: "application/pdf"})
		want += pagesOf(t, content)
	}

	out, results, err := san_pdf_merge.Merge(files)
	if err != nil {
		t.Fatalf("Merge: %v", err)
	}

	sum := 0

	for i, result := range results {
		if result.Err != nil {
			t.Errorf("%s refused: %v", filepath.Base(paths[i]), result.Err)
		}

		if got := pagesOf(t, files[i].Content); result.Pages != got {
			t.Errorf("%s: %d pages counted, the file has %d", filepath.Base(paths[i]), result.Pages, got)
		}

		sum += result.Pages
	}

	if got := pagesOf(t, out); got != want || got != sum {
		t.Fatalf("merged PDF has %d pages, want %d (results sum %d)", got, want, sum)
	}

	// THE PLAIN FORM: no object streams, so every page dictionary is readable text — what the e2e counts the pages by,
	// with no PDF library of its own.
	if got := len(pageDict.FindAll(out, -1)); got != want {
		t.Fatalf("%d page dictionaries in the merged file's text, want %d", got, want)
	}

	if bytes.Contains(out, []byte("/ObjStm")) {
		t.Fatal("the merged file holds object streams")
	}
}

// pageDict is a page dictionary's type entry — /Type /Page, never /Pages.
var pageDict = regexp.MustCompile(`/Type\s*/Page[^a-zA-Z]`)

// A label photo becomes one page of its own size; JPEG and PNG both, beside a PDF.
func TestMerge_APictureIsOnePage(t *testing.T) {
	pdf := read(t, samplePDFs(t)[0])

	files := []san_pdf_merge.File{
		{Content: picture(t, jpegOf, 300, 450), MimeType: "image/jpeg"},
		{Content: pdf, MimeType: "application/pdf"},
		{Content: picture(t, pngOf, 200, 120), MimeType: "image/png"},
	}

	out, results, err := san_pdf_merge.Merge(files)
	if err != nil {
		t.Fatalf("Merge: %v", err)
	}

	if results[0].Pages != 1 || results[2].Pages != 1 || results[0].Err != nil || results[2].Err != nil {
		t.Fatalf("pictures: %+v", results)
	}

	if got, want := pagesOf(t, out), 2+pagesOf(t, pdf); got != want {
		t.Fatalf("merged %d pages, want %d", got, want)
	}

	dims, err := api.PageDims(bytes.NewReader(out), nil)
	if err != nil {
		t.Fatal(err)
	}

	if dims[0].Width != 300 || dims[0].Height != 450 {
		t.Fatalf("the photo's page is %vx%v, want its own 300x450", dims[0].Width, dims[0].Height)
	}
}

// A file that is not a label, or is broken, is refused on its own — and every other file still merges.
func TestMerge_ABadFileIsRefusedAndTheRestMerge(t *testing.T) {
	pdf := read(t, samplePDFs(t)[0])
	pages := pagesOf(t, pdf)

	bad := map[string]san_pdf_merge.File{
		"empty":                {Content: nil, MimeType: "application/pdf"},
		"garbage called a pdf": {Content: []byte("this is not a pdf at all"), MimeType: "application/pdf"},
		"a truncated pdf":      {Content: pdf[:len(pdf)/3], MimeType: "application/pdf"},
		"garbage called a png": {Content: []byte("\x89PNG\r\n\x1a\nnope"), MimeType: "image/png"},
		"a text file":          {Content: []byte("hello"), MimeType: "text/plain"},
		"a spreadsheet":        {Content: []byte("PK\x03\x04 not really"), MimeType: "application/vnd.ms-excel"},
	}

	for name, file := range bad {
		t.Run(name, func(t *testing.T) {
			// First, between and last: the position never matters.
			for _, files := range [][]san_pdf_merge.File{
				{file, {Content: pdf}},
				{{Content: pdf}, file, {Content: pdf}},
				{{Content: pdf}, file},
			} {
				out, results, err := san_pdf_merge.Merge(files)
				if err != nil {
					t.Fatalf("Merge: %v", err)
				}

				good := 0

				for i, result := range results {
					if files[i].MimeType == file.MimeType && bytes.Equal(files[i].Content, file.Content) {
						if !errors.Is(result.Err, san_pdf_merge.ErrUnreadable) || result.Pages != 0 {
							t.Fatalf("the bad file: %+v", result)
						}

						continue
					}

					if result.Err != nil {
						t.Fatalf("a good file refused: %v", result.Err)
					}

					good++
				}

				if got := pagesOf(t, out); got != good*pages {
					t.Fatalf("merged %d pages, want %d", got, good*pages)
				}
			}
		})
	}
}

// Nothing readable: no PDF, every file refused, and no error — the caller says why per file.
func TestMerge_NothingReadable(t *testing.T) {
	out, results, err := san_pdf_merge.Merge([]san_pdf_merge.File{{Content: []byte("x"), MimeType: "application/pdf"}})
	if err != nil || out != nil || len(results) != 1 || !errors.Is(results[0].Err, san_pdf_merge.ErrUnreadable) {
		t.Fatalf("out=%d bytes, results=%+v, err=%v", len(out), results, err)
	}

	_, _, err = san_pdf_merge.Merge(nil)
	if !errors.Is(err, san_pdf_merge.ErrNothingToMerge) {
		t.Fatalf("no files: %v", err)
	}
}

// A HOSTILE FILE MUST NOT CRASH THE SERVICE: every sample, corrupted at many places, either merges or is refused —
// never a panic, never an error for the whole merge — and the good file beside it always merges.
func TestMerge_CorruptedFilesNeverCrash(t *testing.T) {
	paths := samplePDFs(t)
	good := read(t, paths[0])
	goodPages := pagesOf(t, good)

	for _, path := range paths {
		original := read(t, path)

		for cut := 1; cut <= 24; cut++ {
			corrupt := bytes.Clone(original)
			// Overwrite a run of bytes at a spread of offsets — inside the header, objects, streams and the xref.
			at := len(corrupt) * cut / 25
			for k := at; k < at+64 && k < len(corrupt); k++ {
				corrupt[k] = byte(k*31 + cut)
			}

			out, results, err := san_pdf_merge.Merge([]san_pdf_merge.File{
				{Content: corrupt, MimeType: "application/pdf"},
				{Content: good, MimeType: "application/pdf"},
			})
			if err != nil {
				t.Fatalf("%s cut %d: the whole merge failed: %v", filepath.Base(path), cut, err)
			}

			if results[1].Err != nil || results[1].Pages != goodPages {
				t.Fatalf("%s cut %d: the good file: %+v", filepath.Base(path), cut, results[1])
			}

			if got := pagesOf(t, out); got != results[0].Pages+goodPages {
				t.Fatalf("%s cut %d: merged %d pages, results say %d", filepath.Base(path), cut, got, results[0].Pages+goodPages)
			}
		}
	}
}

// A file stored without a type is sniffed from its bytes.
func TestMerge_AnUntypedFileIsSniffed(t *testing.T) {
	pdf := read(t, samplePDFs(t)[0])

	out, results, err := san_pdf_merge.Merge([]san_pdf_merge.File{
		{Content: pdf},
		{Content: picture(t, pngOf, 50, 80), MimeType: "application/octet-stream"},
	})
	if err != nil || results[0].Err != nil || results[1].Err != nil {
		t.Fatalf("results=%+v err=%v", results, err)
	}

	if got := pagesOf(t, out); got != pagesOf(t, pdf)+1 {
		t.Fatalf("merged %d pages", got)
	}
}
