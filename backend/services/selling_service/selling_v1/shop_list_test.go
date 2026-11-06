package selling_v1_test

import (
	"context"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

func TestShopList_ScopedAndSearchable(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertShop(t, db, 2, "Alpha Store", "A1", "shopee")
	insertShop(t, db, 2, "Beta Store", "B1", "tokopedia")
	insertShop(t, db, 3, "Other Team Shop", "C1", "lazada") // different team — must not appear

	// Team 2 sees only its own two shops.
	resp, err := svc.ShopList(context.Background(), connect.NewRequest(&sellingv1.ShopListRequest{
		TeamId: 2, Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("ShopList: %v", err)
	}
	if len(shopRows(resp.Msg)) != 2 {
		t.Fatalf("team 2 shops = %d, want 2", len(shopRows(resp.Msg)))
	}

	// `q` filters by name or code.
	resp, err = svc.ShopList(context.Background(), connect.NewRequest(&sellingv1.ShopListRequest{
		TeamId: 2, Filter: &sellingv1.ShopListFilter{Q: "alpha"}, Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("ShopList (q): %v", err)
	}
	if len(shopRows(resp.Msg)) != 1 || shopRows(resp.Msg)[0].GetName() != "Alpha Store" {
		t.Fatalf("search result = %+v", shopRows(resp.Msg))
	}
}

// shopNames lists a ShopList answer's names in row order.
func shopNames(t *testing.T, svc interface {
	ShopList(context.Context, *connect.Request[sellingv1.ShopListRequest]) (*connect.Response[sellingv1.ShopListResponse], error)
}, filter *sellingv1.ShopListFilter) ([]string, uint64) {
	t.Helper()

	resp, err := svc.ShopList(context.Background(), connect.NewRequest(&sellingv1.ShopListRequest{
		TeamId: 2, Filter: filter, Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("ShopList(%+v): %v", filter, err)
	}

	names := []string{}
	for _, shop := range shopRows(resp.Msg) {
		names = append(names, shop.GetName())
	}

	return names, resp.Msg.GetPageInfo().GetTotalItems()
}

// #16 — the marketplace, the primary CS and "no primary CS" narrow the WHOLE set on the server, so the count and the
// pages agree with what is on screen (a paged list filtered on screen misses the shops on the other pages).
func TestShopList_FiltersByMarketplacePrimaryAndNoPrimary(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	alpha := insertShop(t, db, 2, "Alpha Store", "A1", "shopee")
	beta := insertShop(t, db, 2, "Beta Store", "B1", "tokopedia")
	insertShop(t, db, 2, "Gamma Store", "G1", "shopee") // no grant at all — no primary
	delta := insertShop(t, db, 2, "Delta Store", "D1", "shopee")
	other := insertShop(t, db, 3, "Other Team Shopee", "O1", "shopee") // another team — never listed

	for _, g := range []selling_service_models.ShopUser{
		{ShopID: alpha, UserID: 501, IsPrimary: true},
		{ShopID: beta, UserID: 502, IsPrimary: true},
		{ShopID: delta, UserID: 501, IsPrimary: false}, // granted, but NOT its primary — Delta has none
		{ShopID: other, UserID: 501, IsPrimary: true},
	} {
		row := g
		err := db.Create(&row).Error
		if err != nil {
			t.Fatalf("grant: %v", err)
		}
	}

	cases := []struct {
		name   string
		filter *sellingv1.ShopListFilter
		want   []string
	}{
		{"marketplace", &sellingv1.ShopListFilter{Marketplace: marketplacev1.Marketplace_MARKETPLACE_SHOPEE},
			[]string{"Delta Store", "Gamma Store", "Alpha Store"}},
		{"primary cs", &sellingv1.ShopListFilter{PrimaryUserId: 501}, []string{"Alpha Store"}},
		{"no primary cs (a plain grant is not a primary)", &sellingv1.ShopListFilter{NoPrimary: true},
			[]string{"Delta Store", "Gamma Store"}},
		{"marketplace and no primary", &sellingv1.ShopListFilter{
			Marketplace: marketplacev1.Marketplace_MARKETPLACE_TOKOPEDIA, NoPrimary: true,
		}, []string{}},
		{"marketplace, primary and q", &sellingv1.ShopListFilter{
			Q: "beta", Marketplace: marketplacev1.Marketplace_MARKETPLACE_TOKOPEDIA, PrimaryUserId: 502,
		}, []string{"Beta Store"}},
	}

	for _, c := range cases {
		got, total := shopNames(t, svc, c.filter)
		if strings.Join(got, ",") != strings.Join(c.want, ",") {
			t.Errorf("%s: shops = %v, want %v", c.name, got, c.want)
		}
		if total != uint64(len(c.want)) {
			t.Errorf("%s: total = %d, want %d — the count must narrow with the rows", c.name, total, len(c.want))
		}
	}
}

// A person and nobody at once cannot both hold — refused rather than silently answering an empty list.
func TestShopList_PrimaryAndNoPrimaryTogetherIsInvalid(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	_, err := svc.ShopList(context.Background(), connect.NewRequest(&sellingv1.ShopListRequest{
		TeamId: 2,
		Filter: &sellingv1.ShopListFilter{PrimaryUserId: 501, NoPrimary: true},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}

// THE STATUS FILTER (a-shop-is-closed-never-deleted, the-close-shop-prototype-is-accepted): open by default, closed by
// the filter, both on ALL — every row carrying its status and, when closed, its close date.
func TestShopList_TheStatusFilter(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	insertShop(t, db, 2, "Open Store", "OPN", "shopee")
	closed := insertShop(t, db, 2, "Closed Store", "CLS", "shopee")
	insertShop(t, db, 3, "Other Team", "OTH", "shopee")

	closeShop(t, svc, 2, closed)

	list := func(status sellingv1.ShopListStatus) []*sellingv1.Shop {
		resp, err := svc.ShopList(context.Background(), connect.NewRequest(&sellingv1.ShopListRequest{
			TeamId:      2,
			Filter:      &sellingv1.ShopListFilter{Status: status},
			DataRequest: []sellingv1.ShopListDataType{sellingv1.ShopListDataType_SHOP_LIST_DATA_TYPE_SHOP},
			Page:        &commonv1.CommonPagination{Page: 1, Limit: 20},
		}))
		if err != nil {
			t.Fatalf("ShopList(%v): %v", status, err)
		}

		if resp.Msg.GetPageInfo().GetTotalItems() != uint64(len(resp.Msg.GetIds())) {
			t.Errorf("ShopList(%v): counted %d, listed %d", status, resp.Msg.GetPageInfo().GetTotalItems(), len(resp.Msg.GetIds()))
		}

		return shopRows(resp.Msg)
	}

	names := func(shops []*sellingv1.Shop) []string {
		out := []string{}
		for _, shop := range shops {
			out = append(out, shop.GetName())
		}

		slices.Sort(out)

		return out
	}

	for _, tc := range []struct {
		status sellingv1.ShopListStatus
		want   []string
	}{
		{sellingv1.ShopListStatus_SHOP_LIST_STATUS_UNSPECIFIED, []string{"Open Store"}},
		{sellingv1.ShopListStatus_SHOP_LIST_STATUS_OPEN, []string{"Open Store"}},
		{sellingv1.ShopListStatus_SHOP_LIST_STATUS_CLOSED, []string{"Closed Store"}},
		{sellingv1.ShopListStatus_SHOP_LIST_STATUS_ALL, []string{"Closed Store", "Open Store"}},
	} {
		got := names(list(tc.status))
		if !slices.Equal(got, tc.want) {
			t.Errorf("status %v: %v, want %v", tc.status, got, tc.want)
		}
	}

	for _, shop := range list(sellingv1.ShopListStatus_SHOP_LIST_STATUS_ALL) {
		closedRow := shop.GetId() == closed

		if closedRow != (shop.GetStatus() == sellingv1.ShopStatus_SHOP_STATUS_CLOSED) ||
			closedRow != (shop.GetClosedAtUnix() > 0) {
			t.Errorf("row %s: status %v closed at %d", shop.GetName(), shop.GetStatus(), shop.GetClosedAtUnix())
		}

		if !closedRow && shop.GetStatus() != sellingv1.ShopStatus_SHOP_STATUS_OPEN {
			t.Errorf("open row %s: status %v, want OPEN", shop.GetName(), shop.GetStatus())
		}
	}
}

// The status filter beside `writable`: the statement import's picker asks the closed shops a CS may write on — their
// grants still count on a closed shop (a-closed-shop-locks-all-but-its-grants).
func TestShopList_ClosedAndWritable(t *testing.T) {
	db := san_testdb.DB(t)
	svc := selling_v1.NewService(db, &fakePicker{}, nil, &fakeCatalog{}, &fakeCredit{}, gateRoles(), nil, nil, nil)

	granted := insertShop(t, db, gateTeam, "Granted Closed", "GC", "shopee")
	grantShop(t, db, granted, gateGranted, true)
	insertShop(t, db, gateTeam, "Ungranted Closed", "UC", "shopee")
	insertShop(t, db, gateTeam, "Granted Open", "GO", "shopee")

	closeShop(t, svc, gateTeam, granted)

	ungranted := storedShopByCode(t, db, "UC")
	closeShop(t, svc, gateTeam, ungranted)

	resp, err := svc.ShopList(asUser(gateGranted), connect.NewRequest(&sellingv1.ShopListRequest{
		TeamId: gateTeam,
		Filter: &sellingv1.ShopListFilter{
			Status:   sellingv1.ShopListStatus_SHOP_LIST_STATUS_CLOSED,
			Writable: true,
		},
		DataRequest: []sellingv1.ShopListDataType{sellingv1.ShopListDataType_SHOP_LIST_DATA_TYPE_SHOP},
		Page:        &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("ShopList: %v", err)
	}

	rows := shopRows(resp.Msg)
	if len(rows) != 1 || rows[0].GetId() != granted {
		t.Fatalf("closed + writable for a CS = %+v, want the one closed shop granted to them", rows)
	}
}

func storedShopByCode(t *testing.T, db *gorm.DB, code string) uint64 {
	t.Helper()

	var shop selling_service_models.Shop

	err := db.Where("shop_code = ?", code).First(&shop).Error
	if err != nil {
		t.Fatalf("shop %s: %v", code, err)
	}

	return shop.ID
}
