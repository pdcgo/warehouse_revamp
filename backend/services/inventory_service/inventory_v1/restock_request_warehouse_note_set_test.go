package inventory_v1_test

import (
	"slices"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE RECEIVING WAREHOUSE WRITES ITS OWN NOTE (the-warehouse-writes-its-own-note), ONE WRITER EACH
// (three-notes-one-writer-each, the-notes-are-one-per-writer). The warehouse's note is kept on the restock with its own
// writer and time, beside the selling team's and never in its place; only the receiving warehouse writes it, and both
// sides read it. A changed note is an edit's row on the trail with the warehouse note before and after
// (edits-are-in-the-same-trail); the same note again writes nothing. From which status it may be written is not decided,
// so it is taken in every status — as the warehouse's restock page offers its Ubah.

const (
	wnStaff  uint64 = 14 // a warehouse member writing its note
	wnOther  uint64 = 15 // a second warehouse member
	wnRoot   uint64 = 901
	wnSeller uint64 = 22 // the selling team's note editor
)

var fWarehouseNote = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_WAREHOUSE_NOTE

func wnSet(svc *inventory_v1.Service, user, teamID, requestID uint64, note string) (*inventoryv1.RestockRequest, error) {
	resp, err := svc.RestockRequestWarehouseNoteSet(ctxUser(user), connect.NewRequest(&inventoryv1.RestockRequestWarehouseNoteSetRequest{
		TeamId: teamID, RequestId: requestID, Note: note,
	}))
	if err != nil {
		return nil, err
	}

	return resp.Msg.GetRequest(), nil
}

// wnWriter is who the restock says wrote the warehouse's note, and when.
type wnWriter struct {
	by       uint64
	at       int64
	override bool
}

func wnWriterOf(r *inventoryv1.RestockRequest) wnWriter {
	return wnWriter{r.GetWarehouseNoteByUserId(), r.GetWarehouseNoteAtUnix(), r.GetWarehouseNoteByIsOverride()}
}

// wnDetailAs is the restock as one team's Detail reads it — the selling team's or the receiving warehouse's.
func wnDetailAs(t *testing.T, svc *inventory_v1.Service, teamID, requestID uint64) *inventoryv1.RestockRequest {
	t.Helper()

	detail, err := svc.RestockRequestDetail(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: teamID, RequestId: requestID,
	}))
	if err != nil {
		t.Fatalf("detail as team %d: %v", teamID, err)
	}

	return detail.Msg.GetRequest()
}

// A RAISED RESTOCK CARRIES NO WAREHOUSE NOTE AND NO WRITER: the raise is the selling team's, and the warehouse has
// written nothing yet — nothing is stamped for it.
func TestRestockRequestWarehouseNoteSet_ARaisedRestockHasNone(t *testing.T) {
	db := san_testdb.DB(t)
	svc := nsService(t, db, &sentEvents{})

	got := arrDetail(t, svc, nsRaise(t, svc, "Untuk promo 10.10").GetId())
	if got.GetWarehouseNote() != "" || wnWriterOf(got) != (wnWriter{}) {
		t.Fatalf("a raised restock reads a warehouse note %q by %+v, want none", got.GetWarehouseNote(), wnWriterOf(got))
	}
}

// THE WAREHOUSE'S NOTE IS KEPT IN EVERY STATUS — on its way, at the door, counted in, given up, called off: the screen
// offers its Ubah in each, and when it may be written is not decided. The note, its writer and time move; the selling
// note and its writer, the status, the lines and the money do not, and no money event goes out. The trail gets an edit's
// row in that status, by the warehouse member, with the warehouse note before and after. The SELLING team reads it.
func TestRestockRequestWarehouseNoteSet_KeptWithItsWriterInEveryStatus(t *testing.T) {
	for _, status := range []inventoryv1.RestockRequestStatus{ongoing, statusArrived, accepted, statusLost, cancelled} {
		t.Run(status.String(), func(t *testing.T) {
			db := san_testdb.DB(t)
			sent := &sentEvents{}
			svc := nsService(t, db, sent)

			raised := nsRaise(t, svc, "Untuk promo 10.10")
			nsMoveTo(t, db, svc, raised, status)

			before := arrDetail(t, svc, raised.GetId())
			events := len(sent.events)

			answer, err := wnSet(svc, wnStaff, arrWarehouse, raised.GetId(), "Kardus penyok di sudut — isi aman")
			if err != nil {
				t.Fatalf("warehouse note while %v: %v", status, err)
			}

			if answer.GetWarehouseNote() != "Kardus penyok di sudut — isi aman" || answer.GetStatus() != status ||
				len(answer.GetItems()) != len(before.GetItems()) {
				t.Fatalf("the answer reads warehouse note %q, %v, %d lines — want the new note, %v, %d lines",
					answer.GetWarehouseNote(), answer.GetStatus(), len(answer.GetItems()), status, len(before.GetItems()))
			}

			// Read by the SELLING team.
			got := arrDetail(t, svc, raised.GetId())
			if got.GetWarehouseNote() != "Kardus penyok di sudut — isi aman" || got.GetStatus() != status {
				t.Fatalf("the selling team reads warehouse note %q, %v — want the new note, still %v",
					got.GetWarehouseNote(), got.GetStatus(), status)
			}

			edit := tcLastEdit(t, got, status)
			if edit.GetActorUserId() != wnStaff || edit.GetIsOverride() {
				t.Fatalf("the edit's row is by %d (override %v), want %d", edit.GetActorUserId(), edit.GetIsOverride(), wnStaff)
			}

			if len(got.GetLogs()) != len(before.GetLogs())+1 {
				t.Fatalf("the trail has %d rows, want %d — one edit's row", len(got.GetLogs()), len(before.GetLogs())+1)
			}

			tcExpect(t, tcChangesOf(edit), []tcChange{{fWarehouseNote, 0, "", "", "Kardus penyok di sudut — isi aman"}})

			if w := wnWriterOf(got); w != (wnWriter{wnStaff, edit.GetAtUnix(), false}) {
				t.Fatalf("the warehouse note reads written by %+v, want %d at the edit (%d)", w, wnStaff, edit.GetAtUnix())
			}

			// The selling team's note is its own, untouched: one writer each.
			if got.GetNote() != before.GetNote() || nsWriterOf(got) != nsWriterOf(before) {
				t.Fatalf("the selling note moved: %q by %+v, was %q by %+v",
					got.GetNote(), nsWriterOf(got), before.GetNote(), nsWriterOf(before))
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
				t.Fatalf("the restock moved beyond the warehouse note:\n before %v\n after  %v", before, got)
			}

			if len(sent.events) != events {
				t.Fatalf("a warehouse note published %d event(s) — a note moves no money", len(sent.events)-events)
			}
		})
	}
}

// BOTH SIDES READ IT (the-notes-are-one-per-writer): the receiving warehouse's Detail and both teams' List rows carry the
// note and its writer, as the selling team's Detail does.
func TestRestockRequestWarehouseNoteSet_BothSidesReadIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := nsService(t, db, &sentEvents{})

	raised := nsRaise(t, svc, "Untuk promo 10.10")
	nsMoveTo(t, db, svc, raised, statusArrived)

	_, err := wnSet(svc, wnStaff, arrWarehouse, raised.GetId(), "Diterima Budi, rak B")
	if err != nil {
		t.Fatalf("warehouse note: %v", err)
	}

	want := wnWriterOf(arrDetail(t, svc, raised.GetId()))
	if want.by != wnStaff || want.at == 0 {
		t.Fatalf("the selling team reads the writer %+v, want %d with a time", want, wnStaff)
	}

	if got := wnDetailAs(t, svc, arrWarehouse, raised.GetId()); got.GetWarehouseNote() != "Diterima Budi, rak B" || wnWriterOf(got) != want {
		t.Fatalf("the warehouse reads %q by %+v, want the note by %+v", got.GetWarehouseNote(), wnWriterOf(got), want)
	}

	for _, team := range []uint64{arrSellingTeam, arrWarehouse} {
		list, listErr := svc.RestockRequestList(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestListRequest{
			TeamId: team, Page: page1(),
		}))
		if listErr != nil {
			t.Fatalf("list as team %d: %v", team, listErr)
		}

		var row *inventoryv1.RestockRequest
		for _, item := range list.Msg.GetItems() {
			r, ok := item.GetRestockRequest().GetMapData()[raised.GetId()]
			if ok {
				row = r
			}
		}

		if row == nil || row.GetWarehouseNote() != "Diterima Budi, rak B" || wnWriterOf(row) != want {
			t.Fatalf("team %d's list row reads %v, want the warehouse note by %+v", team, row, want)
		}
	}
}

// A SECOND CHANGE names its own writer and says the note it changed from; CLEARING it is a change like any other — the
// note reads empty, cleared by whoever cleared it.
func TestRestockRequestWarehouseNoteSet_ARewriteAndAClearAreChanges(t *testing.T) {
	db := san_testdb.DB(t)
	svc := nsService(t, db, &sentEvents{})

	raised := nsRaise(t, svc, "Untuk promo 10.10")
	nsMoveTo(t, db, svc, raised, accepted)

	_, err := wnSet(svc, wnStaff, arrWarehouse, raised.GetId(), "Rusak 2")
	if err != nil {
		t.Fatalf("first: %v", err)
	}

	_, err = wnSet(svc, wnOther, arrWarehouse, raised.GetId(), "Rusak 2, sudah difoto")
	if err != nil {
		t.Fatalf("rewrite: %v", err)
	}

	got := arrDetail(t, svc, raised.GetId())
	edit := tcLastEdit(t, got, accepted)
	if wnWriterOf(got) != (wnWriter{wnOther, edit.GetAtUnix(), false}) {
		t.Fatalf("after the rewrite the note reads written by %+v, want %d", wnWriterOf(got), wnOther)
	}

	tcExpect(t, tcChangesOf(edit), []tcChange{{fWarehouseNote, 0, "", "Rusak 2", "Rusak 2, sudah difoto"}})

	_, err = wnSet(svc, wnStaff, arrWarehouse, raised.GetId(), "")
	if err != nil {
		t.Fatalf("clear: %v", err)
	}

	got = arrDetail(t, svc, raised.GetId())
	if got.GetWarehouseNote() != "" || got.GetWarehouseNoteByUserId() != wnStaff {
		t.Fatalf("after the clear: note %q by %d, want empty by %d", got.GetWarehouseNote(), got.GetWarehouseNoteByUserId(), wnStaff)
	}

	tcExpect(t, tcChangesOf(tcLastEdit(t, got, accepted)), []tcChange{{fWarehouseNote, 0, "", "Rusak 2, sudah difoto", ""}})
}

// THE SAME NOTE AGAIN CHANGES NOTHING: no trail row, the row untouched, the note keeps its writer — and an empty note
// on a restock that has none is the same note.
func TestRestockRequestWarehouseNoteSet_AnUnchangedNoteWritesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := nsService(t, db, &sentEvents{})

	raised := nsRaise(t, svc, "Untuk promo 10.10")
	nsMoveTo(t, db, svc, raised, statusArrived)

	for _, c := range []struct {
		name  string
		setup string
		again string
	}{
		{"no note, empty again", "", ""},
		{"a note, the same again", "Diterima Budi", "Diterima Budi"},
	} {
		if c.setup != "" {
			_, err := wnSet(svc, wnStaff, arrWarehouse, raised.GetId(), c.setup)
			if err != nil {
				t.Fatalf("%s: setup: %v", c.name, err)
			}
		}

		before := arrDetail(t, svc, raised.GetId())
		ctid := nsCtid(t, db, raised.GetId())

		_, err := wnSet(svc, wnOther, arrWarehouse, raised.GetId(), c.again)
		if err != nil {
			t.Fatalf("%s: set: %v", c.name, err)
		}

		got := arrDetail(t, svc, raised.GetId())
		if len(got.GetLogs()) != len(before.GetLogs()) {
			t.Fatalf("%s: an unchanged note wrote a trail row (%d rows, want %d)", c.name, len(got.GetLogs()), len(before.GetLogs()))
		}

		if wnWriterOf(got) != wnWriterOf(before) {
			t.Fatalf("%s: an unchanged note now reads written by %+v, want %+v", c.name, wnWriterOf(got), wnWriterOf(before))
		}

		if now := nsCtid(t, db, raised.GetId()); now != ctid {
			t.Fatalf("%s: an unchanged note rewrote the restock row (ctid %s → %s)", c.name, ctid, now)
		}
	}
}

// ONLY THE RECEIVING WAREHOUSE WRITES IT (three-notes-one-writer-each): the selling team that raised it, another
// warehouse and an unknown id all read NotFound — the same answer, so the error confirms nothing — and nothing changes.
func TestRestockRequestWarehouseNoteSet_OnlyTheReceivingWarehouseWritesIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := nsService(t, db, &sentEvents{})

	raised := nsRaise(t, svc, "Untuk promo 10.10")
	nsMoveTo(t, db, svc, raised, statusArrived)

	_, err := wnSet(svc, wnStaff, arrWarehouse, raised.GetId(), "Diterima Budi")
	if err != nil {
		t.Fatalf("warehouse note: %v", err)
	}

	before := arrDetail(t, svc, raised.GetId())

	for _, c := range []struct {
		name      string
		team, req uint64
	}{
		{"the selling team that raised it", arrSellingTeam, raised.GetId()},
		{"another warehouse", arrOtherHouse, raised.GetId()},
		{"an unknown restock", arrWarehouse, raised.GetId() + 1000},
	} {
		_, setErr := wnSet(svc, wnSeller, c.team, c.req, "bukan catatanku")
		if connect.CodeOf(setErr) != connect.CodeNotFound {
			t.Fatalf("%s writing the warehouse note = %v, want NotFound", c.name, setErr)
		}
	}

	got := arrDetail(t, svc, raised.GetId())
	if got.GetWarehouseNote() != before.GetWarehouseNote() || wnWriterOf(got) != wnWriterOf(before) ||
		len(got.GetLogs()) != len(before.GetLogs()) {
		t.Fatalf("a refused warehouse note changed the restock: %q by %+v, %d rows",
			got.GetWarehouseNote(), wnWriterOf(got), len(got.GetLogs()))
	}

	// And the selling team's own note set never reaches the warehouse's note.
	_, err = nsSet(svc, wnSeller, arrSellingTeam, raised.GetId(), "Catatan penjual baru")
	if err != nil {
		t.Fatalf("selling note set: %v", err)
	}

	got = arrDetail(t, svc, raised.GetId())
	if got.GetWarehouseNote() != "Diterima Budi" || wnWriterOf(got) != wnWriterOf(before) {
		t.Fatalf("the selling note set moved the warehouse's: %q by %+v", got.GetWarehouseNote(), wnWriterOf(got))
	}

	for _, c := range tcChangesOf(tcLastEdit(t, got, statusArrived)) {
		if c.field == fWarehouseNote {
			t.Fatalf("the selling note set says the warehouse note changed: %v", c)
		}
	}
}

// THE SELLING TEAM'S EDIT FORM REPLACES ITS OWN FIELDS ONLY: an ongoing edit — a full replace of the restock and its
// lines — leaves the warehouse's note and its writer exactly as they were, and never says it changed.
func TestRestockRequestWarehouseNoteSet_TheSellingEditKeepsIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := nsService(t, db, &sentEvents{})

	raised := nsRaise(t, svc, "Untuk promo 10.10")

	_, err := wnSet(svc, wnStaff, arrWarehouse, raised.GetId(), "Mohon resi dikirim ulang")
	if err != nil {
		t.Fatalf("warehouse note: %v", err)
	}

	before := arrDetail(t, svc, raised.GetId())

	req := tcAsStored(before)
	req.Note = "Urgent"
	req.Items[0].Count = 12

	_, err = svc.RestockRequestUpdate(ctxUser(wnSeller), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("edit: %v", err)
	}

	got := arrDetail(t, svc, raised.GetId())
	if got.GetWarehouseNote() != "Mohon resi dikirim ulang" || wnWriterOf(got) != wnWriterOf(before) {
		t.Fatalf("the selling edit moved the warehouse's note: %q by %+v, was by %+v",
			got.GetWarehouseNote(), wnWriterOf(got), wnWriterOf(before))
	}

	for _, c := range tcChangesOf(tcLastEdit(t, got, ongoing)) {
		if c.field == fWarehouseNote {
			t.Fatalf("the selling edit says the warehouse note changed: %v", c)
		}
	}
}

// Who may write it: the warehouse's roles — any member, as signing for the box — and Root and the Administrator; never a
// selling team's. A write: not marked as a read, so neither an agent nor the monitoring admin team reaches it.
func TestRestockRequestWarehouseNoteSet_Policy(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.RestockRequestWarehouseNoteSetRequest")
	if err != nil {
		t.Fatal(err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatal("RestockRequestWarehouseNoteSetRequest has no policy")
	}

	arrive, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.RestockRequestArriveRequest")
	if err != nil {
		t.Fatal(err)
	}

	want := san_auth.PolicyOf(arrive.(protoreflect.MessageDescriptor)).GetRoles()
	if !slices.Equal(policy.GetRoles(), want) {
		t.Fatalf("roles = %v, want signing for the box's %v", policy.GetRoles(), want)
	}

	for _, r := range policy.GetRoles() {
		switch r {
		case role_basev1.Role_ROLE_SELLING_OWNER, role_basev1.Role_ROLE_SELLING_ADMIN, role_basev1.Role_ROLE_SELLING_CS:
			t.Fatalf("a selling role (%v) may write the warehouse's note", r)
		}
	}

	method, err := protoregistry.GlobalFiles.FindDescriptorByName("warehouse.inventory.v1.RestockRequestService.RestockRequestWarehouseNoteSet")
	if err != nil {
		t.Fatal(err)
	}

	opts, _ := method.(protoreflect.MethodDescriptor).Options().(*descriptorpb.MethodOptions)
	if opts.GetIdempotencyLevel() == descriptorpb.MethodOptions_NO_SIDE_EFFECTS {
		t.Fatal("RestockRequestWarehouseNoteSet writes — it must not be marked NO_SIDE_EFFECTS")
	}
}

// ROOT FROM OUTSIDE THE WAREHOUSE is stamped as the override on the note's writer and on the trail row
// (an-override-is-stamped-in-every-service); Root as a member of the warehouse is not.
func TestRestockRequestWarehouseNoteSet_AnOverrideIsStamped(t *testing.T) {
	db := san_testdb.DB(t)
	svc := nsService(t, db, &sentEvents{})

	raised := nsRaise(t, svc, "Untuk promo 10.10")

	for _, c := range []struct {
		role     role_basev1.Role
		note     string
		override bool
	}{
		{role_basev1.Role_ROLE_UNSPECIFIED, "dari luar gudang", true},
		{role_basev1.Role_ROLE_ROOT, "sebagai anggota", false},
	} {
		_, err := svc.RestockRequestWarehouseNoteSet(ctxAs(wnRoot, arrWarehouse, c.role),
			connect.NewRequest(&inventoryv1.RestockRequestWarehouseNoteSetRequest{
				TeamId: arrWarehouse, RequestId: raised.GetId(), Note: c.note,
			}))
		if err != nil {
			t.Fatalf("warehouse note as %v: %v", c.role, err)
		}

		got := arrDetail(t, svc, raised.GetId())
		edit := tcLastEdit(t, got, ongoing)

		if got.GetWarehouseNoteByUserId() != wnRoot || got.GetWarehouseNoteByIsOverride() != c.override ||
			edit.GetIsOverride() != c.override {
			t.Fatalf("as %v: the note by %d (override %v), its row override %v — want %d, %v",
				c.role, got.GetWarehouseNoteByUserId(), got.GetWarehouseNoteByIsOverride(), edit.GetIsOverride(), wnRoot, c.override)
		}
	}
}
