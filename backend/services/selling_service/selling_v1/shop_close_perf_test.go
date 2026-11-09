//go:build perfaudit

package selling_v1_test

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// seedShopsForLifecycle seeds 20 teams of 500 shops (10 000), one in five CLOSED, each granted to three people with a
// primary — the ShopList perf seed — and answers team 2's shops, open first then closed, by id.
func seedShopsForLifecycle(t *testing.T, db *gorm.DB) (open, closed []uint64) {
	t.Helper()

	shops := make([]selling_service_models.Shop, 0, 10_000)
	closedAt := time.Now()

	for team := range 20 {
		for i := range 500 {
			code := "L" + strconv.Itoa(team) + "-" + strconv.Itoa(i)
			shop := selling_service_models.Shop{
				TeamID: uint64(2 + team), Name: "Toko " + code, ShopCode: code, Marketplace: "shopee",
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
				ShopID: shop.ID, UserID: uint64(100 + (i+k)%40), IsPrimary: k == 0, CreatedAt: time.Now(),
			})
		}
	}

	san_perf.SeedRows(t, db, grants)

	err := db.Exec("ANALYZE shops, shop_users").Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}

	for _, shop := range shops {
		if shop.TeamID != 2 {
			continue
		}

		if shop.Status == selling_service_models.ShopClosed {
			closed = append(closed, shop.ID)
		} else {
			open = append(open, shop.ID)
		}
	}

	return open, closed
}

// measureShopLifecycle runs `call` on six shops — one warm-up, five measured — logging each call's wall, database time
// and statements, the median, and the plans of the last call's statements (its SAVEPOINTs — production's BEGIN and
// COMMIT — have none).
func measureShopLifecycle(t *testing.T, db *gorm.DB, probe *san_perf.Probe, name string, ids []uint64, call func(uint64) error) {
	t.Helper()

	err := call(ids[0])
	if err != nil {
		t.Fatalf("%s warm-up: %v", name, err)
	}

	walls := make([]time.Duration, 0, 5)

	for _, id := range ids[1:6] {
		probe.Reset()

		wall, dbTime := probe.Measure(func() { err = call(id) })
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		walls = append(walls, wall)
		t.Logf("%s wall=%v db=%v queries=%d", name, wall, dbTime, probe.Count())
	}

	t.Logf("%s MEDIAN wall %v", name, san_perf.Median(walls))

	for _, q := range probe.Queries() {
		if strings.HasPrefix(q.SQL, "SELECT") || strings.HasPrefix(q.SQL, "UPDATE") {
			t.Log(san_perf.Explain(t, db, q.SQL))
		}
	}
}

// ShopClose on a team of 500 shops: the row locked, one UPDATE, the answer with its primary CS
// (a-shop-is-closed-never-deleted). Each measured call closes a different open shop.
func TestPerf_ShopClose(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	open, _ := seedShopsForLifecycle(t, db)
	svc := newService(t, db)
	ctx := t.Context()

	measureShopLifecycle(t, db, probe, "ShopClose", open, func(id uint64) error {
		_, err := svc.ShopClose(ctx, connect.NewRequest(&sellingv1.ShopCloseRequest{TeamId: 2, ShopId: id}))

		return err
	})
}
