package inventory_v1_test

import (
	"fmt"
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// AN EDIT'S TRAIL ROW SAYS WHAT CHANGED (edits-are-in-the-same-trail): the status stays where it was and, under the
// row, every field the edit moved, before and after — *Kaos 10 → 12, extra stock* — read back by Detail, the screen with
// the trail on it. A line added once the box is in names itself and, if given, its supplier
// (a-line-added-after-arrival-names-its-supplier). An edit written before the changes were kept reads as it always did.

// tcChange is one change as a reader sees it.
type tcChange struct {
	field   inventoryv1.RestockLogChangeField
	product uint64
	name    string
	before  string
	after   string
}

func (c tcChange) String() string {
	return fmt.Sprintf("%s #%d %q %q→%q", c.field, c.product, c.name, c.before, c.after)
}

func tcChangesOf(l *inventoryv1.RestockLog) []tcChange {
	out := make([]tcChange, 0, len(l.GetChanges()))
	for _, c := range l.GetChanges() {
		out = append(out, tcChange{c.GetField(), c.GetProductId(), c.GetProductName(), c.GetBefore(), c.GetAfter()})
	}

	return out
}

func tcExpect(t *testing.T, got, want []tcChange) {
	t.Helper()

	if len(got) != len(want) {
		t.Fatalf("the edit's row says %d changes, want %d:\n got  %v\n want %v", len(got), len(want), got, want)
	}

	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("change %d reads %v, want %v\n got  %v\n want %v", i, got[i], want[i], got, want)
		}
	}
}

// tcLastEdit is the trail's last row, which must be an edit: the status it was in, twice, and the bare word.
func tcLastEdit(t *testing.T, r *inventoryv1.RestockRequest, status inventoryv1.RestockRequestStatus) *inventoryv1.RestockLog {
	t.Helper()

	logs := r.GetLogs()
	if len(logs) == 0 {
		t.Fatalf("the restock has no trail")
	}

	last := logs[len(logs)-1]
	if last.GetFromStatus() != status || last.GetToStatus() != status || last.GetDescription() != "edited" {
		t.Fatalf("the last trail row reads %v → %v %q, want an edit (%v → %v, \"edited\")",
			last.GetFromStatus(), last.GetToStatus(), last.GetDescription(), status, status)
	}

	return last
}

const (
	fUnspecified = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_UNSPECIFIED
	tcStoreOld   = uint64(312) // Melati's store
	tcStoreNew   = uint64(321) // Sinar's store
)

var (
	fWarehouse    = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_WAREHOUSE
	fReceipt      = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_RECEIPT
	fReceiptFile  = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_RECEIPT_FILE
	fShipment     = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_SHIPMENT
	fInvoiceRef   = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_INVOICE_REF
	fAccount      = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_FINANCE_ACCOUNT
	fShipmentCost = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_SHIPMENT_COST
	fNote         = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_NOTE
	fAdded        = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_LINE_ADDED
	fRemoved      = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_LINE_REMOVED
	fCount        = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_LINE_COUNT
	fTotal        = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_LINE_TOTAL
	fLineNote     = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_LINE_NOTE
	fSupplier     = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_LINE_SUPPLIER
	fStore        = inventoryv1.RestockLogChangeField_RESTOCK_LOG_CHANGE_FIELD_LINE_STORE
)

// tcService knows Melati and Sinar, each with a live store.
func tcService(t *testing.T, db *gorm.DB) *inventory_v1.Service {
	t.Helper()

	return newServiceWithStores(t, db, fakeSuppliers{arrMelati: true, arrSinar: true}, map[uint64]inventory_v1.SupplierStore{
		tcStoreOld: {SupplierID: arrMelati, Live: true},
		tcStoreNew: {SupplierID: arrSinar, Live: true},
	})
}

// tcAsStored is the update that sends the restock back exactly as Detail reads it — what the form sends before anyone
// types — for a test to change one thing on.
func tcAsStored(r *inventoryv1.RestockRequest) *inventoryv1.RestockRequestUpdateRequest {
	items := make([]*inventoryv1.RestockRequestItem, 0, len(r.GetItems()))
	for _, it := range r.GetItems() {
		items = append(items, &inventoryv1.RestockRequestItem{
			ProductId: it.GetProductId(), ProductCode: it.GetProductCode(), Name: it.GetName(),
			Count: it.GetCount(), Total: it.GetTotal(), Note: it.GetNote(),
			SupplierId: it.GetSupplierId(), SupplierChannelId: it.GetSupplierChannelId(),
		})
	}

	return &inventoryv1.RestockRequestUpdateRequest{
		TeamId: arrSellingTeam, RequestId: r.GetId(),
		WarehouseId: r.GetWarehouseId(), Receipt: r.GetReceipt(), ReceiptFile: r.GetReceiptFile(),
		ShipmentId: r.GetShipmentId(), InvoiceRefId: r.GetInvoiceRefId(), FinanceAccountId: r.GetFinanceAccountId(),
		ShipmentCost: r.GetShipmentCost(), Note: r.GetNote(), Items: items,
	}
}

func tcUpdate(t *testing.T, svc *inventory_v1.Service, req *inventoryv1.RestockRequestUpdateRequest) {
	t.Helper()

	_, err := svc.RestockRequestUpdate(ctxUser(arrBuyer), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("update: %v", err)
	}
}

// AN ONGOING EDIT — the restock's own fields and its lines, every one that moved: each said once, before and after, the
// restock's fields first, then the lines in the order sent, then the line taken out. What only follows from the others
// (a unit price, the totals) and a line's name are not changes of their own.
func TestRestockRequestUpdate_TheTrailSaysWhatAnOngoingEditChanged(t *testing.T) {
	db := san_testdb.DB(t)
	svc := tcService(t, db)

	created, err := svc.RestockRequestCreate(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: arrSellingTeam, WarehouseId: arrWarehouse, FinanceAccountId: arrAccount,
		Receipt: "TC-OLD-" + strconv.FormatUint(arrReceipts.Add(1), 10), ReceiptFile: "doc-old", ShipmentId: 91,
		InvoiceRefId: "INV/OLD", ShipmentCost: 20000,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, ProductCode: "SKU-KAOS", Name: "Kaos", Count: 10, Total: 100000, SupplierId: arrMelati, SupplierChannelId: tcStoreOld},
			{ProductId: 200, ProductCode: "SKU-CELANA", Name: "Celana", Count: 5, Total: 150000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	raised := created.Msg.GetRequest()

	req := tcAsStored(raised)
	newReceipt := "TC-NEW-" + strconv.FormatUint(arrReceipts.Add(1), 10)
	req.WarehouseId = arrOtherHouse
	req.Receipt = newReceipt
	req.ReceiptFile = "doc-new"
	req.ShipmentId = 92
	req.InvoiceRefId = "INV/NEW"
	req.FinanceAccountId = arrAccount + 1
	req.ShipmentCost = 25000.5
	req.Note = "urgent"
	req.Items = []*inventoryv1.RestockRequestItem{
		{
			ProductId: 100, ProductCode: "SKU-KAOS", Name: "Kaos", Count: 12, Total: 120000, Note: "extra stock",
			SupplierId: arrSinar, SupplierChannelId: tcStoreNew,
		},
		{ProductId: 300, ProductCode: "SKU-TOPI", Name: "Topi", Count: 2, Total: 30000, Note: "came in the box", SupplierId: arrSinar},
	}
	tcUpdate(t, svc, req)

	got := arrDetail(t, svc, raised.GetId())
	edit := tcLastEdit(t, got, ongoing)

	tcExpect(t, tcChangesOf(edit), []tcChange{
		{fWarehouse, 0, "", "5", "6"},
		{fReceipt, 0, "", raised.GetReceipt(), newReceipt},
		{fReceiptFile, 0, "", "doc-old", "doc-new"},
		{fShipment, 0, "", "91", "92"},
		{fInvoiceRef, 0, "", "INV/OLD", "INV/NEW"},
		{fAccount, 0, "", "7", "8"},
		{fShipmentCost, 0, "", "20000", "25000.5"},
		{fNote, 0, "", "", "urgent"},
		{fCount, 100, "Kaos", "10", "12"},
		{fTotal, 100, "Kaos", "100000", "120000"},
		{fLineNote, 100, "Kaos", "", "extra stock"},
		{fSupplier, 100, "Kaos", "31", "32"},
		{fStore, 100, "Kaos", "312", "321"},
		{fAdded, 300, "Topi", "", "2"},
		{fTotal, 300, "Topi", "", "30000"},
		{fLineNote, 300, "Topi", "", "came in the box"},
		{fSupplier, 300, "Topi", "", "32"},
		{fRemoved, 200, "Celana", "5", ""},
	})

	// Only the edit's row carries changes: the create says it was raised, nothing more.
	if n := len(got.GetLogs()[0].GetChanges()); n != 0 {
		t.Fatalf("the create's row carries %d changes, want none", n)
	}
}

// AN ARRIVED EDIT — 12 in a box of 10, said why, and a product nobody ordered turned up: the lines only (the restock's
// own fields are closed now), and the added line names its supplier and store.
func TestRestockRequestUpdate_TheTrailSaysWhatAnArrivedEditChanged(t *testing.T) {
	db := san_testdb.DB(t)
	svc := tcService(t, db)

	raised := arrRaise(t, svc)

	_, err := arrSign(svc, arrWarehouse, raised.GetId())
	if err != nil {
		t.Fatalf("arrive: %v", err)
	}

	req := tcAsStored(arrDetail(t, svc, raised.GetId()))
	req.Items[0].Count = 12
	req.Items[0].Total = 120000
	req.Items[0].Note = "extra stock"
	req.Items = append(req.Items, &inventoryv1.RestockRequestItem{
		ProductId: 300, ProductCode: "SKU-TOPI", Name: "Topi", Count: 2, Total: 0,
		SupplierId: arrSinar, SupplierChannelId: tcStoreNew, Note: "came in the box",
	})
	tcUpdate(t, svc, req)

	edit := tcLastEdit(t, arrDetail(t, svc, raised.GetId()), statusArrived)

	tcExpect(t, tcChangesOf(edit), []tcChange{
		{fCount, 100, "Kaos", "10", "12"},
		{fTotal, 100, "Kaos", "100000", "120000"},
		{fLineNote, 100, "Kaos", "", "extra stock"},
		{fAdded, 300, "Topi", "", "2"},
		// A sample's total is 0 — still a total, so it is said.
		{fTotal, 300, "Topi", "", "0"},
		{fLineNote, 300, "Topi", "", "came in the box"},
		{fSupplier, 300, "Topi", "", "32"},
		{fStore, 300, "Topi", "", "321"},
	})
}

// AN EDIT THAT CHANGES NOTHING is still a row of the trail (every edit is), and says no change — never one made up.
// Its money: none moved, so nothing is sent (an-edit-sends-the-difference) — not this test's business.
func TestRestockRequestUpdate_AnEditThatChangesNothingSaysNoChange(t *testing.T) {
	db := san_testdb.DB(t)
	svc := tcService(t, db)

	raised := arrRaise(t, svc)
	before := len(arrDetail(t, svc, raised.GetId()).GetLogs())

	tcUpdate(t, svc, tcAsStored(arrDetail(t, svc, raised.GetId())))

	got := arrDetail(t, svc, raised.GetId())
	if len(got.GetLogs()) != before+1 {
		t.Fatalf("the trail has %d rows after the edit, want %d — every edit is a row", len(got.GetLogs()), before+1)
	}

	if changes := tcChangesOf(tcLastEdit(t, got, ongoing)); len(changes) != 0 {
		t.Fatalf("an edit that changed nothing says %v", changes)
	}

	var rows int64

	err := db.
		Table("restock_log_changes").
		Joins("JOIN restock_logs l ON l.id = restock_log_changes.restock_log_id").
		Where("l.restock_id = ?", raised.GetId()).
		Count(&rows).
		Error
	if err != nil {
		t.Fatalf("count changes: %v", err)
	}

	if rows != 0 {
		t.Fatalf("%d change rows stored for an edit that changed nothing", rows)
	}
}

// A REFUSED EDIT leaves no row and no change: the changes are written in the edit's transaction, or not at all.
func TestRestockRequestUpdate_ARefusedEditLeavesNoChange(t *testing.T) {
	db := san_testdb.DB(t)
	svc := tcService(t, db)

	raised := arrRaise(t, svc)

	_, err := arrSign(svc, arrWarehouse, raised.GetId())
	if err != nil {
		t.Fatalf("arrive: %v", err)
	}

	before := len(arrDetail(t, svc, raised.GetId()).GetLogs())

	// Once arrived, a line is added, never removed — and the count changed beside it must not land either.
	req := tcAsStored(arrDetail(t, svc, raised.GetId()))
	req.Items = req.Items[:1]
	req.Items[0].Count = 12

	_, err = svc.RestockRequestUpdate(ctxUser(arrBuyer), connect.NewRequest(req))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("removing a line once arrived = %v, want FailedPrecondition", err)
	}

	got := arrDetail(t, svc, raised.GetId())
	if len(got.GetLogs()) != before {
		t.Fatalf("a refused edit left a trail row (%d rows, want %d)", len(got.GetLogs()), before)
	}

	for _, l := range got.GetLogs() {
		if len(l.GetChanges()) != 0 {
			t.Fatalf("a refused edit left changes on %v → %v: %v", l.GetFromStatus(), l.GetToStatus(), tcChangesOf(l))
		}
	}
}

// AN EDIT WRITTEN BEFORE THE CHANGES WERE KEPT has none stored: it still reads — the bare word, the status unchanged,
// who and when — and nothing is invented for it. Beside it a new edit says what it changed, and the warehouse reads the
// same trail as the selling team.
func TestRestockDetail_AnOldEditWithoutChangesStillReads(t *testing.T) {
	db := san_testdb.DB(t)
	svc := tcService(t, db)

	raised := arrRaise(t, svc)

	// The row an edit wrote until now: the status twice and "edited", nothing under it.
	old := inventory_service_models.RestockLog{
		RestockID:   raised.GetId(),
		FromStatus:  "ongoing",
		ToStatus:    "ongoing",
		ActorUserID: arrBuyer,
		Description: "edited",
		CreatedAt:   time.Now(),
	}

	err := db.Create(&old).Error
	if err != nil {
		t.Fatalf("seed an old edit: %v", err)
	}

	req := tcAsStored(arrDetail(t, svc, raised.GetId()))
	req.Items[1].Count = 6
	tcUpdate(t, svc, req)

	for _, team := range []uint64{arrSellingTeam, arrWarehouse} {
		detail, detailErr := svc.RestockRequestDetail(ctxUser(arrBuyer), connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
			TeamId: team, RequestId: raised.GetId(),
		}))
		if detailErr != nil {
			t.Fatalf("detail as team %d: %v", team, detailErr)
		}

		var oldRow *inventoryv1.RestockLog

		for _, l := range detail.Msg.GetRequest().GetLogs() {
			if l.GetId() == old.ID {
				oldRow = l
			}
		}

		if oldRow == nil {
			t.Fatalf("team %d: the old edit is missing from the trail", team)
		}

		if oldRow.GetFromStatus() != ongoing || oldRow.GetToStatus() != ongoing || oldRow.GetDescription() != "edited" ||
			oldRow.GetActorUserId() != arrBuyer || oldRow.GetAtUnix() != old.CreatedAt.Unix() {
			t.Fatalf("team %d: the old edit reads %v → %v %q by %d at %d, want ongoing → ongoing \"edited\" by %d at %d",
				team, oldRow.GetFromStatus(), oldRow.GetToStatus(), oldRow.GetDescription(), oldRow.GetActorUserId(),
				oldRow.GetAtUnix(), arrBuyer, old.CreatedAt.Unix())
		}

		if len(oldRow.GetChanges()) != 0 {
			t.Fatalf("team %d: the old edit was given changes it never stored: %v", team, tcChangesOf(oldRow))
		}

		tcExpect(t, tcChangesOf(tcLastEdit(t, detail.Msg.GetRequest(), ongoing)), []tcChange{
			{fCount, 200, "Celana", "5", "6"},
		})
	}
}

// Every field word the migration's CHECK allows reads back as its own wire value — none falls to UNSPECIFIED.
func TestRestockLogChange_EveryStoredFieldReadsBack(t *testing.T) {
	db := san_testdb.DB(t)
	svc := tcService(t, db)

	raised := arrRaise(t, svc)

	var logID uint64

	err := db.
		Table("restock_logs").
		Select("id").
		Where("restock_id = ?", raised.GetId()).
		Scan(&logID).
		Error
	if err != nil {
		t.Fatalf("the create's row: %v", err)
	}

	words := map[string]inventoryv1.RestockLogChangeField{
		"warehouse": fWarehouse, "receipt": fReceipt, "receipt_file": fReceiptFile, "shipment": fShipment,
		"invoice_ref": fInvoiceRef, "finance_account": fAccount, "shipment_cost": fShipmentCost, "note": fNote,
		"line_added": fAdded, "line_removed": fRemoved, "line_count": fCount, "line_total": fTotal,
		"line_note": fLineNote, "line_supplier": fSupplier, "line_store": fStore, "warehouse_note": fWarehouseNote,
	}

	for word := range words {
		product := uint64(0)
		if len(word) > 5 && word[:5] == "line_" {
			product = 100
		}

		err = db.Create(&inventory_service_models.RestockLogChange{
			RestockLogID: logID, Field: word, ProductID: product, AfterValue: word,
		}).Error
		if err != nil {
			t.Fatalf("store %q: %v", word, err)
		}
	}

	got := arrDetail(t, svc, raised.GetId()).GetLogs()[0].GetChanges()
	if len(got) != len(words) {
		t.Fatalf("read back %d changes, want %d", len(got), len(words))
	}

	for _, c := range got {
		if want := words[c.GetAfter()]; c.GetField() != want || c.GetField() == fUnspecified {
			t.Fatalf("%q reads back as %v, want %v", c.GetAfter(), c.GetField(), want)
		}
	}

	// A line's field without its line, or the restock's own with one, is refused by the table itself.
	err = db.Transaction(func(tx *gorm.DB) error {
		return tx.Create(&inventory_service_models.RestockLogChange{RestockLogID: logID, Field: "line_count"}).Error
	})
	if err == nil {
		t.Fatalf("a line's change with no line was stored")
	}
}
