//go:build perfaudit

package san_pdf_merge_test

import (
	"testing"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_pdf_merge"
)

// The cost of the unboxing warning (the-unboxing-warning-is-one-sentence-on-each-label): 1, 10 and 50 committed labels,
// cycled, merged plain and with the line stamped on every page — best of three each, in one process.
func TestPerf_MergeStamped(t *testing.T) {
	paths := samplePDFs(t)

	for _, n := range []int{1, 10, 50} {
		files := make([]san_pdf_merge.File, 0, n)
		for i := range n {
			files = append(files, san_pdf_merge.File{Content: read(t, paths[i%len(paths)]), MimeType: "application/pdf"})
		}

		_, _, _ = san_pdf_merge.Merge(files[:1], san_pdf_merge.StampEveryPage(line))

		for _, stamped := range []bool{false, true} {
			var opts []san_pdf_merge.Option
			if stamped {
				opts = append(opts, san_pdf_merge.StampEveryPage(line))
			}

			best := time.Duration(1 << 62)

			var out []byte

			for range 3 {
				start := time.Now()

				merged, _, err := san_pdf_merge.Merge(files, opts...)
				if err != nil {
					t.Fatal(err)
				}

				if took := time.Since(start); took < best {
					best = took
				}

				out = merged
			}

			t.Logf("%3d labels, stamped %-5v: %6.1f ms, out %7.1f KB, %d pages",
				n, stamped, float64(best.Microseconds())/1000, float64(len(out))/1024, pagesOf(t, out))
		}
	}
}
