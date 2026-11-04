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
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// THE RETURN ACCEPT (the-accept-is-the-status-return-completed) — the warehouse has the returned parcel in its hands.
// The cast is the return map's (product_return_map_create_test.go): team 2 sells team 9's 501 and owns 601.

// returnAcceptService is a selling service that records its events and knows the return map's catalogue.
func returnAcceptService(t *testing.T, db *gorm.DB, rec *recorder, catalog selling_v1.ProductCatalog) *selling_v1.Service {
	t.Helper()

	return selling_v1.NewService(db, &fakePicker{}, rec.send, catalog, &fakeCredit{}, nil, nil, nil, nil)
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

func acceptReturn(
	svc *selling_v1.Service,
	ctx context.Context,
	teamID, orderID uint64,
	change func(*sellingv1.OrderReturnAcceptRequest),
) (*sellingv1.OrderReturnAcceptResponse, error) {
	req := &sellingv1.OrderReturnAcceptRequest{TeamId: teamID, OrderId: orderID}
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

// A WHOLE PARCEL: the order moves to return_completed on one warehouse row, and OrderReturnAccepted names the order, its
// selling team, its warehouse and the row — with no charge and no labels, the common case.
func TestOrderReturnAccept_MovesTheReturnToCompleted(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc := returnAcceptService(t, db, rec, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	orderID, _ := returnedOrder(t, svc, orderReq(shop))
	rec.events = nil

	got, err := acceptReturn(svc, asUser(31), testWarehouse, orderID, nil)
	if err != nil {
		t.Fatalf("OrderReturnAccept: %v", err)
	}

	if got.GetOrder().GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_RETURN_COMPLETED {
		t.Fatalf("answered status %v, want RETURN_COMPLETED", got.GetOrder().GetStatus())
	}

	if len(got.GetLabels()) != 0 {
		t.Fatalf("labels %v for an order of nobody's borrowed goods, want none", got.GetLabels())
	}

	if status := orderStatus(t, svc, orderID); status != sellingv1.OrderStatus_ORDER_STATUS_RETURN_COMPLETED {
		t.Fatalf("stored status %v, want RETURN_COMPLETED", status)
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

	if accepted == nil {
		t.Fatalf("published %v, want OrderReturnAccepted", event.GetMessage())
	}

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

// The return cast beyond the order's own warehouse (testWarehouse, 900): team 2's CONFIGURED return warehouse, and a third
// building an old label still names. Neither shipped the order.
const (
	configuredReturnWarehouse uint64 = 950
	staleLabelWarehouse       uint64 = 960
)

// configureReturnWarehouse gives a team its return warehouse (team_return_configurations).
func configureReturnWarehouse(t *testing.T, db *gorm.DB, teamID, warehouseID uint64) {
	t.Helper()

	err := db.Create(&selling_service_models.TeamReturnConfiguration{TeamID: teamID, WarehouseID: warehouseID}).Error
	if err != nil {
		t.Fatalf("configure the return warehouse of %d: %v", teamID, err)
	}
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

// THE SELLING TEAM CLAIMS A RETURN, IT DOES NOT ACCEPT ONE (both-cs-and-the-warehouse-can-return-an-order) — refused, and
// nothing moves.
func TestOrderReturnAccept_TheSellingTeamDoesNotAccept(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc := returnAcceptService(t, db, rec, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	orderID, _ := returnedOrder(t, svc, orderReq(shop))
	rec.events = nil

	_, err := acceptReturn(svc, context.Background(), mapTeam, orderID, nil)
	wantCode(t, err, connect.CodePermissionDenied)

	if status := orderStatus(t, svc, orderID); status != sellingv1.OrderStatus_ORDER_STATUS_RETURN {
		t.Fatalf("status %v after a refused accept, want RETURN", status)
	}

	if len(rec.events) != 0 {
		t.Fatalf("a refused accept published %d events", len(rec.events))
	}
}

// AN OUTSIDER CANNOT PROBE an order that is not a return: a warehouse that is neither end reads NotFound, as a read would.
// The order's own warehouse is told why.
func TestOrderReturnAccept_AnOrderNotInReturnIsNotFoundToAnOutsider(t *testing.T) {
	db := san_testdb.DB(t)
	svc := returnAcceptService(t, db, &recorder{}, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	pending := placeOrder(t, svc, mapTeam, shop)

	_, err := acceptReturn(svc, context.Background(), staleLabelWarehouse, pending, nil)
	wantCode(t, err, connect.CodeNotFound)

	_, err = acceptReturn(svc, context.Background(), testWarehouse, pending, nil)
	wantCode(t, err, connect.CodeFailedPrecondition)
}

// THE CONFIGURED RETURN WAREHOUSE ACCEPTS (a-return-may-land-in-another-warehouse): the parcel comes back to team 2's
// configured warehouse, which never shipped the order. Its crew finds it — the return reads to it, in the list and the
// detail — accepts it, is recorded as where it was accepted, and is the warehouse the courier's charge is owed to.
// Before the claim, the same team's live order is not its to read.
func TestOrderReturnAccept_TheConfiguredReturnWarehouseAccepts(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc := returnAcceptService(t, db, rec, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")
	configureReturnWarehouse(t, db, mapTeam, configuredReturnWarehouse)

	// A live order of team 2 — not a return — is none of the return warehouse's business.
	live := placeOrder(t, svc, mapTeam, shop)

	_, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: configuredReturnWarehouse, OrderId: live,
	}))
	wantCode(t, err, connect.CodeNotFound)

	orderID, _ := returnedOrder(t, svc, orderReq(shop))
	rec.events = nil

	// The Returns tab: the claimed return is listed to the configured warehouse — and the live order is not, on any tab.
	for _, status := range []sellingv1.OrderStatus{sellingv1.OrderStatus_ORDER_STATUS_RETURN, sellingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED} {
		listed, listErr := svc.OrderList(context.Background(), connect.NewRequest(&sellingv1.OrderListRequest{
			TeamId: configuredReturnWarehouse,
			Filter: &sellingv1.OrderListFilter{Status: status},
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
		}))
		if listErr != nil {
			t.Fatalf("OrderList as the return warehouse: %v", listErr)
		}

		if ids := listed.Msg.GetIds(); len(ids) != 1 || ids[0] != orderID {
			t.Fatalf("the return warehouse lists %v under %v, want only the return %d", ids, status, orderID)
		}
	}

	_, err = acceptReturn(svc, asUser(41), configuredReturnWarehouse, orderID, func(r *sellingv1.OrderReturnAcceptRequest) {
		r.CourierCharge = 12_000
		r.CourierChargeNote = "ongkir retur"
	})
	if err != nil {
		t.Fatalf("OrderReturnAccept as the configured return warehouse: %v", err)
	}

	if row := acceptRow(t, db, orderID); row.AcceptingWarehouseID != configuredReturnWarehouse || row.From != "warehouse" {
		t.Fatalf("accept row = %+v, want it accepted at %d, from the warehouse", row, configuredReturnWarehouse)
	}

	accepted := rec.events[0].GetOrderReturnAccepted()
	if accepted.GetWarehouseId() != configuredReturnWarehouse || accepted.GetTeamId() != mapTeam {
		t.Fatalf("event warehouse %d team %d, want the charge owed by %d to %d — the door it was paid at",
			accepted.GetWarehouseId(), accepted.GetTeamId(), mapTeam, configuredReturnWarehouse)
	}

	// After the accept the return warehouse still reads it — return_completed is a return too.
	got, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: configuredReturnWarehouse, OrderId: orderID,
	}))
	if err != nil {
		t.Fatalf("OrderDetail as the return warehouse after the accept: %v", err)
	}

	logs := got.Msg.GetOrder().GetTimelineLogs()
	if last := logs[len(logs)-1]; last.GetAcceptingWarehouseId() != configuredReturnWarehouse {
		t.Fatalf("the timeline's accept row names warehouse %d, want %d", last.GetAcceptingWarehouseId(),
			configuredReturnWarehouse)
	}
}

// AN OLD LABEL (a-stale-return-location-is-accepted, the-accept-records-where-it-was-accepted): the parcel reaches a third
// warehouse — neither the one it shipped from nor the configured one. Its staff accept it, and it is recorded where it
// happened, so the mismatch is visible; the courier's charge is owed to that door.
func TestOrderReturnAccept_AThirdWarehouseAcceptsAStaleLabelAndIsRecorded(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc := returnAcceptService(t, db, rec, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")
	configureReturnWarehouse(t, db, mapTeam, configuredReturnWarehouse)

	orderID, _ := returnedOrder(t, svc, orderReq(shop))
	rec.events = nil

	_, err := acceptReturn(svc, asUser(51), staleLabelWarehouse, orderID, nil)
	if err != nil {
		t.Fatalf("OrderReturnAccept at a stale label's warehouse: %v", err)
	}

	row := acceptRow(t, db, orderID)
	if row.AcceptingWarehouseID != staleLabelWarehouse || row.ActorID != 51 {
		t.Fatalf("accept row = %+v, want it accepted at %d by 51", row, staleLabelWarehouse)
	}

	if got := rec.events[0].GetOrderReturnAccepted().GetWarehouseId(); got != staleLabelWarehouse {
		t.Fatalf("event warehouse %d, want %d — the building that accepted it", got, staleLabelWarehouse)
	}

	// The configured warehouse is now too late: the return is accepted, once.
	_, err = acceptReturn(svc, context.Background(), configuredReturnWarehouse, orderID, nil)
	cerr := wantCode(t, err, connect.CodeFailedPrecondition)

	if !strings.Contains(cerr.Message(), "already accepted") {
		t.Fatalf("message %q should say the return is already accepted", cerr.Message())
	}
}

// ONLY A CLAIMED RETURN: an order still with the courier is forced to return first (a-forced-return-follows-the-status-
// move), and an accepted one is not accepted twice.
func TestOrderReturnAccept_OnlyFromReturn(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc := returnAcceptService(t, db, rec, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	shipping := processedOrder(t, svc, shop)
	moveOrder(t, svc, testWarehouse, shipping, sellingv1.OrderStatus_ORDER_STATUS_PICKED, "")
	moveOrder(t, svc, testWarehouse, shipping, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING, "")

	_, err := acceptReturn(svc, context.Background(), testWarehouse, shipping, nil)
	cerr := wantCode(t, err, connect.CodeFailedPrecondition)

	if !strings.Contains(cerr.Message(), "only an order in return") || !strings.Contains(cerr.Message(), "shipping") {
		t.Fatalf("message %q should say only a return is accepted, and that this one is shipping", cerr.Message())
	}

	returned, _ := returnedOrder(t, svc, orderReq(shop))

	_, err = acceptReturn(svc, context.Background(), testWarehouse, returned, nil)
	if err != nil {
		t.Fatalf("first accept: %v", err)
	}

	rec.events = nil

	_, err = acceptReturn(svc, context.Background(), testWarehouse, returned, nil)
	cerr = wantCode(t, err, connect.CodeFailedPrecondition)

	if !strings.Contains(cerr.Message(), "already accepted") {
		t.Fatalf("message %q should say the return is already accepted", cerr.Message())
	}

	if n := timelineStatusCount(t, db, returned, "return_completed"); n != 1 {
		t.Fatalf("%d return_completed rows, want one", n)
	}

	if len(rec.events) != 0 {
		t.Fatalf("the refused second accept published %d events", len(rec.events))
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

// A SHORT PARCEL IS ACCEPTED (a-short-return-is-accepted-and-the-gap-written-off): the return stays whole, and the
// missing units are named on ONE note row from the warehouse — what customer service claims from the platform.
func TestOrderReturnAccept_AShortParcelNamesWhatIsMissing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := returnAcceptService(t, db, &recorder{}, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	// orderReq is 3 × SKU1 Widget.
	orderID, items := returnedOrder(t, svc, orderReq(shop))

	_, err := acceptReturn(svc, asUser(31), testWarehouse, orderID, func(r *sellingv1.OrderReturnAcceptRequest) {
		r.MissingLines = []*sellingv1.OrderReturnMissingLine{{OrderItemId: items[0].GetId(), Quantity: 1}}
	})
	if err != nil {
		t.Fatalf("OrderReturnAccept: %v", err)
	}

	rows := timelineRows(t, db, orderID)
	accept, note := rows[len(rows)-2], rows[len(rows)-1]

	if accept.Status != "return_completed" {
		t.Fatalf("second-to-last row = %+v, want the accept", accept)
	}

	if note.Status != "" || note.From != "warehouse" || note.ActorID != 31 {
		t.Fatalf("last row = %+v, want a warehouse NOTE by 31", note)
	}

	if note.Note != "Missing from the returned parcel: 1 × SKU1 Widget" {
		t.Fatalf("note %q, want it to name the one missing Widget", note.Note)
	}

	if !note.CreatedAt.Equal(accept.CreatedAt) {
		t.Fatalf("the note at %v and the accept at %v — one act, one moment", note.CreatedAt, accept.CreatedAt)
	}
}

// A MISSING LINE MUST BE THIS ORDER'S, named once, and never more than the line holds — each refused before anything is
// written.
func TestOrderReturnAccept_RefusesMissingUnitsTheOrderDoesNotHave(t *testing.T) {
	db := san_testdb.DB(t)
	svc := returnAcceptService(t, db, &recorder{}, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	orderID, items := returnedOrder(t, svc, orderReq(shop))
	line := items[0].GetId()

	cases := map[string][]*sellingv1.OrderReturnMissingLine{
		"another order's line": {{OrderItemId: line + 1000, Quantity: 1}},
		"more than ordered":    {{OrderItemId: line, Quantity: 4}},
		"named twice":          {{OrderItemId: line, Quantity: 1}, {OrderItemId: line, Quantity: 1}},
	}

	for name, missing := range cases {
		_, err := acceptReturn(svc, context.Background(), testWarehouse, orderID, func(r *sellingv1.OrderReturnAcceptRequest) {
			r.MissingLines = missing
		})
		if connect.CodeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("%s: err %v, want InvalidArgument", name, err)
		}
	}

	if status := orderStatus(t, svc, orderID); status != sellingv1.OrderStatus_ORDER_STATUS_RETURN {
		t.Fatalf("status %v after refused accepts, want RETURN", status)
	}
}

// THE COURIER'S ASK (a-return-may-carry-the-couriers-ask) rides the event, and is written on the accept's row with what
// it was for. A charge with no note is refused (an-incidental-line-must-say-what-it-was-for).
func TestOrderReturnAccept_TheCourierChargeRidesTheEvent(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc := returnAcceptService(t, db, rec, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	orderID, _ := returnedOrder(t, svc, orderReq(shop))
	rec.events = nil

	_, err := acceptReturn(svc, context.Background(), testWarehouse, orderID, func(r *sellingv1.OrderReturnAcceptRequest) {
		r.CourierCharge = 15_000
		r.CourierChargeNote = "   "
	})
	wantCode(t, err, connect.CodeInvalidArgument)

	_, err = acceptReturn(svc, asUser(31), testWarehouse, orderID, func(r *sellingv1.OrderReturnAcceptRequest) {
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
		t.Fatalf("event charge %d %q, want 15.000 and its trimmed note", accepted.GetCourierCharge(), accepted.GetCourierChargeNote())
	}
}

// A BORROWED LINE ANSWERS ITS LABEL (a-returned-borrowed-unit-is-relabelled-at-the-accept): the mapped own product's
// code, one per unit in hand. An own line keeps its label and answers none.
func TestOrderReturnAccept_ABorrowedLineAnswersTheLabelToPrint(t *testing.T) {
	db := san_testdb.DB(t)
	svc := returnAcceptService(t, db, &recorder{}, returnMapCatalog())
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	mapForReturns(t, svc, mapTeam, borrowedA, ourOtherProduct)

	req := borrowedOrderReq(shop, borrowedA)
	req.Items[1].Quantity = 3

	orderID, items := returnedOrder(t, svc, req)

	got, err := acceptReturn(svc, context.Background(), testWarehouse, orderID, func(r *sellingv1.OrderReturnAcceptRequest) {
		r.MissingLines = []*sellingv1.OrderReturnMissingLine{{OrderItemId: items[1].GetId(), Quantity: 1}}
	})
	if err != nil {
		t.Fatalf("OrderReturnAccept: %v", err)
	}

	labels := got.GetLabels()
	if len(labels) != 1 {
		t.Fatalf("%d labels, want one — for the borrowed line only: %v", len(labels), labels)
	}

	label := labels[0]
	if label.GetOrderItemId() != items[1].GetId() || label.GetBorrowedProductId() != borrowedA ||
		label.GetBorrowedProductCode() != "TYPED" || label.GetOwnProductId() != ourOtherProduct ||
		label.GetOwnProductCode() != "SKU602" || label.GetOwnProductName() != "Catalogue SKU602" {
		t.Fatalf("label = %+v, want TYPED covered by SKU602", label)
	}

	if label.GetQuantity() != 2 {
		t.Fatalf("label quantity %d, want 2 — three ordered, one missing", label.GetQuantity())
	}
}

// AN UNMAPPED BORROWED LINE REFUSES THE WHOLE ACCEPT (a-return-never-clones-a-product) — the backstop for an order
// created before create checked the map. The order stays `return`, and the refusal names the product.
func TestOrderReturnAccept_AnUnmappedBorrowedLineRefuses(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc := returnAcceptService(t, db, rec, returnMapCatalog())
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	mapForReturns(t, svc, mapTeam, borrowedA, ourOtherProduct)
	orderID, _ := returnedOrder(t, svc, borrowedOrderReq(shop, borrowedA))

	// As an order placed before the create check: its borrowed product has no map.
	err := db.Exec(`DELETE FROM product_return_maps WHERE team_id = ?`, mapTeam).Error
	if err != nil {
		t.Fatalf("drop the map: %v", err)
	}

	rec.events = nil

	_, err = acceptReturn(svc, context.Background(), testWarehouse, orderID, nil)
	cerr := wantCode(t, err, connect.CodeFailedPrecondition)

	if !strings.Contains(cerr.Message(), "SKU501") || !strings.Contains(cerr.Message(), "mapped") {
		t.Fatalf("message %q should name SKU501 as unmapped", cerr.Message())
	}

	if strings.Contains(cerr.Message(), "SKU601") {
		t.Fatalf("message %q names the team's own product, which needs no map", cerr.Message())
	}

	if status := orderStatus(t, svc, orderID); status != sellingv1.OrderStatus_ORDER_STATUS_RETURN {
		t.Fatalf("status %v after the refusal, want RETURN", status)
	}

	if len(rec.events) != 0 {
		t.Fatalf("a refused accept published %d events", len(rec.events))
	}
}

// THE CATALOGUE DOWN REFUSES THE ACCEPT — whose goods each line is decides the labels, and an accept that cannot say
// what to print is not one the crew can finish.
func TestOrderReturnAccept_ACatalogueFailureAcceptsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	catalog := &fakeCatalog{}
	svc := returnAcceptService(t, db, &recorder{}, catalog)
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	orderID, _ := returnedOrder(t, svc, orderReq(shop))
	catalog.err = errors.New("product_service is down")

	_, err := acceptReturn(svc, context.Background(), testWarehouse, orderID, nil)
	wantCode(t, err, connect.CodeUnavailable)

	if status := orderStatus(t, svc, orderID); status != sellingv1.OrderStatus_ORDER_STATUS_RETURN {
		t.Fatalf("status %v, want RETURN — nothing is accepted", status)
	}
}

// AN OVERRIDE IS STAMPED (an-override-is-stamped-in-every-service): Root accepting inside a warehouse it holds no role
// in stamps both rows the accept writes, and the event says so — what the courier charge's legs are stamped from.
func TestOrderReturnAccept_StampsTheOverride(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc := returnAcceptService(t, db, rec, &fakeCatalog{})
	shop := insertShop(t, db, mapTeam, "Toko A", "TOKO-A", "shopee")

	orderID, items := returnedOrder(t, svc, orderReq(shop))
	rec.events = nil

	_, err := acceptReturn(svc, asScoped(1, testWarehouse, rootOutside), testWarehouse, orderID,
		func(r *sellingv1.OrderReturnAcceptRequest) {
			r.MissingLines = []*sellingv1.OrderReturnMissingLine{{OrderItemId: items[0].GetId(), Quantity: 1}}
		})
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
