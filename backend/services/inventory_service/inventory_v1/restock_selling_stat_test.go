package inventory_v1_test

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"
	"connectrpc.com/validate"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1/inventoryv1connect"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_grpc"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/access_interceptors"
)

// THE SELLING RESTOCK LIST'S STATISTICS (the-restock-statistics-count-transactions-under-the-tabs) — RestockSellingStat.

var sellingStatuses = []inventoryv1.RestockRequestStatus{
	inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ONGOING,
	inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ARRIVED,
	inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED,
	inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_LOST,
	inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_CANCELLED,
}

// sellingStat is the read under test, sugar for the request.
func sellingStat(t *testing.T, svc *inventory_v1.Service, team uint64, filter *inventoryv1.RestockRequestListFilter) *inventoryv1.RestockSellingStatResponse {
	t.Helper()

	res, err := svc.RestockSellingStat(context.Background(), connect.NewRequest(&inventoryv1.RestockSellingStatRequest{
		TeamId: team,
		Filter: filter,
	}))
	if err != nil {
		t.Fatalf("RestockSellingStat: %v", err)
	}

	return res.Msg
}

// pileOf is a status's pile, or a zero pile when the status has none (absent, the OrderStat convention).
func pileOf(res *inventoryv1.RestockSellingStatResponse, status inventoryv1.RestockRequestStatus) *inventoryv1.RestockSellingPile {
	for _, p := range res.GetByStatus() {
		if p.GetStatus() == status {
			return p
		}
	}

	return &inventoryv1.RestockSellingPile{Status: status}
}

// statPile is a pile as plain numbers, for comparing against what the list's rows add up to.
type statPile struct {
	restocks, units, products      int64
	goods, shipping, charge, value float64
}

func (p statPile) String() string {
	return fmt.Sprintf("%d restocks · %d pcs · %d products · goods %.2f · shipping %.2f · cod %.2f · value %.2f",
		p.restocks, p.units, p.products, p.goods, p.shipping, p.charge, p.value)
}

func asStatPile(p *inventoryv1.RestockSellingPile) statPile {
	return statPile{
		restocks: p.GetRestockCount(), units: p.GetUnitCount(), products: p.GetProductCount(),
		goods: p.GetGoodsValue(), shipping: p.GetShipmentCost(), charge: p.GetCourierCharge(), value: p.GetValue(),
	}
}

func samePile(a, b statPile) bool {
	near := func(x, y float64) bool { return math.Abs(x-y) < 0.0001 }

	return a.restocks == b.restocks && a.units == b.units && a.products == b.products &&
		near(a.goods, b.goods) && near(a.shipping, b.shipping) && near(a.charge, b.charge) && near(a.value, b.value)
}

// listRows pages through RestockRequestList for the team and filter and returns every row — the list's own answer.
func listRows(t *testing.T, svc *inventory_v1.Service, team uint64, filter *inventoryv1.RestockRequestListFilter) []*inventoryv1.RestockRequest {
	t.Helper()

	var out []*inventoryv1.RestockRequest

	for page := uint32(1); page <= 50; page++ {
		res, err := svc.RestockRequestList(context.Background(), connect.NewRequest(&inventoryv1.RestockRequestListRequest{
			TeamId: team,
			Filter: filter,
			Page:   &commonv1.CommonPagination{Page: page, Limit: 25},
		}))
		if err != nil {
			t.Fatalf("RestockRequestList: %v", err)
		}

		rows := map[uint64]*inventoryv1.RestockRequest{}
		for _, item := range res.Msg.GetItems() {
			for id, r := range item.GetRestockRequest().GetMapData() {
				rows[id] = r
			}
		}

		for _, id := range res.Msg.GetIds() {
			out = append(out, rows[id])
		}

		if len(res.Msg.GetIds()) < 25 {
			return out
		}
	}

	t.Fatal("more than 50 pages")

	return nil
}

// tabTotal is the list's pager total for the team and filter — what a tab says it holds.
func tabTotal(t *testing.T, svc *inventory_v1.Service, team uint64, filter *inventoryv1.RestockRequestListFilter) int64 {
	t.Helper()

	res, err := svc.RestockRequestList(context.Background(), connect.NewRequest(&inventoryv1.RestockRequestListRequest{
		TeamId: team,
		Filter: filter,
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 1},
	}))
	if err != nil {
		t.Fatalf("RestockRequestList: %v", err)
	}

	return int64(res.Msg.GetPageInfo().GetTotalItems())
}

// rowsAddUp is what the list's rows say, summed the way the cards must read them: per status and in all, the pieces
// ORDERED (jumlah-barang-counts-the-pieces-ordered), the different products, the money; and per status × account.
func rowsAddUp(rows []*inventoryv1.RestockRequest) (map[inventoryv1.RestockRequestStatus]statPile, statPile, map[string][2]float64) {
	piles := map[inventoryv1.RestockRequestStatus]statPile{}
	products := map[inventoryv1.RestockRequestStatus]map[uint64]bool{}
	every := map[uint64]bool{}
	accounts := map[string][2]float64{}

	var total statPile

	for _, r := range rows {
		status := r.GetStatus()
		p := piles[status]

		if products[status] == nil {
			products[status] = map[uint64]bool{}
		}

		var units int64
		for _, line := range r.GetItems() {
			units += line.GetCount()
			products[status][line.GetProductId()] = true
			every[line.GetProductId()] = true
		}

		for _, pp := range []*statPile{&p, &total} {
			pp.restocks++
			pp.units += units
			pp.goods += r.GetSubtotal()
			pp.shipping += r.GetShipmentCost()
			pp.charge += r.GetWarehouseAdditionalCost()
			pp.value += r.GetTotal()
		}

		piles[status] = p

		key := fmt.Sprintf("%v/%d", status, r.GetFinanceAccountId())
		a := accounts[key]
		accounts[key] = [2]float64{a[0] + 1, a[1] + r.GetTotal()}
	}

	for status, p := range piles {
		p.products = int64(len(products[status]))
		piles[status] = p
	}

	total.products = int64(len(every))

	return piles, total, accounts
}

// seedSellingStatFixture writes 60 restocks straight into `restocks` / `restock_items`: two selling teams (2, 3) into two
// warehouses (5, 6), every status with its own dates, three couriers (one 0), three creators (one 0), two acceptors, four
// paying accounts (one 0 — raised before naming one was required), references with and without text, freight and a
// courier's charge at the door on the accepted ones, one to three lines over four products — an accepted line counted in
// short, so the pieces ORDERED and the pieces received differ. Returns the ids in seed order.
func seedSellingStatFixture(t *testing.T, db *gorm.DB) []uint64 {
	t.Helper()

	now := time.Now()
	statuses := []string{"ongoing", "arrived", "accepted", "lost", "cancelled"}
	products := []struct {
		id         uint64
		code, name string
	}{
		{100, "SKU-100", "Beras Pandan"},
		{101, "SKU-101", "Kopi Arabika"},
		{102, "TMB-500-005", "Teh Melati"},
		{103, "SKU-103", "Gula Pasir"},
	}

	ids := make([]uint64, 0, 60)

	for i := range 60 {
		at := func(days int) *time.Time {
			v := now.AddDate(0, 0, -days).Add(time.Duration(i) * time.Minute)
			return &v
		}

		status := statuses[i%len(statuses)]
		created := 40 - i/2

		var lines []inventory_service_models.RestockItem

		var subtotal float64

		for l := range 1 + i%3 {
			p := products[(i+l)%len(products)]
			count := int64(2 + (i+l)%5)
			total := float64(count) * float64(1000*(1+l))
			subtotal += total

			line := inventory_service_models.RestockItem{
				ProductID: p.id, ProductCode: p.code, Name: p.name,
				Count: count, Total: total, PriceUnit: total / float64(count),
				CreatedAt: now, UpdatedAt: now,
			}
			if status == "accepted" {
				line.ReceivedCount = count - 1
			}

			lines = append(lines, line)
		}

		shipping := float64(1000 * (i % 7))

		r := inventory_service_models.Restock{
			TeamID:           uint64(2 + i%2),
			WarehouseID:      uint64(5 + (i/2)%2),
			Status:           status,
			ShipmentID:       []uint64{91, 92, 0}[i%3],
			FinanceAccountID: []uint64{1301, 1303, 0, 1305}[i%4],
			CreatedByUserID:  []uint64{7, 8, 0}[i%3],
			ShipmentCost:     shipping,
			Subtotal:         subtotal,
			Total:            subtotal + shipping,
			CreatedAt:        *at(created),
			UpdatedAt:        now,
		}

		switch i % 4 {
		case 0:
			r.Receipt = fmt.Sprintf("JNE%04d", i)
			r.InvoiceRefID = fmt.Sprintf("INV-%d", i)
		case 1:
			r.Receipt = fmt.Sprintf("JNT%04d", i)
		case 2:
			r.InvoiceRefID = fmt.Sprintf("PO#41%02d", i)
		}

		switch status {
		case "arrived":
			r.ArrivedAt = at(created - 2)
			r.ArrivedByUserID = 9
		case "accepted":
			r.ArrivedAt = at(created - 2)
			r.AcceptedAt = at(created - 3)
			r.AcceptedByUserID = []uint64{9, 10}[i%2]
			r.WarehouseAdditionalCost = float64(500 * (i % 3))
			if r.WarehouseAdditionalCost > 0 {
				r.WarehouseAdditionalCostNote = courierNote
			}
		case "lost":
			r.LostAt = at(created - 4)
		case "cancelled":
			r.CancelledAt = at(created - 1)
		}

		err := db.Create(&r).Error
		if err != nil {
			t.Fatalf("seed restock %d: %v", i, err)
		}

		for l := range lines {
			lines[l].RestockID = r.ID

			err = db.Create(&lines[l]).Error
			if err != nil {
				t.Fatalf("seed line %d/%d: %v", i, l, err)
			}
		}

		ids = append(ids, r.ID)
	}

	return ids
}

// EVERY FILTER NARROWS THE CENSUS EXACTLY AS IT NARROWS THE LIST — the cards are read through the list's one predicate
// (restockListScope), so for every filter the list offers, each status's count is that tab's list total, the total is
// Semua Status's, and every figure is what the list's own rows add up to: the pieces ORDERED on their lines, the
// different products (the total's over every status at once), the goods, the freight, the courier's charge and the
// value; and per paying account, account 0 included. A status in the filter is ignored, and the caller's filter keeps it.
func TestRestockSellingStat_EveryFilterNarrowsAsTheList(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	ids := seedSellingStatFixture(t, db)

	now := time.Now()
	day := func(n int) int64 { return now.AddDate(0, 0, -n).Unix() }

	filters := map[string]*inventoryv1.RestockRequestListFilter{
		"nil":                  nil,
		"empty":                {},
		"product 100":          {ProductId: 100},
		"product 103":          {ProductId: 103},
		"product absent":       {ProductId: 999},
		"warehouse 5":          {WarehouseId: 5},
		"warehouse 6":          {WarehouseId: 6},
		"courier 91":           {ShipmentId: 91},
		"courier 92":           {ShipmentId: 92},
		"courier absent":       {ShipmentId: 99},
		"created by 7":         {CreatedByUserId: 7},
		"created by 8":         {CreatedByUserId: 8},
		"accepted by 9":        {AcceptedByUserId: 9},
		"accepted by 10":       {AcceptedByUserId: 10},
		"both people":          {CreatedByUserId: 7, AcceptedByUserId: 9},
		"q jne":                {Q: "jne"},
		"q JNT padded":         {Q: "  JNT "},
		"q sku-101":            {Q: "sku-101"},
		"q name":               {Q: "melati"},
		"q PO hash":            {Q: "po#41"},
		"q hash id":            {Q: "#" + strconv.FormatUint(ids[4], 10)},
		"q bare id":            {Q: strconv.FormatUint(ids[7], 10)},
		"q invoice":            {Q: "inv-1"},
		"status is ignored":    {Status: inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED},
		"status + warehouse 5": {Status: inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_LOST, WarehouseId: 5},
		"everything": {
			Status:          inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ONGOING,
			ProductId:       101,
			WarehouseId:     5,
			ShipmentId:      91,
			CreatedByUserId: 7,
			DateField:       inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_CREATED,
			FromUnix:        day(45),
			ToUnix:          day(0),
			Q:               "sku",
		},
	}

	for _, field := range []inventoryv1.RestockDateField{
		inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_UNSPECIFIED,
		inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_CREATED,
		inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_ACCEPTED,
		inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_CANCELLED,
		inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_ARRIVED,
		inventoryv1.RestockDateField_RESTOCK_DATE_FIELD_LOST,
	} {
		filters[fmt.Sprintf("%v from", field)] = &inventoryv1.RestockRequestListFilter{DateField: field, FromUnix: day(22)}
		filters[fmt.Sprintf("%v to", field)] = &inventoryv1.RestockRequestListFilter{DateField: field, ToUnix: day(19)}
		filters[fmt.Sprintf("%v window", field)] = &inventoryv1.RestockRequestListFilter{DateField: field, FromUnix: day(30), ToUnix: day(10)}
	}

	names := make([]string, 0, len(filters))
	for name := range filters {
		names = append(names, name)
	}
	slices.Sort(names)

	nonEmpty := 0

	for _, team := range []uint64{2, 3} {
		for _, name := range names {
			filter := filters[name]
			sent := proto.Clone(filter)

			got := sellingStat(t, svc, team, filter)

			// The caller's filter is never written: the status is cleared on a copy.
			if filter != nil && !proto.Equal(filter, sent) {
				t.Fatalf("team %d, %s: the request's filter changed to %v", team, name, filter)
			}

			// The list's set, with the status cleared as the census clears it.
			all := &inventoryv1.RestockRequestListFilter{}
			if filter != nil {
				all = proto.Clone(filter).(*inventoryv1.RestockRequestListFilter)
			}
			all.Status = inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_UNSPECIFIED

			// Each card's count is its tab's list total; the total is Semua Status's.
			semua := tabTotal(t, svc, team, all)
			if got.GetTotal().GetRestockCount() != semua {
				t.Errorf("team %d, %s: total = %d restocks, the list's Semua Status holds %d", team, name, got.GetTotal().GetRestockCount(), semua)
			}

			for _, status := range sellingStatuses {
				tab := proto.Clone(all).(*inventoryv1.RestockRequestListFilter)
				tab.Status = status

				held := tabTotal(t, svc, team, tab)
				if pileOf(got, status).GetRestockCount() != held {
					t.Errorf("team %d, %s: %v = %d restocks, its tab holds %d", team, name, status, pileOf(got, status).GetRestockCount(), held)
				}
			}

			// Every figure is the list's rows summed.
			rows := listRows(t, svc, team, all)
			wantPiles, wantTotal, wantAccounts := rowsAddUp(rows)

			if !samePile(asStatPile(got.GetTotal()), wantTotal) {
				t.Errorf("team %d, %s: total\n got  %v\n want %v", team, name, asStatPile(got.GetTotal()), wantTotal)
			}

			for _, status := range sellingStatuses {
				if !samePile(asStatPile(pileOf(got, status)), wantPiles[status]) {
					t.Errorf("team %d, %s: %v\n got  %v\n want %v", team, name, status, asStatPile(pileOf(got, status)), wantPiles[status])
				}
			}

			// A status with no restock is absent, never a zero row.
			for _, p := range got.GetByStatus() {
				if p.GetRestockCount() == 0 {
					t.Errorf("team %d, %s: %v is a zero row", team, name, p.GetStatus())
				}
			}

			gotAccounts := map[string][2]float64{}
			for _, a := range got.GetByAccount() {
				key := fmt.Sprintf("%v/%d", a.GetStatus(), a.GetFinanceAccountId())
				_, twice := gotAccounts[key]
				if twice {
					t.Errorf("team %d, %s: account row %s twice", team, name, key)
				}

				gotAccounts[key] = [2]float64{float64(a.GetRestockCount()), a.GetValue()}
			}

			if len(gotAccounts) != len(wantAccounts) {
				t.Errorf("team %d, %s: %d account rows, want %d (%v vs %v)", team, name, len(gotAccounts), len(wantAccounts), gotAccounts, wantAccounts)
			}

			for key, want := range wantAccounts {
				g, ok := gotAccounts[key]
				if !ok || g[0] != want[0] || math.Abs(g[1]-want[1]) > 0.0001 {
					t.Errorf("team %d, %s: account %s = %v, want %v", team, name, key, g, want)
				}
			}

			if len(rows) > 0 {
				nonEmpty++
			}
		}
	}

	// A comparison of empty censuses proves nothing.
	t.Logf("%d of %d team × filter cases read restocks", nonEmpty, 2*len(names))
	if nonEmpty*3 < 2*2*len(names) {
		t.Fatalf("only %d of %d cases read any restock — the fixture does not exercise the filters", nonEmpty, 2*len(names))
	}
}

// EACH STATUS, BY HAND — and the three rules a sum gets wrong:
//   - Jumlah barang is the pieces ORDERED on every status, an accepted one included, never the pieces counted in
//     (jumlah-barang-counts-the-pieces-ordered);
//   - the total's Jumlah SKU counts the products over every status together — a product on two piles is one, and the
//     total is neither the piles' sum nor the largest pile's;
//   - Ongkir COD is the warehouse's, outside Nilai transaksi (the-couriers-charge-stays-out-of-total);
//
// and a restock with no paying account (raised before naming one was required) is a Rincian row of its own, so the rows
// add up to the card. One restock goes through the real raise and accept, so the stored subtotal and total are the
// writes' own.
func TestRestockSellingStat_CountsEachStatus(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const team, warehouse uint64 = 2, 5

	seed := func(status string, account uint64, shipping, charge float64, lines ...[3]int64) {
		t.Helper()

		var subtotal float64
		for _, l := range lines {
			subtotal += float64(l[2])
		}

		r := inventory_service_models.Restock{
			TeamID: team, WarehouseID: warehouse, Status: status, FinanceAccountID: account,
			ShipmentCost: shipping, Subtotal: subtotal, Total: subtotal + shipping,
			WarehouseAdditionalCost: charge,
		}
		if charge > 0 {
			r.WarehouseAdditionalCostNote = courierNote
		}

		err := db.Create(&r).Error
		if err != nil {
			t.Fatalf("seed restock: %v", err)
		}

		for _, l := range lines {
			line := inventory_service_models.RestockItem{
				RestockID: r.ID, ProductID: uint64(l[0]), ProductCode: fmt.Sprintf("P-%d", l[0]), Name: "line",
				Count: l[1], Total: float64(l[2]), PriceUnit: float64(l[2]) / float64(l[1]),
			}
			// An accepted line counted in two short: the cards still read what was ORDERED.
			if status == "accepted" {
				line.ReceivedCount = max(l[1]-2, 0)
			}

			err = db.Create(&line).Error
			if err != nil {
				t.Fatalf("seed line: %v", err)
			}
		}
	}

	// ongoing: products 1 and 3; accepted: 1, 2 and the raise's 4; cancelled: 1. The total's products are 1–4 — the
	// largest pile would say 3, the piles' sum 6.
	seed("ongoing", 1301, 10_000, 0, [3]int64{1, 5, 50_000}, [3]int64{3, 2, 30_000})
	seed("ongoing", 0, 0, 0, [3]int64{1, 1, 10_000})
	seed("accepted", 1301, 20_000, 5_000, [3]int64{1, 10, 100_000}, [3]int64{2, 4, 40_000})
	seed("accepted", 1303, 5_000, 0, [3]int64{2, 6, 60_000})
	seed("cancelled", 1303, 0, 0, [3]int64{1, 3, 30_000})
	// A restock with no line yet still counts as a transaction, with nothing ordered.
	seed("lost", 1301, 7_000, 0)

	// And one through the real raise and accept, with no account named — account 0.
	staging := stagingPlacement(t, db, warehouse)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: team, WarehouseId: warehouse, ShipmentCost: 8_000,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 4, ProductCode: "P-4", Name: "Kaos Polos Hitam", Count: 10, Total: 400_000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	raised := created.Msg.GetRequest()

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: raised.GetId(), WarehouseAdditionalCost: 3_000, WarehouseAdditionalCostNote: courierNote,
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: raised.GetItems()[0].GetId(), ReceivedCount: 7, Placements: placedOn(staging, 7)},
		},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	got := sellingStat(t, svc, team, nil)

	want := map[inventoryv1.RestockRequestStatus]statPile{
		inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ONGOING: {
			restocks: 2, units: 8, products: 2, goods: 90_000, shipping: 10_000, value: 100_000,
		},
		inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED: {
			// 10 + 4 + 6 + the raise's 10 — ordered, though 7 + 2 + 4 + 7 were counted in.
			restocks: 3, units: 30, products: 3, goods: 600_000, shipping: 33_000, charge: 8_000, value: 633_000,
		},
		inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_CANCELLED: {
			restocks: 1, units: 3, products: 1, goods: 30_000, value: 30_000,
		},
		inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_LOST: {
			restocks: 1, shipping: 7_000, value: 7_000,
		},
	}

	for _, status := range sellingStatuses {
		g := asStatPile(pileOf(got, status))
		if !samePile(g, want[status]) {
			t.Errorf("%v\n got  %v\n want %v", status, g, want[status])
		}
	}

	if len(got.GetByStatus()) != 4 {
		t.Errorf("%d piles, want 4 — arrived has none and is absent", len(got.GetByStatus()))
	}

	// Products 1, 2, 3, 4 — every status's lines together.
	wantTotal := statPile{restocks: 7, units: 41, products: 4, goods: 720_000, shipping: 50_000, charge: 8_000, value: 770_000}
	gotTotal := asStatPile(got.GetTotal())
	if !samePile(gotTotal, wantTotal) {
		t.Errorf("total\n got  %v\n want %v", gotTotal, wantTotal)
	}

	if got.GetTotal().GetStatus() != inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_UNSPECIFIED {
		t.Errorf("the total's status = %v, want UNSPECIFIED", got.GetTotal().GetStatus())
	}

	// Rincian on Diterima: 1301 (one, Rp 160.000), 1303 (one, Rp 65.000) and no account (the raise, Rp 408.000) — a row
	// each, adding up to the card's 3 · Rp 633.000.
	accepted := map[uint64][2]float64{}
	for _, a := range got.GetByAccount() {
		if a.GetStatus() == inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED {
			accepted[a.GetFinanceAccountId()] = [2]float64{float64(a.GetRestockCount()), a.GetValue()}
		}
	}

	wantAccepted := map[uint64][2]float64{1301: {1, 160_000}, 1303: {1, 65_000}, 0: {1, 408_000}}
	if len(accepted) != len(wantAccepted) {
		t.Fatalf("accepted's accounts = %v, want %v", accepted, wantAccepted)
	}

	var count, value float64
	for id, w := range wantAccepted {
		if accepted[id] != w {
			t.Errorf("accepted, account %d = %v, want %v", id, accepted[id], w)
		}

		count += accepted[id][0]
		value += accepted[id][1]
	}

	if int64(count) != pileOf(got, inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED).GetRestockCount() ||
		value != pileOf(got, inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED).GetValue() {
		t.Errorf("accepted's rows add up to %v restocks · Rp %v, the card says %d · Rp %v", count, value,
			pileOf(got, inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED).GetRestockCount(),
			pileOf(got, inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED).GetValue())
	}
}

// THE SELLING SIDE ONLY — never the list's other side. The list shows a team the restocks it raised AND the ones coming
// to it as a warehouse; the census counts only the ones it raised, so a warehouse's inbound restocks — another team's
// money — never reach it (the-warehouse-sees-the-cod-it-paid). A team with nothing raised reads zeros, not an error.
func TestRestockSellingStat_CountsOnlyWhatTheTeamRaised(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	seedCodRestock(t, db, 5, "accepted", nil, 4_000) // team 2's, into warehouse 5

	// A restock raised by team 3 addressed to team 2 — the list's OR reads it for team 2, the census must not.
	inbound := inventory_service_models.Restock{TeamID: 3, WarehouseID: 2, Status: "ongoing", Subtotal: 9_000, Total: 9_000}

	err := db.Create(&inbound).Error
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	listed := tabTotal(t, svc, 2, nil)
	if listed != 2 {
		t.Fatalf("the list reads %d for team 2, want 2 (its own and the one coming to it)", listed)
	}

	got := sellingStat(t, svc, 2, nil)
	if got.GetTotal().GetRestockCount() != 1 || got.GetTotal().GetValue() != 1_025_000 {
		t.Fatalf("team 2 = %v, want its own restock only (1 · Rp 1.025.000)", asStatPile(got.GetTotal()))
	}

	// The warehouse, asked by Root (the only caller the policy lets near it), raised nothing.
	warehouse := sellingStat(t, svc, 5, nil)
	if warehouse.GetTotal().GetRestockCount() != 0 || warehouse.GetTotal().GetValue() != 0 ||
		len(warehouse.GetByStatus()) != 0 || len(warehouse.GetByAccount()) != 0 {
		t.Fatalf("warehouse 5 = %v, want nothing — it raised no restock", warehouse)
	}
}

// Who may ask: the selling roles that read the list, Root and the Administrator — no warehouse role, which sees no
// restock money (the-warehouse-sees-the-cod-it-paid). A read: an agent and the monitor may call it.
func TestRestockSellingStat_Policy(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.RestockSellingStatRequest")
	if err != nil {
		t.Fatal(err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatal("RestockSellingStatRequest has no policy")
	}

	want := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_SELLING_OWNER,
		role_basev1.Role_ROLE_SELLING_ADMIN,
		role_basev1.Role_ROLE_SELLING_CS,
	}
	if !slices.Equal(policy.GetRoles(), want) {
		t.Fatalf("roles = %v, want %v", policy.GetRoles(), want)
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.RestockRequestService.RestockSellingStat")
	if err != nil {
		t.Fatal(err)
	}

	opts, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() != descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatal("RestockSellingStat must be marked NO_SIDE_EFFECTS")
	}
}

// statRoles is a caller's role per (user, team), as the access interceptor resolves it.
type statRoles map[[2]uint64]role_basev1.Role

func (r statRoles) Resolve(_ context.Context, user, team uint64) (access_interceptors.Access, error) {
	return access_interceptors.Access{Role: r[[2]uint64{user, team}]}, nil
}

func (statRoles) Invalidate(context.Context, uint64) error { return nil }

// MOUNTED AS THE APP MOUNTS IT — inventory's register behind the validator and the access interceptor: the selling
// team's Owner and CS read their own census; the warehouse's Owner is refused on its own team (no warehouse role), and
// a selling Owner is refused on another team (the scope).
func TestRestockSellingStat_TheWarehouseAndAnotherTeamAreRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	seedCodRestock(t, db, 5, "accepted", nil, 4_000) // team 2's

	const owner, cs, keeper uint64 = 71, 72, 73

	roles := statRoles{
		{owner, 2}:  role_basev1.Role_ROLE_SELLING_OWNER,
		{cs, 2}:     role_basev1.Role_ROLE_SELLING_CS,
		{owner, 3}:  role_basev1.Role_ROLE_UNSPECIFIED,
		{keeper, 5}: role_basev1.Role_ROLE_WAREHOUSE_OWNER,
	}

	signer := san_auth.NewSigner("restock-selling-stat-test", time.Hour)
	chain := connect.WithInterceptors(validate.NewInterceptor(), access_interceptors.NewInterceptor(signer, roles))

	mux := http.NewServeMux()
	san_grpc.Register(mux, inventory_service.NewRegister(mux, svc, chain))

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	client := inventoryv1connect.NewRestockRequestServiceClient(server.Client(), server.URL)

	ask := func(user, team uint64) (*inventoryv1.RestockSellingStatResponse, error) {
		t.Helper()

		token, err := signer.Sign(&role_basev1.Identity{
			IdentityId:   user,
			Username:     fmt.Sprintf("u%d", user),
			IdentityType: role_basev1.IdentityType_IDENTITY_TYPE_GENERAL_USER,
		}, time.Now())
		if err != nil {
			t.Fatal(err)
		}

		req := connect.NewRequest(&inventoryv1.RestockSellingStatRequest{TeamId: team})
		req.Header().Set("Authorization", "Bearer "+token)

		res, err := client.RestockSellingStat(context.Background(), req)
		if err != nil {
			return nil, err
		}

		return res.Msg, nil
	}

	for _, user := range []uint64{owner, cs} {
		got, err := ask(user, 2)
		if err != nil {
			t.Fatalf("user %d on their own team: %v", user, err)
		}

		if got.GetTotal().GetRestockCount() != 1 {
			t.Fatalf("user %d: %d restocks, want 1", user, got.GetTotal().GetRestockCount())
		}
	}

	_, err := ask(keeper, 5)
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("the warehouse's Owner on its own team: %v, want PermissionDenied", err)
	}

	_, err = ask(owner, 3)
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("a selling Owner on another team: %v, want PermissionDenied", err)
	}
}
