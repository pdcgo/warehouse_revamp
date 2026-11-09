//go:build perfaudit

// Performance audit for LiabilityPaymentList (the audit-rpc-performance skill).
//
// WHY THIS RPC, NOW. Backlog #34 added the period (`created_at`) and the side (payer or creditor) before the page. The
// side turns the payer-OR-creditor scope into one arm of it, which each of the two team indexes holds; the period is
// a heap predicate. 20 000 payments between the pair over 400 days — far past any real pair's — size both.
//
//	go test -tags perfaudit -run TestPerf_LiabilityPaymentList -v ./backend/services/liability_service/liability_v1/
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

func TestPerf_LiabilityPaymentList(t *testing.T) {
	base := san_testdb.DB(t)

	// Both directions of the pair, and as many with ten other teams.
	for other := warehouse; other < warehouse+10; other++ {
		err := base.Exec(`
INSERT INTO liability_payments (payer_team_id, creditor_team_id, amount, status, created_at)
SELECT CASE WHEN g % 3 = 0 THEN ?::bigint ELSE ?::bigint END,
       CASE WHEN g % 3 = 0 THEN ?::bigint ELSE ?::bigint END,
       1000 + g % 97, CASE WHEN g % 5 = 0 THEN 'recorded' ELSE 'confirmed' END,
       TIMESTAMPTZ '2026-01-01 00:00:00+07' + (g * 400 / 20000) * INTERVAL '1 day' + (g % 1440) * INTERVAL '1 minute'
FROM generate_series(1, 20000) AS g`, other, selling, selling, other).Error
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	err := base.Exec(`ANALYZE liability_payments`).Error
	if err != nil {
		t.Fatal(err)
	}

	db, probe := san_perf.Wrap(base)
	svc := liability_v1.NewService(db, nil, nil, nil)

	for _, c := range []struct {
		name   string
		filter *liabilityv1.LiabilityPaymentListFilter
	}{
		{"unfiltered", &liabilityv1.LiabilityPaymentListFilter{}},
		{"my payments", &liabilityv1.LiabilityPaymentListFilter{Side: liabilityv1.LiabilityPaymentSide_LIABILITY_PAYMENT_SIDE_PAID}},
		{"their payments, one week", &liabilityv1.LiabilityPaymentListFilter{
			Side: liabilityv1.LiabilityPaymentSide_LIABILITY_PAYMENT_SIDE_RECEIVED,
			From: "2026-07-01", To: "2026-07-07",
		}},
		{"the oldest week", &liabilityv1.LiabilityPaymentListFilter{From: "2026-01-01", To: "2026-01-07"}},
	} {
		c.filter.CounterpartyId = warehouse

		// The count, the page and the documents slice.
		measure(t, base, probe, "LiabilityPaymentList "+c.name, 4, func() error {
			_, err := svc.LiabilityPaymentList(context.Background(), connect.NewRequest(&liabilityv1.LiabilityPaymentListRequest{
				TeamId: selling,
				Filter: c.filter,
				Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
			}))

			return err
		})
	}
}
