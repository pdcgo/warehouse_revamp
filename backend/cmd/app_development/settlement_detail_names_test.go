package main

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_service_models"
	user_v1 "github.com/pdcgo/warehouse_revamp/backend/services/user_service/user_v1"
)

// THE ORDER'S LEDGER NAMES WHO TYPED A MANUAL ROW through the real user read (the-source-is-a-badge: *Manual · <who
// typed it>*): the adder's name comes from the users table, and a user since removed comes back unnamed with the id
// kept, so the panel falls back to `Manual · <id>`.
func TestOrderSettlementDetail_NamesTheAdderThroughTheUserRead(t *testing.T) {
	db := san_testdb.DB(t)
	ctx := context.Background()

	adder := user_service_models.User{Name: "SO Adder", Username: "soadderledger", Password: "x"}
	removed := user_service_models.User{Name: "Gone Person", Username: "goneledger", Password: "x"}

	for _, u := range []*user_service_models.User{&adder, &removed} {
		err := db.Create(u).Error
		if err != nil {
			t.Fatalf("user %s: %v", u.Username, err)
		}
	}

	names := NewSettlementUserNames(user_v1.NewService(db, nil, nil, nil, nil, nil, nil))
	svc := settlement_v1.NewService(db, nil, nil, nil, nil, nil, names)

	const (
		teamID  uint64 = 12
		shopID  uint64 = 21
		orderID uint64 = 910_117
	)

	for _, in := range []settlement_v1.PostInput{
		{UniqueID: "order-910117-initial", SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL,
			SourceType: settlementv1.SourceType_SOURCE_TYPE_ORDER, Change: -100_000},
		{UniqueID: "manual-ads", SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_EXTERNAL_ADS_FEE,
			SourceType: settlementv1.SourceType_SOURCE_TYPE_MANUAL, Change: -5_000, ActorID: adder.ID},
		{UniqueID: "manual-other", SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_EXTERNAL_ADS_FEE,
			SourceType: settlementv1.SourceType_SOURCE_TYPE_MANUAL, Change: -1_000, ActorID: removed.ID},
	} {
		in.TeamID = teamID
		in.ShopID = shopID
		in.OrderID = orderID
		in.OccurredOn = "2026-11-21"

		_, err := svc.PostEntry(ctx, in)
		if err != nil {
			t.Fatalf("%s: %v", in.UniqueID, err)
		}
	}

	err := db.Delete(&removed).Error
	if err != nil {
		t.Fatalf("remove user: %v", err)
	}

	res, err := svc.OrderSettlementDetail(ctx, connect.NewRequest(&settlementv1.OrderSettlementDetailRequest{
		TeamId:  teamID,
		OrderId: orderID,
	}))
	if err != nil {
		t.Fatalf("OrderSettlementDetail: %v", err)
	}

	want := map[string]struct {
		actor uint64
		name  string
	}{
		"order-910117-initial": {0, ""},
		"manual-ads":           {adder.ID, "SO Adder"},
		"manual-other":         {removed.ID, ""},
	}

	if len(res.Msg.GetEntries()) != len(want) {
		t.Fatalf("%d entries, want %d", len(res.Msg.GetEntries()), len(want))
	}

	for _, e := range res.Msg.GetEntries() {
		w := want[e.GetUniqueId()]
		if e.GetActorId() != w.actor || e.GetActorName() != w.name {
			t.Errorf("%s: actor %d named %q, want %d named %q", e.GetUniqueId(), e.GetActorId(), e.GetActorName(), w.actor, w.name)
		}
	}
}
