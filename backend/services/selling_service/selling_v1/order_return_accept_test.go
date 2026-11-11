package selling_v1_test

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// THE RETURN ACCEPT (the-accept-is-the-status-return-completed) with its stock half (return_decision.md) — the selling
// team's return warehouse has the returned parcel in its hands. The cast is the return map's
// (product_return_map_create_test.go): team 2 sells team 9's 501 and owns 601 and 602. Unless a test says otherwise,
// team 2's return warehouse is the one that shipped the order (testWarehouse).

// The return cast beyond the order's own warehouse (testWarehouse, 900): a configured return warehouse that never shipped
// the order, and a third building an old label still names.
const (
	configuredReturnWarehouse uint64 = 950
	staleLabelWarehouse       uint64 = 960

	// The rack the crew puts the sound units on — inventory checks it is the warehouse's; the fake does not.
	returnRack uint64 = 77
)

// fakeNames is team_service's names, for the refusal's sentence.
type fakeNames map[uint64]string

func (n fakeNames) TeamNames(_ context.Context, ids []uint64) (map[uint64]string, error) {
	out := map[uint64]string{}
	for _, id := range ids {
		if name, ok := n[id]; ok {
			out[id] = name
		}
	}

	return out, nil
}

// returnAccept is a selling service that records its events, knows the return map's catalogue, names Gudang Cabang, and
// answers the stock half with the fake picker it returns.
func returnAccept(t *testing.T, db *gorm.DB, rec *recorder, catalog selling_v1.ProductCatalog) (*selling_v1.Service, *fakePicker) {
	t.Helper()

	picker := &fakePicker{}

	return selling_v1.NewService(db, picker, rec.send, catalog, &fakeCredit{}, everyoneMayWrite{}, nil, nil, nil, nil,
		fakeNames{configuredReturnWarehouse: "Gudang Cabang"}), picker
}

// returnedOrder places team 2's order, walks it to the courier and has customer service claim it back — `return`, the
// state the accept starts from.
func returnedOrder(t *testing.T, svc *selling_v1.Service, req *sellingv1.OrderCreateRequest) (uint64, []*sellingv1.OrderItem) {
	t.Helper()

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	id := created.Msg.GetOrder().GetId()

	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, "")
	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_PICKED, "")
	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING, "")
	moveOrder(t, svc, mapTeam, id, sellingv1.OrderStatus_ORDER_STATUS_RETURN, "")

	return id, created.Msg.GetOrder().GetItems()
}

// configureReturnWarehouse gives a team its return warehouse (team_return_configurations).
func configureReturnWarehouse(t *testing.T, db *gorm.DB, teamID, warehouseID uint64) {
	t.Helper()

	err := db.Create(&selling_service_models.TeamReturnConfiguration{TeamID: teamID, WarehouseID: warehouseID}).Error
	if err != nil {
		t.Fatalf("configure the return warehouse of %d: %v", teamID, err)
	}
}

// whole is the count of a whole, sound parcel: every line on the return rack.
func whole(items []*sellingv1.OrderItem) []*sellingv1.OrderReturnAcceptLine {
	lines := make([]*sellingv1.OrderReturnAcceptLine, 0, len(items))
	for _, item := range items {
		lines = append(lines, counted(item, 0, 0, ""))
	}

	return lines
}

// counted is one line's count: broken and missing as given, the sound rest on the return rack.
func counted(item *sellingv1.OrderItem, broken, missing uint32, note string) *sellingv1.OrderReturnAcceptLine {
	line := &sellingv1.OrderReturnAcceptLine{OrderItemId: item.GetId(), Broken: broken, Missing: missing, Note: note}
	if sound := item.GetQuantity() - broken - missing; sound > 0 {
		line.Placements = []*sellingv1.OrderReturnPlacement{{RackId: returnRack, Quantity: sound}}
	}

	return line
}

func acceptReturn(
	svc *selling_v1.Service,
	ctx context.Context,
	teamID, orderID uint64,
	lines []*sellingv1.OrderReturnAcceptLine,
	change func(*sellingv1.OrderReturnAcceptRequest),
) (*sellingv1.OrderReturnAcceptResponse, error) {
	req := &sellingv1.OrderReturnAcceptRequest{TeamId: teamID, OrderId: orderID, Lines: lines}
	if change != nil {
		change(req)
	}

	res, err := svc.OrderReturnAccept(ctx, connect.NewRequest(req))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// timelineRows is the order's timeline, oldest first.
func timelineRows(t *testing.T, db *gorm.DB, orderID uint64) []selling_service_models.OrderTimelineLog {
	t.Helper()

	var rows []selling_service_models.OrderTimelineLog

	err := db.Where("order_id = ?", orderID).Order("id").Find(&rows).Error
	if err != nil {
		t.Fatalf("read timeline of %d: %v", orderID, err)
	}

	return rows
}

// acceptRow is the order's return_completed row.
func acceptRow(t *testing.T, db *gorm.DB, orderID uint64) selling_service_models.OrderTimelineLog {
	t.Helper()

	var row selling_service_models.OrderTimelineLog

	err := db.Where("order_id = ? AND status = ?", orderID, "return_completed").Take(&row).Error
	if err != nil {
		t.Fatalf("the accept row of %d: %v", orderID, err)
	}

	return row
}

// stillReturn asserts a refused accept left the order in `return`, the stock half and the broker untouched.
func stillReturn(t *testing.T, svc *selling_v1.Service, picker *fakePicker, rec *recorder, orderID uint64, stockCalls int) {
	t.Helper()

	if status := orderStatus(t, svc, orderID); status != sellingv1.OrderStatus_ORDER_STATUS_RETURN {
		t.Fatalf("status %v after a refused accept, want RETURN", status)
	}

	if len(picker.stockReturns) != stockCalls {
		t.Fatalf("the stock half was asked %d times, want %d", len(picker.stockReturns), stockCalls)
	}

	if len(rec.events) != 0 {
		t.Fatalf("a refused accept published %d events", len(rec.events))
	}
}

// A WHOLE PARCEL: the stock half is asked FIRST — the return warehouse, the ordering team, the order's take, every line
// sound on its rack — then the order moves to return_completed on one warehouse row with no note, stores the return's
// stock transaction, and OrderReturnAccepted names the order, its selling team, the warehouse and the row.
func TestOrderReturnAccept_PutsTheParcelBackThenMovesTheReturn(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc, picker := returnAccept(t, db, rec, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")
	configureReturnWarehouse(t, db, mapTeam, testWarehouse)

	orderID, items := returnedOrder(t, svc, orderReq(shop))
	rec.events = nil

	got, err := acceptReturn(svc, asUser(31), testWarehouse, orderID, whole(items), nil)
	if err != nil {
		t.Fatalf("OrderReturnAccept: %v", err)
	}

	if len(picker.stockReturns) != 1 {
		t.Fatalf("the stock half was asked %d times, want once", len(picker.stockReturns))
	}

	in := picker.stockReturns[0]
	if in.ReturnWarehouseID != testWarehouse || in.SellingTeamID != mapTeam || in.TakeTransactionID != 7001 ||
		len(in.Lines) != 1 {
		t.Fatalf("stock return %+v, want warehouse %d, team 2, the take 7001, one line", in, testWarehouse)
	}

	line := in.Lines[0]
	if line.ProductID != 100 || line.ReturnProductID != 100 || line.MarkupRate != 0 || line.Sound != 3 ||
		line.Broken != 0 || line.Missing != 0 || len(line.Placements) != 1 || line.Placements[0].RackID != returnRack ||
		line.Placements[0].Quantity != 3 {
		t.Fatalf("stock line %+v, want 3 sound Widgets as themselves on rack %d", line, returnRack)
	}

	order := got.GetOrder()
	if order.GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_RETURN_COMPLETED || order.GetReturnTransactionId() != 8001 ||
		order.GetReturnWarehouseId() != testWarehouse {
		t.Fatalf("answered %v, return transaction %d, return warehouse %d — want RETURN_COMPLETED, 8001, %d",
			order.GetStatus(), order.GetReturnTransactionId(), order.GetReturnWarehouseId(), testWarehouse)
	}

	if len(got.GetLabels()) != 0 {
		t.Fatalf("labels %v for an order of nobody's borrowed goods, want none", got.GetLabels())
	}

	var stored *uint64

	db.Raw(`SELECT return_transaction_id FROM orders WHERE id = ?`, orderID).Scan(&stored)
	if stored == nil || *stored != 8001 {
		t.Fatalf("orders.return_transaction_id = %v, want 8001", stored)
	}

	rows := timelineRows(t, db, orderID)
	last := rows[len(rows)-1]

	if last.Status != "return_completed" || last.From != "warehouse" || last.ActorID != 31 || last.Note != "" ||
		last.AcceptingWarehouseID != testWarehouse {
		t.Fatalf("accept row = %+v, want return_completed from the warehouse by 31 with no note, accepted at %d", last,
			testWarehouse)
	}

	if len(rec.events) != 1 {
		t.Fatalf("published %d events, want one OrderReturnAccepted", len(rec.events))
	}

	event := rec.events[0]
	accepted := event.GetOrderReturnAccepted()

	if event.GetEventId() != "order-return-accepted:"+strconv.FormatUint(orderID, 10) {
		t.Fatalf("event id %q, want order-return-accepted:<order>", event.GetEventId())
	}

	if accepted.GetTeamId() != mapTeam || accepted.GetWarehouseId() != testWarehouse ||
		accepted.GetActorId() != 31 || accepted.GetTimelineLogId() != last.ID || accepted.GetCourierCharge() != 0 {
		t.Fatalf("event = %+v, want team 2, warehouse %d, actor 31, row %d, no charge", accepted, testWarehouse, last.ID)
	}

	// To the microsecond — what Postgres keeps of the moment the row and the event share.
	if event.GetOccurredAt().AsTime().Sub(last.CreatedAt).Abs() >= time.Microsecond {
		t.Fatalf("occurred_at %v, want the accept row's %v", event.GetOccurredAt().AsTime(), last.CreatedAt)
	}
}

// THE SELLING TEAM CLAIMS A RETURN, IT DOES NOT ACCEPT ONE (both-cs-and-the-warehouse-can-return-an-order) — refused, and
// nothing moves.
func TestOrderReturnAccept_TheSellingTeamDoesNotAccept(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc, picker := returnAccept(t, db, rec, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")
	configureReturnWarehouse(t, db, mapTeam, testWarehouse)

	orderID, items := returnedOrder(t, svc, orderReq(shop))
	rec.events = nil

	_, err := acceptReturn(svc, context.Background(), mapTeam, orderID, whole(items), nil)
	wantCode(t, err, connect.CodePermissionDenied)

	stillReturn(t, svc, picker, rec, orderID, 0)
}

// AN OUTSIDER CANNOT PROBE an order that is not a return: a warehouse that is neither end reads NotFound, as a read would.
// The order's own warehouse is told why.
func TestOrderReturnAccept_AnOrderNotInReturnIsNotFoundToAnOutsider(t *testing.T) {
	db := san_testdb.DB(t)
	svc, _ := returnAccept(t, db, &recorder{}, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")
	configureReturnWarehouse(t, db, mapTeam, testWarehouse)

	pending := placeOrder(t, svc, mapTeam, shop)

	_, err := acceptReturn(svc, context.Background(), staleLabelWarehouse, pending, nil, nil)
	wantCode(t, err, connect.CodeNotFound)

	_, err = acceptReturn(svc, context.Background(), testWarehouse, pending, nil, nil)
	wantCode(t, err, connect.CodeFailedPrecondition)
}

// ONLY THE RETURN WAREHOUSE ACCEPTS A RETURN (only-the-return-warehouse-accepts-a-return): team 2's return warehouse is
// Gudang Cabang, which never shipped the order. The warehouse that shipped it, and a third building an old label sent the
// parcel to, are refused FailedPrecondition naming where it goes — nothing is stocked, nothing moves. Gudang Cabang finds
// it on its list, accepts it, is recorded as where it was accepted, and is the warehouse the courier's charge is owed to.
func TestOrderReturnAccept_OnlyTheReturnWarehouseAccepts(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc, picker := returnAccept(t, db, rec, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")
	configureReturnWarehouse(t, db, mapTeam, configuredReturnWarehouse)

	orderID, items := returnedOrder(t, svc, orderReq(shop))
	rec.events = nil

	for _, elsewhere := range []uint64{testWarehouse, staleLabelWarehouse} {
		_, err := acceptReturn(svc, asUser(51), elsewhere, orderID, whole(items), nil)
		cerr := wantCode(t, err, connect.CodeFailedPrecondition)

		if !strings.Contains(cerr.Message(), "this return goes to Gudang Cabang") {
			t.Fatalf("warehouse %d: message %q should say the return goes to Gudang Cabang", elsewhere, cerr.Message())
		}
	}

	stillReturn(t, svc, picker, rec, orderID, 0)

	// The Returns tab, and the order read: the return is listed to Gudang Cabang, saying it goes there.
	listed, err := svc.OrderList(context.Background(), connect.NewRequest(&sellingv1.OrderListRequest{
		TeamId: configuredReturnWarehouse,
		Filter: &sellingv1.OrderListFilter{Status: sellingv1.OrderStatus_ORDER_STATUS_RETURN},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("OrderList as the return warehouse: %v", err)
	}

	if ids := listed.Msg.GetIds(); len(ids) != 1 || ids[0] != orderID {
		t.Fatalf("the return warehouse lists %v, want only the return %d", ids, orderID)
	}

	for _, item := range listed.Msg.GetItems() {
		for _, o := range item.GetOrder().GetMapData() {
			if o.GetReturnWarehouseId() != configuredReturnWarehouse {
				t.Fatalf("the listed return goes to %d, want %d", o.GetReturnWarehouseId(), configuredReturnWarehouse)
			}
		}
	}

	_, err = acceptReturn(svc, asUser(41), configuredReturnWarehouse, orderID, whole(items),
		func(r *sellingv1.OrderReturnAcceptRequest) {
			r.CourierCharge = 12_000
			r.CourierChargeNote = "ongkir retur"
		})
	if err != nil {
		t.Fatalf("OrderReturnAccept as the return warehouse: %v", err)
	}

	if in := picker.stockReturns[0]; in.ReturnWarehouseID != configuredReturnWarehouse {
		t.Fatalf("the parcel was stocked at %d, want the return warehouse %d", in.ReturnWarehouseID, configuredReturnWarehouse)
	}

	if row := acceptRow(t, db, orderID); row.AcceptingWarehouseID != configuredReturnWarehouse || row.From != "warehouse" {
		t.Fatalf("accept row = %+v, want it accepted at %d, from the warehouse", row, configuredReturnWarehouse)
	}

	accepted := rec.events[0].GetOrderReturnAccepted()
	if accepted.GetWarehouseId() != configuredReturnWarehouse || accepted.GetTeamId() != mapTeam {
		t.Fatalf("event warehouse %d team %d, want the charge owed by %d to %d — the door it was paid at",
			accepted.GetWarehouseId(), accepted.GetTeamId(), mapTeam, configuredReturnWarehouse)
	}
}

// A TEAM WITH NO RETURN WAREHOUSE has nobody who may accept its return — said plainly, nothing stocked.
func TestOrderReturnAccept_ATeamWithNoReturnWarehouseIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc, picker := returnAccept(t, db, rec, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	orderID, items := returnedOrder(t, svc, orderReq(shop))
	rec.events = nil

	_, err := acceptReturn(svc, context.Background(), testWarehouse, orderID, whole(items), nil)
	cerr := wantCode(t, err, connect.CodeFailedPrecondition)

	if !strings.Contains(cerr.Message(), "no return warehouse") {
		t.Fatalf("message %q should say the team has no return warehouse", cerr.Message())
	}

	stillReturn(t, svc, picker, rec, orderID, 0)
}

// ONLY A CLAIMED RETURN: an order still with the courier is forced to return first (a-forced-return-follows-the-status-
// move), and an accepted one is not accepted twice — nor stocked twice.
func TestOrderReturnAccept_OnlyFromReturn(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc, picker := returnAccept(t, db, rec, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")
	configureReturnWarehouse(t, db, mapTeam, testWarehouse)

	shipping := processedOrder(t, svc, shop)
	moveOrder(t, svc, testWarehouse, shipping, sellingv1.OrderStatus_ORDER_STATUS_PICKED, "")
	moveOrder(t, svc, testWarehouse, shipping, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING, "")

	_, err := acceptReturn(svc, context.Background(), testWarehouse, shipping, nil, nil)
	cerr := wantCode(t, err, connect.CodeFailedPrecondition)

	if !strings.Contains(cerr.Message(), "only an order in return") || !strings.Contains(cerr.Message(), "shipping") {
		t.Fatalf("message %q should say only a return is accepted, and that this one is shipping", cerr.Message())
	}

	returned, items := returnedOrder(t, svc, orderReq(shop))

	_, err = acceptReturn(svc, context.Background(), testWarehouse, returned, whole(items), nil)
	if err != nil {
		t.Fatalf("first accept: %v", err)
	}

	rec.events = nil

	_, err = acceptReturn(svc, context.Background(), testWarehouse, returned, whole(items), nil)
	cerr = wantCode(t, err, connect.CodeFailedPrecondition)

	if !strings.Contains(cerr.Message(), "already accepted") {
		t.Fatalf("message %q should say the return is already accepted", cerr.Message())
	}

	if n := timelineStatusCount(t, db, returned, "return_completed"); n != 1 {
		t.Fatalf("%d return_completed rows, want one", n)
	}

	if len(picker.stockReturns) != 1 || len(rec.events) != 0 {
		t.Fatalf("the refused second accept stocked %d times in all and published %d events", len(picker.stockReturns),
			len(rec.events))
	}
}

// timelineStatusCount is how many timeline rows of `kind` the order has.
func timelineStatusCount(t *testing.T, db *gorm.DB, orderID uint64, kind string) int64 {
	t.Helper()

	var n int64

	err := db.Raw(`SELECT count(*) FROM order_timeline_logs WHERE order_id = ? AND status = ?`, orderID, kind).Scan(&n).Error
	if err != nil {
		t.Fatalf("count %s rows of %d: %v", kind, orderID, err)
	}

	return n
}

// BROKEN AND MISSING (a-short-return-is-missing-at-the-door, a-broken-returned-unit-is-thrown-away-at-the-door,
// a-return-door-row-carries-an-optional-note): the return stays whole; the stock half gets 1 sound, 1 broken, 1 missing
// and the crew's note, and ONE note row from the warehouse names both with the note — what customer service claims
// from the platform — at the accept's moment.
func TestOrderReturnAccept_BrokenAndMissingAreNamedWithTheNote(t *testing.T) {
	db := san_testdb.DB(t)
	svc, picker := returnAccept(t, db, &recorder{}, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")
	configureReturnWarehouse(t, db, mapTeam, testWarehouse)

	// orderReq is 3 × SKU1 Widget.
	orderID, items := returnedOrder(t, svc, orderReq(shop))

	_, err := acceptReturn(svc, asUser(31), testWarehouse, orderID,
		[]*sellingv1.OrderReturnAcceptLine{counted(items[0], 1, 1, "  sobek di jahitan ")}, nil)
	if err != nil {
		t.Fatalf("OrderReturnAccept: %v", err)
	}

	line := picker.stockReturns[0].Lines[0]
	if line.Sound != 1 || line.Broken != 1 || line.Missing != 1 || line.Note != "sobek di jahitan" {
		t.Fatalf("stock line %+v, want 1 sound, 1 broken, 1 missing and the trimmed note", line)
	}

	rows := timelineRows(t, db, orderID)
	accept, note := rows[len(rows)-2], rows[len(rows)-1]

	if accept.Status != "return_completed" {
		t.Fatalf("second-to-last row = %+v, want the accept", accept)
	}

	if note.Status != "" || note.From != "warehouse" || note.ActorID != 31 {
		t.Fatalf("last row = %+v, want a warehouse NOTE by 31", note)
	}

	want := "Missing from the returned parcel: 1 × SKU1 Widget (sobek di jahitan). " +
		"Broken, thrown away: 1 × SKU1 Widget (sobek di jahitan)"
	if note.Note != want {
		t.Fatalf("note %q, want %q", note.Note, want)
	}

	if !note.CreatedAt.Equal(accept.CreatedAt) {
		t.Fatalf("the note at %v and the accept at %v — one act, one moment", note.CreatedAt, accept.CreatedAt)
	}
}

// THE COUNT MUST FIT THE ORDER — every line once, never more broken and missing than the line holds, every sound unit
// on a rack, each rack once — each refused before the stock half is asked.
func TestOrderReturnAccept_RefusesACountThatDoesNotFit(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc, picker := returnAccept(t, db, rec, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")
	configureReturnWarehouse(t, db, mapTeam, testWarehouse)

	orderID, items := returnedOrder(t, svc, orderReq(shop))
	rec.events = nil
	item := items[0]

	short := counted(item, 0, 0, "")
	short.Placements[0].Quantity = 2

	twice := counted(item, 0, 0, "")
	twice.Placements = []*sellingv1.OrderReturnPlacement{{RackId: returnRack, Quantity: 1}, {RackId: returnRack, Quantity: 2}}

	cases := map[string][]*sellingv1.OrderReturnAcceptLine{
		"no line counted":           nil,
		"another order's line":      {counted(item, 0, 0, ""), {OrderItemId: item.GetId() + 1000}},
		"a line counted twice":      {counted(item, 0, 0, ""), counted(item, 0, 0, "")},
		"more than ordered":         {{OrderItemId: item.GetId(), Broken: 2, Missing: 2}},
		"sound units off a rack":    {short},
		"the same rack named twice": {twice},
	}

	for name, lines := range cases {
		_, err := acceptReturn(svc, context.Background(), testWarehouse, orderID, lines, nil)
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("%s: err %v, want InvalidArgument", name, err)
		}
	}

	stillReturn(t, svc, picker, rec, orderID, 0)
}

// A REFUSED PUT-AWAY REFUSES THE WHOLE ACCEPT (the order_return.md flow — stock first): inventory's refusal — here a count
// holding the rack — comes back as it was, and the order stays `return` with no accept row, no note and no event.
func TestOrderReturnAccept_AStockRefusalRefusesTheWholeAccept(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc, picker := returnAccept(t, db, rec, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")
	configureReturnWarehouse(t, db, mapTeam, testWarehouse)

	orderID, items := returnedOrder(t, svc, orderReq(shop))
	rec.events = nil
	before := len(timelineRows(t, db, orderID))

	picker.returnStockErr = connect.NewError(connect.CodeFailedPrecondition,
		errors.New("product 100 on rack 77 is being counted in count #5, started by Budi"))

	_, err := acceptReturn(svc, context.Background(), testWarehouse, orderID,
		[]*sellingv1.OrderReturnAcceptLine{counted(items[0], 1, 0, "pecah")}, nil)
	cerr := wantCode(t, err, connect.CodeFailedPrecondition)

	if !strings.Contains(cerr.Message(), "count #5") {
		t.Fatalf("message %q should be the count's, as inventory said it", cerr.Message())
	}

	stillReturn(t, svc, picker, rec, orderID, 1)

	if after := len(timelineRows(t, db, orderID)); after != before {
		t.Fatalf("%d timeline rows after the refusal, %d before", after, before)
	}
}

// AN ORDER WITH NO TAKE RECORDED (revamp-has-no-real-orders-yet) has no batches to mint its return from: refused plainly,
// before the stock half is asked.
func TestOrderReturnAccept_AnOrderWithNoTakeIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc, picker := returnAccept(t, db, rec, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")
	configureReturnWarehouse(t, db, mapTeam, testWarehouse)

	orderID, items := returnedOrder(t, svc, orderReq(shop))
	rec.events = nil

	err := db.Exec(`UPDATE orders SET transaction_id = NULL WHERE id = ?`, orderID).Error
	if err != nil {
		t.Fatalf("drop the take: %v", err)
	}

	_, err = acceptReturn(svc, context.Background(), testWarehouse, orderID, whole(items), nil)
	cerr := wantCode(t, err, connect.CodeFailedPrecondition)

	if !strings.Contains(cerr.Message(), "no stock take recorded") {
		t.Fatalf("message %q should say the order has no take recorded", cerr.Message())
	}

	stillReturn(t, svc, picker, rec, orderID, 0)
}

// THE COURIER'S ASK (a-return-may-carry-the-couriers-ask) rides the event, and is written on the accept's row with what
// it was for. A charge with no note is refused (an-incidental-line-must-say-what-it-was-for).
func TestOrderReturnAccept_TheCourierChargeRidesTheEvent(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc, _ := returnAccept(t, db, rec, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")
	configureReturnWarehouse(t, db, mapTeam, testWarehouse)

	orderID, items := returnedOrder(t, svc, orderReq(shop))
	rec.events = nil

	_, err := acceptReturn(svc, context.Background(), testWarehouse, orderID, whole(items), func(r *sellingv1.OrderReturnAcceptRequest) {
		r.CourierCharge = 15_000
		r.CourierChargeNote = "   "
	})
	wantCode(t, err, connect.CodeInvalidArgument)

	_, err = acceptReturn(svc, asUser(31), testWarehouse, orderID, whole(items), func(r *sellingv1.OrderReturnAcceptRequest) {
		r.CourierCharge = 15_000
		r.CourierChargeNote = " ongkir retur J&T "
	})
	if err != nil {
		t.Fatalf("OrderReturnAccept: %v", err)
	}

	rows := timelineRows(t, db, orderID)
	accept := rows[len(rows)-1]

	if accept.Note != "Courier charge Rp 15.000: ongkir retur J&T" {
		t.Fatalf("accept row note %q, want the charge and what it was for", accept.Note)
	}

	accepted := rec.events[0].GetOrderReturnAccepted()
	if accepted.GetCourierCharge() != 15_000 || accepted.GetCourierChargeNote() != "ongkir retur J&T" {
		t.Fatalf("event charge %v %q, want 15.000 and its trimmed note", accepted.GetCourierCharge(), accepted.GetCourierChargeNote())
	}
}

// A BORROWED LINE (a-returned-borrowed-unit-is-relabelled-at-the-accept, a-return-mints-one-batch-per-batch-the-order-took):
// its units go back as team 2's mapped own product at the markup the team paid on them (20 %), and the line answers the
// own product's code to print — one per SOUND unit. Before the accept, OrderDetail already names it, at the whole line.
// An own line comes back as itself, at no markup, and keeps its label.
func TestOrderReturnAccept_ABorrowedLineComesBackAsTheMappedProduct(t *testing.T) {
	db := san_testdb.DB(t)
	svc, picker := returnAccept(t, db, &recorder{}, returnMapCatalog())
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")
	configureReturnWarehouse(t, db, mapTeam, testWarehouse)

	mapForReturns(t, svc, mapTeam, borrowedA, ourOtherProduct)

	// 3 borrowed units drawn at Rp 10.000, Rp 36.000 with the owner's 20 % (inventory-computes-the-markup).
	picker.draw = selling_v1.PickDraw{borrowedA: {Cost: 30000, UnitCost: 10000, Total: 36000, UnitCostWithMarkup: 12000,
		MarkupTotal: 6000}}

	req := borrowedOrderReq(shop, borrowedA)
	req.Items[1].Quantity = 3

	orderID, items := returnedOrder(t, svc, req)

	detail, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: testWarehouse, OrderId: orderID,
	}))
	if err != nil {
		t.Fatalf("OrderDetail: %v", err)
	}

	if before := detail.Msg.GetReturnLabels(); len(before) != 1 || before[0].GetOwnProductCode() != "SKU602" ||
		before[0].GetQuantity() != 3 || detail.Msg.GetOrder().GetReturnWarehouseId() != testWarehouse {
		t.Fatalf("detail labels %v, return warehouse %d — want SKU602 × 3 before the accept, and %d",
			before, detail.Msg.GetOrder().GetReturnWarehouseId(), testWarehouse)
	}

	got, err := acceptReturn(svc, context.Background(), testWarehouse, orderID,
		[]*sellingv1.OrderReturnAcceptLine{counted(items[0], 0, 0, ""), counted(items[1], 1, 0, "")}, nil)
	if err != nil {
		t.Fatalf("OrderReturnAccept: %v", err)
	}

	lines := picker.stockReturns[0].Lines
	if lines[0].ProductID != ourProduct || lines[0].ReturnProductID != ourProduct || lines[0].MarkupRate != 0 {
		t.Fatalf("own line %+v, want 601 back as itself at no markup", lines[0])
	}

	if lines[1].ProductID != borrowedA || lines[1].ReturnProductID != ourOtherProduct || !san_money.Equal(lines[1].MarkupRate, 0.2) ||
		lines[1].Sound != 2 || lines[1].Broken != 1 {
		t.Fatalf("borrowed line %+v, want 501 back as 602 at 20 %%, 2 sound and 1 broken", lines[1])
	}

	labels := got.GetLabels()
	if len(labels) != 1 {
		t.Fatalf("%d labels, want one — for the borrowed line only: %v", len(labels), labels)
	}

	label := labels[0]
	if label.GetOrderItemId() != items[1].GetId() || label.GetBorrowedProductId() != borrowedA ||
		label.GetBorrowedProductCode() != "TYPED" || label.GetOwnProductId() != ourOtherProduct ||
		label.GetOwnProductCode() != "SKU602" || label.GetOwnProductName() != "Catalogue SKU602" || label.GetQuantity() != 2 {
		t.Fatalf("label = %+v, want TYPED covered by SKU602, 2 — three ordered, one broken", label)
	}
}

// AN UNMAPPED BORROWED LINE REFUSES THE WHOLE ACCEPT (a-return-never-clones-a-product) — the backstop for an order
// created before create checked the map. The order stays `return`, the refusal names the product, nothing is stocked.
func TestOrderReturnAccept_AnUnmappedBorrowedLineRefuses(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc, picker := returnAccept(t, db, rec, returnMapCatalog())
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")
	configureReturnWarehouse(t, db, mapTeam, testWarehouse)

	mapForReturns(t, svc, mapTeam, borrowedA, ourOtherProduct)
	orderID, items := returnedOrder(t, svc, borrowedOrderReq(shop, borrowedA))

	// As an order placed before the create check: its borrowed product has no map.
	err := db.Exec(`DELETE FROM product_return_maps WHERE team_id = ?`, mapTeam).Error
	if err != nil {
		t.Fatalf("drop the map: %v", err)
	}

	rec.events = nil

	_, err = acceptReturn(svc, context.Background(), testWarehouse, orderID, whole(items), nil)
	cerr := wantCode(t, err, connect.CodeFailedPrecondition)

	if !strings.Contains(cerr.Message(), "SKU501") || !strings.Contains(cerr.Message(), "mapped") {
		t.Fatalf("message %q should name SKU501 as unmapped", cerr.Message())
	}

	if strings.Contains(cerr.Message(), "SKU601") {
		t.Fatalf("message %q names the team's own product, which needs no map", cerr.Message())
	}

	stillReturn(t, svc, picker, rec, orderID, 0)
}

// THE CATALOGUE DOWN REFUSES THE ACCEPT — whose goods each line is decides what the units come back as, and an accept
// that cannot say is not one the crew can finish.
func TestOrderReturnAccept_ACatalogueFailureAcceptsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	catalog := &fakeCatalog{}
	rec := &recorder{}
	svc, picker := returnAccept(t, db, rec, catalog)
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")
	configureReturnWarehouse(t, db, mapTeam, testWarehouse)

	orderID, items := returnedOrder(t, svc, orderReq(shop))
	rec.events = nil
	catalog.err = errors.New("product_service is down")

	_, err := acceptReturn(svc, context.Background(), testWarehouse, orderID, whole(items), nil)
	wantCode(t, err, connect.CodeUnavailable)

	stillReturn(t, svc, picker, rec, orderID, 0)
}

// AN OVERRIDE IS STAMPED (an-override-is-stamped-in-every-service): Root accepting inside a warehouse it holds no role
// in stamps both rows the accept writes, and the event says so — what the courier charge's legs are stamped from.
func TestOrderReturnAccept_StampsTheOverride(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc, _ := returnAccept(t, db, rec, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")
	configureReturnWarehouse(t, db, mapTeam, testWarehouse)

	orderID, items := returnedOrder(t, svc, orderReq(shop))
	rec.events = nil

	_, err := acceptReturn(svc, asScoped(1, testWarehouse, rootOutside), testWarehouse, orderID,
		[]*sellingv1.OrderReturnAcceptLine{counted(items[0], 0, 1, "")}, nil)
	if err != nil {
		t.Fatalf("OrderReturnAccept: %v", err)
	}

	flags := timelineOverrides(t, db, orderID)
	if !flags[len(flags)-1] || !flags[len(flags)-2] {
		t.Fatalf("timeline stamps %v, want the accept and its note stamped", flags)
	}

	if !rec.events[0].GetOrderReturnAccepted().GetActorIsOverride() {
		t.Fatalf("event actor_is_override false, want true")
	}
}
