package selling_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

func updateDraft(
	t *testing.T,
	svc *selling_v1.Service,
	userID uint64,
	req *sellingv1.OrderDraftUpdateRequest,
) *sellingv1.OrderDraft {
	t.Helper()

	res, err := svc.OrderDraftUpdate(asUser(userID), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("OrderDraftUpdate(draft=%d): %v", req.GetDraftId(), err)
	}

	return res.Msg.GetDraft()
}

func str(s string) *string { return &s }

func u64(v uint64) *uint64 { return &v }

// THE HALF THAT MAKES #191's MERGE MEAN ANYTHING. An edit marks the fields it wrote, and nothing
// else — mark too much and the first save freezes the whole draft against the app forever.
func TestOrderDraftUpdate_MarksOnlyWhatItWrote(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := pushRef(t, svc, 7, "SHP-100")

	draft := updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId:       2,
		DraftId:      draftID,
		CustomerName: str("Budi Santoso"),
	})

	if draft.GetCustomerName() != "Budi Santoso" {
		t.Fatalf("customer_name = %q, want the edit to have landed", draft.GetCustomerName())
	}

	if len(draft.GetTouchedFields()) != 1 || draft.GetTouchedFields()[0] != "customer_name" {
		t.Fatalf("touched_fields = %v, want exactly [customer_name]", draft.GetTouchedFields())
	}

	// And now the app cannot take it back — which is the entire point of the mark.
	repush := scrape()
	repush.CustomerName = "budi"
	repush.ShippingCost = 21000

	after := push(t, svc, 7, repush).GetDraft()

	if after.GetCustomerName() != "Budi Santoso" {
		t.Fatalf("customer_name = %q after a re-push — the mark did not hold", after.GetCustomerName())
	}

	if after.GetShippingCost() != 21000 {
		t.Fatalf("shipping_cost = %d — an unmarked field was frozen too", after.GetShippingCost())
	}
}

// An unset field is not written AND not marked. Without presence, saving one field would mark them
// all, and "the app fills blanks" would stop being true after the first save anybody made.
func TestOrderDraftUpdate_AnUnsetFieldIsNotTouched(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := pushRef(t, svc, 7, "SHP-100")

	draft := updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId:  2,
		DraftId: draftID,
		ShopId:  u64(11),
	})

	for _, name := range draft.GetTouchedFields() {
		if name != "shop_id" {
			t.Fatalf("touched_fields = %v — an unset field was marked", draft.GetTouchedFields())
		}
	}

	// The untouched address is still what the app scraped.
	if draft.GetAddress().GetAddressLine() != "Jl. Merdeka 1" {
		t.Fatalf("address_line = %q — an unset field was written",
			draft.GetAddress().GetAddressLine())
	}
}

// Setting a field to EMPTY is a real edit — clearing a wrongly-scraped phone number is exactly the
// correction somebody needs to make, and it must stick against the next push.
func TestOrderDraftUpdate_ClearingAFieldIsAnEdit(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := pushRef(t, svc, 7, "SHP-100")

	draft := updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId:       2,
		DraftId:      draftID,
		CustomerName: str(""),
	})

	if len(draft.GetTouchedFields()) != 1 {
		t.Fatalf("touched_fields = %v, want [customer_name] — clearing is an edit",
			draft.GetTouchedFields())
	}

	after := push(t, svc, 7, scrape()).GetDraft()
	if after.GetCustomerName() != "" {
		t.Fatalf("customer_name = %q — the app undid a deliberate clearing",
			after.GetCustomerName())
	}
}

// THE MAPPING ACT — the reason this whole feature exists. The scraped text must survive it, because
// it is the evidence a reviewer checks the mapping against.
func TestOrderDraftUpdate_MapsALineAndKeepsTheScrapedText(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := pushRef(t, svc, 7, "SHP-100")

	detail, err := draftDetail(t, svc, 7, 2, draftID)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	lines := make([]*sellingv1.OrderDraftLineEdit, 0, 2)
	for _, item := range detail.GetItems() {
		lines = append(lines, &sellingv1.OrderDraftLineEdit{
			Id:        item.GetId(),
			ProductId: 42,
			Quantity:  item.GetQuantity(),
			UnitPrice: item.GetUnitPrice(),
		})
	}

	draft := updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId:  2,
		DraftId: draftID,
		Items:   &sellingv1.OrderDraftLines{Lines: lines},
	})

	if draft.GetUnmappedItemCount() != 0 {
		t.Fatalf("unmapped = %d after mapping both lines, want 0", draft.GetUnmappedItemCount())
	}

	if draft.GetItems()[0].GetExternalName() != "Kaos Polos Hitam L" {
		t.Fatalf("external_name = %q — the mapping overwrote the evidence",
			draft.GetItems()[0].GetExternalName())
	}
}

// A buyer who cancelled one line of three must be able to say so — otherwise the draft is
// unpromotable forever over a line nobody wants.
func TestOrderDraftUpdate_AnOmittedLineIsDeleted(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := pushRef(t, svc, 7, "SHP-100")

	detail, err := draftDetail(t, svc, 7, 2, draftID)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	keep := detail.GetItems()[0]

	draft := updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId:  2,
		DraftId: draftID,
		Items: &sellingv1.OrderDraftLines{Lines: []*sellingv1.OrderDraftLineEdit{
			{Id: keep.GetId(), ProductId: 42, Quantity: 2, UnitPrice: 50000},
		}},
	})

	if len(draft.GetItems()) != 1 || draft.GetItemCount() != 1 {
		t.Fatalf("items = %d, want 1 — the omitted line survived", len(draft.GetItems()))
	}

	var stored int64

	err = db.
		Model(&selling_service_models.OrderDraftItem{}).
		Where("draft_id = ?", draftID).
		Count(&stored).
		Error
	if err != nil {
		t.Fatalf("count lines: %v", err)
	}

	if stored != 1 {
		t.Fatalf("%d lines in the table, want 1 — the delete did not reach the database", stored)
	}
}

// A line the scrape never saw: no external text, which truthfully says a person typed it in.
func TestOrderDraftUpdate_AddsALineTheScrapeNeverSaw(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := pushRef(t, svc, 7, "SHP-100")

	detail, err := draftDetail(t, svc, 7, 2, draftID)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	lines := []*sellingv1.OrderDraftLineEdit{{Id: 0, ProductId: 7, Quantity: 3, UnitPrice: 1000}}
	for _, item := range detail.GetItems() {
		lines = append(lines, &sellingv1.OrderDraftLineEdit{
			Id: item.GetId(), ProductId: 42, Quantity: item.GetQuantity(), UnitPrice: item.GetUnitPrice(),
		})
	}

	draft := updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId:  2,
		DraftId: draftID,
		Items:   &sellingv1.OrderDraftLines{Lines: lines},
	})

	if draft.GetItemCount() != 3 {
		t.Fatalf("item_count = %d, want 3", draft.GetItemCount())
	}

	var added *sellingv1.OrderDraftItem

	for _, item := range draft.GetItems() {
		if item.GetProductId() == 7 {
			added = item
		}
	}

	if added == nil || added.GetExternalName() != "" {
		t.Fatalf("the hand-added line carries external text %q — it was never scraped",
			added.GetExternalName())
	}
}

// A line id from somebody else's draft is InvalidArgument, not NotFound: the draft named IS the
// caller's, and "your draft is gone" would send them looking for the wrong problem.
func TestOrderDraftUpdate_RejectsALineFromAnotherDraft(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mine := pushRef(t, svc, 7, "SHP-100")
	other := pushRef(t, svc, 7, "SHP-200")

	foreign, err := draftDetail(t, svc, 7, 2, other)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	_, err = svc.OrderDraftUpdate(asUser(7), connect.NewRequest(&sellingv1.OrderDraftUpdateRequest{
		TeamId:  2,
		DraftId: mine,
		Items: &sellingv1.OrderDraftLines{Lines: []*sellingv1.OrderDraftLineEdit{
			{Id: foreign.GetItems()[0].GetId(), ProductId: 42, Quantity: 1},
		}},
	}))

	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}

func TestOrderDraftUpdate_CannotEditAColleaguesDraft(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	draftID := pushRef(t, svc, 9, "SHP-200")

	_, err := svc.OrderDraftUpdate(asUser(7), connect.NewRequest(&sellingv1.OrderDraftUpdateRequest{
		TeamId: 2, DraftId: draftID, CustomerName: str("nope"),
	}))

	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}
