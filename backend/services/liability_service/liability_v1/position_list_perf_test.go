//go:build perfaudit

// Performance audit for LiabilityPositionList (the audit-rpc-performance skill).
//
// WHY THIS RPC, NOW. It gained the whole-set summary (the-summary-is-tiles-on-the-list), which took
// it from two queries to four — and the two new ones are an AGGREGATE and an ORDER BY over the same
// table the rows come from. That is exactly the shape that looks free on a seeded database and is
// not on a full one.
//
//	go test -tags perfaudit -run TestPerf_LiabilityPositionList -v ./backend/services/liability_service/liability_v1/
package liability_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

func TestPerf_LiabilityPositionList(t *testing.T) {
	base := san_testdb.DB(t)
	db, probe := san_perf.Wrap(base)
	svc := liability_v1.NewService(db)
	ctx := context.Background()

	// 500 counterparties — well past the 20 that fit on a page, which is the whole point: the tiles
	// summarise all of them and the rows return 20.
	for i := 0; i < 500; i++ {
		_, err := svc.PostEntry(ctx, db, liability_v1.Posting{
			DebtorTeamID:   uint64(1000 + i),
			CreditorTeamID: selling,
			Amount:         int64(1000 + i),
			SourceType:     liability_v1.SourceTypeOrderFee,
			SourceID:       uint64(70000 + i),
		})
		if err != nil {
			t.Fatalf("seed %d: %v", i, err)
		}
	}

	probe.Reset()

	var res *connect.Response[liabilityv1.LiabilityPositionListResponse]

	wall, dbTime := probe.Measure(func() {
		var err error

		res, err = svc.LiabilityPositionList(ctx,
			connect.NewRequest(&liabilityv1.LiabilityPositionListRequest{
				TeamId: selling,
				Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
			}))
		if err != nil {
			t.Fatalf("LiabilityPositionList: %v", err)
		}
	})

	t.Logf("wall=%s db=%s queries=%d", wall, dbTime, probe.Count())

	for _, q := range probe.Queries() {
		t.Logf("  %s  %s", q.Duration, q.SQL)
	}

	// ⚠ THE COUNT MUST NOT SCALE WITH THE ROWS. Four is the design: count, page, sum, oldest. A number
	// near 20 or 500 would mean an N+1 crept in — which is the failure this test exists to catch, not
	// the milliseconds.
	if probe.Count() > 5 {
		t.Fatalf("%d queries for one page, want 4 — something is querying per row", probe.Count())
	}

	// And the summary is still the WHOLE set while the rows are one page.
	if got := res.Msg.GetTotalReceivable(); got == 0 {
		t.Fatal("total_receivable = 0 with 500 debtors")
	}

	if n := len(res.Msg.GetIds()); n != 20 {
		t.Fatalf("%d rows, want 20", n)
	}
}
