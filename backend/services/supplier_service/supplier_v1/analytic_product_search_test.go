package supplier_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/proto"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// Product Grouped: one row per restocking team's product, the largest restocked value first — two teams buying one
// item are two rows (every-accepted-line-links-its-own-product) — paged, and narrowed to one team when picked.
func TestAnalyticProductSearch_PerTeamsProductLargestValueFirst(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	fold(t, svc, accept(1, sellingA, 31, "2026-10-01",
		line{product: 100, ordered: 10, total: 10000, accepted: 10},
		line{product: 101, ordered: 1, total: 500, accepted: 1},
	))
	fold(t, svc, accept(2, sellingA, 31, "2026-10-02", line{product: 100, ordered: 5, total: 5000, accepted: 4, broken: 1}))
	fold(t, svc, accept(3, sellingB, 31, "2026-10-02", line{product: 900, ordered: 20, total: 40000, accepted: 20}))

	search := func(team uint64, n uint32) *supplierv1.AnalyticProductSearchResponse {
		resp, err := svc.AnalyticProductSearch(context.Background(), connect.NewRequest(&supplierv1.AnalyticProductSearchRequest{
			TeamId: sellingA, SupplierId: 31,
			Filter: &supplierv1.AnalyticTimeSearchFilter{DateRange: dateRange("2026-10-01", "2026-10-31"), RestockTeamId: team},
			Page:   page(n, 2),
		}))
		if err != nil {
			t.Fatalf("AnalyticProductSearch: %v", err)
		}

		return resp.Msg
	}

	got := search(0, 1)
	if got.GetPageInfo().GetTotalItems() != 3 {
		t.Fatalf("%d products, want 3", got.GetPageInfo().GetTotalItems())
	}

	first, second := got.GetDatas()[0], got.GetDatas()[1]
	if first.GetProductId() != 900 || first.GetTeamId() != sellingB || second.GetProductId() != 100 {
		t.Fatalf("page 1 = %v, %v — want team B's 900 (Rp 40.000), then A's 100 (Rp 14.000)", first, second)
	}

	if want := metric(14, 14000, 0, 0, 1, 1000); !proto.Equal(second.GetMetric(), want) {
		t.Fatalf("product 100 = %v, want its two days summed %v", second.GetMetric(), want)
	}

	if last := search(0, 2).GetDatas(); len(last) != 1 || last[0].GetProductId() != 101 {
		t.Fatalf("page 2 = %v, want product 101", last)
	}

	if onlyA := search(sellingA, 1); onlyA.GetPageInfo().GetTotalItems() != 2 {
		t.Fatalf("team A alone has %d products, want 2", onlyA.GetPageInfo().GetTotalItems())
	}
}
