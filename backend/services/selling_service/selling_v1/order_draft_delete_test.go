package selling_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

func deleteDrafts(
	t *testing.T,
	svc *selling_v1.Service,
	userID, teamID uint64,
	ids []uint64,
) uint32 {
	t.Helper()

	res, err := svc.OrderDraftDelete(asUser(userID),
		connect.NewRequest(&sellingv1.OrderDraftDeleteRequest{TeamId: teamID, DraftIds: ids}))
	if err != nil {
		t.Fatalf("OrderDraftDelete(%v): %v", ids, err)
	}

	return res.Msg.GetDeleted()
}

// Pruning is entirely manual (§6.7), so several at once is the point — one at a time would lose the
// race against an app that pushes continuously.
func TestOrderDraftDelete_RemovesSeveralAtOnce(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	first := pushRef(t, svc, 7, "SHP-100")
	second := pushRef(t, svc, 7, "SHP-200")
	keep := pushRef(t, svc, 7, "SHP-300")

	if got := deleteDrafts(t, svc, 7, 2, []uint64{first, second}); got != 2 {
		t.Fatalf("deleted = %d, want 2", got)
	}

	remaining := listDrafts(t, svc, 7, 2, "").GetDrafts()
	if len(remaining) != 1 || remaining[0].GetId() != keep {
		t.Fatalf("%d drafts left, want only %d", len(remaining), keep)
	}
}

// The lines go with the draft — a hard delete leaving orphaned lines behind would fill the table
// with rows nothing can ever reach.
func TestOrderDraftDelete_TakesTheLinesWithIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := pushRef(t, svc, 7, "SHP-100")

	deleteDrafts(t, svc, 7, 2, []uint64{draftID})

	var lines int64

	err := db.
		Model(&selling_service_models.OrderDraftItem{}).
		Where("draft_id = ?", draftID).
		Count(&lines).
		Error
	if err != nil {
		t.Fatalf("count lines: %v", err)
	}

	if lines != 0 {
		t.Fatalf("%d orphaned lines survived the delete", lines)
	}
}

// A colleague's id in the batch is SKIPPED, not fatal — but it must also not be deleted. Both halves
// matter: refusing the whole batch would make a bulk prune unusable, and deleting it would let
// anyone in the team wipe somebody else's work by guessing ids.
func TestOrderDraftDelete_SkipsWhatIsNotYours(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mine := pushRef(t, svc, 7, "SHP-100")
	theirs := pushRef(t, svc, 9, "SHP-200")

	if got := deleteDrafts(t, svc, 7, 2, []uint64{mine, theirs}); got != 1 {
		t.Fatalf("deleted = %d, want 1 — a colleague's draft was in the batch", got)
	}

	var survived int64

	err := db.
		Model(&selling_service_models.OrderDraft{}).
		Where("id = ?", theirs).
		Count(&survived).
		Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if survived != 1 {
		t.Fatal("a colleague's draft was deleted")
	}
}

// Deleting is idempotent by nature: an id already gone reports 0 rather than failing, so a retry
// after a lost response is safe.
func TestOrderDraftDelete_AnAlreadyGoneIdIsNotAnError(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := pushRef(t, svc, 7, "SHP-100")

	deleteDrafts(t, svc, 7, 2, []uint64{draftID})

	if got := deleteDrafts(t, svc, 7, 2, []uint64{draftID}); got != 0 {
		t.Fatalf("deleted = %d on the second call, want 0", got)
	}
}
