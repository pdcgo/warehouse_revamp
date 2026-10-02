import { LiabilitySourceType } from "../../gen/warehouse/liability/v1/liability_pb";

// WHAT CAUSED an entry, in words, from the typed `(source_type, source_id)` pair — never free text. A
// line reads "Product fee · order #412", so "why do I owe this?" is answerable, filterable and
// countable.
export function causeKey(type: LiabilitySourceType): string {
  switch (type) {
    case LiabilitySourceType.ORDER_FEE:
      return "liabilityDetail.causeOrderFee";
    case LiabilitySourceType.INCIDENTAL_FEE:
      return "liabilityDetail.causeIncidentalFee";
    case LiabilitySourceType.PRODUCT_FEE:
      return "liabilityDetail.causeProductFee";
    case LiabilitySourceType.PAYMENT:
      return "liabilityDetail.causePayment";
    // ⚠ CAUSES 4 AND 5 USED TO SHARE ONE LABEL, because they shared one source type. They no longer
    // do: broken and lost are different questions to answer, and a find is a giving-back movement
    // rather than a third kind of loss. The REVERSAL badge still marks the find — the type carries
    // the cause and the flag carries the direction.
    case LiabilitySourceType.BROKEN_GOOD:
      return "liabilityDetail.causeBrokenGood";
    case LiabilitySourceType.LOST_GOOD:
      return "liabilityDetail.causeLostGood";
    case LiabilitySourceType.FOUND:
      return "liabilityDetail.causeFound";
    default:
      // A source this build does not know renders as "unknown" rather than breaking the page.
      return "liabilityDetail.causeUnknown";
  }
}

/** A unix instant as the viewer's local date; 0 is no date. */
export function fmtDate(unix: bigint): string {
  if (unix === 0n) return "—";
  return new Date(Number(unix) * 1000).toLocaleDateString();
}
