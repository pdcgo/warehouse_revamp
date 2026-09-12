package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

func draftDetail(
	t *testing.T,
	svc *selling_v1.Service,
	userID, teamID, draftID uint64,
) (*sellingv1.OrderDraft, error) {
	t.Helper()

	res, err := svc.OrderDraftDetail(asUser(userID),
		connect.NewRequest(&sellingv1.OrderDraftDetailRequest{TeamId: teamID, DraftId: draftID}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetDraft(), nil
}

// The lines are the point of the detail — nothing else returns them, and the mapping screen (#196)
// needs the scraped text and the mapped product side by side.
func TestOrderDraftDetail_ReturnsTheLinesWithTheirScrapedText(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := pushRef(t, svc, 7, "SHP-100")
	mapLine(t, db, draftID, "MP-1", 42)

	draft, err := draftDetail(t, svc, 7, 2, draftID)
	if err != nil {
		t.Fatalf("OrderDraftDetail: %v", err)
	}

	if len(draft.GetItems()) != 2 {
		t.Fatalf("items = %d, want 2", len(draft.GetItems()))
	}

	first := draft.GetItems()[0]

	// Both halves, together: the evidence of what was ordered AND what somebody mapped it to. Losing
	// either is how a wrong mapping becomes invisible.
	if first.GetExternalName() != "Kaos Polos Hitam L" || first.GetProductId() != 42 {
		t.Fatalf("line 1 = %q / product %d, want the scraped name AND the mapping",
			first.GetExternalName(), first.GetProductId())
	}

	if draft.GetItemCount() != 2 || draft.GetUnmappedItemCount() != 1 {
		t.Fatalf("counts = %d/%d, want 2/1 — the detail must agree with the list",
			draft.GetItemCount(), draft.GetUnmappedItemCount())
	}
}

// A colleague's draft reads as NOT FOUND, not as a permission error. The caller holds a perfectly
// good role in this team; the draft is simply not theirs, and "exists but is not yours" would leak
// that a given external ref has already been scraped.
func TestOrderDraftDetail_AColleaguesDraftIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := pushRef(t, svc, 9, "SHP-200")

	_, err := draftDetail(t, svc, 7, 2, draftID)
	if err == nil {
		t.Fatal("read another person's draft — a draft is personal")
	}

	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}

// The team scope is checked in the query itself, so naming the right draft id under the wrong team
// cannot reach it.
func TestOrderDraftDetail_AnotherTeamCannotReachItById(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := pushRef(t, svc, 7, "SHP-100")

	_, err := draftDetail(t, svc, 7, 3, draftID)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}

func TestOrderDraftDetail_RefusesWithoutAnIdentity(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := pushRef(t, svc, 7, "SHP-100")

	_, err := svc.OrderDraftDetail(context.Background(),
		connect.NewRequest(&sellingv1.OrderDraftDetailRequest{TeamId: 2, DraftId: draftID}))
	if connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("code = %v, want Unauthenticated — a personal read needs to know who is asking",
			connect.CodeOf(err))
	}
}
