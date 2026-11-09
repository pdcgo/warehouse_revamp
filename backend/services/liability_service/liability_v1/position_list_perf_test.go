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
	"fmt"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

func TestPerf_LiabilityPositionList(t *testing.T) {
	base := san_testdb.DB(t)
	db, probe := san_perf.Wrap(base)
	svc := liability_v1.NewService(db, nil, nil, nil)
	ctx := context.Background()

	// 500 counterparties — well past the 20 that fit on a page, which is the whole point: the tiles
	// summarise all of them and the rows return 20.
	for i := 0; i < 500; i++ {
		_, err := svc.PostEntry(ctx, db, liability_v1.Posting{
			DebtorTeamID:   uint64(1000 + i),
			CreditorTeamID: selling,
			Amount:         float64(1000 + i),
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

	// ⚠ THE COUNT MUST NOT SCALE WITH THE ROWS. Six is the design: count, page, the awaiting badge, the open payment
	// requests, sum, oldest (the badge and the requests joined the page after this probe was first written, which
	// left its old "4" red). A number near 20 or 500 would mean an N+1 crept in — the failure this test exists to catch,
	// not the milliseconds.
	if probe.Count() > 6 {
		t.Fatalf("%d queries for one page, want 6 — something is querying per row", probe.Count())
	}

	// And the summary is still the WHOLE set while the rows are one page.
	if got := res.Msg.GetTotalReceivable(); got == 0 {
		t.Fatal("total_receivable = 0 with 500 debtors")
	}

	if n := len(res.Msg.GetIds()); n != 20 {
		t.Fatalf("%d rows, want 20", n)
	}
}

// THE ROW FILTERS (backlog #34). The search and the kind read the team's own counterparty ids once (an index-only read
// of `liability_balances`), ask team_service for their facts ONCE, and narrow by the matched ids; awaiting-only is a
// subquery on `liability_payments_awaiting_idx`. None of it may scale the query count with the pairs.
func TestPerf_LiabilityPositionListFilters(t *testing.T) {
	base := san_testdb.DB(t)
	names := &fakeNames{facts: map[uint64]liability_v1.TeamFact{}}
	seedSvc := liability_v1.NewService(base, nil, nil, names)
	ctx := context.Background()

	for i := 0; i < 500; i++ {
		debtor := uint64(1000 + i)

		_, err := seedSvc.PostEntry(ctx, base, liability_v1.Posting{
			DebtorTeamID: debtor, CreditorTeamID: selling, Amount: float64(1000 + i),
			SourceType: liability_v1.SourceTypeOrderFee, SourceID: uint64(70000 + i),
		})
		if err != nil {
			t.Fatalf("seed %d: %v", i, err)
		}

		kind := teamv1.TeamType_TEAM_TYPE_SELLING
		if i%10 == 0 {
			kind = teamv1.TeamType_TEAM_TYPE_WAREHOUSE
		}

		names.facts[debtor] = liability_v1.TeamFact{Name: fmt.Sprintf("Toko %d", debtor), Code: fmt.Sprintf("T%d", debtor), Type: kind}
	}

	err := base.Exec(`
INSERT INTO liability_payments (payer_team_id, creditor_team_id, amount, status)
SELECT 1000 + g % 500, ?, 1000, CASE WHEN g % 50 = 0 THEN 'recorded' ELSE 'confirmed' END
FROM generate_series(1, 20000) AS g`, selling).Error
	if err != nil {
		t.Fatalf("seed payments: %v", err)
	}

	err = base.Exec(`ANALYZE liability_balances; ANALYZE liability_payments`).Error
	if err != nil {
		t.Fatal(err)
	}

	db, probe := san_perf.Wrap(base)
	svc := liability_v1.NewService(db, nil, nil, names)

	for _, c := range []struct {
		name   string
		filter *liabilityv1.LiabilityPositionListFilter
	}{
		{"search, one match", &liabilityv1.LiabilityPositionListFilter{Q: "toko 1234"}},
		{"search, every pair matches", &liabilityv1.LiabilityPositionListFilter{Q: "toko"}},
		{"warehouses only", &liabilityv1.LiabilityPositionListFilter{CounterpartyType: teamv1.TeamType_TEAM_TYPE_WAREHOUSE}},
		{"awaiting only", &liabilityv1.LiabilityPositionListFilter{AwaitingOnly: true}},
	} {
		// The unfiltered six, plus the one read of the team's counterparty ids a search or a kind needs.
		measure(t, base, probe, "LiabilityPositionList "+c.name, 7, func() error {
			_, err := svc.LiabilityPositionList(ctx, connect.NewRequest(&liabilityv1.LiabilityPositionListRequest{
				TeamId: selling,
				Filter: c.filter,
				Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
			}))

			return err
		})
	}
}
