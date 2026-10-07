package selling_v1_test

import (
	"context"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

func grantAt(t *testing.T, db *gorm.DB, shopID, userID uint64, primary bool, at time.Time) uint64 {
	t.Helper()

	row := selling_service_models.ShopUser{ShopID: shopID, UserID: userID, IsPrimary: primary, CreatedAt: at}

	err := db.Create(&row).Error
	if err != nil {
		t.Fatalf("grant shop %d to %d: %v", shopID, userID, err)
	}

	return row.ID
}

func grantsLeft(t *testing.T, db *gorm.DB, ids ...uint64) map[uint64]bool {
	t.Helper()

	var left []uint64

	db.Model(&selling_service_models.ShopUser{}).Where("id IN ?", ids).Pluck("id", &left)

	out := map[uint64]bool{}
	for _, id := range left {
		out[id] = true
	}

	return out
}

func memberRemoved(teamID, userID uint64, at time.Time) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:     "team-member-log:1",
		OccurredAt:  timestamppb.New(at),
		AggregateId: "team:1",
		Message:     &eventsv1.Event_MemberRemoved{MemberRemoved: &eventsv1.MemberRemoved{TeamId: teamID, UserId: userID}},
	}
}

// removing-a-member-drops-their-shop-access: the person's grants on the team's shops go, the primary flag with them;
// their grants in another team, and anyone else's, stay.
func TestMemberRemoved_DropsTheirGrantsInThatTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const ani, budi uint64 = 7, 8

	melati := insertShop(t, db, 2, "Toko Melati", "MELATI", "shopee")
	melatiTok := insertShop(t, db, 2, "Melati Tokopedia", "MELATI-T", "tokopedia")
	other := insertShop(t, db, 3, "Toko Lain", "LAIN", "shopee")

	before := time.Now().Add(-time.Hour)
	removedAt := time.Now()

	anisPrimary := grantAt(t, db, melati, ani, true, before)
	anisSecond := grantAt(t, db, melatiTok, ani, false, before)
	anisElsewhere := grantAt(t, db, other, ani, false, before)
	budis := grantAt(t, db, melati, budi, false, before)

	err := svc.MemberRemovedHandler()(context.Background(), memberRemoved(2, ani, removedAt))
	if err != nil {
		t.Fatalf("handler: %v", err)
	}

	left := grantsLeft(t, db, anisPrimary, anisSecond, anisElsewhere, budis)

	if left[anisPrimary] || left[anisSecond] {
		t.Fatalf("Ani still holds a grant on team 2's shops: %v", left)
	}

	if !left[anisElsewhere] {
		t.Fatalf("Ani's grant in team 3 went too — she left one team")
	}

	if !left[budis] {
		t.Fatalf("Budi's grant went — he was not removed")
	}

	// A redelivery finds nothing older to drop, and is fine.
	err = svc.MemberRemovedHandler()(context.Background(), memberRemoved(2, ani, removedAt))
	if err != nil {
		t.Fatalf("redelivery: %v", err)
	}
}

// A late delivery never undoes a grant made after the person was added back: only grants older than the removal go.
func TestMemberRemoved_KeepsAGrantMadeAfterTheRemoval(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const ani uint64 = 7

	melati := insertShop(t, db, 2, "Toko Melati", "MELATI", "shopee")

	removedAt := time.Now().Add(-time.Minute)
	regranted := grantAt(t, db, melati, ani, true, time.Now())

	err := svc.MemberRemovedHandler()(context.Background(), memberRemoved(2, ani, removedAt))
	if err != nil {
		t.Fatalf("handler: %v", err)
	}

	if !grantsLeft(t, db, regranted)[regranted] {
		t.Fatalf("the grant made after Ani was added back was dropped by the old removal")
	}
}

// Another event on this route is not this handler's, and is ACKed untouched.
func TestMemberRemoved_IgnoresOtherEvents(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	melati := insertShop(t, db, 2, "Toko Melati", "MELATI", "shopee")
	kept := grantAt(t, db, melati, 7, false, time.Now().Add(-time.Hour))

	err := svc.MemberRemovedHandler()(context.Background(), &eventsv1.Event{
		EventId: "order-cancelled:1", OccurredAt: timestamppb.Now(), AggregateId: "order:1",
		Message: &eventsv1.Event_OrderCancelled{OrderCancelled: &eventsv1.OrderCancelled{TeamId: 2, OrderId: 1}},
	})
	if err != nil {
		t.Fatalf("handler: %v", err)
	}

	if !grantsLeft(t, db, kept)[kept] {
		t.Fatalf("an unrelated event dropped a grant")
	}
}
