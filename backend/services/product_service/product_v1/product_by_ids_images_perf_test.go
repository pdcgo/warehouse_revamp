//go:build perfaudit

package product_v1_test

import (
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// THE DISCOVER DETAIL'S GALLERY AT VOLUME — ProductByIds with the IMAGES slice (the-discover-detail-shows-no-markup).
// product_images grows with the catalogue: 100 000 products over forty selling teams, each with a FULL gallery of five
// pictures — 500 000 image rows, the most a catalogue this size can carry. The page asks for ONE product; a by-ids call
// may ask for 200. Each is timed beside the same call without IMAGES (the read every other caller makes, unchanged), so
// the slice's own cost is the difference.
func TestPerf_ProductByIdsImages(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	const (
		products = 100_000
		teams    = 40
		pictures = 5
	)

	rows := make([]product_service_models.Product, 0, products)
	for i := range products {
		rows = append(rows, product_service_models.Product{
			TeamID:      2 + uint64(i%teams),
			ProductCode: fmt.Sprintf("IMG-%06d", i),
			Name:        fmt.Sprintf("Produk %d", i),
		})
	}
	san_perf.SeedRows(t, quiet, &rows)

	images := make([]product_service_models.ProductImage, 0, products*pictures)
	for _, p := range rows {
		// Written newest position first, so the index — not the insertion order — gives the gallery's order.
		for position := pictures - 1; position >= 0; position-- {
			url := fmt.Sprintf("https://img.example/%d/%d.webp", p.ID, position)
			images = append(images, product_service_models.ProductImage{
				ProductID: p.ID, URL: url, ThumbnailURL: url + "?thumb", Position: position,
			})
		}
	}
	san_perf.SeedRows(t, quiet, &images)

	for _, table := range []string{"products", "product_images"} {
		err := quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}

	svc := product_v1.NewService(db, nil, nil, nil, nil)
	ctx := perfCtx()
	row := []productv1.ProductByIdsDataType{productv1.ProductByIdsDataType_PRODUCT_BY_IDS_DATA_TYPE_PRODUCT}
	withImages := append(append([]productv1.ProductByIdsDataType{}, row...), productv1.ProductByIdsDataType_PRODUCT_BY_IDS_DATA_TYPE_IMAGES)

	for _, n := range []int{1, 200} {
		ids := make([]uint64, 0, n)
		// Spread over the table, not the first n rows: a page's products are anywhere in it.
		for i := range n {
			ids = append(ids, rows[(i*7919)%products].ID)
		}

		for _, c := range []struct {
			name  string
			types []productv1.ProductByIdsDataType
		}{
			{"PRODUCT (every caller today)", row},
			{"PRODUCT + IMAGES (the discover detail)", withImages},
		} {
			measure(t, probe, fmt.Sprintf("ProductByIds ids=%d %s", n, c.name), func() error {
				_, err := svc.ProductByIds(ctx, connect.NewRequest(&productv1.ProductByIdsRequest{
					TeamId:      2,
					Filter:      &productv1.ProductByIdsFilter{Ids: ids},
					DataRequest: c.types,
				}))

				return err
			})
		}
	}

	explainReads(t, db, probe)
}
