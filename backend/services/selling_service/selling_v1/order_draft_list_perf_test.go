//go:build perfaudit

package selling_v1_test

import (
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderDraftList with its #16 set-wide ready count, over 50 000 drafts: ten authors in team 2 with 5 000 each (an app
// pushing all day and nobody pruning — drafts never expire), two lines a draft, a third of them ready.
func TestPerf_OrderDraftListReadyCount(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	drafts := make([]selling_service_models.OrderDraft, 0, 50_000)
	at := time.Now().Add(-48 * time.Hour)

	for i := range 50_000 {
		ready := i%3 == 0
		d := selling_service_models.OrderDraft{
			TeamID: 2, AuthorUserID: uint64(7 + i%10), Source: "scraper-app", ExternalID: "SHP-" + strconv.Itoa(i),
			TouchedFields: "[]", CustomerName: "Budi", CreatedAt: at, UpdatedAt: at,
		}
		if ready {
			d.ShopID, d.WarehouseID, d.PlatformTotal, d.PlatformCreatedAt = 21, 11, 135000, &at
		}

		drafts = append(drafts, d)
	}

	san_perf.SeedRows(t, db, drafts)

	items := make([]selling_service_models.OrderDraftItem, 0, 100_000)

	for i, d := range drafts {
		for k := range 2 {
			product := uint64(0)
			if i%3 == 0 {
				product = uint64(500 + k)
			}

			items = append(items, selling_service_models.OrderDraftItem{
				DraftID: d.ID, ExternalSKU: "MP-" + strconv.Itoa(k), ExternalName: "Kaos", Quantity: 1, UnitPrice: 50000,
				ProductID: product,
			})
		}
	}

	san_perf.SeedRows(t, db, items)

	svc := newService(t, db)
	ctx := asUser(7)

	calls := map[string]func() error{
		"OrderDraftList page 1": func() error {
			_, err := svc.OrderDraftList(ctx, connect.NewRequest(&sellingv1.OrderDraftListRequest{
				TeamId: 2, Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
			}))

			return err
		},
		"OrderDraftList by source": func() error {
			_, err := svc.OrderDraftList(ctx, connect.NewRequest(&sellingv1.OrderDraftListRequest{
				TeamId: 2, Filter: &sellingv1.OrderDraftListFilter{Source: "scraper-app"},
				Page: &commonv1.CommonPagination{Page: 3, Limit: 20},
			}))

			return err
		},
	}

	for name, call := range calls {
		err := call()
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
