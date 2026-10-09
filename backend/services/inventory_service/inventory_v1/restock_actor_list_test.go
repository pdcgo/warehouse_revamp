package inventory_v1_test

import (
	"context"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// listActors asks who did `role` on the restocks `team` may list, in the default order (latest first).
func listActors(
	t *testing.T,
	svc *inventory_v1.Service,
	ctx context.Context,
	team uint64,
	role inventoryv1.RestockActorRole,
	page *commonv1.CommonPagination,
) *inventoryv1.RestockActorListResponse {
	t.Helper()

	resp, err := svc.RestockActorList(ctx, connect.NewRequest(&inventoryv1.RestockActorListRequest{
		TeamId: team,
		Filter: &inventoryv1.RestockActorListFilter{Role: role},
		Page:   page,
	}))
	if err != nil {
		t.Fatalf("RestockActorList: %v", err)
	}

	return resp.Msg
}

// a-who-filter-lists-the-people-on-its-rows: the people on the rows THIS team may list — on both sides, and
// nobody from a restock it cannot see.
func TestRestockActorList_ThePeopleOnTheRows(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const sellingTeam, otherSeller, warehouse uint64 = 2, 3, 5
	const rina, budi, stranger uint64 = 7, 8, 12
	const hand, otherHand uint64 = 9, 11

	create := func(team, author uint64) *inventoryv1.RestockRequest {
		t.Helper()

		resp, err := svc.RestockRequestCreate(ctxUser(author), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: team, WarehouseId: warehouse,
			Items: []*inventoryv1.RestockRequestItem{
				{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 2, Total: 200},
			},
		}))
		if err != nil {
			t.Fatalf("create: %v", err)
		}

		return resp.Msg.GetRequest()
	}

	accept := func(by uint64, r *inventoryv1.RestockRequest) {
		t.Helper()

		_, err := svc.RestockRequestAccept(ctxUser(by), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
			TeamId: warehouse, RequestId: r.GetId(), Lines: allArrived(t, db, r),
		}))
		if err != nil {
			t.Fatalf("accept: %v", err)
		}
	}

	// The dates are set by hand: rows written in one test transaction land within microseconds, and the
	// order is the point.
	stamp := func(r *inventoryv1.RestockRequest, created time.Time) {
		t.Helper()

		err := db.Exec("UPDATE restock_requests SET created_at = ?, accepted_at = CASE WHEN accepted_at IS NULL THEN NULL ELSE ?::timestamptz END WHERE id = ?",
			created, created.Add(time.Hour), r.GetId()).Error
		if err != nil {
			t.Fatalf("stamp: %v", err)
		}
	}

	day := time.Date(2026, 9, 1, 9, 0, 0, 0, time.UTC)

	rinasOld := create(sellingTeam, rina)
	budis := create(sellingTeam, budi)
	rinasNew := create(sellingTeam, rina)
	pending := create(sellingTeam, budi)
	strangers := create(otherSeller, stranger)

	accept(hand, rinasOld)
	accept(otherHand, budis)
	accept(hand, strangers)

	stamp(rinasOld, day)
	stamp(budis, day.AddDate(0, 0, 1))
	stamp(rinasNew, day.AddDate(0, 0, 2))
	stamp(pending, day.AddDate(0, 0, 3))
	stamp(strangers, day.AddDate(0, 0, 4))

	ctx := ctxUser(rina)

	// Raised, on the selling side: Budi raised the latest of the team's own, and the other team's author
	// is not on any row this team can see.
	raised := listActors(t, svc, ctx, sellingTeam, inventoryv1.RestockActorRole_RESTOCK_ACTOR_ROLE_CREATED, page1())
	if !slices.Equal(raised.GetIds(), []uint64{budi, rina}) {
		t.Fatalf("raised = %v, want [budi rina], latest first", raised.GetIds())
	}

	last := raised.GetItems()[0].GetActor().GetMapData()[rina].GetLastAtUnix()
	if last != day.AddDate(0, 0, 2).Unix() {
		t.Fatalf("rina's last = %d, want her newer restock's date", last)
	}

	// Accepted, on the selling side: the warehouse people who counted THIS team's restocks — whom it can
	// never read from the warehouse's member list. A pending restock names nobody.
	accepted := listActors(t, svc, ctx, sellingTeam, inventoryv1.RestockActorRole_RESTOCK_ACTOR_ROLE_ACCEPTED, page1())
	if !slices.Equal(accepted.GetIds(), []uint64{otherHand, hand}) {
		t.Fatalf("accepted = %v, want [otherHand hand]", accepted.GetIds())
	}

	// The warehouse sees every team's restocks addressed to it, so every author.
	inbound := listActors(t, svc, ctx, warehouse, inventoryv1.RestockActorRole_RESTOCK_ACTOR_ROLE_CREATED, page1())
	if !slices.Equal(inbound.GetIds(), []uint64{stranger, budi, rina}) {
		t.Fatalf("warehouse raised = %v, want [stranger budi rina]", inbound.GetIds())
	}

	// The pager counts PEOPLE, not restocks: three authors over five restocks.
	firstTwo := listActors(t, svc, ctx, warehouse, inventoryv1.RestockActorRole_RESTOCK_ACTOR_ROLE_CREATED,
		&commonv1.CommonPagination{Page: 1, Limit: 2})
	if firstTwo.GetPageInfo().GetTotalItems() != 3 || len(firstTwo.GetIds()) != 2 {
		t.Fatalf("page 1 of 2 = %v, total %d, want 2 of 3", firstTwo.GetIds(), firstTwo.GetPageInfo().GetTotalItems())
	}

	// A team with no restocks has nobody to offer.
	if none := listActors(t, svc, ctx, 99, inventoryv1.RestockActorRole_RESTOCK_ACTOR_ROLE_CREATED, page1()); len(none.GetIds()) != 0 {
		t.Fatalf("an empty team offers %v", none.GetIds())
	}
}

// A restock from before the actor columns has 0 there — "not recorded", which is nobody to filter by.
func TestRestockActorList_ZeroIsNobody(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	resp, err := svc.RestockRequestCreate(ctxUser(7), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: 5,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 1, Total: 100}},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	err = db.Exec("UPDATE restock_requests SET created_by_user_id = 0 WHERE id = ?", resp.Msg.GetRequest().GetId()).Error
	if err != nil {
		t.Fatalf("clear the author: %v", err)
	}

	got := listActors(t, svc, ctxUser(7), 2, inventoryv1.RestockActorRole_RESTOCK_ACTOR_ROLE_CREATED, page1())
	if len(got.GetIds()) != 0 || got.GetPageInfo().GetTotalItems() != 0 {
		t.Fatalf("an unrecorded author offered as %v (total %d)", got.GetIds(), got.GetPageInfo().GetTotalItems())
	}
}
