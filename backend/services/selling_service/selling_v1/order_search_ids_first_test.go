package selling_v1_test

import (
	"context"
	"fmt"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// THE SEARCH BEFORE the-order-search-matches-ids-first, kept VERBATIM — scopedOrders' clause as it stood (HEAD 681576ea),
// the four ILIKEs tested on every order in scope. The old-vs-new test runs the real handlers with it and with the built one.
var oldLikeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

func oldOrderSearchClause(term string) (string, map[string]any) {
	args := map[string]any{"like": "%" + oldLikeEscaper.Replace(term) + "%"}

	clause := `(orders.id IN (SELECT a.order_id FROM order_addresses a WHERE a.customer_name ILIKE @like ESCAPE '\'` +
		` OR a.customer_phone ILIKE @like ESCAPE '\')` +
		` OR order_external_ref_id ILIKE @like ESCAPE '\' OR receipt ILIKE @like ESCAPE '\')`

	id, err := strconv.ParseUint(term, 10, 64)
	if err == nil && id > 0 {
		clause = `(orders.id IN (SELECT a.order_id FROM order_addresses a WHERE a.customer_name ILIKE @like ESCAPE '\'` +
			` OR a.customer_phone ILIKE @like ESCAPE '\')` +
			` OR order_external_ref_id ILIKE @like ESCAPE '\' OR receipt ILIKE @like ESCAPE '\' OR id = @id)`
		args["id"] = id
	}

	return clause, args
}

// sameStat reports whether two OrderStat answers hold the same figures. Its rows are grouped by status with no ORDER BY
// — their order was never part of the answer (the screen reads each row by its status) and moves with the plan — so they
// are compared per status, counts exactly and money within san_money.Equal (another summation order can move a double's
// last digit).
func sameStat(a, b *sellingv1.OrderStatResponse) bool {
	if a.GetPreview().GetOrders_30D() != b.GetPreview().GetOrders_30D() ||
		!san_money.Equal(a.GetPreview().GetRevenue_30D(), b.GetPreview().GetRevenue_30D()) ||
		len(a.GetByStatus()) != len(b.GetByStatus()) {
		return false
	}

	byStatus := map[sellingv1.OrderStatus]*sellingv1.OrderStatusCount{}
	for _, row := range b.GetByStatus() {
		byStatus[row.GetStatus()] = row
	}

	for _, x := range a.GetByStatus() {
		y, ok := byStatus[x.GetStatus()]
		if !ok || x.GetCount() != y.GetCount() || x.GetItemCount() != y.GetItemCount() ||
			x.GetMarginUnknown() != y.GetMarginUnknown() || !san_money.Equal(x.GetValue(), y.GetValue()) ||
			!san_money.Equal(x.GetMpValue(), y.GetMpValue()) || !san_money.Equal(x.GetGoodsCost(), y.GetGoodsCost()) ||
			!san_money.Equal(x.GetFees(), y.GetFees()) {
			return false
		}
	}

	return true
}

// searchFixture is one set of orders every reader, filter and term below reads.
type searchFixture struct {
	melatiShopee uint64
	both         uint64 // its NAME and its REF both hold "778899" — one row, never two
	addressOnly  uint64
	refOnly      uint64
	receiptOnly  uint64
	digitsID     uint64 // an order whose id is searched as digits
	now          time.Time
}

// seedSearchFixture: 154 orders over three selling teams (2, 3, 4) and three warehouses (900–902), 14 in each of the
// eleven statuses, spread over 40 days, with names, phones, refs, tracking numbers (none on every fourth), a line each and
// their timeline — plus four orders matching "778899" through one arm each, one of them through two. Team 4's returns go
// to warehouse 902, so 902 reads team 4's orders in return through orderReaders' third arm.
func seedSearchFixture(t *testing.T, db *gorm.DB) searchFixture {
	t.Helper()

	err := db.Create(&selling_service_models.TeamReturnConfiguration{TeamID: 4, WarehouseID: 902}).Error
	if err != nil {
		t.Fatalf("team 4's return warehouse: %v", err)
	}

	f := searchFixture{now: time.Now()}
	f.melatiShopee = insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")
	melatiTiktok := insertShop(t, db, 2, "Melati TikTok", "MEL-T", "tiktok")
	kenanga := insertShop(t, db, 3, "Kenanga Shopee", "KEN-S", "shopee")
	anggrek := insertShop(t, db, 4, "Anggrek TikTok", "ANG-T", "tiktok")

	statuses := []string{"pending", "processed", "picked", "shipping", "shipped", "completed", "problem", "lost", "return", "return_completed", "cancel"}
	names := []string{"Budi Santoso", "Siti Aminah", "Agus Salim", "Dewi Lestari", "Promo 50% Rina", "Promo 500 Joko"}

	order := func(i int, name, ref, receipt string) selling_service_models.Order {
		team := []uint64{2, 3, 4}[i%3]
		shop := map[uint64]uint64{2: f.melatiShopee, 3: kenanga, 4: anggrek}[team]
		if team == 2 && i%2 == 1 {
			shop = melatiTiktok
		}

		created := f.now.Add(-time.Duration(i%40)*24*time.Hour - 2*time.Hour)

		var platform *time.Time
		if i%7 != 0 {
			p := created.Add(-time.Hour)
			platform = &p
		}

		return selling_service_models.Order{
			IdempotencyKey:     newOrderKey(),
			TeamID:             team,
			ShopID:             shop,
			WarehouseID:        900 + uint64((i/3)%3),
			Status:             statuses[i%len(statuses)],
			ShipmentChannelID:  testShipmentChannel + uint64(i%2),
			OrderExternalRefID: ref,
			Receipt:            receipt,
			PlatformTotal:      float64(15_000 + (i*7919)%10_000),
			TotalCost:          float64(10_000 + (i*104_729)%9_000),
			CreatedByUserID:    7 + uint64(i%2),
			PlatformCreatedAt:  platform,
			CreatedAt:          created,
			UpdatedAt:          created,
			Address:            &selling_service_models.OrderAddress{CustomerName: name, CustomerPhone: fmt.Sprintf("0812%08d", 10_000+i*37)},
			Items: []selling_service_models.OrderItem{
				{ProductID: 1 + uint64(i%2), ProductCode: "SKU", Name: "Widget", Quantity: 1 + uint32(i%3), CreatedAt: created},
			},
		}
	}

	rows := make([]selling_service_models.Order, 0, 160)

	for i := range 154 {
		receipt := ""
		if i%4 != 0 {
			receipt = fmt.Sprintf("JP%010d", 500+i)
		}

		rows = append(rows, order(i, names[i%len(names)], fmt.Sprintf("5780%010d", 31_000+i*13), receipt))
	}

	rows = append(rows,
		order(154, "Rina 778899", "778899001", "JP0000900154"),
		order(155, "Wati 778899", "5780000099155", "JP0000900155"),
		order(156, "Yanti", "778899555", "JP0000900156"),
		order(157, "Lina", "5780000099157", "JP778899000"),
	)

	err = db.Create(&rows).Error
	if err != nil {
		t.Fatalf("seed the orders: %v", err)
	}

	timeline := make([]selling_service_models.OrderTimelineLog, 0, 2*len(rows))
	for _, o := range rows {
		timeline = append(timeline,
			selling_service_models.OrderTimelineLog{OrderID: o.ID, Status: "pending", From: "selling", ActorID: 7, CreatedAt: o.CreatedAt},
			selling_service_models.OrderTimelineLog{OrderID: o.ID, Status: o.Status, From: "warehouse", ActorID: 7, CreatedAt: o.CreatedAt.Add(time.Hour)},
		)
	}

	err = db.Create(&timeline).Error
	if err != nil {
		t.Fatalf("seed the timeline: %v", err)
	}

	f.both, f.addressOnly, f.refOnly, f.receiptOnly = rows[154].ID, rows[155].ID, rows[156].ID, rows[157].ID
	f.digitsID = rows[20].ID

	return f
}

// searchListRun is every page of one OrderList read: the ids in the order the pages gave them, and the pager's total.
type searchListRun struct {
	ids   []uint64
	total uint64
}

func listEveryPage(t *testing.T, svc *selling_v1.Service, team uint64, filter *sellingv1.OrderListFilter, sort *sellingv1.OrderListFilterSort) searchListRun {
	t.Helper()

	var run searchListRun

	for page := uint32(1); ; page++ {
		res, err := svc.OrderList(context.Background(), connect.NewRequest(&sellingv1.OrderListRequest{
			TeamId: team, Filter: filter, Sort: sort, Page: &commonv1.CommonPagination{Page: page, Limit: 12},
		}))
		if err != nil {
			t.Fatalf("OrderList(team %d, %v): %v", team, filter, err)
		}

		run.total = res.Msg.GetPageInfo().GetTotalItems()
		run.ids = append(run.ids, res.Msg.GetIds()...)

		if len(res.Msg.GetIds()) == 0 || page >= res.Msg.GetPageInfo().GetTotalPage() {
			return run
		}
	}
}

// statFilterOf is the stat's mirror of a list filter — every field but the tab.
func statFilterOf(f *sellingv1.OrderListFilter) *sellingv1.OrderStatFilter {
	return &sellingv1.OrderStatFilter{
		ProductId: f.GetProductId(), Search: f.GetSearch(), ShopId: f.GetShopId(),
		CreatedFromUnix: f.GetCreatedFromUnix(), CreatedToUnix: f.GetCreatedToUnix(), CreatedByUserId: f.GetCreatedByUserId(),
		SellerTeamId: f.GetSellerTeamId(), Marketplace: f.GetMarketplace(), ShipmentChannelId: f.GetShipmentChannelId(),
		WarehouseId: f.GetWarehouseId(), DateField: f.GetDateField(), SettlementNotOpened: f.GetSettlementNotOpened(),
	}
}

// THE SAME ROWS (the-order-search-matches-ids-first): on one fixture, every reader (root, a seller, two warehouses — one
// of them reading another team's returns), every term (text, digits, an order's id, a term matching both the address and
// the ref, wildcards typed as text, 1–2 characters, none at all) and every filter beside it (each status, the Returns tab,
// three date windows, shop, seller, warehouse, product, creator, courier, marketplace), the list gives the SAME ids in the
// SAME order with the SAME total under the old clause and the built one — and so do the stat and the export.
func TestOrderSearch_IdsFirstReadsTheSameRowsAsTheScan(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	f := seedSearchFixture(t, db)

	useOld := func() { selling_v1.SetOrderSearchMatch(t, oldOrderSearchClause) }
	useNew := func() { selling_v1.SetOrderSearchMatch(t, nil) }

	digits := strconv.FormatUint(f.digitsID, 10)
	terms := []string{
		"",                 // no search — the unchanged path
		"budi",             // text, lower case, a name
		"Siti Aminah",      // two words
		"778899",           // digits matching an address, a ref and a receipt — and one order through two of them
		digits,             // an order's own id
		"0812000",          // a phone's digits
		"JP00000005",       // tracking numbers
		"5780",             // every ref
		"Promo 50%",        // a typed % is text, through the ids
		"50%",              // … and through the scan (no three-character run)
		"08",               // two characters — the scan
		"a",                // one
		"_",                // a typed wildcard alone
		"zzz-none",         // nothing
		"  budi santoso  ", // trimmed
	}

	day := int64(24 * 60 * 60)
	from, to := f.now.Unix()-20*day, f.now.Unix()-5*day

	filters := make([]*sellingv1.OrderListFilter, 0, 80)
	for _, term := range terms {
		filters = append(filters, &sellingv1.OrderListFilter{Search: term})
	}

	for _, term := range []string{"", "budi", "778899", "5780"} {
		for value := range sellingv1.OrderStatus_name {
			if value == 0 {
				continue
			}

			filters = append(filters, &sellingv1.OrderListFilter{Search: term, Status: sellingv1.OrderStatus(value)})
		}

		filters = append(filters, &sellingv1.OrderListFilter{Search: term, Statuses: []sellingv1.OrderStatus{
			sellingv1.OrderStatus_ORDER_STATUS_RETURN, sellingv1.OrderStatus_ORDER_STATUS_RETURN_COMPLETED,
		}})
	}

	filters = append(filters,
		&sellingv1.OrderListFilter{Search: "", CreatedFromUnix: from, CreatedToUnix: to},
		&sellingv1.OrderListFilter{Search: "budi", CreatedFromUnix: from, CreatedToUnix: to},
		&sellingv1.OrderListFilter{Search: "5780", CreatedFromUnix: from},
		&sellingv1.OrderListFilter{Search: "JP00000005", CreatedToUnix: to},
		&sellingv1.OrderListFilter{Search: "5780", DateField: sellingv1.OrderDateField_ORDER_DATE_FIELD_PLATFORM_CREATED, CreatedFromUnix: from, CreatedToUnix: to},
		&sellingv1.OrderListFilter{Search: "budi", DateField: sellingv1.OrderDateField_ORDER_DATE_FIELD_ENTERED_PROCESSED, CreatedFromUnix: from, CreatedToUnix: to},
		&sellingv1.OrderListFilter{Search: "budi", ShopId: f.melatiShopee},
		&sellingv1.OrderListFilter{Search: "778899", SellerTeamId: 2},
		&sellingv1.OrderListFilter{Search: "0812000", WarehouseId: 901},
		&sellingv1.OrderListFilter{Search: "budi", ProductId: 2},
		&sellingv1.OrderListFilter{Search: "5780", CreatedByUserId: 7},
		&sellingv1.OrderListFilter{Search: "5780", ShipmentChannelId: testShipmentChannel},
		&sellingv1.OrderListFilter{Search: "5780", Marketplace: marketplacev1.Marketplace_MARKETPLACE_TIKTOK},
		&sellingv1.OrderListFilter{Search: "5780", SettlementNotOpened: true, Status: sellingv1.OrderStatus_ORDER_STATUS_RETURN},
	)

	byTotal := &sellingv1.OrderListFilterSort{
		SortType: commonv1.CommonSortType_COMMON_SORT_TYPE_DESC,
		S:        &sellingv1.OrderListFilterSort_Order{Order: sellingv1.OrderRowSort_ORDER_ROW_SORT_TOTAL},
	}

	readers := []uint64{san_auth.RootTeamID, 2, 3, testWarehouse, 902}
	compared, matched := 0, 0

	for _, team := range readers {
		for _, filter := range filters {
			sorts := []*sellingv1.OrderListFilterSort{nil}
			if filter.GetStatus() == 0 && len(filter.GetStatuses()) == 0 {
				sorts = append(sorts, byTotal)
			}

			for _, sort := range sorts {
				useOld()
				old := listEveryPage(t, svc, team, filter, sort)
				useNew()
				built := listEveryPage(t, svc, team, filter, sort)

				if !slices.Equal(old.ids, built.ids) || old.total != built.total {
					t.Fatalf("team %d, filter %v, sort %v: ids first read %v (total %d), the scan %v (total %d)",
						team, filter, sort, built.ids, built.total, old.ids, old.total)
				}

				if uint64(len(built.ids)) != built.total {
					t.Fatalf("team %d, filter %v: %d rows over the pages, total %d", team, filter, len(built.ids), built.total)
				}

				compared++
				if filter.GetSearch() != "" && built.total > 0 {
					matched++
				}
			}

			if filter.GetStatus() != 0 || len(filter.GetStatuses()) > 0 {
				continue
			}

			stat := &sellingv1.OrderStatRequest{TeamId: team, Filter: statFilterOf(filter)}

			useOld()
			oldStat, err := svc.OrderStat(context.Background(), connect.NewRequest(stat))
			if err != nil {
				t.Fatalf("OrderStat (scan): %v", err)
			}

			useNew()
			builtStat, err := svc.OrderStat(context.Background(), connect.NewRequest(stat))
			if err != nil {
				t.Fatalf("OrderStat (ids first): %v", err)
			}

			if !sameStat(oldStat.Msg, builtStat.Msg) {
				t.Fatalf("team %d, filter %v: the stat reads %v with ids first, %v with the scan", team, filter, builtStat.Msg, oldStat.Msg)
			}
		}
	}

	// The fixture is not trivially empty: most searches find rows.
	if matched < 150 {
		t.Fatalf("only %d searched reads found rows of %d compared — the fixture no longer exercises the search", matched, compared)
	}

	// "778899" as root: the four orders it names through each arm — the one matching both its name and its ref ONCE.
	useNew()

	got := listEveryPage(t, svc, san_auth.RootTeamID, &sellingv1.OrderListFilter{Search: "778899"}, nil)
	want := []uint64{f.receiptOnly, f.refOnly, f.addressOnly, f.both}

	if !slices.Equal(got.ids, want) || got.total != 4 {
		t.Fatalf("root's \"778899\" reads %v (total %d), want %v", got.ids, got.total, want)
	}

	// An order's id as digits finds it.
	got = listEveryPage(t, svc, san_auth.RootTeamID, &sellingv1.OrderListFilter{Search: digits}, nil)
	if !slices.Contains(got.ids, f.digitsID) {
		t.Fatalf("searching %s does not find order %d: %v", digits, f.digitsID, got.ids)
	}

	// THE EXPORT — the same file, every cell, under both clauses.
	for _, c := range []struct {
		team   uint64
		view   sellingv1.OrderExportView
		filter *sellingv1.OrderListFilter
	}{
		{san_auth.RootTeamID, sellingv1.OrderExportView_ORDER_EXPORT_VIEW_SELLER, &sellingv1.OrderListFilter{Search: "5780"}},
		{san_auth.RootTeamID, sellingv1.OrderExportView_ORDER_EXPORT_VIEW_SELLER, &sellingv1.OrderListFilter{Search: "778899"}},
		{2, sellingv1.OrderExportView_ORDER_EXPORT_VIEW_SELLER, &sellingv1.OrderListFilter{Search: "budi", CreatedFromUnix: from}},
		{testWarehouse, sellingv1.OrderExportView_ORDER_EXPORT_VIEW_WAREHOUSE, &sellingv1.OrderListFilter{Search: "JP00000005"}},
		{902, sellingv1.OrderExportView_ORDER_EXPORT_VIEW_WAREHOUSE, &sellingv1.OrderListFilter{Search: "5780", Status: sellingv1.OrderStatus_ORDER_STATUS_RETURN}},
		{testWarehouse, sellingv1.OrderExportView_ORDER_EXPORT_VIEW_WAREHOUSE, &sellingv1.OrderListFilter{Search: "08"}},
		{testWarehouse, sellingv1.OrderExportView_ORDER_EXPORT_VIEW_WAREHOUSE, &sellingv1.OrderListFilter{}},
	} {
		req := &sellingv1.OrderExportRequest{TeamId: c.team, Filter: c.filter, View: c.view}

		useOld()
		old := export(t, db, &fakeExports{}, req)
		useNew()
		built := export(t, db, &fakeExports{}, req)

		if !reflect.DeepEqual(old.rows, built.rows) {
			t.Fatalf("team %d, filter %v: the file differs — ids first %d rows, the scan %d", c.team, c.filter, len(built.rows), len(old.rows))
		}

		if c.filter.GetSearch() == "5780" && c.team == san_auth.RootTeamID && len(built.rows) < 100 {
			t.Fatalf("root's \"5780\" export holds %d rows — the fixture no longer exercises it", len(built.rows)-1)
		}
	}

	t.Logf("compared %d list reads (%d searched with rows), the stat beside each, 7 exports", compared, matched)
}
