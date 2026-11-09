//go:build perfaudit

// Performance audit for LiabilityTermsHistoryList (the audit-rpc-performance skill).
//
// WHY THIS RPC, NOW. Backlog #34 added the period on `changed_at`. Both history indexes already END in
// `changed_at DESC`, so the period should be an index range, not a filter — this probe is the proof, over 20 000
// changes, far more limit edits than any creditor makes.
//
//	go test -tags perfaudit -run TestPerf_LiabilityTermsHistoryList -v ./backend/services/liability_service/liability_v1/
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

func TestPerf_LiabilityTermsHistoryList(t *testing.T) {
	base := san_testdb.DB(t)

	err := base.Exec(`
INSERT INTO liability_terms_logs (team_id, counterparty_id, changed_at)
SELECT ?, ? + g % 20, TIMESTAMPTZ '2026-01-01 00:00:00+07' + (g * 400 / 20000) * INTERVAL '1 day'
FROM generate_series(1, 20000) AS g`, warehouse, selling).Error
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	err = base.Exec(`ANALYZE liability_terms_logs`).Error
	if err != nil {
		t.Fatal(err)
	}

	db, probe := san_perf.Wrap(base)
	svc := liability_v1.NewService(db, nil, nil, nil)
	pair := selling

	for _, c := range []struct {
		name   string
		filter *liabilityv1.LiabilityTermsHistoryListFilter
	}{
		{"one pair, unfiltered", &liabilityv1.LiabilityTermsHistoryListFilter{CounterpartyId: &pair}},
		{"one pair, one week", &liabilityv1.LiabilityTermsHistoryListFilter{CounterpartyId: &pair, From: "2026-07-01", To: "2026-07-07"}},
		{"every pair, one week", &liabilityv1.LiabilityTermsHistoryListFilter{From: "2026-07-01", To: "2026-07-07"}},
	} {
		measure(t, base, probe, "LiabilityTermsHistoryList "+c.name, 3, func() error {
			_, err := svc.LiabilityTermsHistoryList(context.Background(),
				connect.NewRequest(&liabilityv1.LiabilityTermsHistoryListRequest{
					TeamId: warehouse,
					Filter: c.filter,
					Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
				}))

			return err
		})
	}
}
