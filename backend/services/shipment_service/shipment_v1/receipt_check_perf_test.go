//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ReceiptCheck -v -timeout 30m ./backend/services/shipment_service/shipment_v1/
//
// ReceiptCheck reads no table, so there is no volume to seed: its cost is the reader's, and it grows with the
// FILE. Measured on every real label sample, then on synthetic files up to the worst one a request may carry —
// as many pages as the request's 2 MB max_len lets through. The report is
// audits/services/shipment_service/performances/ReceiptCheck.md.
package shipment_v1_test

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	shipmentv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/shipment/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	shipment_v1 "github.com/pdcgo/warehouse_revamp/backend/services/shipment_service/shipment_v1"
)

// maxFile is the request's max_len — the largest file that reaches the reader.
const maxFile = 2097152

func TestPerf_ReceiptCheck(t *testing.T) {
	// A real, probed database — not because the RPC needs one, but to PROVE it issues no query.
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	svc := shipment_v1.NewService(db)
	ctx := context.Background()

	// The handler's one log line per call would bury the measurements.
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	// measure warms once and takes the median of `runs`; a call that runs for seconds is measured once, cold —
	// warming it would only double a number nobody needs to the millisecond.
	measure := func(name string, content []byte, runs int) time.Duration {
		req := &shipmentv1.ReceiptCheckRequest{FileContent: content}

		var result shipmentv1.ReceiptCheckResult

		run := func() {
			resp, err := svc.ReceiptCheck(ctx, connect.NewRequest(req))
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}
			result = resp.Msg.GetResult()
		}

		if runs > 1 {
			run()
		}

		walls := make([]time.Duration, 0, runs)

		for range runs {
			probe.Reset()

			wall, dbTime := probe.Measure(run)
			if probe.Count() != 0 || dbTime != 0 {
				t.Fatalf("%s issued %d queries", name, probe.Count())
			}

			walls = append(walls, wall)
		}

		median := san_perf.Median(walls)
		t.Logf("%-32s %8d B  %-40s %v", name, len(content), result, median)

		return median
	}

	// ── the real labels ──

	entries, err := os.ReadDir(receiptSamples)
	if err != nil {
		t.Fatalf("the samples: %v", err)
	}

	medians := []time.Duration{}
	slowest, slowestName := time.Duration(0), ""

	for _, entry := range entries {
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".pdf") {
			continue
		}

		m := measure(entry.Name(), sample(t, entry.Name()), 5)
		medians = append(medians, m)

		if m > slowest {
			slowest, slowestName = m, entry.Name()
		}
	}

	t.Logf("%d samples: median of medians %v, slowest %v (%s)", len(medians), san_perf.Median(medians), slowest, slowestName)

	// ── the worst file the contract admits ──
	//
	// A bulk print is refused only after EVERY page is laid out and matched, and a page no layout reads runs
	// every layout's match first — so both are measured at several page counts, up to max_len, to show how the
	// cost grows with the page count.

	label := func(i int) []labelText {
		return jntPage(fmt.Sprintf("JY%010d", i), fmt.Sprintf("58%016d", i))
	}
	note := func(int) []labelText {
		return []labelText{{x: 20, y: 300, size: 10, s: "Some other courier"}, {x: 20, y: 280, size: 10, s: "AB1234567890"}}
	}

	for _, kind := range []struct {
		name string
		page func(i int) []labelText
	}{{"bulk print", label}, {"no layout", note}} {
		most := pagesThatFit(kind.page)

		for _, n := range []int{10, 100, 500, 1000} {
			measure(fmt.Sprintf("%s, %d pages", kind.name, n), labelPDF(pagesOf(n, kind.page)...), 5)
		}

		measure(fmt.Sprintf("%s, %d pages (2 MB)", kind.name, most), labelPDF(pagesOf(most, kind.page)...), 1)
	}

	// …and 2 MB that is no PDF past its header: refused before any page is parsed.
	measure("2 MB, a header and zeros", append([]byte("%PDF-1.4\n"), make([]byte, maxFile-9)...), 5)
}

// pagesOf is the first n pages: page(0), page(1), ….
func pagesOf(n int, page func(i int) []labelText) [][]labelText {
	pages := make([][]labelText, 0, n)
	for i := range n {
		pages = append(pages, page(i))
	}

	return pages
}

// pagesThatFit is how many of these pages fit in max_len — sized from the per-page growth, every page here
// being the same length.
func pagesThatFit(page func(i int) []labelText) int {
	one := len(labelPDF(pagesOf(1, page)...))
	step := len(labelPDF(pagesOf(2, page)...)) - one

	n := (maxFile-one)/step + 1
	for len(labelPDF(pagesOf(n, page)...)) > maxFile {
		n--
	}

	return n
}
