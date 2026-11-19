package inventory_v1_test

import (
	"slices"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE ADMINS' ACTS (custom-tags-are-shared-system-tags-are-the-admins-and-the-apps and its 🔄 line): Root / the
// Administrator put a system tag on and take it off, rename and delete a tag — custom or theirs — and read how many
// restocks carry each. The app's own problem tags are locked for them too (a-restock-problem-is-a-system-tag: when one
// comes off waits on the problem's solution). Who may call each is the proto's (TestRestockTags_Policy).

func tgSystemSet(svc *inventory_v1.Service, team, requestID, tagID uint64, on bool) ([]*inventoryv1.RestockTag, error) {
	if on {
		res, err := svc.RestockRequestSystemTagAdd(ctxUser(tgRoot), connect.NewRequest(&inventoryv1.RestockRequestSystemTagAddRequest{
			TeamId: team, RequestId: requestID, TagId: tagID,
		}))
		if err != nil {
			return nil, err
		}

		return res.Msg.GetTags(), nil
	}

	res, err := svc.RestockRequestSystemTagRemove(ctxUser(tgRoot), connect.NewRequest(&inventoryv1.RestockRequestSystemTagRemoveRequest{
		TeamId: team, RequestId: requestID, TagId: tagID,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetTags(), nil
}

func tgRename(svc *inventory_v1.Service, tagID uint64, name string) (*inventoryv1.RestockTag, error) {
	res, err := svc.RestockTagRename(ctxUser(tgRoot), connect.NewRequest(&inventoryv1.RestockTagRenameRequest{TagId: tagID, Name: name}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetTag(), nil
}

func tgDelete(svc *inventory_v1.Service, tagID uint64) (uint64, error) {
	res, err := svc.RestockTagDelete(ctxUser(tgRoot), connect.NewRequest(&inventoryv1.RestockTagDeleteRequest{TagId: tagID}))
	if err != nil {
		return 0, err
	}

	return res.Msg.GetRestockCount(), nil
}

// AN ADMIN'S SYSTEM TAG goes on and comes off a restock through either side, in every status — a received and a lost
// restock included; the team's own RPC refuses it (TestRestockRequestTagAdd_ASystemTagIsRefused).
func TestRestockRequestSystemTagAdd_AnAdminTagsEitherSideInEveryStatus(t *testing.T) {
	for _, status := range []inventoryv1.RestockRequestStatus{ongoing, statusArrived, accepted, statusLost, cancelled} {
		t.Run(status.String(), func(t *testing.T) {
			db := san_testdb.DB(t)
			svc := tgService(t, db)

			raised := nsRaise(t, svc, "")
			nsMoveTo(t, db, svc, raised, status)

			audit := seedTag(t, db, "Audit Gudang", "system")

			for _, team := range []uint64{arrSellingTeam, arrWarehouse} {
				on, err := tgSystemSet(svc, team, raised.GetId(), audit, true)
				if err != nil || !slices.Equal(tagNames(on), []string{"Audit Gudang"}) {
					t.Fatalf("admin puts it on through team %d: %v, %v", team, tagNames(on), err)
				}

				if d := tgDetailAs(t, svc, arrSellingTeam, raised.GetId()); !slices.Equal(d, []string{"Audit Gudang"}) {
					t.Fatalf("the seller reads %v", d)
				}

				off, err := tgSystemSet(svc, team, raised.GetId(), audit, false)
				if err != nil || len(off) != 0 {
					t.Fatalf("admin takes it off through team %d: %v, %v", team, tagNames(off), err)
				}
			}
		})
	}
}

// THE APP'S OWN TAGS ARE LOCKED FOR ADMINS TOO — never put on or taken off by hand (FailedPrecondition), never renamed or
// deleted; a custom tag is not the admins' RPC's (InvalidArgument); another team's restock is NotFound.
func TestRestockRequestSystemTagAdd_TheAppsTagsAreLocked(t *testing.T) {
	db := san_testdb.DB(t)
	svc := tgService(t, db)

	raised := nsRaise(t, svc, "")

	for _, task := range []string{taskMissing, taskBroken} {
		tag := appTagID(t, db, task)

		_, err := tgSystemSet(svc, arrWarehouse, raised.GetId(), tag, true)
		if connect.CodeOf(err) != connect.CodeFailedPrecondition {
			t.Fatalf("admin puts %s on: err = %v, want FailedPrecondition", task, err)
		}

		tagOn(t, db, raised.GetId(), tag)

		_, err = tgSystemSet(svc, arrWarehouse, raised.GetId(), tag, false)
		if connect.CodeOf(err) != connect.CodeFailedPrecondition {
			t.Fatalf("admin takes %s off: err = %v, want FailedPrecondition", task, err)
		}

		_, err = tgRename(svc, tag, "Kurang Lagi")
		if connect.CodeOf(err) != connect.CodeFailedPrecondition {
			t.Fatalf("admin renames %s: err = %v, want FailedPrecondition", task, err)
		}

		_, err = tgDelete(svc, tag)
		if connect.CodeOf(err) != connect.CodeFailedPrecondition {
			t.Fatalf("admin deletes %s: err = %v, want FailedPrecondition", task, err)
		}
	}

	if n := tagRowsOf(t, db, raised.GetId()); n != 2 {
		t.Fatalf("the restock carries %d tags, want the app's 2 still on", n)
	}

	if got := tgDetailAs(t, svc, arrSellingTeam, raised.GetId()); !slices.Equal(got, []string{"Barang kurang", "Barang rusak"}) {
		t.Fatalf("the app's tags read %v, want their names unchanged", got)
	}

	custom := seedTag(t, db, "Prioritas", "custom")

	_, err := tgSystemSet(svc, arrWarehouse, raised.GetId(), custom, true)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a custom tag through the admins' RPC: err = %v, want InvalidArgument", err)
	}

	audit := seedTag(t, db, "Audit Gudang", "system")

	_, err = tgSystemSet(svc, nsOtherTeam, raised.GetId(), audit, true)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("another team's restock: err = %v, want NotFound", err)
	}
}

// RENAME: a custom or an admin's system tag; every restock carrying it reads the new name; a change of case alone is a
// rename; a name ANOTHER tag carries, any case, is AlreadyExists and changes nothing; spaces only is InvalidArgument; an
// unknown tag NotFound.
func TestRestockTagRename_OneNameOneTag(t *testing.T) {
	db := san_testdb.DB(t)
	svc := tgService(t, db)

	raised := nsRaise(t, svc, "")
	prioritas := seedTag(t, db, "Prioritas", "custom")
	lebaran := seedTag(t, db, "Lebaran 2026", "custom")
	audit := seedTag(t, db, "Audit Gudang", "system")

	tagOn(t, db, raised.GetId(), prioritas)

	got, err := tgRename(svc, prioritas, "  Sangat   Prioritas ")
	if err != nil || got.GetName() != "Sangat Prioritas" || got.GetId() != prioritas || got.GetType() != tagCustom {
		t.Fatalf("rename = %v, %v", got, err)
	}

	for _, team := range []uint64{arrSellingTeam, arrWarehouse} {
		if d := tgDetailAs(t, svc, team, raised.GetId()); !slices.Equal(d, []string{"Sangat Prioritas"}) {
			t.Fatalf("team %d reads %v after the rename", team, d)
		}
	}

	got, err = tgRename(svc, prioritas, "SANGAT PRIORITAS")
	if err != nil || got.GetName() != "SANGAT PRIORITAS" {
		t.Fatalf("a change of case alone = %v, %v", got, err)
	}

	for _, taken := range []string{"lebaran 2026", "AUDIT gudang", "barang kurang"} {
		_, err = tgRename(svc, prioritas, taken)
		if connect.CodeOf(err) != connect.CodeAlreadyExists {
			t.Fatalf("rename to %q: err = %v, want AlreadyExists", taken, err)
		}
	}

	var row inventory_service_models.Tag

	err = db.First(&row, prioritas).Error
	if err != nil || row.Name != "SANGAT PRIORITAS" {
		t.Fatalf("after the refused renames the tag reads %q (%v)", row.Name, err)
	}

	got, err = tgRename(svc, audit, "Audit Gudang Pusat")
	if err != nil || got.GetType() != tagSystem || got.GetName() != "Audit Gudang Pusat" {
		t.Fatalf("an admin's system tag renamed = %v, %v", got, err)
	}

	_, err = tgRename(svc, lebaran, "   ")
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("spaces only: err = %v, want InvalidArgument", err)
	}

	_, err = tgRename(svc, 999_999, "Apa Saja")
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("an unknown tag: err = %v, want NotFound", err)
	}
}

// DELETE: the tag leaves the list AND comes off every restock carrying it, every team's — the answer says how many; the
// others' tags stay. Again is NotFound.
func TestRestockTagDelete_OffEveryRestock(t *testing.T) {
	db := san_testdb.DB(t)
	svc := tgService(t, db)

	ours := nsRaise(t, svc, "")
	another := nsRaise(t, svc, "")

	theirs := inventory_service_models.Restock{TeamID: nsOtherTeam, WarehouseID: arrOtherHouse, Status: "ongoing"}

	err := db.Create(&theirs).Error
	if err != nil {
		t.Fatal(err)
	}

	prioritas := seedTag(t, db, "Prioritas", "custom")
	lebaran := seedTag(t, db, "Lebaran 2026", "custom")

	for _, id := range []uint64{ours.GetId(), another.GetId(), theirs.ID} {
		tagOn(t, db, id, prioritas)
	}

	tagOn(t, db, ours.GetId(), lebaran)

	off, err := tgDelete(svc, prioritas)
	if err != nil || off != 3 {
		t.Fatalf("delete = %d restocks, %v — want 3", off, err)
	}

	if got := tgDetailAs(t, svc, arrWarehouse, ours.GetId()); !slices.Equal(got, []string{"Lebaran 2026"}) {
		t.Fatalf("our restock reads %v after the delete, want only Lebaran 2026", got)
	}

	if n := tagRowsOf(t, db, theirs.ID); n != 0 {
		t.Fatalf("another team's restock still carries %d tags", n)
	}

	var left int64

	db.Model(&inventory_service_models.Tag{}).Where("id = ?", prioritas).Count(&left)

	if left != 0 {
		t.Fatal("the deleted tag is still on the list")
	}

	_, err = tgDelete(svc, prioritas)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("delete again: err = %v, want NotFound", err)
	}

	unused, err := tgDelete(svc, lebaran)
	if err != nil || unused != 1 {
		t.Fatalf("delete lebaran = %d, %v", unused, err)
	}
}

// THE LIST: every team's tags, the system's first then by name (any case), narrowed by `q` (any case, spaces folded, a
// `%` or `_` literal), paged; RestockTagList carries no count, RestockTagManageList each tag's restocks, every team's.
func TestRestockTagList_TheAppWideList(t *testing.T) {
	db := san_testdb.DB(t)
	svc := tgService(t, db)

	ours := nsRaise(t, svc, "")
	theirs := inventory_service_models.Restock{TeamID: nsOtherTeam, WarehouseID: arrOtherHouse, Status: "ongoing"}

	err := db.Create(&theirs).Error
	if err != nil {
		t.Fatal(err)
	}

	promo := seedTag(t, db, "Barang Promo", "custom")
	seedTag(t, db, "audit gudang", "system")
	seedTag(t, db, "Diskon 50%", "custom")
	seedTag(t, db, "lebaran 2026", "custom")

	tagOn(t, db, ours.GetId(), promo)
	tagOn(t, db, theirs.ID, promo)
	tagOn(t, db, theirs.ID, appTagID(t, db, taskMissing))

	list := func(q string, page, limit uint32) ([]*inventoryv1.RestockTag, uint64) {
		t.Helper()

		res, err := svc.RestockTagList(ctxUser(tgSeller), connect.NewRequest(&inventoryv1.RestockTagListRequest{
			TeamId: arrSellingTeam, Q: q, Page: &commonv1.CommonPagination{Page: page, Limit: limit},
		}))
		if err != nil {
			t.Fatalf("list %q: %v", q, err)
		}

		return res.Msg.GetTags(), res.Msg.GetPageInfo().GetTotalItems()
	}

	all, total := list("", 1, 50)
	want := []string{"audit gudang", "Barang kurang", "Barang rusak", "Barang Promo", "Diskon 50%", "lebaran 2026"}

	if !slices.Equal(tagNames(all), want) || total != 6 {
		t.Fatalf("the list = %v (%d), want %v", tagNames(all), total, want)
	}

	for _, tag := range all {
		if tag.GetRestockCount() != 0 {
			t.Fatalf("RestockTagList counts %q's restocks: %d", tag.GetName(), tag.GetRestockCount())
		}
	}

	for q, w := range map[string][]string{
		"BARANG":           {"Barang kurang", "Barang rusak", "Barang Promo"},
		"  barang  promo ": {"Barang Promo"},
		"%":                {"Diskon 50%"},
		"_":                nil,
		"tidak ada":        nil,
	} {
		got, n := list(q, 1, 50)
		if !slices.Equal(tagNames(got), w) || n != uint64(len(w)) {
			t.Fatalf("q %q = %v (%d), want %v", q, tagNames(got), n, w)
		}
	}

	second, n := list("", 2, 4)
	if !slices.Equal(tagNames(second), want[4:]) || n != 6 {
		t.Fatalf("page 2 of 4 = %v (%d), want %v", tagNames(second), n, want[4:])
	}

	managed, err := svc.RestockTagManageList(ctxUser(tgRoot), connect.NewRequest(&inventoryv1.RestockTagManageListRequest{
		Page: &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatal(err)
	}

	counts := map[string]uint64{}
	for _, tag := range managed.Msg.GetTags() {
		counts[tag.GetName()] = tag.GetRestockCount()
	}

	if !slices.Equal(tagNames(managed.Msg.GetTags()), want) || counts["Barang Promo"] != 2 || counts["Barang kurang"] != 1 ||
		counts["Diskon 50%"] != 0 {
		t.Fatalf("the admins' list = %v, counts %v", tagNames(managed.Msg.GetTags()), counts)
	}
}
