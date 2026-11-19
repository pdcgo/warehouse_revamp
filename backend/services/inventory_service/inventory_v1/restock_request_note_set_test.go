package inventory_v1_test

import (
	"slices"
	"strconv"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE SELLING TEAM'S NOTE HAS ITS OWN WRITER (the-notes-are-one-per-writer) AND IS EDITED IN ANY STATUS
// (the-note-is-edited-in-any-status). The note's writer and time are stamped where the note is written — the raise, an
// edit or a note set that CHANGES it — and never by a write that changes only a line. A note set is taken on its way, at
// the door, and once accepted, lost or cancelled; it moves the note alone and is an edit's row on the trail with the note
// before and after (edits-are-in-the-same-trail). A note written before its writer was kept (00050) reads no writer.

const (
	nsLineEditor uint64 = 21 // changes a line, never the note
	nsNoteEditor uint64 = 22 // changes the note
	nsRoot       uint64 = 900
	nsOtherTeam  uint64 = 99
)

// nsService is the restock service recording what it publishes — a note moves no money, so it publishes nothing.
func nsService(t *testing.T, db *gorm.DB, sent *sentEvents) *inventory_v1.Service {
	t.Helper()

	return inventory_v1.NewService(db, nil, nil, fakeSuppliers{arrMelati: true, arrSinar: true}, sent.send, nil, nil, nil, nil, nil)
}

// nsRaise raises a restock as the buyer with `note` on it — the paying account, a resi of its own, two lines.
func nsRaise(t *testing.T, svc *inventory_v1.Service, note string) *inventoryv1.RestockRequest {
	t.Helper()

	created, err := svc.RestockRequestCreate(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: arrSellingTeam, WarehouseId: arrWarehouse, FinanceAccountId: arrAccount,
		Receipt: "NS-" + strconv.FormatUint(arrReceipts.Add(1), 10), ShipmentCost: 20000,
		Note: note, Items: arrLines(),
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	return created.Msg.GetRequest()
}

func nsSet(svc *inventory_v1.Service, user, teamID, requestID uint64, note string) (*inventoryv1.RestockRequest, error) {
	resp, err := svc.RestockRequestNoteSet(ctxUser(user), connect.NewRequest(&inventoryv1.RestockRequestNoteSetRequest{
		TeamId: teamID, RequestId: requestID, Note: note,
	}))
	if err != nil {
		return nil, err
	}

	return resp.Msg.GetRequest(), nil
}

// nsWriter is who the restock says wrote its note, and when.
type nsWriter struct {
	by       uint64
	at       int64
	override bool
}

func nsWriterOf(r *inventoryv1.RestockRequest) nsWriter {
	return nsWriter{r.GetNoteByUserId(), r.GetNoteAtUnix(), r.GetNoteByIsOverride()}
}

// nsMoveTo puts the raised restock `r` into `status` the way the teams do: the warehouse signs or counts it in, the
// selling team gives it up or calls it off.
func nsMoveTo(t *testing.T, db *gorm.DB, svc *inventory_v1.Service, r *inventoryv1.RestockRequest, status inventoryv1.RestockRequestStatus) {
	t.Helper()

	var err error

	switch status {
	case ongoing:
		return
	case statusArrived:
		_, err = arrSign(svc, arrWarehouse, r.GetId())
	case accepted:
		_, err = svc.RestockRequestAccept(ctxUser(arrCounter), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
			TeamId: arrWarehouse, RequestId: r.GetId(), Lines: allArrived(t, db, r),
		}))
	case statusLost:
		_, err = svc.RestockRequestMarkLost(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestMarkLostRequest{
			TeamId: arrSellingTeam, RequestId: r.GetId(),
		}))
	case cancelled:
		_, err = svc.RestockRequestCancel(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{
			TeamId: arrSellingTeam, RequestId: r.GetId(),
		}))
	default:
		t.Fatalf("no way to %v", status)
	}

	if err != nil {
		t.Fatalf("move to %v: %v", status, err)
	}
}

// THE RAISE WRITES THE NOTE, so its writer is whoever raised it, at the raise's instant — with a note or without one.
// An edit that changes only a line leaves the note's writer and time as they were; an edit that changes the note names
// the person who changed it. The trail's last edit carries the note's change only when the note changed.
func TestRestockRequestNoteSet_TheNoteKeepsItsOwnWriter(t *testing.T) {
	db := san_testdb.DB(t)
	svc := nsService(t, db, &sentEvents{})

	raised := nsRaise(t, svc, "Untuk promo 10.10")

	got := arrDetail(t, svc, raised.GetId())
	if w := nsWriterOf(got); w != (nsWriter{arrBuyer, got.GetCreatedAtUnix(), false}) {
		t.Fatalf("a raised note reads written by %+v, want the raiser %d at the raise (%d)", w, arrBuyer, got.GetCreatedAtUnix())
	}

	blank := arrDetail(t, svc, nsRaise(t, svc, "").GetId())
	if w := nsWriterOf(blank); w.by != arrBuyer || w.at != blank.GetCreatedAtUnix() {
		t.Fatalf("a restock raised with no note reads its note written by %+v, want the raiser at the raise", w)
	}

	raisedBy := nsWriterOf(got)

	// A LINE, only: the note's writer stays the raiser.
	req := tcAsStored(got)
	req.Items[0].Count = 12

	_, err := svc.RestockRequestUpdate(ctxUser(nsLineEditor), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("line edit: %v", err)
	}

	got = arrDetail(t, svc, raised.GetId())
	if w := nsWriterOf(got); w != raisedBy {
		t.Fatalf("after an edit of a line only the note reads written by %+v, want %+v — the line's editor never wrote it", w, raisedBy)
	}

	for _, c := range tcChangesOf(tcLastEdit(t, got, ongoing)) {
		if c.field == fNote {
			t.Fatalf("an edit of a line says the note changed: %v", c)
		}
	}

	// THE NOTE, by the edit form: now the editor wrote it, at the edit.
	req = tcAsStored(got)
	req.Note = "Urgent"

	_, err = svc.RestockRequestUpdate(ctxUser(nsNoteEditor), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("note edit: %v", err)
	}

	got = arrDetail(t, svc, raised.GetId())
	edit := tcLastEdit(t, got, ongoing)

	if w := nsWriterOf(got); w.by != nsNoteEditor || w.at != edit.GetAtUnix() || w.override {
		t.Fatalf("after the note's edit it reads written by %+v, want %d at the edit (%d)", w, nsNoteEditor, edit.GetAtUnix())
	}

	tcExpect(t, tcChangesOf(edit), []tcChange{{fNote, 0, "", "Untuk promo 10.10", "Urgent"}})
}

// A NOTE CHANGED PAST THE RESTOCK'S WAY IS KEPT (the-note-is-edited-in-any-status): in every status — on its way, at the
// door, counted in, given up, called off. The note, its writer and time move; the status, the lines and the money do not,
// and no money event goes out. The trail gets an edit's row in that status with the note before and after.
func TestRestockRequestNoteSet_ALateNoteIsKeptInEveryStatus(t *testing.T) {
	for _, status := range []inventoryv1.RestockRequestStatus{ongoing, statusArrived, accepted, statusLost, cancelled} {
		t.Run(status.String(), func(t *testing.T) {
			db := san_testdb.DB(t)
			sent := &sentEvents{}
			svc := nsService(t, db, sent)

			raised := nsRaise(t, svc, "Untuk promo 10.10")
			nsMoveTo(t, db, svc, raised, status)

			before := arrDetail(t, svc, raised.GetId())
			events := len(sent.events)

			answer, err := nsSet(svc, nsNoteEditor, arrSellingTeam, raised.GetId(), "Stok untuk 11.11 — dicek ulang")
			if err != nil {
				t.Fatalf("note set while %v: %v", status, err)
			}

			if answer.GetNote() != "Stok untuk 11.11 — dicek ulang" || answer.GetStatus() != status ||
				len(answer.GetItems()) != len(before.GetItems()) {
				t.Fatalf("the answer reads note %q, %v, %d lines — want the new note, %v, %d lines",
					answer.GetNote(), answer.GetStatus(), len(answer.GetItems()), status, len(before.GetItems()))
			}

			got := arrDetail(t, svc, raised.GetId())
			if got.GetNote() != "Stok untuk 11.11 — dicek ulang" || got.GetStatus() != status {
				t.Fatalf("stored: note %q, %v — want the new note, still %v", got.GetNote(), got.GetStatus(), status)
			}

			edit := tcLastEdit(t, got, status)
			if edit.GetActorUserId() != nsNoteEditor || edit.GetIsOverride() {
				t.Fatalf("the edit's row is by %d (override %v), want %d", edit.GetActorUserId(), edit.GetIsOverride(), nsNoteEditor)
			}

			if len(got.GetLogs()) != len(before.GetLogs())+1 {
				t.Fatalf("the trail has %d rows, want %d — one edit's row", len(got.GetLogs()), len(before.GetLogs())+1)
			}

			tcExpect(t, tcChangesOf(edit), []tcChange{{fNote, 0, "", "Untuk promo 10.10", "Stok untuk 11.11 — dicek ulang"}})

			if w := nsWriterOf(got); w != (nsWriter{nsNoteEditor, edit.GetAtUnix(), false}) {
				t.Fatalf("the note reads written by %+v, want %d at the edit (%d)", w, nsNoteEditor, edit.GetAtUnix())
			}

			// Nothing else of the restock moved.
			for i, it := range got.GetItems() {
				was := before.GetItems()[i]
				if it.GetCount() != was.GetCount() || it.GetTotal() != was.GetTotal() || it.GetNote() != was.GetNote() ||
					it.GetReceivedCount() != was.GetReceivedCount() {
					t.Fatalf("line %d moved: %v → %v", i, was, it)
				}
			}

			if got.GetReceipt() != before.GetReceipt() || got.GetTotal() != before.GetTotal() ||
				got.GetFinanceAccountId() != before.GetFinanceAccountId() || got.GetArrivedAtUnix() != before.GetArrivedAtUnix() ||
				got.GetAcceptedAtUnix() != before.GetAcceptedAtUnix() || got.GetCreatedByUserId() != before.GetCreatedByUserId() {
				t.Fatalf("the restock moved beyond its note:\n before %v\n after  %v", before, got)
			}

			if len(sent.events) != events {
				t.Fatalf("a note set published %d event(s) — a note moves no money", len(sent.events)-events)
			}
		})
	}
}

// CLEARING THE NOTE is a change like any other: the note reads empty, written (cleared) by whoever cleared it.
func TestRestockRequestNoteSet_ClearingTheNoteIsAChange(t *testing.T) {
	db := san_testdb.DB(t)
	svc := nsService(t, db, &sentEvents{})

	raised := nsRaise(t, svc, "Untuk promo 10.10")
	nsMoveTo(t, db, svc, raised, accepted)

	_, err := nsSet(svc, nsNoteEditor, arrSellingTeam, raised.GetId(), "")
	if err != nil {
		t.Fatalf("clear: %v", err)
	}

	got := arrDetail(t, svc, raised.GetId())
	if got.GetNote() != "" || got.GetNoteByUserId() != nsNoteEditor {
		t.Fatalf("after the clear: note %q by %d, want empty by %d", got.GetNote(), got.GetNoteByUserId(), nsNoteEditor)
	}

	tcExpect(t, tcChangesOf(tcLastEdit(t, got, accepted)), []tcChange{{fNote, 0, "", "Untuk promo 10.10", ""}})
}

// THE SAME NOTE AGAIN CHANGES NOTHING: no trail row, the row untouched, the note keeps its writer.
func TestRestockRequestNoteSet_TheSameNoteWritesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := nsService(t, db, &sentEvents{})

	raised := nsRaise(t, svc, "Untuk promo 10.10")
	nsMoveTo(t, db, svc, raised, statusArrived)

	before := arrDetail(t, svc, raised.GetId())
	ctid := nsCtid(t, db, raised.GetId())

	_, err := nsSet(svc, nsNoteEditor, arrSellingTeam, raised.GetId(), "Untuk promo 10.10")
	if err != nil {
		t.Fatalf("note set: %v", err)
	}

	got := arrDetail(t, svc, raised.GetId())
	if len(got.GetLogs()) != len(before.GetLogs()) {
		t.Fatalf("an unchanged note wrote a trail row (%d rows, want %d)", len(got.GetLogs()), len(before.GetLogs()))
	}

	if nsWriterOf(got) != nsWriterOf(before) {
		t.Fatalf("an unchanged note now reads written by %+v, want %+v", nsWriterOf(got), nsWriterOf(before))
	}

	if now := nsCtid(t, db, raised.GetId()); now != ctid {
		t.Fatalf("an unchanged note rewrote the restock row (ctid %s → %s)", ctid, now)
	}
}

// nsCtid is the restock row's physical address — any UPDATE moves it, while NOW() stands still inside the test's one
// transaction.
func nsCtid(t *testing.T, db *gorm.DB, id uint64) string {
	t.Helper()

	var ctid string

	err := db.
		Raw(`SELECT ctid::text FROM restocks WHERE id = ?`, id).
		Scan(&ctid).
		Error
	if err != nil {
		t.Fatalf("ctid: %v", err)
	}

	return ctid
}

// ONLY THE RAISING TEAM WRITES ITS NOTE (three-notes-one-writer-each): the receiving warehouse, another selling team and
// an unknown id all read NotFound — the same answer, so the error confirms nothing — and nothing changes.
func TestRestockRequestNoteSet_OnlyTheRaisingTeamWritesIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := nsService(t, db, &sentEvents{})

	raised := nsRaise(t, svc, "Untuk promo 10.10")
	nsMoveTo(t, db, svc, raised, accepted)
	before := arrDetail(t, svc, raised.GetId())

	for _, c := range []struct {
		name      string
		team, req uint64
	}{
		{"the receiving warehouse", arrWarehouse, raised.GetId()},
		{"another selling team", nsOtherTeam, raised.GetId()},
		{"an unknown restock", arrSellingTeam, raised.GetId() + 1000},
	} {
		_, err := nsSet(svc, nsNoteEditor, c.team, c.req, "bukan catatanku")
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("%s writing the note = %v, want NotFound", c.name, err)
		}
	}

	got := arrDetail(t, svc, raised.GetId())
	if got.GetNote() != before.GetNote() || nsWriterOf(got) != nsWriterOf(before) || len(got.GetLogs()) != len(before.GetLogs()) {
		t.Fatalf("a refused note set changed the restock: note %q by %+v, %d rows", got.GetNote(), nsWriterOf(got), len(got.GetLogs()))
	}
}

// Who may write it: the selling team's roles — Update's — and Root and the Administrator; never the warehouse's. A write:
// not marked as a read, so neither an agent nor the monitoring admin team reaches it.
func TestRestockRequestNoteSet_Policy(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.RestockRequestNoteSetRequest")
	if err != nil {
		t.Fatal(err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatal("RestockRequestNoteSetRequest has no policy")
	}

	update, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.RestockRequestUpdateRequest")
	if err != nil {
		t.Fatal(err)
	}

	want := san_auth.PolicyOf(update.(protoreflect.MessageDescriptor)).GetRoles()
	if !slices.Equal(policy.GetRoles(), want) {
		t.Fatalf("roles = %v, want the edit's %v", policy.GetRoles(), want)
	}

	for _, r := range policy.GetRoles() {
		switch r {
		case role_basev1.Role_ROLE_WAREHOUSE_OWNER, role_basev1.Role_ROLE_WAREHOUSE_ADMIN, role_basev1.Role_ROLE_WAREHOUSE_STAFF:
			t.Fatalf("a warehouse role (%v) may write the selling team's note", r)
		}
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.RestockRequestService.RestockRequestNoteSet")
	if err != nil {
		t.Fatal(err)
	}

	opts, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() == descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatal("RestockRequestNoteSet writes — it must not be marked NO_SIDE_EFFECTS")
	}
}

// ROOT FROM OUTSIDE THE TEAM is stamped as the override on the note's writer and on the trail row
// (an-override-is-stamped-in-every-service); Root as a member of the team is not.
func TestRestockRequestNoteSet_AnOverrideIsStamped(t *testing.T) {
	db := san_testdb.DB(t)
	svc := nsService(t, db, &sentEvents{})

	raised := nsRaise(t, svc, "Untuk promo 10.10")

	for _, c := range []struct {
		role     role_basev1.Role
		note     string
		override bool
	}{
		{role_basev1.Role_ROLE_UNSPECIFIED, "dari luar tim", true},
		{role_basev1.Role_ROLE_ROOT, "sebagai anggota", false},
	} {
		_, err := svc.RestockRequestNoteSet(ctxAs(nsRoot, arrSellingTeam, c.role), connect.NewRequest(&inventoryv1.RestockRequestNoteSetRequest{
			TeamId: arrSellingTeam, RequestId: raised.GetId(), Note: c.note,
		}))
		if err != nil {
			t.Fatalf("note set as %v: %v", c.role, err)
		}

		got := arrDetail(t, svc, raised.GetId())
		edit := tcLastEdit(t, got, ongoing)

		if got.GetNoteByUserId() != nsRoot || got.GetNoteByIsOverride() != c.override || edit.GetIsOverride() != c.override {
			t.Fatalf("as %v: the note by %d (override %v), its row override %v — want %d, %v",
				c.role, got.GetNoteByUserId(), got.GetNoteByIsOverride(), edit.GetIsOverride(), nsRoot, c.override)
		}
	}
}

// A NOTE WRITTEN BEFORE ITS WRITER WAS KEPT (a restock as 00050 left it: 0, false, NULL) reads no writer — 0 and 0, for
// the screen to fall back on — and an edit of a line never invents one. The next change of the note names its writer.
func TestRestockDetail_ANoteWrittenBeforeItsWriterWasKeptReadsNoWriter(t *testing.T) {
	db := san_testdb.DB(t)
	svc := nsService(t, db, &sentEvents{})

	raised := nsRaise(t, svc, "Stok bulanan")

	err := db.
		Exec(`UPDATE restocks SET note_by_user_id = 0, note_by_is_override = false, note_at = NULL WHERE id = ?`, raised.GetId()).
		Error
	if err != nil {
		t.Fatalf("age the row: %v", err)
	}

	got := arrDetail(t, svc, raised.GetId())
	if got.GetNote() != "Stok bulanan" || nsWriterOf(got) != (nsWriter{}) {
		t.Fatalf("an old note reads %q written by %+v, want the note with no writer", got.GetNote(), nsWriterOf(got))
	}

	req := tcAsStored(got)
	req.Items[0].Count = 12

	_, err = svc.RestockRequestUpdate(ctxUser(nsLineEditor), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("line edit: %v", err)
	}

	if w := nsWriterOf(arrDetail(t, svc, raised.GetId())); w != (nsWriter{}) {
		t.Fatalf("an edit of a line gave the old note a writer: %+v", w)
	}

	_, err = nsSet(svc, nsNoteEditor, arrSellingTeam, raised.GetId(), "Stok bulanan — November")
	if err != nil {
		t.Fatalf("note set: %v", err)
	}

	if w := nsWriterOf(arrDetail(t, svc, raised.GetId())); w.by != nsNoteEditor || w.at == 0 {
		t.Fatalf("after its next change the note reads written by %+v, want %d", w, nsNoteEditor)
	}
}

// AT THE DOOR THE EDIT FORM STILL CHANGES THE LINES ONLY (the-lines-stay-editable-until-accepted): a note changed through
// the full update is refused as before, and nothing moves — the note past the restock's way is the note set's.
func TestRestockRequestUpdate_AnArrivedEditStillRefusesTheNote(t *testing.T) {
	db := san_testdb.DB(t)
	svc := nsService(t, db, &sentEvents{})

	raised := nsRaise(t, svc, "Untuk promo 10.10")
	nsMoveTo(t, db, svc, raised, statusArrived)
	before := arrDetail(t, svc, raised.GetId())

	req := tcAsStored(before)
	req.Note = "lewat form"

	_, err := svc.RestockRequestUpdate(ctxUser(nsNoteEditor), connect.NewRequest(req))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a note through the arrived edit = %v, want FailedPrecondition", err)
	}

	got := arrDetail(t, svc, raised.GetId())
	if got.GetNote() != before.GetNote() || nsWriterOf(got) != nsWriterOf(before) {
		t.Fatalf("a refused edit moved the note: %q by %+v", got.GetNote(), nsWriterOf(got))
	}
}

// ON ITS WAY, TOO, THE NOTE IS SAVED ALONE (the-note-is-edited-in-any-status): the Catatan dialog — or the restock page —
// read the restock, and while it stood open a colleague changed a line through the edit form. The note's save then sends
// the note and nothing else, so the colleague's line stays as they left it; the note changes, the trail gains one edit's
// row saying only the note before and after, and the colleague's own row stays the line's.
//
// nsSaveFromTheDialog is that save as the screen sends it: `opened` is the restock as the dialog read it.
func nsSaveFromTheDialog(svc *inventory_v1.Service, opened *inventoryv1.RestockRequest, note string) error {
	_, err := nsSet(svc, nsNoteEditor, arrSellingTeam, opened.GetId(), note)

	return err
}

func TestRestockRequestNoteSet_OnItsWayALineEditMadeWhileTheNoteWasOpenIsKept(t *testing.T) {
	db := san_testdb.DB(t)
	sent := &sentEvents{}
	svc := nsService(t, db, sent)

	raised := nsRaise(t, svc, "Untuk promo 10.10")

	// The dialog opens: the restock as it reads now.
	opened := arrDetail(t, svc, raised.GetId())

	// A colleague changes a line through the edit form while it stands open: Kaos 10 → 12.
	req := tcAsStored(opened)
	req.Items[0].Count = 12

	_, err := svc.RestockRequestUpdate(ctxUser(nsLineEditor), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("the colleague's line edit: %v", err)
	}

	afterColleague := arrDetail(t, svc, raised.GetId())
	events := len(sent.events)

	err = nsSaveFromTheDialog(svc, opened, "Urgent")
	if err != nil {
		t.Fatalf("the note's save: %v", err)
	}

	got := arrDetail(t, svc, raised.GetId())
	if got.GetStatus() != ongoing || got.GetNote() != "Urgent" {
		t.Fatalf("after the save: %v, note %q — want still on its way, note %q", got.GetStatus(), got.GetNote(), "Urgent")
	}

	// THE COLLEAGUE'S LINE IS KEPT — and every line is the one their edit left, under the same id.
	if len(got.GetItems()) != len(afterColleague.GetItems()) {
		t.Fatalf("after the save %d lines, want the %d the colleague left", len(got.GetItems()), len(afterColleague.GetItems()))
	}

	for i, it := range got.GetItems() {
		was := afterColleague.GetItems()[i]
		if it.GetId() != was.GetId() || it.GetProductId() != was.GetProductId() || it.GetCount() != was.GetCount() ||
			it.GetTotal() != was.GetTotal() || it.GetNote() != was.GetNote() {
			t.Fatalf("line %d moved under the note's save: %v → %v — the colleague's edit was written over", i, was, it)
		}
	}

	if got.GetItems()[0].GetCount() != 12 {
		t.Fatalf("Kaos reads %d, want the colleague's 12", got.GetItems()[0].GetCount())
	}

	if got.GetTotal() != afterColleague.GetTotal() || got.GetReceipt() != afterColleague.GetReceipt() ||
		got.GetFinanceAccountId() != afterColleague.GetFinanceAccountId() {
		t.Fatalf("the restock moved beyond its note:\n before %v\n after  %v", afterColleague, got)
	}

	// The trail: the colleague's row says the line, the save's row says the note alone, by whoever saved it.
	if len(got.GetLogs()) != len(afterColleague.GetLogs())+1 {
		t.Fatalf("the trail has %d rows, want %d — the note's one row", len(got.GetLogs()), len(afterColleague.GetLogs())+1)
	}

	edit := tcLastEdit(t, got, ongoing)
	if edit.GetActorUserId() != nsNoteEditor {
		t.Fatalf("the note's row is by %d, want %d", edit.GetActorUserId(), nsNoteEditor)
	}

	tcExpect(t, tcChangesOf(edit), []tcChange{{fNote, 0, "", "Untuk promo 10.10", "Urgent"}})
	tcExpect(t, tcChangesOf(got.GetLogs()[len(got.GetLogs())-2]), []tcChange{{fCount, 100, "Kaos", "10", "12"}})

	if w := nsWriterOf(got); w != (nsWriter{nsNoteEditor, edit.GetAtUnix(), false}) {
		t.Fatalf("the note reads written by %+v, want %d at its row (%d)", w, nsNoteEditor, edit.GetAtUnix())
	}

	if len(sent.events) != events {
		t.Fatalf("the note's save published %d event(s) — a note moves no money", len(sent.events)-events)
	}
}

// …AND THE RIWAYAT READS AS IT DID: on its way, the note saved alone writes the same row the edit form's note-only change
// writes — an edit's row in that status, the bare word, the person and the override, ONE change, the note before and
// after — and stamps the note's writer the same way. Two restocks raised alike: one's note changed through the edit
// form, the other's through the note set.
func TestRestockRequestNoteSet_OnItsWayItsRowIsTheEditFormsNoteRow(t *testing.T) {
	db := san_testdb.DB(t)
	sent := &sentEvents{}
	svc := nsService(t, db, sent)

	byForm := arrDetail(t, svc, nsRaise(t, svc, "Untuk promo 10.10").GetId())
	byNote := arrDetail(t, svc, nsRaise(t, svc, "Untuk promo 10.10").GetId())
	events := len(sent.events)

	req := tcAsStored(byForm)
	req.Note = "Urgent"

	_, err := svc.RestockRequestUpdate(ctxUser(nsNoteEditor), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("the edit form's note change: %v", err)
	}

	_, err = nsSet(svc, nsNoteEditor, arrSellingTeam, byNote.GetId(), "Urgent")
	if err != nil {
		t.Fatalf("the note set: %v", err)
	}

	formGot := arrDetail(t, svc, byForm.GetId())
	noteGot := arrDetail(t, svc, byNote.GetId())

	if len(formGot.GetLogs()) != len(noteGot.GetLogs()) {
		t.Fatalf("the edit form left %d trail rows, the note set %d", len(formGot.GetLogs()), len(noteGot.GetLogs()))
	}

	formRow := tcLastEdit(t, formGot, ongoing)
	noteRow := tcLastEdit(t, noteGot, ongoing)

	if formRow.GetActorUserId() != noteRow.GetActorUserId() || formRow.GetIsOverride() != noteRow.GetIsOverride() ||
		formRow.GetDescription() != noteRow.GetDescription() {
		t.Fatalf("the rows differ:\n edit form %v\n note set  %v", formRow, noteRow)
	}

	tcExpect(t, tcChangesOf(noteRow), tcChangesOf(formRow))

	formBy, noteBy := nsWriterOf(formGot), nsWriterOf(noteGot)
	if formBy.by != noteBy.by || formBy.override != noteBy.override || formBy.at != formRow.GetAtUnix() ||
		noteBy.at != noteRow.GetAtUnix() {
		t.Fatalf("the note's writer differs: edit form %+v (row at %d), note set %+v (row at %d)",
			formBy, formRow.GetAtUnix(), noteBy, noteRow.GetAtUnix())
	}

	if len(sent.events) != events {
		t.Fatalf("a note change published %d event(s) — a note moves no money", len(sent.events)-events)
	}
}
