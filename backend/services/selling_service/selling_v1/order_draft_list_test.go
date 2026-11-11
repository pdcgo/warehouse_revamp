package selling_v1_test

import (
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

func listDrafts(
	t *testing.T,
	svc *selling_v1.Service,
	userID, teamID uint64,
	source string,
) *sellingv1.OrderDraftListResponse {
	t.Helper()

	res, err := svc.OrderDraftList(asUser(userID), connect.NewRequest(&sellingv1.OrderDraftListRequest{
		TeamId: teamID,
		Filter: &sellingv1.OrderDraftListFilter{Source: source},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
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

// A DRAFT IS PERSONAL (§6.3). Two people in the same team, each pushing their own scrape, must not
// see each other's — and the team scope alone would not do that, since both hold a role in team 2.
func TestOrderDraftList_ShowsOnlyTheCallersOwnDrafts(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mine := pushRef(t, svc, 7, "SHP-100")
	pushRef(t, svc, 9, "SHP-200")

	msg := listDrafts(t, svc, 7, 2, "")

	if len(draftRows(msg)) != 1 {
		t.Fatalf("got %d drafts, want 1 — a colleague's draft leaked into the list",
			len(draftRows(msg)))
	}

	if draftRows(msg)[0].GetId() != mine {
		t.Fatalf("listed draft %d, want %d", draftRows(msg)[0].GetId(), mine)
	}

	if msg.GetPageInfo().GetTotalItems() != 1 {
		t.Fatalf("total_items = %d, want 1 — the COUNT saw drafts the page did not",
			msg.GetPageInfo().GetTotalItems())
	}
}

// The list carries no lines, so the count is what the list screen (#195) says of them — the line count only, since a
// draft stores no mapping (the-drafts-list-counts-no-mapping). The buyer and the address come from each draft's one
// address row.
func TestOrderDraftList_CountsTheLinesAndNamesTheBuyer(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	pushRef(t, svc, 7, "SHP-100")

	got := draftRows(listDrafts(t, svc, 7, 2, ""))[0]

	if got.GetItemCount() != 2 {
		t.Fatalf("item_count = %d, want 2", got.GetItemCount())
	}

	if got.GetCustomerName() != "Budi" || got.GetAddress().GetAddressLine() != "Jl. Merdeka 1" {
		t.Fatalf("buyer %q at %q — want the address row's Budi at Jl. Merdeka 1",
			got.GetCustomerName(), got.GetAddress().GetAddressLine())
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

	got := draftRows(listDrafts(t, svc, 7, 2, ""))[0]

	if got.GetItemCount() != 0 {
		t.Fatalf("item_count = %d on a draft with no lines, want 0", got.GetItemCount())
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

	if len(draftRows(msg)) != 1 || draftRows(msg)[0].GetSource() != "other-app" {
		t.Fatalf("source filter returned %d drafts, want 1 from other-app", len(draftRows(msg)))
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

	if len(draftRows(msg)) != 0 {
		t.Fatalf("got %d drafts in a team that has none", len(draftRows(msg)))
	}
}

// finishDraft fills in everything Create needs that a scrape does not carry — written directly. The scrape already
// carries the buyer and the address line; nothing maps the lines (a-draft-stores-no-mapping).
func finishDraft(t *testing.T, db *gorm.DB, draftID uint64) {
	t.Helper()

	err := db.
		Model(&selling_service_models.OrderDraft{}).
		Where("id = ?", draftID).
		Updates(map[string]any{
			"shop_id":             21,
			"warehouse_id":        11,
			"platform_total":      135000,
			"platform_created_at": time.Now().Add(-time.Hour),
			"shipment_channel_id": 1,
		}).
		Error
	if err != nil {
		t.Fatalf("finish draft: %v", err)
	}
}

// #16 — THE READY COUNT IS THE WHOLE SET'S (the-draft-summary-is-three-cards). Two of seven drafts are ready; asked
// one row a page, every page still answers 2 — the card no longer counts the page on screen. Each other draft misses
// exactly one rule of draftGaps, so a rule dropped from readyDrafts shows up as a 3. No line of any draft is mapped —
// a draft stores no mapping, and none keeps it from Ready (the-drafts-list-counts-no-mapping).
func TestOrderDraftList_ReadyCountIsTheWholeSets(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	readyA := pushRef(t, svc, 7, "SHP-R1")
	readyB := pushRef(t, svc, 7, "SHP-R2")
	noPrice := pushRef(t, svc, 7, "SHP-P1")
	noDate := pushRef(t, svc, 7, "SHP-D1")
	noCourier := pushRef(t, svc, 7, "SHP-C1")
	noAddress := pushRef(t, svc, 7, "SHP-A1")
	noCustomer := pushRef(t, svc, 7, "SHP-N1")

	for _, id := range []uint64{readyA, readyB, noPrice, noDate, noCourier, noAddress, noCustomer} {
		finishDraft(t, db, id)
	}

	db.Model(&selling_service_models.OrderDraft{}).Where("id = ?", noPrice).Update("platform_total", 0)
	db.Model(&selling_service_models.OrderDraft{}).Where("id = ?", noDate).Update("platform_created_at", nil)
	db.Model(&selling_service_models.OrderDraft{}).Where("id = ?", noCourier).Update("shipment_channel_id", 0)
	db.Model(&selling_service_models.OrderDraftAddress{}).Where("order_draft_id = ?", noAddress).Update("address_line", "")
	db.Model(&selling_service_models.OrderDraftAddress{}).Where("order_draft_id = ?", noCustomer).Update("customer_name", "")

	// A colleague's ready draft is not the caller's backlog.
	other := pushRef(t, svc, 9, "SHP-X1")
	finishDraft(t, db, other)

	for page := uint32(1); page <= 7; page++ {
		res, err := svc.OrderDraftList(asUser(7), connect.NewRequest(&sellingv1.OrderDraftListRequest{
			TeamId: 2,
			Page:   &commonv1.CommonPagination{Page: page, Limit: 1},
		}))
		if err != nil {
			t.Fatalf("page %d: %v", page, err)
		}

		if res.Msg.GetReadyCount() != 2 {
			t.Fatalf("page %d: ready = %d, want 2 — the count must be the set's, not the page's", page, res.Msg.GetReadyCount())
		}

		if len(draftRows(res.Msg)) != 1 || res.Msg.GetPageInfo().GetTotalItems() != 7 {
			t.Fatalf("page %d: rows = %d, total = %d — the count leaked into the page query",
				page, len(draftRows(res.Msg)), res.Msg.GetPageInfo().GetTotalItems())
		}
	}

	// It follows the list's own filter: another app's drafts are none of this set.
	msg := listDrafts(t, svc, 7, 2, "another-app")
	if msg.GetReadyCount() != 0 {
		t.Fatalf("ready under another source = %d, want 0", msg.GetReadyCount())
	}

	// A manual draft is never ready on the list: its order ref is still to be typed (orderDrafts.gapRef).
	db.Model(&selling_service_models.OrderDraft{}).Where("id = ?", readyB).Update("source", "manual")

	msg = listDrafts(t, svc, 7, 2, "")
	if msg.GetReadyCount() != 1 {
		t.Fatalf("ready with a manual draft = %d, want 1", msg.GetReadyCount())
	}
}

// THE DRAFTS LIST READS THE OVERRIDE STAMP (an-override-shows-a-platform-badge): a draft whose last push was Root's, from
// outside team 2, reads is_override beside its author — the "by Root team" badge — and the CS's draft does not.
func TestOrderDraftList_ReadsTheOverrideStamp(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	want := map[uint64]bool{}

	for _, c := range []struct {
		ref    string
		userID uint64
		want   bool
	}{
		{"SHP-ROOT", 1, true},
		{"SHP-CS", 7, false},
	} {
		role := sellingCS
		if c.want {
			role = rootOutside
		}

		msg := scrape()
		msg.ExternalId = c.ref

		res, err := svc.OrderDraftPush(asScoped(c.userID, 2, role), connect.NewRequest(msg))
		if err != nil {
			t.Fatalf("%s: OrderDraftPush: %v", c.ref, err)
		}

		want[res.Msg.GetDraft().GetId()] = c.want
	}

	// A draft is its author's own (the list narrows to the caller), so each reads their own one.
	for _, userID := range []uint64{1, 7} {
		rows := draftRows(listDrafts(t, svc, userID, 2, ""))
		if len(rows) != 1 {
			t.Fatalf("user %d listed %d drafts, want 1", userID, len(rows))
		}

		d := rows[0]
		if d.GetIsOverride() != want[d.GetId()] {
			t.Errorf("user %d: draft %d is_override = %v, want %v", userID, d.GetId(), d.GetIsOverride(), want[d.GetId()])
		}
	}
}
