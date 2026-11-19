package inventory_v1_test

import (
	"slices"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A TAG ON A RESTOCK, AND OFF IT (custom-tags-are-shared-system-tags-are-the-admins-and-the-apps): a restock's tags are
// ONE set, put on and taken off by either side that sees it — its selling team and its receiving warehouse — every role
// but a monitor, in EVERY status (the owner's 🔄 under the-restock-tags-prototype-is-accepted). A custom tag through the
// team's RPC; a system tag only through the admins' (RestockRequestSystemTagAdd/Remove), never the app's own by hand.

func tgAdd(svc *inventory_v1.Service, user, team, requestID, tagID uint64) ([]*inventoryv1.RestockTag, error) {
	res, err := svc.RestockRequestTagAdd(ctxUser(user), connect.NewRequest(&inventoryv1.RestockRequestTagAddRequest{
		TeamId: team, RequestId: requestID, TagId: tagID,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetTags(), nil
}

func tgRemove(svc *inventory_v1.Service, user, team, requestID, tagID uint64) ([]*inventoryv1.RestockTag, error) {
	res, err := svc.RestockRequestTagRemove(ctxUser(user), connect.NewRequest(&inventoryv1.RestockRequestTagRemoveRequest{
		TeamId: team, RequestId: requestID, TagId: tagID,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetTags(), nil
}

// tgDetailAs is the restock's tags as one side's Detail reads them.
func tgDetailAs(t *testing.T, svc *inventory_v1.Service, team, requestID uint64) []string {
	t.Helper()

	res, err := svc.RestockRequestDetail(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: team, RequestId: requestID,
	}))
	if err != nil {
		t.Fatalf("detail as %d: %v", team, err)
	}

	return tagNames(res.Msg.GetRequest().GetTags())
}

// tgListRowAs is the restock's tags as one side's List row reads them.
func tgListRowAs(t *testing.T, svc *inventory_v1.Service, team, requestID uint64) []string {
	t.Helper()

	for _, r := range listRows(t, svc, team, nil) {
		if r.GetId() == requestID {
			return tagNames(r.GetTags())
		}
	}

	t.Fatalf("restock %d is not on team %d's list", requestID, team)

	return nil
}

// tgService is the restock service the tag tests raise, sign, count, lose and cancel through.
func tgService(t *testing.T, db *gorm.DB) *inventory_v1.Service {
	t.Helper()

	return nsService(t, db, &sentEvents{})
}

// BOTH SIDES TAG, BOTH SIDES READ ONE SET: the selling team puts *Prioritas* on, the warehouse *Retur ke Supplier*; both
// Details and both List rows read the two, in every screen's order; the warehouse takes the seller's tag off — whoever
// put it on — and both read one. Who put each on, and when, is kept on its row.
func TestRestockRequestTagAdd_BothSidesTagOneSet(t *testing.T) {
	db := san_testdb.DB(t)
	svc := tgService(t, db)

	raised := nsRaise(t, svc, "")
	prioritas := seedTag(t, db, "Prioritas", "custom")
	retur := seedTag(t, db, "Retur ke Supplier", "custom")

	got, err := tgAdd(svc, tgSeller, arrSellingTeam, raised.GetId(), prioritas)
	if err != nil {
		t.Fatalf("the seller tags: %v", err)
	}

	if !slices.Equal(tagNames(got), []string{"Prioritas"}) {
		t.Fatalf("the seller's answer = %v", tagNames(got))
	}

	got, err = tgAdd(svc, tgWarehouse, arrWarehouse, raised.GetId(), retur)
	if err != nil {
		t.Fatalf("the warehouse tags: %v", err)
	}

	want := []string{"Prioritas", "Retur ke Supplier"}
	if !slices.Equal(tagNames(got), want) {
		t.Fatalf("the warehouse's answer = %v, want %v", tagNames(got), want)
	}

	for _, team := range []uint64{arrSellingTeam, arrWarehouse} {
		if d := tgDetailAs(t, svc, team, raised.GetId()); !slices.Equal(d, want) {
			t.Fatalf("team %d's Detail reads %v, want %v", team, d, want)
		}

		if l := tgListRowAs(t, svc, team, raised.GetId()); !slices.Equal(l, want) {
			t.Fatalf("team %d's List row reads %v, want %v", team, l, want)
		}
	}

	var row inventory_service_models.RestockTag

	err = db.Where("restock_id = ? AND tag_id = ?", raised.GetId(), retur).Take(&row).Error
	if err != nil {
		t.Fatal(err)
	}

	if row.AddedByUserID != tgWarehouse || row.AddedByIsOverride || row.AddedAt.IsZero() {
		t.Fatalf("the warehouse's tag reads put on by %d (override %v) at %v", row.AddedByUserID, row.AddedByIsOverride, row.AddedAt)
	}

	got, err = tgRemove(svc, tgWarehouse, arrWarehouse, raised.GetId(), prioritas)
	if err != nil {
		t.Fatalf("the warehouse takes the seller's tag off: %v", err)
	}

	if !slices.Equal(tagNames(got), []string{"Retur ke Supplier"}) {
		t.Fatalf("after the take-off: %v", tagNames(got))
	}

	if d := tgDetailAs(t, svc, arrSellingTeam, raised.GetId()); !slices.Equal(d, []string{"Retur ke Supplier"}) {
		t.Fatalf("the seller reads %v after the warehouse took its tag off", d)
	}
}

// IN EVERY STATUS (the owner's 🔄 under the-restock-tags-prototype-is-accepted: a tag goes on and comes off in every
// status, as the-note-is-edited-in-any-status) — on its way, at the door, RECEIVED (Diterima), LOST and cancelled; by
// either side. Nothing else of the restock moves: its status, its trail, its lines.
func TestRestockRequestTagAdd_InEveryStatus(t *testing.T) {
	for _, status := range []inventoryv1.RestockRequestStatus{ongoing, statusArrived, accepted, statusLost, cancelled} {
		t.Run(status.String(), func(t *testing.T) {
			db := san_testdb.DB(t)
			svc := tgService(t, db)

			raised := nsRaise(t, svc, "")
			nsMoveTo(t, db, svc, raised, status)

			before := arrDetail(t, svc, raised.GetId())
			tag := seedTag(t, db, "Prioritas", "custom")

			for _, side := range []struct{ user, team uint64 }{{tgSeller, arrSellingTeam}, {tgWarehouse, arrWarehouse}} {
				on, err := tgAdd(svc, side.user, side.team, raised.GetId(), tag)
				if err != nil {
					t.Fatalf("team %d tags a %v restock: %v", side.team, status, err)
				}

				if !slices.Equal(tagNames(on), []string{"Prioritas"}) {
					t.Fatalf("team %d's answer = %v", side.team, tagNames(on))
				}

				off, err := tgRemove(svc, side.user, side.team, raised.GetId(), tag)
				if err != nil {
					t.Fatalf("team %d takes a tag off a %v restock: %v", side.team, status, err)
				}

				if len(off) != 0 {
					t.Fatalf("team %d's answer after the take-off = %v", side.team, tagNames(off))
				}
			}

			_, err := tgAdd(svc, tgSeller, arrSellingTeam, raised.GetId(), tag)
			if err != nil {
				t.Fatal(err)
			}

			after := arrDetail(t, svc, raised.GetId())
			if after.GetStatus() != status || len(after.GetLogs()) != len(before.GetLogs()) ||
				len(after.GetItems()) != len(before.GetItems()) || after.GetTotal() != before.GetTotal() {
				t.Fatalf("the restock moved: %v, %d trail rows (was %v, %d)", after.GetStatus(), len(after.GetLogs()), status, len(before.GetLogs()))
			}

			if !slices.Equal(tagNames(after.GetTags()), []string{"Prioritas"}) {
				t.Fatalf("a %v restock reads %v", status, tagNames(after.GetTags()))
			}
		})
	}
}

// ANOTHER TEAM'S RESTOCK reads as one that does not exist — a selling team that did not raise it, a warehouse it is not
// going to — and nothing is written.
func TestRestockRequestTagAdd_AnotherTeamsRestockIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := tgService(t, db)

	raised := nsRaise(t, svc, "")
	tag := seedTag(t, db, "Prioritas", "custom")

	for _, team := range []uint64{nsOtherTeam, arrOtherHouse} {
		_, err := tgAdd(svc, tgSeller, team, raised.GetId(), tag)
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("team %d tags another team's restock: err = %v, want NotFound", team, err)
		}

		tagOn(t, db, raised.GetId(), tag)

		_, err = tgRemove(svc, tgSeller, team, raised.GetId(), tag)
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("team %d takes a tag off another team's restock: err = %v, want NotFound", team, err)
		}

		if n := tagRowsOf(t, db, raised.GetId()); n != 1 {
			t.Fatalf("after team %d's refused calls the restock has %d tags, want the 1 laid", team, n)
		}

		err = db.Where("restock_id = ?", raised.GetId()).Delete(&inventory_service_models.RestockTag{}).Error
		if err != nil {
			t.Fatal(err)
		}
	}

	_, err := tgAdd(svc, tgSeller, arrSellingTeam, 999_999, tag)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("an unknown restock: err = %v, want NotFound", err)
	}

	_, err = tgAdd(svc, tgSeller, arrSellingTeam, raised.GetId(), 999_999)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("an unknown tag: err = %v, want NotFound", err)
	}
}

// A SYSTEM TAG IS NOT A TEAM'S TO MOVE: an admin's system tag and the app's problem tags are PermissionDenied through the
// team's RPC — on and off, for every caller of it — and nothing moves.
func TestRestockRequestTagAdd_ASystemTagIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := tgService(t, db)

	raised := nsRaise(t, svc, "")
	audit := seedTag(t, db, "Audit Gudang", "system")

	for _, tag := range []uint64{audit, appTagID(t, db, taskMissing), appTagID(t, db, taskBroken)} {
		_, err := tgAdd(svc, tgSeller, arrSellingTeam, raised.GetId(), tag)
		if connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("a team puts system tag %d on: err = %v, want PermissionDenied", tag, err)
		}

		tagOn(t, db, raised.GetId(), tag)

		_, err = tgRemove(svc, tgWarehouse, arrWarehouse, raised.GetId(), tag)
		if connect.CodeOf(err) != connect.CodePermissionDenied {
			t.Fatalf("a team takes system tag %d off: err = %v, want PermissionDenied", tag, err)
		}
	}

	if n := tagRowsOf(t, db, raised.GetId()); n != 3 {
		t.Fatalf("the restock carries %d tags, want the 3 laid — a refused call moved one", n)
	}
}

// ALREADY ON IS NO CHANGE, NOT ON IS NO CHANGE: one row, never an error; the answer is the set as it is.
func TestRestockRequestTagAdd_TwiceIsOnce(t *testing.T) {
	db := san_testdb.DB(t)
	svc := tgService(t, db)

	raised := nsRaise(t, svc, "")
	tag := seedTag(t, db, "Prioritas", "custom")

	for range 2 {
		got, err := tgAdd(svc, tgSeller, arrSellingTeam, raised.GetId(), tag)
		if err != nil || len(got) != 1 {
			t.Fatalf("add = %v, %v", tagNames(got), err)
		}
	}

	if n := tagRowsOf(t, db, raised.GetId()); n != 1 {
		t.Fatalf("%d rows after two adds, want 1", n)
	}

	for range 2 {
		got, err := tgRemove(svc, tgWarehouse, arrWarehouse, raised.GetId(), tag)
		if err != nil || len(got) != 0 {
			t.Fatalf("remove = %v, %v", tagNames(got), err)
		}
	}
}

// ROOT FROM OUTSIDE the team is stamped as the override on the tag's row; Root as a member is not.
func TestRestockRequestTagAdd_AnOverrideIsStamped(t *testing.T) {
	db := san_testdb.DB(t)
	svc := tgService(t, db)

	raised := nsRaise(t, svc, "")

	for _, c := range []struct {
		role     role_basev1.Role
		name     string
		override bool
	}{
		{role_basev1.Role_ROLE_UNSPECIFIED, "Dari Luar", true},
		{role_basev1.Role_ROLE_ROOT, "Sebagai Anggota", false},
	} {
		tag := seedTag(t, db, c.name, "custom")

		_, err := svc.RestockRequestTagAdd(ctxAs(tgRoot, arrWarehouse, c.role), connect.NewRequest(&inventoryv1.RestockRequestTagAddRequest{
			TeamId: arrWarehouse, RequestId: raised.GetId(), TagId: tag,
		}))
		if err != nil {
			t.Fatalf("as %v: %v", c.role, err)
		}

		var row inventory_service_models.RestockTag

		err = db.Where("restock_id = ? AND tag_id = ?", raised.GetId(), tag).Take(&row).Error
		if err != nil {
			t.Fatal(err)
		}

		if row.AddedByUserID != tgRoot || row.AddedByIsOverride != c.override {
			t.Fatalf("as %v: put on by %d (override %v), want %d (%v)", c.role, row.AddedByUserID, row.AddedByIsOverride, tgRoot, c.override)
		}
	}
}
