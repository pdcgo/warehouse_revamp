package selling_v1_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// AN ORDER MUST SAY WHEN ITS BUYER ORDERED (platform-created-at-is-required-at-finalize): refused at placement, naming
// what is missing, and nothing is written.
func TestOrderCreate_RefusesAnOrderWithNoPlatformOrderDate(t *testing.T) {
	db := san_testdb.DB(t)
	picker := knownCosts()
	svc := newServiceWithFees(t, db, picker, &fakeFees{percent: 2.5})
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")

	req := feeOrderReq(shop)
	req.PlatformCreatedAtUnix = 0

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))

	if connect.CodeOf(err) != connect.CodeInvalidArgument || !strings.Contains(err.Error(), "when the buyer ordered") {
		t.Fatalf("err = %v — want InvalidArgument naming the missing order date", err)
	}

	if n := countOrders(t, db); n != 0 || len(picker.picked) != 0 {
		t.Fatalf("%d orders written, picked %v — a refused order takes nothing", n, picker.picked)
	}
}

// BOTH DATES ARE KEPT AS READ OFF THE STOREFRONT, on the response, the detail and the list row — the deadline is
// optional (the-shipment-deadline-is-the-platforms-and-optional), so an order without one carries 0.
func TestOrderCreate_KeepsThePlatformsTwoDates(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")

	const deadline = testPlatformDate + 2*86400

	req := feeOrderReq(shop)
	req.PlatformShipmentDeadlineUnix = deadline

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	without, err := svc.OrderCreate(context.Background(), connect.NewRequest(feeOrderReq(shop)))
	if err != nil {
		t.Fatalf("create without a deadline: %v — it is optional", err)
	}

	order := created.Msg.GetOrder()
	if order.GetPlatformCreatedAtUnix() != testPlatformDate || order.GetPlatformShipmentDeadlineUnix() != deadline {
		t.Fatalf("dates %d / %d — want %d / %d", order.GetPlatformCreatedAtUnix(), order.GetPlatformShipmentDeadlineUnix(),
			testPlatformDate, deadline)
	}

	if got := without.Msg.GetOrder().GetPlatformShipmentDeadlineUnix(); got != 0 {
		t.Fatalf("deadline = %d on an order given none — want 0", got)
	}

	detail, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: 2, OrderId: order.GetId(),
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if got := detail.Msg.GetOrder().GetPlatformShipmentDeadlineUnix(); got != deadline {
		t.Fatalf("detail deadline = %d, want %d", got, deadline)
	}

	for _, row := range orderRows(listFiltered(t, svc, 2, &sellingv1.OrderListFilter{})) {
		if row.GetPlatformCreatedAtUnix() != testPlatformDate {
			t.Fatalf("list row %d platform date = %d, want %d", row.GetId(), row.GetPlatformCreatedAtUnix(), testPlatformDate)
		}
	}
}

// PROMOTE COPIES THEM — the order date the person set on the draft and the deadline the app pushed.
func TestOrderDraftPromote_CopiesThePlatformsTwoDates(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	const deadline = testPlatformDate + 86400

	draftID := readyDraft(t, svc, db, shop)
	updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId: 2, DraftId: draftID, PlatformShipmentDeadlineUnix: i64(deadline),
	})

	res, err := promote(t, svc, 7, 2, draftID)
	if err != nil {
		t.Fatalf("promote: %v", err)
	}

	order := res
	if order.GetPlatformCreatedAtUnix() != testPlatformDate || order.GetPlatformShipmentDeadlineUnix() != deadline {
		t.Fatalf("promoted dates %d / %d — want the draft's %d / %d", order.GetPlatformCreatedAtUnix(),
			order.GetPlatformShipmentDeadlineUnix(), testPlatformDate, deadline)
	}
}

// THE APP'S DATES YIELD TO A PERSON'S, FIELD BY FIELD (§6.5): a push stores both; a person corrects the order date,
// which marks it touched; the app's next push still moves the untouched deadline and leaves the corrected date alone.
func TestOrderDraftPush_ThePlatformDatesYieldToAPersonsEdit(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	first := scrape()
	first.PlatformCreatedAtUnix = testPlatformDate
	first.PlatformShipmentDeadlineUnix = testPlatformDate + 86400

	draft := push(t, svc, 7, first).GetDraft()
	if draft.GetPlatformCreatedAtUnix() != testPlatformDate || draft.GetPlatformShipmentDeadlineUnix() != testPlatformDate+86400 {
		t.Fatalf("pushed dates %d / %d — want both kept", draft.GetPlatformCreatedAtUnix(), draft.GetPlatformShipmentDeadlineUnix())
	}

	const corrected = testPlatformDate - 3600

	edited := updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId: 2, DraftId: draft.GetId(), PlatformCreatedAtUnix: i64(corrected),
	})
	if !contains(edited.GetTouchedFields(), "platform_created_at_unix") {
		t.Fatalf("touched %v — the corrected order date must be marked", edited.GetTouchedFields())
	}

	again := scrape()
	again.PlatformCreatedAtUnix = testPlatformDate + 999
	again.PlatformShipmentDeadlineUnix = testPlatformDate + 2*86400

	after := push(t, svc, 7, again).GetDraft()
	if after.GetPlatformCreatedAtUnix() != corrected {
		t.Fatalf("order date = %d after a re-push — the person's %d must stand", after.GetPlatformCreatedAtUnix(), corrected)
	}

	if after.GetPlatformShipmentDeadlineUnix() != testPlatformDate+2*86400 {
		t.Fatalf("deadline = %d — an untouched field follows the app's latest reading", after.GetPlatformShipmentDeadlineUnix())
	}
}

// THE DATE WINDOW READS THE DATE ASKED FOR (the-date-filter-switches-created-or-platform): by default when we wrote the
// row, or when the buyer ordered — and the tab counts read the same one.
func TestOrderList_TheDateWindowReadsThePlatformDateWhenAsked(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")

	now := time.Now().Unix()

	// Typed in today, bought a month ago.
	old := feeOrderReq(shop)

	oldResp, err := svc.OrderCreate(context.Background(), connect.NewRequest(old))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Typed in today, bought an hour ago.
	recent := feeOrderReq(shop)
	recent.PlatformCreatedAtUnix = now - 3600

	recentResp, err := svc.OrderCreate(context.Background(), connect.NewRequest(recent))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	window := func(field sellingv1.OrderDateField) *sellingv1.OrderListFilter {
		return &sellingv1.OrderListFilter{CreatedFromUnix: now - 86400, CreatedToUnix: now + 86400, DateField: field}
	}

	both := []uint64{oldResp.Msg.GetOrder().GetId(), recentResp.Msg.GetOrder().GetId()}

	wantOrders(t, listFiltered(t, svc, 2, window(sellingv1.OrderDateField_ORDER_DATE_FIELD_UNSPECIFIED)), both...)
	wantOrders(t, listFiltered(t, svc, 2, window(sellingv1.OrderDateField_ORDER_DATE_FIELD_CREATED)), both...)
	wantOrders(t, listFiltered(t, svc, 2, window(sellingv1.OrderDateField_ORDER_DATE_FIELD_PLATFORM_CREATED)),
		recentResp.Msg.GetOrder().GetId())

	stat, err := svc.OrderStat(context.Background(), connect.NewRequest(&sellingv1.OrderStatRequest{
		TeamId: 2,
		Filter: &sellingv1.OrderStatFilter{
			CreatedFromUnix: now - 86400, CreatedToUnix: now + 86400,
			DateField: sellingv1.OrderDateField_ORDER_DATE_FIELD_PLATFORM_CREATED,
		},
	}))
	if err != nil {
		t.Fatalf("OrderStat: %v", err)
	}

	if got := pendingRow(t, stat.Msg).GetCount(); got != 1 {
		t.Fatalf("the counts read %d pending on the platform date, want 1 — the same set as the rows", got)
	}
}

func contains(values []string, want string) bool {
	for _, v := range values {
		if v == want {
			return true
		}
	}

	return false
}
