package selling_v1

import (
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// CETAK ULANG LABEL (a-changed-label-asks-the-warehouse-to-reprint): the system records when an order's label is
// printed — the print page's Print, OrderLabels with `record_print` — and when the seller last changed its resi or label
// file (OrderReceiptUpdate). A change AFTER the print marks the order until the label is printed again; a change before
// any print marks nothing, since the first print takes the new label anyway.
//
// It marks only a parcel still in the building — pending, processed, picked: the steps Edit Resi is offered on
// (receiptEditable). From shipping on the courier has the parcel, the edit is refused, and nothing is marked.
//
// THE RULE IS WRITTEN TWICE, once for a row in hand (needsReprint) and once as SQL for the list's filter
// (reprintLabelCondition) — TestReprintLabel_TheFilterAndTheRowAgree pins that the two agree on every case.

// reprintLabelCarries is where the mark can show: the steps a resi may still be edited on.
var reprintLabelCarries = receiptEditable

// reprintLabelCondition is the rule as one SQL condition on `orders`, for OrderListFilter / OrderStatFilter
// `reprint_label` (the-reprint-label-prototype-is-accepted). The statuses are literals, so the planner can match a
// partial index on them.
const reprintLabelCondition = `(label_printed_at IS NOT NULL AND receipt_changed_at > label_printed_at AND ` +
	`status IN ('pending', 'processed', 'picked'))`

// reprintRefusal is why the handover refuses a marked parcel (a-parcel-marked-for-reprint-is-not-handed-over) — a
// sentence for the person who asked, as every refusal in a batch result is.
const reprintRefusal moveRefusal = "the label changed after it was printed — print the new label first"

// needsReprint is the rule for one row in hand: a resi or label change after the last print, on a parcel still in the
// building.
func needsReprint(order *selling_service_models.Order) bool {
	if order.LabelPrintedAt == nil || order.ReceiptChangedAt == nil {
		return false
	}

	return order.ReceiptChangedAt.After(*order.LabelPrintedAt) && reprintLabelCarries[order.Status]
}
