package settlement_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// asScoped is a request context as the access interceptor leaves it: who is calling, the team the request is scoped
// to, and their role there. ROLE_UNSPECIFIED is Root or the Administrator, in by the root-team bypass.
func asScoped(userID, teamID uint64, role role_basev1.Role) context.Context {
	ctx := san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: userID})
	ctx = san_auth.WithScope(ctx, teamID)

	return san_auth.WithCallerRole(ctx, role)
}

// AN OVERRIDE IS STAMPED (an-override-is-stamped-in-every-service): a row Root posts into a team it holds no role in
// says so beside its actor; the team's own CS's row does not, and neither does the opening row the system wrote from
// the order's event.
func TestSettlementPost_StampsAnOverride(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	// The account opens from the order's event — no person on the ctx, so the system's row.
	_, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("PostEntry: %v", err)
	}

	posts := []struct {
		name     string
		ctx      context.Context
		uniqueID string
		kind     settlementv1.SettlementType
		change   int64
	}{
		{"root outside the team", asScoped(1, team, role_basev1.Role_ROLE_UNSPECIFIED), "root-fund",
			settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, arrived},
		{"the team's own CS", asScoped(7, team, role_basev1.Role_ROLE_SELLING_CS), "cs-ads",
			settlementv1.SettlementType_SETTLEMENT_TYPE_EXTERNAL_ADS_FEE, adsFee},
	}

	for _, p := range posts {
		_, err = svc.SettlementPost(p.ctx, connect.NewRequest(&settlementv1.SettlementPostRequest{
			TeamId:         team,
			OrderId:        order,
			ShopId:         shop,
			UniqueId:       p.uniqueID,
			SettlementType: p.kind,
			SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
			Change:         p.change,
			OccurredOn:     "2026-08-29",
		}))
		if err != nil {
			t.Fatalf("%s: SettlementPost: %v", p.name, err)
		}
	}

	want := map[string]bool{
		"order-5001-initial": false,
		"root-fund":          true,
		"cs-ads":             false,
	}

	var rows []settlement_service_models.SettlementLog

	err = db.Where("order_id = ?", order).Find(&rows).Error
	if err != nil {
		t.Fatalf("read the log: %v", err)
	}

	if len(rows) != len(want) {
		t.Fatalf("%d rows on the account, want %d", len(rows), len(want))
	}

	for _, row := range rows {
		if row.IsOverride != want[row.UniqueID] {
			t.Errorf("%s by %d: is_override = %v, want %v", row.UniqueID, row.ActorID, row.IsOverride, want[row.UniqueID])
		}
	}
}

// AN OVERRIDE IS STAMPED DOWNSTREAM OF AN EVENT: the opening row names the order's placer and the cancel row the
// canceller, so each carries its own event's `actor_is_override` — and the SettlementLogPosted each row publishes
// carries the row's stamp on, so the financial account's withdrawal listener reads the same answer.
func TestOrderSale_EachRowCarriesItsEventsStamp(t *testing.T) {
	db := san_testdb.DB(t)
	capture := &captureEvents{}
	svc := settlement_v1.NewService(db, capture.send, nil, nil)

	placedBy := func(orderID uint64, override bool) *eventsv1.Event {
		return &eventsv1.Event{
			EventId:    "order-placed:" + itoa(orderID),
			OccurredAt: timestamppb.New(placedAt),
			Message: &eventsv1.Event_OrderPlaced{OrderPlaced: &eventsv1.OrderPlaced{
				TeamId: team, ShopId: shop, OrderId: orderID, PlatformTotal: sale, ActorId: 42, ActorIsOverride: override,
			}},
		}
	}

	cancelledBy := func(orderID uint64, override bool) *eventsv1.Event {
		return &eventsv1.Event{
			EventId:    "order-cancelled:" + itoa(orderID),
			OccurredAt: timestamppb.New(placedAt.Add(time.Hour)),
			Message: &eventsv1.Event_OrderCancelled{OrderCancelled: &eventsv1.OrderCancelled{
				TeamId: team, ShopId: shop, OrderId: orderID, ActorId: 43, ActorIsOverride: override,
			}},
		}
	}

	// Order 6001: Root places it from outside, the team's CS cancels it. Order 6002: the other way round.
	for _, event := range []*eventsv1.Event{
		placedBy(6001, true), cancelledBy(6001, false),
		placedBy(6002, false), cancelledBy(6002, true),
	} {
		deliver(t, svc, event)
	}

	want := map[uint64]map[string]bool{
		6001: {"initial_total": true, "initial_total_cancel": false},
		6002: {"initial_total": false, "initial_total_cancel": true},
	}

	var rows []settlement_service_models.SettlementLog

	err := db.Where("order_id IN ?", []uint64{6001, 6002}).Order("id").Find(&rows).Error
	if err != nil {
		t.Fatalf("read the log: %v", err)
	}

	if len(rows) != 4 {
		t.Fatalf("%d rows for the two orders, want 4 (an opening and a cancel each)", len(rows))
	}

	for _, row := range rows {
		if row.IsOverride != want[*row.OrderID][row.SettlementType] {
			t.Errorf("order %d %s by %d: is_override = %v, want %v",
				*row.OrderID, row.SettlementType, row.ActorID, row.IsOverride, want[*row.OrderID][row.SettlementType])
		}
	}

	// Each committed row published itself, carrying its stamp beside its actor.
	if len(capture.sent) != len(rows) {
		t.Fatalf("published %d events, want one per row (%d)", len(capture.sent), len(rows))
	}

	for i, event := range capture.sent {
		posted := event.GetSettlementLogPosted()
		if posted.GetActorIsOverride() != rows[i].IsOverride {
			t.Errorf("row %d published actor_is_override = %v, the row says %v",
				rows[i].ID, posted.GetActorIsOverride(), rows[i].IsOverride)
		}
	}
}

// A PERSON'S ROW publishes its stamp too: Root's SettlementPost from outside the team says so on the event.
func TestSettlementPost_TheEventCarriesTheRowsStamp(t *testing.T) {
	db := san_testdb.DB(t)
	capture := &captureEvents{}
	svc := settlement_v1.NewService(db, capture.send, nil, nil)

	for _, c := range []struct {
		name     string
		ctx      context.Context
		uniqueID string
		want     bool
	}{
		{"root outside the team", asScoped(1, team, role_basev1.Role_ROLE_UNSPECIFIED), "root-withdrawal", true},
		{"the team's own CS", asScoped(7, team, role_basev1.Role_ROLE_SELLING_CS), "cs-withdrawal", false},
	} {
		capture.sent = nil

		_, err := svc.SettlementPost(c.ctx, connect.NewRequest(&settlementv1.SettlementPostRequest{
			TeamId:         team,
			ShopId:         shop,
			UniqueId:       c.uniqueID,
			SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_WITHDRAWAL,
			SourceType:     settlementv1.SourceType_SOURCE_TYPE_MANUAL,
			Change:         -50_000,
			OccurredOn:     "2026-08-29",
		}))
		if err != nil {
			t.Fatalf("%s: SettlementPost: %v", c.name, err)
		}

		if len(capture.sent) != 1 {
			t.Fatalf("%s: published %d events, want 1", c.name, len(capture.sent))
		}

		if got := capture.sent[0].GetSettlementLogPosted().GetActorIsOverride(); got != c.want {
			t.Errorf("%s: actor_is_override = %v, want %v", c.name, got, c.want)
		}
	}
}
