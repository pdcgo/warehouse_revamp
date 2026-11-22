//go:build perfaudit

package product_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// THE KATEGORI PAGE'S PRODUK COUNT AT VOLUME — ProductCategoryCounts, one GROUP BY over every team's products. The
// catalogue grows to 100 000 and then 300 000 products over forty teams and 1 500 categories, one in ten archived and
// one in a hundred on no category. Each size is timed with products_category_idx (the partial index on category_id
// WHERE archived = FALSE, migration 00002) and again with that index dropped inside the test transaction, so both run
// on one seed — the index's own worth.
func TestPerf_ProductCategoryCounts(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	const (
		teams      = 40
		categories = 1_500
	)

	seeded := 0
	seed := func(n int) {
		rows := make([]product_service_models.Product, 0, n)
		for i := seeded; i < seeded+n; i++ {
			category := uint64(8_000_000 + (i*7919)%categories)
			if i%100 == 0 {
				category = 0
			}

			rows = append(rows, product_service_models.Product{
				TeamID:      2 + uint64(i%teams),
				ProductCode: fmt.Sprintf("CC-%07d", i),
				Name:        fmt.Sprintf("Produk %d", i),
				CategoryID:  category,
				Archived:    i%10 == 3,
			})
		}

		san_perf.SeedRows(t, quiet, &rows)
		seeded += n

		err := quiet.Exec("ANALYZE products").Error
		if err != nil {
			t.Fatalf("analyze: %v", err)
		}
	}

	svc := product_v1.NewService(db, nil, nil, nil, nil)
	ctx := rootCtx()

	count := func() error {
		resp, err := svc.ProductCategoryCounts(ctx, connect.NewRequest(&productv1.ProductCategoryCountsRequest{}))
		if err != nil {
			return err
		}

		// A tenth of the categories hold only archived products (the seed's stride lands them on one residue), so they are not listed.
		if len(resp.Msg.GetCounts()) < categories*8/10 {
			return fmt.Errorf("%d categories answered, want at least %d", len(resp.Msg.GetCounts()), categories*8/10)
		}

		return nil
	}

	for _, size := range []int{100_000, 200_000} {
		seed(size)
		measure(t, probe, fmt.Sprintf("ProductCategoryCounts products=%d (with products_category_idx)", seeded), count)
		explainReads(t, db, probe)

		// The same seed without the index — inside a savepoint, so the index is back for the next size.
		err := quiet.Exec("SAVEPOINT no_idx").Error
		if err != nil {
			t.Fatalf("savepoint: %v", err)
		}

		err = quiet.Exec("DROP INDEX products_category_idx").Error
		if err != nil {
			t.Fatalf("drop index: %v", err)
		}

		measure(t, probe, fmt.Sprintf("ProductCategoryCounts products=%d (index dropped)", seeded), count)
		explainReads(t, db, probe)

		err = quiet.Exec("ROLLBACK TO SAVEPOINT no_idx").Error
		if err != nil {
			t.Fatalf("rollback to savepoint: %v", err)
		}
	}
}

// rootCtx is Root's context as the interceptor leaves it — the role does not reach the handler, which reads no
// caller, but the probe runs as the page's own caller would.
func rootCtx() context.Context {
	return asPerson(1, role_basev1.Role_ROLE_UNSPECIFIED)
}
