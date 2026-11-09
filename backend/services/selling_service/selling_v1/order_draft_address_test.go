package selling_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// draftAddressRows reads every `order_draft_addresses` row of one draft — what was written, not what a call echoed.
func draftAddressRows(t *testing.T, db *gorm.DB, draftID uint64) []selling_service_models.OrderDraftAddress {
	t.Helper()

	var rows []selling_service_models.OrderDraftAddress

	err := db.Where("order_draft_id = ?", draftID).Find(&rows).Error
	if err != nil {
		t.Fatalf("read draft address rows: %v", err)
	}

	return rows
}

// A DRAFT'S ADDRESS IS ITS ONE ROW, NAMES ONLY (one-address-per-order-and-per-draft, an-address-is-plain-names): a push
// writes exactly one row with the buyer and the address the app read, and the region codes it sent are discarded —
// read back, they are empty.
func TestOrderDraftAddress_APushWritesOneRowOfNames(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	msg := scrape()
	msg.CustomerPhone = "0812-1"
	msg.Address = &sellingv1.OrderAddress{
		ProvinsiCode: "32", ProvinsiName: "Jawa Barat",
		KabupatenCode: "32.01", KabupatenName: "Kab. Bogor",
		KecamatanCode: "32.01.01", KecamatanName: "Cibinong",
		DesaCode: "32.01.01.1001", DesaName: "Pakansari",
		KodePos: "16915", AddressLine: "Jl. Raya 1",
	}

	draft := push(t, svc, 7, msg).GetDraft()

	rows := draftAddressRows(t, db, draft.GetId())
	if len(rows) != 1 {
		t.Fatalf("%d address rows, want exactly 1", len(rows))
	}

	row := rows[0]
	if row.CustomerName != "Budi" || row.CustomerPhone != "0812-1" || row.KabupatenName != "Kab. Bogor" ||
		row.DesaName != "Pakansari" || row.PostalCode != "16915" || row.AddressLine != "Jl. Raya 1" {
		t.Fatalf("row %+v — want the buyer and the names as the app sent them", row)
	}

	got := draft.GetAddress()
	if got.GetProvinsiCode() != "" || got.GetKabupatenCode() != "" || got.GetKecamatanCode() != "" ||
		got.GetDesaCode() != "" {
		t.Fatalf("codes came back %+v — a draft keeps names only", got)
	}

	if got.GetKabupatenName() != "Kab. Bogor" || got.GetKodePos() != "16915" {
		t.Fatalf("names came back %+v — want the app's own text", got)
	}
}

// Corrections update the ONE row — a re-push of the untouched address and a person's edit alike — never a second.
func TestOrderDraftAddress_ARepushAndAnEditUpdateTheOneRow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := push(t, svc, 7, scrape()).GetDraft().GetId()

	repush := scrape()
	repush.Address = &sellingv1.OrderAddress{ProvinsiName: "Bali", AddressLine: "Jl. Sunset 9"}
	push(t, svc, 7, repush)

	rows := draftAddressRows(t, db, draftID)
	if len(rows) != 1 || rows[0].ProvinsiName != "Bali" || rows[0].AddressLine != "Jl. Sunset 9" {
		t.Fatalf("after a re-push: %+v — want one row with the app's latest address", rows)
	}

	updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId:        2,
		DraftId:       draftID,
		CustomerPhone: str("0812-9"),
		Address:       &sellingv1.OrderAddress{DesaName: "Kuta", DesaCode: "51.03.01.1001", AddressLine: "Jl. Pantai 2"},
	})

	rows = draftAddressRows(t, db, draftID)
	if len(rows) != 1 {
		t.Fatalf("%d rows after an edit, want 1", len(rows))
	}

	row := rows[0]
	if row.CustomerName != "Budi" || row.CustomerPhone != "0812-9" || row.DesaName != "Kuta" ||
		row.ProvinsiName != "" || row.AddressLine != "Jl. Pantai 2" {
		t.Fatalf("row %+v — want the edit's whole address and phone, the untouched name kept", row)
	}
}

// UNIQUE (order_draft_id): a second row for one draft is refused by the table itself.
func TestOrderDraftAddress_ASecondRowIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := pushRef(t, svc, 7, "SHP-100")

	err := db.Create(&selling_service_models.OrderDraftAddress{OrderDraftID: draftID, CustomerName: "Other"}).Error
	if err == nil {
		t.Fatal("a second address row was accepted — a draft has exactly one")
	}
}

// The row goes with its draft: a deleted draft leaves no address behind.
func TestOrderDraftAddress_GoesWithItsDraft(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := pushRef(t, svc, 7, "SHP-100")

	_, err := svc.OrderDraftDelete(asUser(7), connect.NewRequest(&sellingv1.OrderDraftDeleteRequest{
		TeamId:   2,
		DraftIds: []uint64{draftID},
	}))
	if err != nil {
		t.Fatalf("OrderDraftDelete: %v", err)
	}

	if rows := draftAddressRows(t, db, draftID); len(rows) != 0 {
		t.Fatalf("%d address rows outlived their draft", len(rows))
	}
}
