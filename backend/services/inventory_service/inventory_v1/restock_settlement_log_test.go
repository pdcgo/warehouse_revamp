package inventory_v1_test

import (
	"slices"
	"testing"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// THE SETTLEMENT IN THE RESTOCK'S RIWAYAT (backlog #101 — the owner's 🔄 on a-restock-problem-is-settled-by-resolution-rows):
// one real trail row per resolution, per settle and per reopen, with who and when, written in the transaction of what it
// records and never rewritten — settled → reopened → settled reads all three.

const (
	logKindNone       = inventoryv1.RestockLogKind_RESTOCK_LOG_KIND_UNSPECIFIED
	logKindResolution = inventoryv1.RestockLogKind_RESTOCK_LOG_KIND_RESOLUTION
	logKindSettled    = inventoryv1.RestockLogKind_RESTOCK_LOG_KIND_SETTLED
	logKindReopened   = inventoryv1.RestockLogKind_RESTOCK_LOG_KIND_REOPENED

	changeResolution   = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_RESOLUTION
	changeParcel       = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_PARCEL
	changeParcelShort  = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_PARCEL_SHORT
	changeParcelBroken = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_PARCEL_BROKEN
)

// settlementRows is a restock's trail rows that record its settlement, in the trail's order.
func settlementRows(r *inventoryv1.RestockRequest) []*inventoryv1.RestockLog {
	var out []*inventoryv1.RestockLog

	for _, l := range r.GetLogs() {
		if l.GetKind() != logKindNone {
			out = append(out, l)
		}
	}

	return out
}

func kindsOf(rows []*inventoryv1.RestockLog) []inventoryv1.RestockLogKind {
	out := make([]inventoryv1.RestockLogKind, 0, len(rows))
	for _, l := range rows {
		out = append(out, l.GetKind())
	}

	return out
}

// storedRows counts a restock's `restock_logs` rows of one stored word — what was WRITTEN, not what a read shows.
func (f *csFixture) storedRows(t *testing.T, restockID uint64, word string) int64 {
	t.Helper()

	var n int64

	err := f.db.Raw(`SELECT count(*) FROM restock_logs WHERE restock_id = ? AND description = ?`, restockID, word).
		Scan(&n).Error
	if err != nil {
		t.Fatalf("count trail rows: %v", err)
	}

	return n
}

// Every resolution — a refund, a return (Paket Baru's `resolution` and RestockResolutionCreate's link), a reshipping —
// and the settle each write ONE row, keeping the status, by who did it, naming the resolution; a refused double tap or
// a second settle writes none. The warehouse reads the same rows (they carry no money: the row's id, never its amount).
func TestRestockRiwayat_EachResolutionAndTheSettleIsWrittenOnce(t *testing.T) {
	f := rsStocked(t)

	refund := f.mustResolve(t, rsRefund(f.restock, "riwayat-refund", 65000, accountPlain)).GetResolution()

	_, err := f.resolve(rsRefund(f.restock, "riwayat-refund", 65000, accountPlain))
	if err == nil {
		t.Fatal("a double tap was recorded twice")
	}

	req := f.csReship("riwayat-return", csRestockLine(f.line[csWidget], 2))
	req.Resolution = &inventoryv1.CustomShipmentReturnResolution{Note: "send them back"}
	ret := f.mustCreate(t, req)

	reship := f.mustResolve(t, rsReshipping(f.restock, "riwayat-reship", rsLine(csWidget, 3, 9000))).GetResolution()

	_, err = f.settle(otMelati, f.restock)
	if err != nil {
		t.Fatalf("settle: %v", err)
	}

	_, err = f.settle(otMelati, f.restock)
	if err == nil {
		t.Fatal("settled twice")
	}

	if n := f.storedRows(t, f.restock, "resolution recorded"); n != 3 {
		t.Fatalf("resolution rows written = %d, want 3", n)
	}

	if n := f.storedRows(t, f.restock, "settled"); n != 1 {
		t.Fatalf("settle rows written = %d, want 1", n)
	}

	for _, reader := range []struct{ team, user uint64 }{{otMelati, wtSeller}, {wtA, wtStaffA}} {
		rows := settlementRows(f.restockAs(t, reader.team, reader.user, f.restock))

		want := []inventoryv1.RestockLogKind{logKindResolution, logKindResolution, logKindResolution, logKindSettled}
		if got := kindsOf(rows); !slices.Equal(got, want) {
			t.Fatalf("team %d reads kinds %v, want %v", reader.team, got, want)
		}

		ids := []uint64{refund.GetId(), ret.GetResolutionId(), reship.GetId()}
		for i, id := range ids {
			l := rows[i]
			if l.GetActorUserId() != wtSeller || l.GetAtUnix() == 0 || l.GetIsOverride() ||
				l.GetFromStatus() != l.GetToStatus() ||
				l.GetToStatus() != inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED {
				t.Fatalf("resolution row %d = %v", i, l)
			}

			if len(l.GetChanges()) != 1 || l.GetChanges()[0].GetField() != changeResolution ||
				l.GetChanges()[0].GetAfter() != itoaU(id) {
				t.Fatalf("resolution row %d names %v, want resolution %d", i, l.GetChanges(), id)
			}
		}

		settled := rows[3]
		if settled.GetActorUserId() != wtSeller || settled.GetAtUnix() == 0 || len(settled.GetChanges()) != 0 {
			t.Fatalf("settle row = %v", settled)
		}
	}
}

// A Terima that lifts the settled mark writes the REOPENED row — the counting warehouse member, the parcel, per product
// what was short and broken; settling again writes another SETTLED row, so the trail reads settled → reopened → settled.
// A Terima on a restock NOT settled reopens nothing and writes no row; a whole count on a settled one neither.
func TestRestockRiwayat_SettleReopenSettleReadsThree(t *testing.T) {
	f := rsStocked(t)

	_, err := f.settle(otMelati, f.restock)
	if err != nil {
		t.Fatalf("settle: %v", err)
	}

	// A whole count on the settled restock keeps it settled: no reopen row.
	whole := f.mustResolve(t, rsReshipping(f.restock, "riwayat-whole", rsLine(wtKaosHitam, 2, 5000))).GetCustomShipment()

	_, err = f.receive(whole.GetId(), 0, "", inLine(csItemOf(t, whole, wtKaosHitam).GetId(), 2, 0, f.rakA))
	if err != nil {
		t.Fatalf("receive whole: %v", err)
	}

	if n := f.storedRows(t, f.restock, "reopened"); n != 0 {
		t.Fatalf("a whole count wrote %d reopen rows", n)
	}

	// 3 Widgets sent, 2 in the box, 1 of them broken.
	cs := f.mustResolve(t, rsReshipping(f.restock, "riwayat-short", rsLine(csWidget, 3, 9000))).GetCustomShipment()

	_, err = f.receive(cs.GetId(), 0, "", inLine(csItemOf(t, cs, csWidget).GetId(), 2, 1, f.rakA))
	if err != nil {
		t.Fatalf("receive short: %v", err)
	}

	_, err = f.settle(otMelati, f.restock)
	if err != nil {
		t.Fatalf("settle again: %v", err)
	}

	if n := f.storedRows(t, f.restock, "reopened"); n != 1 {
		t.Fatalf("reopen rows written = %d, want 1", n)
	}

	rows := settlementRows(f.restockAs(t, otMelati, wtSeller, f.restock))

	var marks []*inventoryv1.RestockLog

	for _, l := range rows {
		if l.GetKind() != logKindResolution {
			marks = append(marks, l)
		}
	}

	want := []inventoryv1.RestockLogKind{logKindSettled, logKindReopened, logKindSettled}
	if got := kindsOf(marks); !slices.Equal(got, want) {
		t.Fatalf("the marks read %v, want %v", got, want)
	}

	reopened := marks[1]
	if reopened.GetActorUserId() != wtStaffA || reopened.GetAtUnix() == 0 ||
		reopened.GetFromStatus() != inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ACCEPTED ||
		reopened.GetToStatus() != reopened.GetFromStatus() {
		t.Fatalf("reopen row = %v", reopened)
	}

	changes := reopened.GetChanges()
	if len(changes) != 3 ||
		changes[0].GetField() != changeParcel || changes[0].GetAfter() != itoaU(cs.GetId()) ||
		changes[1].GetField() != changeParcelShort || changes[1].GetProductId() != csWidget || changes[1].GetAfter() != "1" ||
		changes[1].GetProductName() == "" ||
		changes[2].GetField() != changeParcelBroken || changes[2].GetProductId() != csWidget || changes[2].GetAfter() != "1" {
		t.Fatalf("reopen row names %v", changes)
	}

	// Not settled (a lost restock, never marked): a short count reopens nothing, and writes no row.
	unsettled := f.lostRestock(t)
	lostIn := f.mustResolve(t, rsReshipping(unsettled, "riwayat-lost", rsLine(csWidget, 2, 9000))).GetCustomShipment()

	_, err = f.receive(lostIn.GetId(), 0, "", inLine(csItemOf(t, lostIn, csWidget).GetId(), 1, 0, f.rakA))
	if err != nil {
		t.Fatalf("receive on the unsettled: %v", err)
	}

	if n := f.storedRows(t, unsettled, "reopened"); n != 0 {
		t.Fatalf("an unsettled restock wrote %d reopen rows", n)
	}
}
