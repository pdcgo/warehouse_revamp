package selling_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

func listDrafts(
	t *testing.T,
	svc *selling_v1.Service,
	userID, teamID uint64,
	source string,
) *sellingv1.OrderDraftListResponse {
	t.Helper()

	res, err := svc.OrderDraftList(asUser(userID), connect.NewRequest(&sellingv1.OrderDraftListRequest{
		TeamId: teamID,
		Page:   &commonv1.PageFilter{Page: 1, Limit: 50},
		Source: source,
	}))
	if err != nil {
		t.Fatalf("OrderDraftList(user=%d, team=%d): %v", userID, teamID, err)
	}

	return res.Msg
}

// pushRef is a scrape under a given external ref, so a test can make several distinct drafts.
func pushRef(t *testing.T, svc *selling_v1.Service, userID uint64, ref string) uint64 {
	t.Helper()

	msg := scrape()
	msg.ExternalId = ref

	return push(t, svc, userID, msg).GetDraft().GetId()
}

// mapLine is what OrderDraftUpdate (#193) will do — written directly so the unmapped count can be
// tested before that RPC exists.
func mapLine(t *testing.T, db *gorm.DB, draftID uint64, sku string, productID uint64) {
	t.Helper()

	err := db.
		Model(&selling_service_models.OrderDraftItem{}).
		Where("draft_id = ? AND external_sku = ?", draftID, sku).
		Update("product_id", productID).
		Error
	if err != nil {
		t.Fatalf("map line: %v", err)
	}
}

// A DRAFT IS PERSONAL (§6.3). Two people in the same team, each pushing their own scrape, must not
// see each other's — and the team scope alone would not do that, since both hold a role in team 2.
func TestOrderDraftList_ShowsOnlyTheCallersOwnDrafts(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mine := pushRef(t, svc, 7, "SHP-100")
	pushRef(t, svc, 9, "SHP-200")

	msg := listDrafts(t, svc, 7, 2, "")

	if len(msg.GetDrafts()) != 1 {
		t.Fatalf("got %d drafts, want 1 — a colleague's draft leaked into the list",
			len(msg.GetDrafts()))
	}

	if msg.GetDrafts()[0].GetId() != mine {
		t.Fatalf("listed draft %d, want %d", msg.GetDrafts()[0].GetId(), mine)
	}

	if msg.GetPageInfo().GetTotalItems() != 1 {
		t.Fatalf("total_items = %d, want 1 — the COUNT saw drafts the page did not",
			msg.GetPageInfo().GetTotalItems())
	}
}

// The list carries no lines, so these counts are the only thing on the list screen (#195) that says
// how much work is left on a draft.
func TestOrderDraftList_CountsTheUnmappedLines(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := pushRef(t, svc, 7, "SHP-100")
	mapLine(t, db, draftID, "MP-1", 42)

	got := listDrafts(t, svc, 7, 2, "").GetDrafts()[0]

	if got.GetItemCount() != 2 {
		t.Fatalf("item_count = %d, want 2", got.GetItemCount())
	}

	if got.GetUnmappedItemCount() != 1 {
		t.Fatalf("unmapped_item_count = %d, want 1 — one of the two lines was mapped",
			got.GetUnmappedItemCount())
	}

	// Summaries only: the list must not carry lines, or paginating it would be pointless.
	if len(got.GetItems()) != 0 {
		t.Fatalf("the list returned %d line items — it is meant to be a summary",
			len(got.GetItems()))
	}
}

// A draft with no lines at all is still a draft (a push with nothing readable is kept). The counts
// must say zero rather than the aggregate simply omitting the row.
func TestOrderDraftList_ADraftWithNoLinesCountsZero(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	empty := scrape()
	empty.Items = nil

	push(t, svc, 7, empty)

	got := listDrafts(t, svc, 7, 2, "").GetDrafts()[0]

	if got.GetItemCount() != 0 || got.GetUnmappedItemCount() != 0 {
		t.Fatalf("counts = %d/%d on a draft with no lines, want 0/0",
			got.GetItemCount(), got.GetUnmappedItemCount())
	}
}

// The source filter is server-side because the list is paginated: filtering the loaded page in the
// client would narrow one page and report the unfiltered total beside it.
func TestOrderDraftList_FiltersBySource(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	pushRef(t, svc, 7, "SHP-100")

	other := scrape()
	other.Source = "other-app"
	other.ExternalId = "OTH-1"
	push(t, svc, 7, other)

	msg := listDrafts(t, svc, 7, 2, "other-app")

	if len(msg.GetDrafts()) != 1 || msg.GetDrafts()[0].GetSource() != "other-app" {
		t.Fatalf("source filter returned %d drafts, want 1 from other-app", len(msg.GetDrafts()))
	}

	if msg.GetPageInfo().GetTotalItems() != 1 {
		t.Fatalf("total_items = %d, want 1 — the count ignored the filter",
			msg.GetPageInfo().GetTotalItems())
	}
}

// The scope still does its job: the same person in a different team sees nothing of team 2's.
func TestOrderDraftList_IsScopedToTheTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	pushRef(t, svc, 7, "SHP-100")

	msg := listDrafts(t, svc, 7, 3, "")

	if len(msg.GetDrafts()) != 0 {
		t.Fatalf("got %d drafts in a team that has none", len(msg.GetDrafts()))
	}
}
