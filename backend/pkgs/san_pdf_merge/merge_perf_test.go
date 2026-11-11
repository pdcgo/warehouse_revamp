//go:build perfaudit

package san_pdf_merge_test

import (
	"encoding/binary"
	"image"
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

// The cost of turning a label photo (backlog #39): one 12-megapixel phone photo (4032 × 3024) merged as stored
// (orientation 1, embedded as it is) and stored sideways (orientation 6, decoded, turned and re-encoded). Logs the
// wall time and the sizes of both.
func TestPerf_MergeTurnedPhoto(t *testing.T) {
	const w, h = 4032, 3024

	img := image.NewYCbCr(image.Rect(0, 0, w, h), image.YCbCrSubsampleRatio420)
	for y := range h {
		for x := range w {
			img.Y[img.YOffset(x, y)] = uint8((x/8 + y/8) % 256)
		}
	}

	for y := range h / 2 {
		for x := range w / 2 {
			img.Cb[img.COffset(2*x, 2*y)] = uint8(x % 256)
			img.Cr[img.COffset(2*x, 2*y)] = uint8(y % 256)
		}
	}

	stored := jpegBytes(t, img)

	for _, orientation := range []uint16{1, 6} {
		photo := withEXIF(t, stored, binary.LittleEndian, orientation)
		files := []san_pdf_merge.File{{Content: photo, MimeType: "image/jpeg"}}

		_, _, _ = san_pdf_merge.Merge(files)

		best := time.Duration(1 << 62)

		var out []byte

		for range 3 {
			start := time.Now()

			merged, results, err := san_pdf_merge.Merge(files)
			if err != nil || results[0].Err != nil {
				t.Fatalf("Merge: %v %v", err, results[0].Err)
			}

			if took := time.Since(start); took < best {
				best = took
			}

			out = merged
		}

		t.Logf("orientation %d: %7.1f ms, photo %6.1f KB, out %6.1f KB", orientation,
			float64(best.Microseconds())/1000, float64(len(photo))/1024, float64(len(out))/1024)
	}
}
