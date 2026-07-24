import type { OrderDraft } from "../../gen/warehouse/selling/v1/order_draft_pb";

// What a draft is still missing before it can be promoted (#195/#196).
//
// ⚠ THE SERVER IS AUTHORITATIVE. `OrderDraftPromote` runs the same validation `OrderCreate` runs, and
// that is the one that decides. This mirrors it so a person can see what is left WITHOUT pressing
// promote and reading an error — a list of forty drafts is useless if the only way to tell which are
// finished is to try each one.
//
// It is kept in its own file, listed in one order, for the same reason: two screens ask this question
// (the list summary and the detail's promote button), and answering it twice is how they start
// disagreeing about what "ready" means.
export interface DraftGap {
  // An i18n key naming what is missing.
  key: string;
}

export function draftGaps(draft: OrderDraft): DraftGap[] {
  const gaps: DraftGap[] = [];

  if (draft.shopId === 0n) {
    gaps.push({ key: "orderDrafts.missingShop" });
  }

  if (draft.warehouseId === 0n) {
    gaps.push({ key: "orderDrafts.missingWarehouse" });
  }

  if (!draft.customerName) {
    gaps.push({ key: "orderDrafts.missingCustomer" });
  }

  if (draft.itemCount === 0) {
    gaps.push({ key: "orderDrafts.missingLines" });
  } else if (draft.unmappedItemCount > 0) {
    // The one gap specific to drafts: an unmapped line is precisely what makes this a draft rather
    // than an order somebody has not got round to submitting.
    gaps.push({ key: "orderDrafts.unmappedLines" });
  }

  return gaps;
}

export function isDraftReady(draft: OrderDraft): boolean {
  return draftGaps(draft).length === 0;
}
