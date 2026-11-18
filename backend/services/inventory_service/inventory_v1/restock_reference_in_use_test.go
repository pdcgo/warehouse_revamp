package inventory_v1_test

import (
	"errors"
	"os"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A REFERENCE IN USE STOPS THE RESTOCK — on the server (a-reference-in-use-stops-the-restock-form): a resi or an Order
// ID, each on its own, already on another restock of THIS team that is not cancelled, exact but for letter case and the
// spaces around it, is refused AlreadyExists, naming the restock that holds it and its status. Kept by inventory 00048's
// unique indexes; its concurrency half is restock_reference_in_use_race_test.go.

const (
	refTeam      uint64 = 2
	refOtherTeam uint64 = 3
	refWarehouse uint64 = 5
)

var (
	receiptRef = inventoryv1.RestockReference_RESTOCK_REFERENCE_RECEIPT
	invoiceRef = inventoryv1.RestockReference_RESTOCK_REFERENCE_INVOICE_REF
)

// refItems is one line of the team's own product — each team its own, as a restock carries only those.
func refItems(team uint64) []*inventoryv1.RestockRequestItem {
	return []*inventoryv1.RestockRequestItem{{ProductId: 100 + team, ProductCode: "SKU1", Name: "Widget", Count: 1, Total: 100}}
}

// refCreate raises one restock of `team` carrying the two references.
func refCreate(svc *inventory_v1.Service, team uint64, receipt, orderID string) (*inventoryv1.RestockRequest, error) {
	res, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: team, WarehouseId: refWarehouse, Receipt: receipt, InvoiceRefId: orderID, Items: refItems(team),
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetRequest(), nil
}

func mustRefCreate(t *testing.T, svc *inventory_v1.Service, team uint64, receipt, orderID string) *inventoryv1.RestockRequest {
	t.Helper()

	r, err := refCreate(svc, team, receipt, orderID)
	if err != nil {
		t.Fatalf("create %q / %q for team %d: %v", receipt, orderID, team, err)
	}

	return r
}

// refEdit replaces an ongoing restock's references, everything else as it was raised.
func refEdit(svc *inventory_v1.Service, id uint64, receipt, orderID string) error {
	_, err := svc.RestockRequestUpdate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
		TeamId: refTeam, RequestId: id, WarehouseId: refWarehouse, FinanceAccountId: 41,
		Receipt: receipt, InvoiceRefId: orderID, Items: refItems(refTeam),
	}))

	return err
}

// heldIn reads the refusal: AlreadyExists, and its RestockReferenceInUse detail as reference → holder.
func heldIn(t *testing.T, err error) map[inventoryv1.RestockReference]*inventoryv1.RestockReferenceHeld {
	t.Helper()

	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("code = %v (%v), want AlreadyExists", connect.CodeOf(err), err)
	}

	var cerr *connect.Error
	if !errors.As(err, &cerr) {
		t.Fatalf("not a connect error: %v", err)
	}

	out := map[inventoryv1.RestockReference]*inventoryv1.RestockReferenceHeld{}

	for _, d := range cerr.Details() {
		v, valueErr := d.Value()
		if valueErr != nil {
			t.Fatalf("detail: %v", valueErr)
		}

		inUse, ok := v.(*inventoryv1.RestockReferenceInUse)
		if !ok {
			continue
		}

		for _, h := range inUse.GetHeld() {
			out[h.GetReference()] = h
		}
	}

	if len(out) == 0 {
		t.Fatalf("the refusal carries no RestockReferenceInUse: %v", err)
	}

	return out
}

func wantHolder(
	t *testing.T,
	held map[inventoryv1.RestockReference]*inventoryv1.RestockReferenceHeld,
	ref inventoryv1.RestockReference,
	id uint64,
	status inventoryv1.RestockRequestStatus,
) {
	t.Helper()

	h, ok := held[ref]
	if !ok {
		t.Fatalf("%v is not named held: %v", ref, held)
	}

	if h.GetHolderId() != id || h.GetHolderStatus() != status {
		t.Fatalf("%v held by %d (%v), want %d (%v)", ref, h.GetHolderId(), h.GetHolderStatus(), id, status)
	}
}

func setRestockStatus(t *testing.T, db *gorm.DB, id uint64, status string) {
	t.Helper()

	err := db.Exec(`UPDATE restocks SET status = ? WHERE id = ?`, status, id).Error
	if err != nil {
		t.Fatalf("set restock %d %s: %v", id, status, err)
	}
}

// A CREATE: the resi and the Order ID are each judged on their own, letter case and the spaces around them aside, and
// the refusal names the holder by number and status.
func TestRestockReferenceInUse_CreateRefusesAHeldResiOrOrderID(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	holder := mustRefCreate(t, svc, refTeam, "JNT9988776655", "INV/2026/10/0987")

	for name, tc := range map[string]struct {
		receipt, orderID string
		want             []inventoryv1.RestockReference
	}{
		"the resi, in lower case":                {"jnt9988776655", "INV-OTHER-1", []inventoryv1.RestockReference{receiptRef}},
		"the resi, spaces around it":             {"  JNT9988776655 ", "INV-OTHER-2", []inventoryv1.RestockReference{receiptRef}},
		"the Order ID, in lower case and spaced": {"JNE-OTHER-3", " inv/2026/10/0987  ", []inventoryv1.RestockReference{invoiceRef}},
		"both":                                   {"Jnt9988776655", "inv/2026/10/0987", []inventoryv1.RestockReference{receiptRef, invoiceRef}},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := refCreate(svc, refTeam, tc.receipt, tc.orderID)

			held := heldIn(t, err)
			if len(held) != len(tc.want) {
				t.Fatalf("held = %v, want only %v", held, tc.want)
			}

			for _, ref := range tc.want {
				wantHolder(t, held, ref, holder.GetId(), ongoing)
			}

			if !strings.Contains(err.Error(), "#"+idText(holder.GetId())) || !strings.Contains(err.Error(), "ongoing") {
				t.Fatalf("the sentence does not name the holder and its status: %v", err)
			}
		})
	}

	// Each on its own: a resi equal to the other restock's ORDER ID is no duplicate, and nor is a near value.
	mustRefCreate(t, svc, refTeam, "INV/2026/10/0987", "JNT9988776655")
	mustRefCreate(t, svc, refTeam, "JNT99887766550", "INV/2026/10/09870")

	var n int64

	db.Raw(`SELECT count(*) FROM restocks WHERE team_id = ?`, refTeam).Scan(&n)
	if n != 3 {
		t.Fatalf("restocks of the team = %d, want 3 — a refused create wrote a row", n)
	}
}

// Every status but cancelled holds it: an arrived, an accepted and a lost restock hold their resi; a cancelled one holds
// nothing — its parcel never came.
func TestRestockReferenceInUse_EveryStatusButCancelledHolds(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	for _, tc := range []struct {
		status string
		want   inventoryv1.RestockRequestStatus
	}{
		{"arrived", inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_ARRIVED},
		{"accepted", accepted},
		{"lost", inventoryv1.RestockRequestStatus_RESTOCK_REQUEST_STATUS_LOST},
	} {
		receipt := "SCP-" + tc.status
		holder := mustRefCreate(t, svc, refTeam, receipt, "")
		setRestockStatus(t, db, holder.GetId(), tc.status)

		_, err := refCreate(svc, refTeam, strings.ToLower(receipt), "")
		wantHolder(t, heldIn(t, err), receiptRef, holder.GetId(), tc.want)
	}

	// A CANCELLED holder holds nothing — through the real cancel, both references are free again.
	cancelledOne := mustRefCreate(t, svc, refTeam, "JNE0000000001", "INV-CANCEL-1")

	_, err := svc.RestockRequestCancel(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{
		TeamId: refTeam, RequestId: cancelledOne.GetId(),
	}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	again := mustRefCreate(t, svc, refTeam, "jne0000000001", "inv-cancel-1")

	// …and the new one holds them now.
	_, err = refCreate(svc, refTeam, "JNE0000000001", "")
	wantHolder(t, heldIn(t, err), receiptRef, again.GetId(), ongoing)
}

// AN EDIT: the restock being edited is not its own duplicate — saving its own references back, in another case or
// spaced, passes — while taking another restock's is refused, naming that one. A refused edit changes nothing.
func TestRestockReferenceInUse_UpdateIsNotItsOwnDuplicate(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mine := mustRefCreate(t, svc, refTeam, "JNE0123456789", "INV/2026/10/1001")
	theirs := mustRefCreate(t, svc, refTeam, "JNT9988776655", "INV/2026/10/0987")

	err := refEdit(svc, mine.GetId(), " jne0123456789 ", "inv/2026/10/1001")
	if err != nil {
		t.Fatalf("an edit keeping its own references, re-cased: %v", err)
	}

	err = refEdit(svc, mine.GetId(), "JNE0123456789", " INV/2026/10/0987")
	wantHolder(t, heldIn(t, err), invoiceRef, theirs.GetId(), ongoing)

	err = refEdit(svc, mine.GetId(), "jnt9988776655", "INV/2026/10/1001")
	wantHolder(t, heldIn(t, err), receiptRef, theirs.GetId(), ongoing)

	var stored struct {
		Receipt      string
		InvoiceRefID string
	}

	db.Raw(`SELECT receipt, invoice_ref_id FROM restocks WHERE id = ?`, mine.GetId()).Scan(&stored)
	if stored.Receipt != " jne0123456789 " || stored.InvoiceRefID != "inv/2026/10/1001" {
		t.Fatalf("a refused edit changed the restock: %+v", stored)
	}

	// Once the other restock is cancelled, its references are free to take.
	_, err = svc.RestockRequestCancel(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCancelRequest{
		TeamId: refTeam, RequestId: theirs.GetId(),
	}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	err = refEdit(svc, mine.GetId(), "JNT9988776655", "INV/2026/10/0987")
	if err != nil {
		t.Fatalf("taking a cancelled restock's references: %v", err)
	}
}

// NOT ASKED ONCE ARRIVED — the references are closed: an arrived restock's edit of its lines passes, its references
// sent back as stored.
func TestRestockReferenceInUse_AnArrivedEditIsNotAskedAgain(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	r := mustRefCreate(t, svc, refTeam, "JNE5555666677", "INV/2026/09/0050")
	setRestockStatus(t, db, r.GetId(), "arrived")

	_, err := svc.RestockRequestUpdate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestUpdateRequest{
		TeamId: refTeam, RequestId: r.GetId(), WarehouseId: refWarehouse,
		Receipt: "JNE5555666677", InvoiceRefId: "INV/2026/09/0050",
		Items: []*inventoryv1.RestockRequestItem{{ProductId: 100 + refTeam, ProductCode: "SKU1", Name: "Widget", Count: 3, Total: 300}},
	}))
	if err != nil {
		t.Fatalf("an arrived restock's lines edit: %v", err)
	}
}

// EMPTY HOLDS NOTHING — no resi, no Order ID, or only spaces, on as many restocks as there are.
func TestRestockReferenceInUse_AnEmptyReferenceHoldsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	for _, v := range []string{"", "", "   ", " "} {
		mustRefCreate(t, svc, refTeam, v, v)
	}
}

// THIS TEAM'S RESTOCKS ONLY — the rule as decided. Another team's restock holding the same resi is not refused: that
// case is not defined by the decision (the form's pending mark keeps it described), so it is pinned here as what is
// BUILT, not as a rule.
func TestRestockReferenceInUse_AnotherTeamsRestockIsNotJudged(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mustRefCreate(t, svc, refOtherTeam, "SCP7777888899", "INV-77")
	mustRefCreate(t, svc, refTeam, "SCP7777888899", "INV-77")
}

// THE GUARD of 00048: a database where two restocks of one team already share a reference refuses the migration — no
// index made — and the message lists each pair; on a database with none it makes both indexes.
func TestRestockReferenceInUse_MigrationRefusesSharedReferences(t *testing.T) {
	raw, err := os.ReadFile("../db_migrations/00048_restock_references_in_use.sql")
	if err != nil {
		t.Fatalf("the migration: %v", err)
	}

	parts := strings.SplitN(string(raw), "-- +goose Down", 2)
	if len(parts) != 2 {
		t.Fatal("the migration has no Down")
	}

	up, down := parts[0], parts[1]

	indexes := func(db *gorm.DB) int64 {
		var n int64

		db.Raw(`SELECT count(*) FROM pg_indexes WHERE schemaname = current_schema()
			AND indexname IN ('restocks_receipt_in_use_idx', 'restocks_invoice_ref_in_use_idx')`).Scan(&n)

		return n
	}

	t.Run("shared", func(t *testing.T) {
		db := san_testdb.DB(t)

		err := db.Exec(down).Error
		if err != nil {
			t.Fatalf("run the Down: %v", err)
		}

		if indexes(db) != 0 {
			t.Fatal("the Down left an index")
		}

		ids := map[string]uint64{}

		for _, row := range []struct {
			key, status, receipt, orderID string
			team                          uint64
		}{
			{"a", "accepted", "asdasd", "", refTeam},
			{"b", "accepted", " ASDASD", "", refTeam},
			{"c", "cancelled", "asdasd", "INV-9", refTeam},
			{"d", "ongoing", "jne-1", "INV-9", refTeam},
			{"e", "arrived", "jne-2", "inv-9 ", refTeam},
			{"f", "ongoing", "asdasd", "", refOtherTeam},
		} {
			var id uint64

			db.Raw(`INSERT INTO restocks (team_id, warehouse_id, status, receipt, invoice_ref_id) VALUES (?, ?, ?, ?, ?)
				RETURNING id`, row.team, refWarehouse, row.status, row.receipt, row.orderID).Scan(&id)
			if id == 0 {
				t.Fatalf("seed %s", row.key)
			}

			ids[row.key] = id
		}

		err = db.Transaction(func(tx *gorm.DB) error {
			return tx.Exec(up).Error
		})
		if err == nil {
			t.Fatal("the migration made the indexes over shared references")
		}

		for _, says := range []string{
			"team 2 resi 'asdasd': restocks " + idText(ids["a"]) + " accepted, " + idText(ids["b"]) + " accepted",
			"team 2 Order ID 'inv-9': restocks " + idText(ids["d"]) + " ongoing, " + idText(ids["e"]) + " arrived",
		} {
			if !strings.Contains(err.Error(), says) {
				t.Fatalf("the refusal does not list %q: %v", says, err)
			}
		}

		// The cancelled one, and the other team's, are no pair.
		if strings.Contains(err.Error(), idText(ids["c"])+" cancelled") || strings.Contains(err.Error(), "team 3") {
			t.Fatalf("the refusal lists a cancelled or another team's restock: %v", err)
		}

		if indexes(db) != 0 {
			t.Fatal("a refused migration made an index")
		}
	})

	t.Run("none shared", func(t *testing.T) {
		db := san_testdb.DB(t)

		err := db.Exec(down).Error
		if err != nil {
			t.Fatalf("run the Down: %v", err)
		}

		err = db.Exec(up).Error
		if err != nil {
			t.Fatalf("run the Up: %v", err)
		}

		if indexes(db) != 2 {
			t.Fatalf("indexes = %d, want 2", indexes(db))
		}
	})
}
