//go:build perfaudit

// Performance audit for OrderDraftByExternalRefs (the audit-rpc-performance skill) — the order form's one-ref ask and
// the contract's cap (50 refs), over 50 000 drafts in ONE team (an app pushing all day and nobody pruning — drafts
// never expire), three sources (two apps and the form's `manual`), five shops.
//
//	go test -tags perfaudit -run TestPerf_OrderDraftByExternalRefs -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

func TestPerf_OrderDraftByExternalRefs(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	const (
		team  uint64 = 2
		rows         = 50_000
		shops        = 5
	)

	sources := []string{"scraper-app", "other-app", "manual"}
	at := time.Now().Add(-48 * time.Hour)

	drafts := make([]selling_service_models.OrderDraft, 0, rows+10_000)

	for i := range rows {
		drafts = append(drafts, selling_service_models.OrderDraft{
			TeamID:        team,
			AuthorUserID:  uint64(7 + i%10),
			Source:        sources[i%len(sources)],
			ExternalID:    fmt.Sprintf("2511%010d", i),
			ShopID:        uint64(31 + i%shops),
			TouchedFields: "[]",
			CreatedAt:     at,
			UpdatedAt:     at,
		})
	}

	// Another team, so team_id has to narrow.
	for i := range 10_000 {
		drafts = append(drafts, selling_service_models.OrderDraft{
			TeamID: 3, AuthorUserID: 50, Source: "scraper-app", ExternalID: fmt.Sprintf("2511%010d", i),
			ShopID: 31, TouchedFields: "[]", CreatedAt: at, UpdatedAt: at,
		})
	}

	san_perf.SeedRows(t, db, drafts)

	svc := newService(t, db)
	ctx := asUser(7)

	for _, tc := range []struct {
		name string
		refs []string
	}{
		{"1 ref (the form)", []string{fmt.Sprintf("2511%010d", 12_345)}},
		{"50 refs (the cap)", func() []string {
			out := make([]string, 0, 50)
			for k := range 50 {
				out = append(out, fmt.Sprintf("2511%010d", k*997))
			}

			return out
		}()},
	} {
		req := &sellingv1.OrderDraftByExternalRefsRequest{
			TeamId: team,
			Filter: &sellingv1.OrderDraftByExternalRefsFilter{ShopId: 31, Refs: tc.refs},
		}

		// Warm-up: schema reflection and pool setup are not this RPC's cost.
		_, err := svc.OrderDraftByExternalRefs(ctx, connect.NewRequest(req))
		if err != nil {
			t.Fatalf("warm-up (%s): %v", tc.name, err)
		}

		walls := make([]time.Duration, 0, 5)

		var resp *connect.Response[sellingv1.OrderDraftByExternalRefsResponse]

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() {
				resp, err = svc.OrderDraftByExternalRefs(ctx, connect.NewRequest(req))
			})
			if err != nil {
				t.Fatalf("%s: %v", tc.name, err)
			}

			walls = append(walls, wall)
			t.Logf("%s: wall=%v db=%v go=%v queries=%d", tc.name, wall, dbTime, wall-dbTime, probe.Count())
		}

		t.Logf("%s: %d refs answered · MEDIAN wall %v", tc.name, len(resp.Msg.GetItems()), san_perf.Median(walls))
		probe.Report(t, "OrderDraftByExternalRefs — "+tc.name)

		for _, q := range probe.Queries() {
			if strings.Contains(q.SQL, "SAVEPOINT") || strings.Contains(q.SQL, "RELEASE") {
				continue
			}

			san_perf.Explain(t, db, q.SQL)
		}
	}
}
