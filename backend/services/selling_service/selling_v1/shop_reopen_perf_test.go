//go:build perfaudit

package selling_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// ShopReopen on a team of 500 shops, 100 of them closed: the row locked, the code's open holder looked for (the partial
// unique index's own key), one UPDATE, the answer with its primary CS (a-shop-code-is-unique-among-open-shops). Each
// measured call reopens a different closed shop. The seed is ShopClose's (shop_close_perf_test.go).
func TestPerf_ShopReopen(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	_, closed := seedShopsForLifecycle(t, db)
	svc := newService(t, db)
	ctx := t.Context()

	measureShopLifecycle(t, db, probe, "ShopReopen", closed, func(id uint64) error {
		_, err := svc.ShopReopen(ctx, connect.NewRequest(&sellingv1.ShopReopenRequest{TeamId: 2, ShopId: id}))

		return err
	})
}
