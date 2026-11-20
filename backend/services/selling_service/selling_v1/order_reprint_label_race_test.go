//go:build raceaudit

// Concurrency audit for Cetak ulang label (the audit-sql skill) — a-changed-label-asks-the-warehouse-to-reprint,
// a-parcel-marked-for-reprint-is-not-handed-over.
//
// Three writers meet on one order's row: Edit Resi (OrderReceiptUpdate, FOR UPDATE, stamps receipt_changed_at), the
// print page's Print (OrderLabels with record_print, reads FOR SHARE, stamps label_printed_at) and the handover
// (OrderStatusChange, FOR UPDATE, refuses a marked parcel). What must never happen is a parcel leaving with a label
// older than its last change: a print that took the OLD file yet cleared the mark, or a handover that slipped past an
// edit made after the print. Both are proved here.
//
//	go test -tags raceaudit -count=5 -run 'TestRace_ReprintLabel|TestInterleave_ReprintLabel' -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// raceLinker holds the race team's label files: the old one, and each new one an edit may attach.
func raceLinker() *fakeLinker {
	owners := map[string]uint64{"doc-race-old": raceOrderTeam, "doc-race-new": raceOrderTeam}
	for i := range 8 {
		owners[fmt.Sprintf("doc-race-%d", i)] = raceOrderTeam
	}

	return &fakeLinker{owners: owners}
}

// printedRaceOrder is a picked race order whose label doc-race-old the print page has printed — committed.
func printedRaceOrder(t *testing.T, h *san_race.Harness, svc *selling_v1.Service, shopID uint64) uint64 {
	t.Helper()

	orderID := pickedRaceOrder(t, svc, shopID)

	err := h.DB().
		Exec(`UPDATE orders SET receipt_document_id = 'doc-race-old', receipt_filename = 'old.pdf',
			receipt_mime_type = 'application/pdf' WHERE id = ?`, orderID).
		Error
	if err != nil {
		t.Fatal(err)
	}

	_, err = racePrint(svc, orderID)
	if err != nil {
		t.Fatalf("the first print: %v", err)
	}

	return orderID
}

// racePrint is the print page's Print of one order.
func racePrint(svc *selling_v1.Service, orderID uint64) (*sellingv1.OrderLabelsResponse, error) {
	res, err := svc.OrderLabels(context.Background(), connect.NewRequest(&sellingv1.OrderLabelsRequest{
		TeamId: testWarehouse, OrderIds: []uint64{orderID}, RecordPrint: true,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// raceEditFile is the seller's Edit Resi of the label file.
func raceEditFile(svc *selling_v1.Service, orderID uint64, documentID string) error {
	_, err := editReceipt(svc, context.Background(), raceOrderTeam, orderID, nil, &sellingv1.OrderReceipt{
		DocumentId: documentID, Filename: documentID + ".pdf", MimeType: "application/pdf",
	})

	return err
}

// raceMarked reads the order's Cetak ulang label as its warehouse.
func raceMarked(t *testing.T, svc *selling_v1.Service, orderID uint64) bool {
	t.Helper()

	got, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: testWarehouse, OrderId: orderID,
	}))
	if err != nil {
		t.Fatalf("detail of %d: %v", orderID, err)
	}

	return got.Msg.GetOrder().GetReprintLabel()
}

// THE PROOF A PRINT NEVER CLEARS A CHANGE IT DID NOT PRINT. A holds the order FOR UPDATE replacing its label file and
// has not committed; B's print must wait on that row (its read is FOR SHARE), then read the NEW file — so the PDF holds
// the label the order now names, and the order is not marked after it. Without the wait, B would print the old file and
// stamp a time after A's change: the mark gone, the old label on the box.
func TestInterleave_ReprintLabel_APrintWaitsForAnEditInFlight(t *testing.T) {
	h := orderRaceHarness(t)
	linker := raceLinker()
	svc := labelService(h.DB(), linker)
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Cetak", "RC-1", "shopee")

	orderID := printedRaceOrder(t, h, svc, shopID)
	linker.asked = nil

	const print = "B prints the same order's label"

	sched := h.Interleave(t,
		san_race.Do("A", "A replaces the label file — FOR UPDATE holds its row", func(tx *gorm.DB) error {
			return raceEditFile(newService(t, tx), orderID, "doc-race-new")
		}),
		san_race.Block("B", print, func(tx *gorm.DB) error {
			res, err := racePrint(labelService(tx, linker), orderID)
			if err != nil {
				return err
			}

			if !res.GetResults()[0].GetIncluded() {
				return fmt.Errorf("the print left the order out: %v", res.GetResults())
			}

			return nil
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	step := sched.Get(print)
	if !step.Blocked || !step.Released || step.Err != nil {
		t.Fatalf("B's print: blocked=%v released=%v err=%v — want it to wait on the edit, then print", step.Blocked,
			step.Released, step.Err)
	}

	if !slices.Equal(linker.asked, []string{"doc-race-new"}) {
		t.Fatalf("the print read %v, want the new file doc-race-new", linker.asked)
	}

	if raceMarked(t, svc, orderID) {
		t.Fatal("printed after the change, still marked")
	}
}

// A print and an edit at once, × 30 rounds. Whichever lands first, the PDF and the mark agree: a print that read the
// OLD file leaves the order marked; only a print of the NEW file clears it.
func TestRace_ReprintLabel_PrintAndEditAtOnce(t *testing.T) {
	h := orderRaceHarness(t)
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Cetak", "RC-2", "shopee")

	oldFirst, newFirst := 0, 0

	for round := range 30 {
		linker := raceLinker()
		svc := labelService(h.DB(), linker)
		orderID := printedRaceOrder(t, h, svc, shopID)
		linker.asked = nil

		res := h.Race(t, 2, func(i int) error {
			if i == 0 {
				_, err := racePrint(svc, orderID)

				return err
			}

			return raceEditFile(svc, orderID, "doc-race-new")
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() > 0 {
			t.Fatalf("round %d: %d calls failed — deadlocks %d", round, res.Failed(), res.Count(san_race.Deadlock))
		}

		marked := raceMarked(t, svc, orderID)

		switch {
		case slices.Equal(linker.asked, []string{"doc-race-old"}):
			oldFirst++

			if !marked {
				t.Fatalf("round %d: the print took the OLD file, yet the order is not marked", round)
			}
		case slices.Equal(linker.asked, []string{"doc-race-new"}):
			newFirst++

			if marked {
				t.Fatalf("round %d: the print took the new file, yet the order is still marked", round)
			}
		default:
			t.Fatalf("round %d: the print read %v", round, linker.asked)
		}
	}

	t.Logf("the print read the old file first %d times, the new one %d times", oldFirst, newFirst)
}

// Edits of an order already printed and its handover at once, × 20 rounds. A parcel never leaves with a label older
// than its last change: either the handover went first and every edit is refused (the courier has it), or an edit went
// first and the handover is refused as Cetak ulang label — never a handover AND an edit that answered success.
func TestRace_ReprintLabel_AnEditAfterThePrintAgainstTheHandover(t *testing.T) {
	h := orderRaceHarness(t)
	svc := labelService(h.DB(), raceLinker())
	shopID := insertShop(t, h.DB(), raceOrderTeam, "Race Cetak", "RC-3", "shopee")

	const edits = 4

	shippedFirst, editedFirst := 0, 0

	for round := range 20 {
		orderID := printedRaceOrder(t, h, svc, shopID)

		var shipped *sellingv1.OrderStatusChangeResult

		errs := make([]error, edits)

		res := h.Race(t, edits+1, func(i int) error {
			if i == edits {
				got, err := raceMove(svc, testWarehouse, orderID, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING)
				shipped = got

				return err
			}

			errs[i] = raceEditFile(svc, orderID, fmt.Sprintf("doc-race-%d", i))

			// A refusal after the handover is the answer, not a failure of the race.
			var cerr *connect.Error
			if errors.As(errs[i], &cerr) && cerr.Code() == connect.CodeFailedPrecondition {
				return nil
			}

			return errs[i]
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() > 0 {
			t.Fatalf("round %d: %d calls failed — deadlocks %d", round, res.Failed(), res.Count(san_race.Deadlock))
		}

		landed := 0

		for _, err := range errs {
			if err == nil {
				landed++
			}
		}

		switch {
		case shipped.GetMoved() && landed == 0:
			shippedFirst++
		case !shipped.GetMoved() && landed > 0 &&
			shipped.GetRefusedReason() == "the label changed after it was printed — print the new label first":
			editedFirst++
		default:
			t.Fatalf("round %d: handover moved=%v (%q) with %d edits landed — a parcel left with an old label, or a "+
				"refusal without a change", round, shipped.GetMoved(), shipped.GetRefusedReason(), landed)
		}
	}

	t.Logf("the handover went first %d times, an edit %d times", shippedFirst, editedFirst)
}
