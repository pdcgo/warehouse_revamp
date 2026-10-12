//go:build perfaudit

// go test -tags perfaudit -run TestPerf_TiktokSettlementImport -v ./backend/services/settlement_importer_service/settlement_importer_v1/
package settlement_importer_v1_test

import (
	"bytes"
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_excel_readers"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// A TikTok statement through the REAL streamed handler, at ~150 and ~1,500 lines. Its lines take the same
// per-line path as Shopee's (importLine → saveFile); what differs is the reader, and that a commissioned
// order yields TWO lines — its fund and its affiliate_fee.
func TestPerf_TiktokSettlementImport(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfSeed(t, db)

	ctx := context.Background()

	for _, size := range []struct {
		commissioned, plain, withdrawals int
	}{
		{70, 6, 2},
		{700, 60, 20},
	} {
		content, refs := perfTiktokStatement(t, size.commissioned, size.plain, size.withdrawals)
		found := perfOrdersFor(refs, tiktokShop)

		worlds := make([]*world, 6)
		clients := make([]func() (int, message, error), 6)

		for i := range worlds {
			w, client := perfImporter(t, db, found)
			worlds[i] = w
			clients[i] = func() (int, message, error) {
				return perfStreamTiktok(ctx, client, tiktokShop, content)
			}
		}

		var (
			messages int
			rows     int
		)

		name := fmt.Sprintf("TiktokSettlementImport/orders%d", size.commissioned+size.plain)

		t.Logf("PERF| %s: the statement is %d bytes, read in %v (median of 5, reader only)", name, len(content), perfReadTiktok(t, content))

		median := perfRun(t, probe, name, func(i int) error {
			n, end, err := clients[i+1]()
			if err != nil {
				return err
			}

			worlds[i+1].svc.Wait()
			messages = n
			rows = int(end.file.GetTally().GetTotal())

			return perfCheckDone(end, -1)
		})

		count := probe.Count()
		dbTime := probe.DBTotal()

		t.Logf("PERF| %s: %d lines, %d stream messages, %d queries = %.3f per line, db %v = %.3f ms per line, median wall %v = %.3f ms per line",
			name, rows, messages, count, float64(count)/float64(rows), dbTime, perfMs(dbTime)/float64(rows), median, perfMs(median)/float64(rows))

		perfByStatement(t, probe, name)
	}
}

// perfReadTiktok is the reader's own cost over the bytes — every sheet it reads, and every row's key.
func perfReadTiktok(t *testing.T, content []byte) time.Duration {
	t.Helper()

	walls := make([]time.Duration, 0, 5)

	for range 5 {
		start := time.Now()

		doc, err := san_excel_readers.NewTiktokSettlementDocument(bytes.NewReader(content))
		if err != nil {
			t.Fatalf("read: %v", err)
		}

		items, _ := doc.GetItems()
		_, _ = doc.GetDetails()
		withdrawals, _ := doc.GetWithdrawals()

		for _, item := range items {
			_, err = item.GenerateUniqueID()
			if err != nil {
				t.Fatalf("key: %v", err)
			}
		}

		for _, w := range withdrawals {
			_, err = w.GenerateUniqueID()
			if err != nil {
				t.Fatalf("key: %v", err)
			}
		}

		walls = append(walls, time.Since(start))
	}

	return san_perf.Median(walls)
}
