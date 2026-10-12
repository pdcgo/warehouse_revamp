import { receiptClient } from "../../api/clients";
import { ReceiptCheckResult } from "../../gen/warehouse/shipment/v1/receipt_pb";

// THE SHIPPING LABEL, READ BACK — shipment's ReceiptCheck (docs/business/shipment/context_decision.md).
//
// It READS and never VERIFIES (receipt-check-returns-what-the-library-reads): what comes back is what the
// label says, and comparing it with what a person typed is the caller's job. Every answer about the file
// is a RESULT, not an error (a-label-outcome-is-a-result-not-an-error) — a label the reader has not
// learned yet is normal, and says nothing on screen.

export type LabelResult = "read" | "unknownLabel" | "multipleLabels" | "notShippingLabel" | "unreadable";

/** What the label says. `""` = it does not print it, or prints it masked. All `""` unless `read`. */
export interface LabelReading {
  result: LabelResult;
  /** The tracking number — or an instant label's pickup code. */
  receipt: string;
  orderRefId: string;
  customerName: string;
  phone: string;
  address: string;
}

/** The reader's own cap (receipt-check-caps-the-body-before-reading). A larger PDF is never sent. */
export const LABEL_MAX_BYTES = 2 * 1024 * 1024;

const RESULTS: Record<ReceiptCheckResult, LabelResult | undefined> = {
  [ReceiptCheckResult.UNSPECIFIED]: undefined,
  [ReceiptCheckResult.READ]: "read",
  [ReceiptCheckResult.UNKNOWN_LABEL]: "unknownLabel",
  [ReceiptCheckResult.MULTIPLE_LABELS]: "multipleLabels",
  [ReceiptCheckResult.NOT_SHIPPING_LABEL]: "notShippingLabel",
  [ReceiptCheckResult.UNREADABLE]: "unreadable",
};

const NOTHING = { receipt: "", orderRefId: "", customerName: "", phone: "", address: "" };

/**
 * Reads ONE label file. `null` = not checked at all, and the form behaves as if no check existed.
 *
 * ⚠ ONLY A PDF IS SENT. The reader reads PDFs; whether a PHOTO of a label should be read is
 * receipt_readers Q4, still open — and a phone photo would be refused by the 3 MB read cap anyway.
 * A PDF over the cap is answered here as `unreadable`, which is exactly what the server would say.
 *
 * ⚠ A FAILED CALL IS `null`, NOT A MESSAGE. The check is advice that starts beside the upload
 * (receipt-check-takes-the-file-bytes); when it cannot run, the person types the numbers, as before
 * the check existed. The upload's own errors are the upload's to report.
 */
export async function checkLabel(file: File): Promise<LabelReading | null> {
  if (file.type !== "application/pdf" || file.size === 0) {
    return null;
  }

  if (file.size > LABEL_MAX_BYTES) {
    return { result: "unreadable", ...NOTHING };
  }

  try {
    const res = await receiptClient.receiptCheck({
      fileContent: new Uint8Array(await file.arrayBuffer()),
    });
    const result = RESULTS[res.result];

    if (!result) {
      return null;
    }

    if (result !== "read") {
      return { result, ...NOTHING };
    }

    return {
      result,
      receipt: res.receipt,
      orderRefId: res.orderRefId,
      customerName: res.customerName,
      phone: res.phone,
      address: res.address,
    };
  } catch {
    return null;
  }
}
