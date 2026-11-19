package settlement_v1_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// AN ORDER'S ACCOUNT MOVES WITH ITS SHOP (an-orders-shop-is-fixed-and-counted-on-the-day): the ledger is not edited —
// the order's figure of each type goes out of the old shop and into the new as a pair of rows — so the new shop's
// statement posts onto the account, the shop reports move on the day it is written, and no past day changes.

const newShop uint64 = 31

// postedRecorder keeps every event the ledger published.
type postedRecorder struct {
	mu     sync.Mutex
	events []*eventsv1.Event
}

func (r *postedRecorder) send(_ context.Context, _ *role_basev1.Identity, event *eventsv1.Event) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.events = append(r.events, event)

	return nil
}

func (r *postedRecorder) all() []*eventsv1.Event {
	r.mu.Lock()
	defer r.mu.Unlock()

	return append([]*eventsv1.Event{}, r.events...)
}

// worked posts the design's worked example on order 5001 under `shop`: the 120.000 sale, 110.000 arrived, a 20.000 ads fee.
func worked(t *testing.T, svc *settlement_v1.Service) {
	t.Helper()

	for _, in := range []settlement_v1.PostInput{
		initialTotal("order-placed:5001"),
		{UniqueID: "imp-fund", SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
			SourceType: settlementv1.SourceType_SOURCE_TYPE_IMPORTER, Change: arrived},
		{UniqueID: "imp-ads", SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_EXTERNAL_ADS_FEE,
			SourceType: settlementv1.SourceType_SOURCE_TYPE_IMPORTER, Change: adsFee},
	} {
		in.CreatedByUserID = creator

		_, err := post(t, svc, in)
		if err != nil {
			t.Fatalf("post %s: %v", in.UniqueID, err)
		}
	}
}

func move(svc *settlement_v1.Service, changeID, to uint64) (settlement_v1.ShopMoveResult, error) {
	return svc.MoveOrderShop(context.Background(), settlement_v1.ShopMoveInput{
		TeamID: team, OrderID: order, ToShopID: to, ChangeID: changeID, OccurredOn: "2026-11-18", ActorID: 9,
	})
}

func account(t *testing.T, db *gorm.DB) settlement_service_models.OrderSettlement {
	t.Helper()

	var state settlement_service_models.OrderSettlement

	err := db.Where("order_id = ?", order).Take(&state).Error
	if err != nil {
		t.Fatalf("read the account: %v", err)
	}

	return state
}

// sumsByShop is the order's rows summed per shop and type.
func sumsByShop(t *testing.T, db *gorm.DB) map[uint64]map[string]float64 {
	t.Helper()

	var rows []struct {
		ShopID         uint64
		SettlementType string
		Total          float64
	}

	err := db.Raw(`SELECT shop_id, settlement_type, SUM(change) AS total FROM settlement_logs WHERE order_id = ?
GROUP BY shop_id, settlement_type`, order).Scan(&rows).Error
	if err != nil {
		t.Fatalf("sums: %v", err)
	}

	out := map[uint64]map[string]float64{}
	for _, row := range rows {
		if out[row.ShopID] == nil {
			out[row.ShopID] = map[string]float64{}
		}

		out[row.ShopID][row.SettlementType] = row.Total
	}

	return out
}

func logCount(t *testing.T, db *gorm.DB) int64 {
	t.Helper()

	var n int64

	err := db.Model(&settlement_service_models.SettlementLog{}).Where("order_id = ?", order).Count(&n).Error
	if err != nil {
		t.Fatalf("count rows: %v", err)
	}

	return n
}

// THE MOVE: one pair per type — out of the old shop, into the new, by the person who fixed it, source `order`, on the
// fix's day — the account on the new shop with its balance and live sale where they were. The old shop nets to 0 per
// type, the new one holds the order's figures; a post naming the new shop lands, one naming the old is refused.
func TestMoveOrderShop_MovesTheAccountAndItsFigures(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &postedRecorder{}
	svc := settlement_v1.NewService(db, rec.send, nil, nil, nil, nil, nil)

	worked(t, svc)
	before := account(t, db)

	got, err := move(svc, 77, newShop)
	if err != nil {
		t.Fatalf("MoveOrderShop: %v", err)
	}

	if !got.Moved || len(got.Entries) != 6 {
		t.Fatalf("moved %v with %d rows, want a pair for each of the 3 types", got.Moved, len(got.Entries))
	}

	for _, entry := range got.Entries {
		if entry.SourceType != "order" || entry.ActorID != 9 || entry.OccurredOn.Format(time.DateOnly) != "2026-11-18" ||
			entry.OrderID == nil || *entry.OrderID != order || entry.TeamID != team {
			t.Fatalf("a moving row = %+v, want the order's, from source order, by 9, on the fix's day", entry)
		}
	}

	state := account(t, db)
	if state.ShopID != newShop || !san_money.Equal(state.LastBalance, before.LastBalance) ||
		!san_money.Equal(state.InitialTotal, before.InitialTotal) || state.CreatedByUserID != creator {
		t.Fatalf("account = %+v, want it on shop %d with the balance and the sale of %+v", state, newShop, before)
	}

	sums := sumsByShop(t, db)
	for settlementType, total := range sums[shop] {
		if !san_money.IsZero(total) {
			t.Fatalf("the old shop still holds %v of %s", total, settlementType)
		}
	}

	if !san_money.Equal(sums[newShop]["initial_total"], -sale) || !san_money.Equal(sums[newShop]["fund"], arrived) ||
		!san_money.Equal(sums[newShop]["external_ads_fee"], adsFee) {
		t.Fatalf("the new shop holds %v, want the order's three figures", sums[newShop])
	}

	// The last row's running balance is the account's — the log and the projection agree.
	if last := got.Entries[len(got.Entries)-1]; !san_money.Equal(last.Balance, state.LastBalance) {
		t.Fatalf("the last moving row's balance %v, the account's %v", last.Balance, state.LastBalance)
	}

	_, err = post(t, svc, settlement_v1.PostInput{
		ShopID: newShop, UniqueID: "new-shop-line", SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
		SourceType: settlementv1.SourceType_SOURCE_TYPE_IMPORTER, Change: 1_000,
	})
	if err != nil {
		t.Fatalf("the new shop's line after the move: %v", err)
	}

	_, err = post(t, svc, settlement_v1.PostInput{
		UniqueID: "old-shop-line", SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
		SourceType: settlementv1.SourceType_SOURCE_TYPE_IMPORTER, Change: 1_000,
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("the old shop's NEW line after the move: err %v, want InvalidArgument", err)
	}

	// Every moving row was announced, for the reports.
	announced := 0

	for _, event := range rec.all() {
		posted := event.GetSettlementLogPosted()
		if posted != nil && posted.GetSourceType() == settlementv1.SourceType_SOURCE_TYPE_ORDER &&
			posted.GetOrderCreatedByUserId() == creator && posted.GetActorId() == 9 {
			announced++
		}
	}

	if announced != 6 {
		t.Fatalf("%d moving rows announced, want 6", announced)
	}
}

// ONCE AND IN ORDER: a redelivery moves nothing; a fix OLDER than one applied moves nothing (the later fix already
// took the account further); a newer one moves it on from wherever it is.
func TestMoveOrderShop_OnceAndInOrder(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	worked(t, svc)

	_, err := move(svc, 77, newShop)
	if err != nil {
		t.Fatalf("move: %v", err)
	}

	rows := logCount(t, db)

	again, err := move(svc, 77, newShop)
	if err != nil || again.Moved || logCount(t, db) != rows {
		t.Fatalf("the redelivery moved %v (err %v, %d new rows)", again.Moved, err, logCount(t, db)-rows)
	}

	stale, err := move(svc, 76, 32)
	if err != nil || stale.Moved || account(t, db).ShopID != newShop || logCount(t, db) != rows {
		t.Fatalf("an older fix moved %v to %d (err %v)", stale.Moved, account(t, db).ShopID, err)
	}

	later, err := move(svc, 78, 32)
	if err != nil || !later.Moved || account(t, db).ShopID != 32 {
		t.Fatalf("a later fix moved %v to %d (err %v)", later.Moved, account(t, db).ShopID, err)
	}

	sums := sumsByShop(t, db)
	if !san_money.Equal(sums[32]["fund"], arrived) || !san_money.IsZero(sums[newShop]["fund"]) || !san_money.IsZero(sums[shop]["fund"]) {
		t.Fatalf("after two moves the fund sits %v, want all of it under 32", sums)
	}

	var claims int64

	err = db.Model(&settlement_service_models.OrderSettlementShopMove{}).Where("order_id = ?", order).Count(&claims).Error
	if err != nil || claims != 3 {
		t.Fatalf("%d claims (err %v), want 3 — every fix seen once", claims, err)
	}
}

// NO ACCOUNT YET (the sale never opened): nothing moves, and the new shop's first line opens it under that shop.
func TestMoveOrderShop_NoAccountMovesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	got, err := move(svc, 77, newShop)
	if err != nil || got.Moved || logCount(t, db) != 0 {
		t.Fatalf("a move with no account: moved %v, err %v, %d rows", got.Moved, err, logCount(t, db))
	}

	_, err = post(t, svc, settlement_v1.PostInput{
		ShopID: newShop, UniqueID: "first-line", SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
		SourceType: settlementv1.SourceType_SOURCE_TYPE_IMPORTER, Change: arrived,
	})
	if err != nil || account(t, db).ShopID != newShop {
		t.Fatalf("the new shop's first line: err %v", err)
	}
}

// A RETRY OF A ROW THE LEDGER HOLDS under the old shop — an order event redelivered after the move — is answered with
// its own row and writes nothing; a NEW row under the old shop is refused.
func TestMoveOrderShop_ARetryUnderTheOldShopIsAnswered(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	worked(t, svc)

	_, err := move(svc, 77, newShop)
	if err != nil {
		t.Fatalf("move: %v", err)
	}

	rows := logCount(t, db)

	retry, err := post(t, svc, initialTotal("order-placed:5001"))
	if err != nil || retry.Created || retry.Entry.ShopID != shop || logCount(t, db) != rows {
		t.Fatalf("the redelivered opening: created %v, shop %d, err %v, %d new rows", retry.Created, retry.Entry.ShopID,
			err, logCount(t, db)-rows)
	}

	_, err = post(t, svc, settlement_v1.PostInput{
		UniqueID: "fresh-old-shop", SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER,
		SourceType: settlementv1.SourceType_SOURCE_TYPE_IMPORTER, Change: 5,
	})
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a new old-shop row: err %v, want InvalidArgument", err)
	}
}

// Another team's event on this order's account is refused, and nothing moves.
func TestMoveOrderShop_AnotherTeamIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	worked(t, svc)

	_, err := svc.MoveOrderShop(context.Background(), settlement_v1.ShopMoveInput{
		TeamID: team + 1, OrderID: order, ToShopID: newShop, ChangeID: 77, OccurredOn: "2026-11-18",
	})
	if connect.CodeOf(err) != connect.CodePermissionDenied || account(t, db).ShopID != shop {
		t.Fatalf("another team's move: err %v, account on %d", err, account(t, db).ShopID)
	}
}

// THE SHOP REPORTS COUNT IT ON THE DAY IT IS WRITTEN: the order's figures folded on 1 Oct under the old shop stay
// there; the day of the move takes them off the old shop (its close back to 0) and puts them on the new one. The
// person grain nets to nothing.
func TestMoveOrderShop_TheShopReportsMoveOnTheDay(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &postedRecorder{}
	svc := settlement_v1.NewService(db, rec.send, nil, nil, nil, nil, nil)

	worked(t, svc)

	// The order's own rows were learned on 1 Oct.
	for _, event := range rec.all() {
		event.GetSettlementLogPosted().PostedOn = "2026-10-01"
		fold(t, svc, event)
	}

	oldBefore, oldDays := shopDays(t, db, shop)
	userBefore, _ := userDays(t, db, creator)

	moved, err := move(svc, 77, newShop)
	if err != nil {
		t.Fatalf("move: %v", err)
	}

	events := rec.all()
	fold(t, svc, events[3:]...)

	day := moved.Entries[0].PostedOn.Format(time.DateOnly)

	oldAfter, oldAfterDays := shopDays(t, db, shop)
	if len(oldAfter) != 2 || oldAfterDays[0] != oldDays[0] || oldAfter[0] != oldBefore[0] ||
		oldAfterDays[1].Format(time.DateOnly) != day {
		t.Fatalf("the old shop's days %v → %v, want 1 Oct untouched and the move's day added", oldDays, oldAfterDays)
	}

	if !san_money.Equal(oldAfter[1].InitialTotal, sale) || !san_money.Equal(oldAfter[1].Fund, -arrived) ||
		!san_money.Equal(oldAfter[1].ExternalAdsFee, -adsFee) || !san_money.IsZero(oldAfter[1].CloseBalance) {
		t.Fatalf("the old shop on the move's day = %+v, want the order's figures out and a 0 close", oldAfter[1])
	}

	newAfter, newDays := shopDays(t, db, newShop)
	if len(newAfter) != 1 || newDays[0].Format(time.DateOnly) != day ||
		!san_money.Equal(newAfter[0].InitialTotal, -sale) || !san_money.Equal(newAfter[0].Fund, arrived) ||
		!san_money.Equal(newAfter[0].CloseBalance, oldBefore[0].CloseBalance) {
		t.Fatalf("the new shop = %+v on %v, want the order's figures on the move's day", newAfter, newDays)
	}

	userAfter, _ := userDays(t, db, creator)
	if len(userAfter) == 0 || !san_money.Equal(userAfter[len(userAfter)-1].CloseBalance, userBefore[len(userBefore)-1].CloseBalance) {
		t.Fatalf("the creator's position moved: %+v → %+v", userBefore, userAfter)
	}
}

// THE PUSH HANDLER: an OrderShopChanged moves the account on its own day; any other variant is acked.
func TestOrderShopHandler_MovesFromTheEvent(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	worked(t, svc)

	handler := svc.OrderShopHandler()

	err := handler(context.Background(), &eventsv1.Event{
		EventId: "order-placed:1", OccurredAt: timestamppb.Now(), AggregateId: "order:1",
		Message: &eventsv1.Event_OrderPlaced{OrderPlaced: &eventsv1.OrderPlaced{OrderId: order}},
	})
	if err != nil || account(t, db).ShopID != shop {
		t.Fatalf("another variant: err %v", err)
	}

	// 23:30 WIB on 17 Nov is 16:30 UTC — the move's rows are dated the 17th, the fix's own day.
	at := time.Date(2026, 11, 17, 16, 30, 0, 0, time.UTC)

	err = handler(context.Background(), &eventsv1.Event{
		EventId: "order-shop-changed:77", OccurredAt: timestamppb.New(at), AggregateId: "order:5001",
		Message: &eventsv1.Event_OrderShopChanged{OrderShopChanged: &eventsv1.OrderShopChanged{
			TeamId: team, OrderId: order, FromShopId: shop, ToShopId: newShop, ChangeId: 77, TimelineLogId: 9,
			ActorId: 9, ActorIsOverride: true,
		}},
	})
	if err != nil {
		t.Fatalf("OrderShopChanged: %v", err)
	}

	var rows []settlement_service_models.SettlementLog

	err = db.Where("order_id = ? AND unique_id LIKE 'order-shop-moved:%'", order).Find(&rows).Error
	if err != nil || len(rows) != 6 || account(t, db).ShopID != newShop {
		t.Fatalf("%d moving rows (err %v), account on %d", len(rows), err, account(t, db).ShopID)
	}

	for _, row := range rows {
		if row.OccurredOn.Format(time.DateOnly) != "2026-11-17" || !row.IsOverride || row.ActorID != 9 {
			t.Fatalf("moving row %+v, want 17 Nov, by 9, stamped as an override", row)
		}
	}
}
