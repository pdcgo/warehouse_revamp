//go:build perfaudit

package selling_v1_test

import (
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// ShopList's #16 filters — marketplace, primary CS, no primary CS — and the pickers' `writable` (a CS's grants), over 20 teams of 500 shops (10 000), each shop
// granted to three people and two of every three with a primary. A team runs tens of shops; 500 is the ceiling probe.
// One shop in five is CLOSED, so the status filter (a-shop-is-closed-never-deleted) — open by default, closed, all — is
// measured on a team whose closed shops are a real share of its rows (shops_team_status_idx).
func TestPerf_ShopListFilters(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	markets := []string{"shopee", "tokopedia", "lazada", "tiktok"}
	shops := make([]selling_service_models.Shop, 0, 10_000)
	closedAt := time.Now()

	for team := range 20 {
		for i := range 500 {
			code := "T" + strconv.Itoa(team) + "-" + strconv.Itoa(i)
			shop := selling_service_models.Shop{
				TeamID: uint64(2 + team), Name: "Toko " + code, ShopCode: code, Marketplace: markets[i%4],
				Status:    selling_service_models.ShopOpen,
				CreatedAt: time.Now(), UpdatedAt: time.Now(),
			}

			if i%5 == 4 {
				shop.Status = selling_service_models.ShopClosed
				shop.ClosedAt = &closedAt
			}

			shops = append(shops, shop)
		}
	}

	san_perf.SeedRows(t, db, shops)

	grants := make([]selling_service_models.ShopUser, 0, 30_000)

	for i, shop := range shops {
		for k := range 3 {
			grants = append(grants, selling_service_models.ShopUser{
				ShopID: shop.ID, UserID: uint64(100 + (i+k)%40), IsPrimary: k == 0 && i%3 != 0, CreatedAt: time.Now(),
			})
		}
	}

	san_perf.SeedRows(t, db, grants)

	err := db.Exec("ANALYZE shops, shop_users").Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}

	svc := newService(t, db)
	ctx := t.Context()
	list := func(filter *sellingv1.ShopListFilter) func() error {
		return func() error {
			_, err := svc.ShopList(ctx, connect.NewRequest(&sellingv1.ShopListRequest{
				TeamId: 2, Filter: filter, Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
			}))

			return err
		}
	}

	// The order form's picker for a CS (a-write-needs-a-grant-or-a-manager): no manager role, so the grants narrow it.
	cs := newServiceWithRoles(t, db, nil)
	writable := func() error {
		_, err := cs.ShopList(asUser(101), connect.NewRequest(&sellingv1.ShopListRequest{
			TeamId: 2, Filter: &sellingv1.ShopListFilter{Writable: true}, Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
		}))

		return err
	}

	// The statement import's second picker read: the closed shops a CS may still import for.
	closedWritable := func() error {
		_, err := cs.ShopList(asUser(101), connect.NewRequest(&sellingv1.ShopListRequest{
			TeamId: 2,
			Filter: &sellingv1.ShopListFilter{Writable: true, Status: sellingv1.ShopListStatus_SHOP_LIST_STATUS_CLOSED},
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
		}))

		return err
	}

	calls := map[string]func() error{
		"ShopList writable, a CS":        writable,
		"ShopList closed writable, a CS": closedWritable,
		"ShopList status closed":         list(&sellingv1.ShopListFilter{Status: sellingv1.ShopListStatus_SHOP_LIST_STATUS_CLOSED}),
		"ShopList status all":            list(&sellingv1.ShopListFilter{Status: sellingv1.ShopListStatus_SHOP_LIST_STATUS_ALL}),
		"ShopList unfiltered":            list(nil),
		"ShopList marketplace":           list(&sellingv1.ShopListFilter{Marketplace: marketplacev1.Marketplace_MARKETPLACE_SHOPEE}),
		"ShopList primary cs":            list(&sellingv1.ShopListFilter{PrimaryUserId: 101}),
		"ShopList no primary":            list(&sellingv1.ShopListFilter{NoPrimary: true}),
	}

	for name, call := range calls {
		err = call()
		if err != nil {
			t.Fatalf("%s warm-up: %v", name, err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() { err = call() })
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}

			walls = append(walls, wall)
			t.Logf("%s wall=%v db=%v queries=%d", name, wall, dbTime, probe.Count())
		}

		t.Logf("%s MEDIAN wall %v", name, san_perf.Median(walls))

		for _, q := range probe.Queries() {
			t.Log(san_perf.Explain(t, db, q.SQL))
		}
	}
}
