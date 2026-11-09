package selling_v1_test

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// the-total-sort-is-ours-and-the-platform-total-sorts-apart — TOTAL sorts by `total_cost` (what the order cost the
// seller), PLATFORM TOTAL by `platform_total` (what the buyer paid), each under its own name; ties fall back to the id.

// sortOrder seeds one order of team 2 with its two figures, and returns its id.
func sortOrder(t *testing.T, db *gorm.DB, shop uint64, totalCost float64, platformTotal float64) uint64 {
	t.Helper()

	o := selling_service_models.Order{
		IdempotencyKey: newOrderKey(), TeamID: 2, ShopID: shop, WarehouseID: testWarehouse, Status: "processed",
		Address: &selling_service_models.OrderAddress{CustomerName: "Budi"}, TotalCost: totalCost, PlatformTotal: platformTotal,
	}

	err := db.Create(&o).Error
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	return o.ID
}

func sortedIDs(t *testing.T, svc *selling_v1.Service, by sellingv1.OrderRowSort, dir commonv1.CommonSortType) []uint64 {
	t.Helper()

	res, err := svc.OrderList(context.Background(), connect.NewRequest(&sellingv1.OrderListRequest{
		TeamId: 2,
		Sort:   &sellingv1.OrderListFilterSort{SortType: dir, S: &sellingv1.OrderListFilterSort_Order{Order: by}},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("OrderList(sort %v %v): %v", by, dir, err)
	}

	return res.Msg.GetIds()
}

// Each sort reads ITS OWN figure — the two orders are chosen so that sorting by one gives the opposite order to sorting
// by the other — and two orders equal on the figure fall back to the id, in the sort's own direction.
func TestOrderList_TheTwoTotalsSortApartAndTiesFallBackToTheID(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	// cost 50 000, paid 300 000 · cost 200 000, paid 250 000 · two at cost 100 000 / paid 100 000 (the ties).
	cheap := sortOrder(t, db, shop, 50_000, 300_000)
	dear := sortOrder(t, db, shop, 200_000, 250_000)
	tieA := sortOrder(t, db, shop, 100_000, 100_000)
	tieB := sortOrder(t, db, shop, 100_000, 100_000)

	const (
		asc  = commonv1.CommonSortType_COMMON_SORT_TYPE_ASC
		desc = commonv1.CommonSortType_COMMON_SORT_TYPE_DESC
	)

	cases := []struct {
		name string
		by   sellingv1.OrderRowSort
		dir  commonv1.CommonSortType
		want []uint64
	}{
		{"Total, highest first", sellingv1.OrderRowSort_ORDER_ROW_SORT_TOTAL, desc, []uint64{dear, tieB, tieA, cheap}},
		{"Total, lowest first", sellingv1.OrderRowSort_ORDER_ROW_SORT_TOTAL, asc, []uint64{cheap, tieA, tieB, dear}},
		{"Platform total, highest first", sellingv1.OrderRowSort_ORDER_ROW_SORT_PLATFORM_TOTAL, desc, []uint64{cheap, dear, tieB, tieA}},
		{"Platform total, lowest first", sellingv1.OrderRowSort_ORDER_ROW_SORT_PLATFORM_TOTAL, asc, []uint64{tieA, tieB, dear, cheap}},
		{"id, newest first (the default)", sellingv1.OrderRowSort_ORDER_ROW_SORT_UNSPECIFIED, desc, []uint64{tieB, tieA, dear, cheap}},
	}

	for _, c := range cases {
		got := sortedIDs(t, svc, c.by, c.dir)
		if !slices.Equal(got, c.want) {
			t.Fatalf("%s: ids = %v, want %v", c.name, got, c.want)
		}
	}
}

// A TIE ACROSS A PAGE BOUNDARY is stable: page 1 and page 2 of a sort by Total, two at a time, hold every order exactly
// once — the id tie-break is what keeps the two equal orders from swapping between requests.
func TestOrderList_ATotalSortPagesWithoutRepeats(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	var want []uint64
	for range 4 {
		want = append(want, sortOrder(t, db, shop, 75_000, 90_000))
	}

	slices.Reverse(want)

	var got []uint64

	for page := uint32(1); page <= 2; page++ {
		res, err := svc.OrderList(context.Background(), connect.NewRequest(&sellingv1.OrderListRequest{
			TeamId: 2,
			Sort: &sellingv1.OrderListFilterSort{
				SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_DESC,
				S:        &sellingv1.OrderListFilterSort_Order{Order: sellingv1.OrderRowSort_ORDER_ROW_SORT_TOTAL},
			},
			Page: &commonv1.CommonPagination{Page: page, Limit: 2},
		}))
		if err != nil {
			t.Fatalf("page %d: %v", page, err)
		}

		got = append(got, res.Msg.GetIds()...)
	}

	if !slices.Equal(got, want) {
		t.Fatalf("two pages = %v, want %v (all four, highest id first among equals)", got, want)
	}
}
