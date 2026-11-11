//go:build perfaudit

package san_pdf_merge_test

import (
	"testing"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_pdf_merge"
)

// The cost of a warehouse printing a full page of labels at once: 50 and 100 of the committed marketplace labels,
// cycled, merged into one PDF. Logs the wall time, the input and output sizes and the pages.
func TestPerf_Merge(t *testing.T) {
	paths := samplePDFs(t)

	for _, n := range []int{1, 10, 50, 100} {
		files := make([]san_pdf_merge.File, 0, n)
		in := 0

		for i := range n {
			content := read(t, paths[i%len(paths)])
			files = append(files, san_pdf_merge.File{Content: content, MimeType: "application/pdf"})
			in += len(content)
		}

		// Warm once (pdfcpu's one-time config), then time the best of three.
		_, _, _ = san_pdf_merge.Merge(files[:1])

		best := time.Duration(1 << 62)

		var out []byte

		for range 3 {
			start := time.Now()

			merged, results, err := san_pdf_merge.Merge(files)
			if err != nil {
				t.Fatal(err)
			}

			for i, result := range results {
				if result.Err != nil {
					t.Fatalf("file %d refused: %v", i, result.Err)
				}
			}

			if took := time.Since(start); took < best {
				best = took
			}

			out = merged
		}

		t.Logf("%3d labels: %6.1f ms, in %6.1f KB, out %6.1f KB, %d pages",
			n, float64(best.Microseconds())/1000, float64(in)/1024, float64(len(out))/1024, pagesOf(t, out))
	}
}
