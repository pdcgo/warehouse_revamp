import type { OrderDraft } from "../../gen/warehouse/selling/v1/order_draft_pb";

// What a draft is still missing before it can be promoted (#195/#196).
//
// ⚠ THE SERVER IS AUTHORITATIVE. Promote is `OrderCreate` with the draft's id
// (a-draft-becomes-an-order-through-order-create), and its validation is the one that decides. This mirrors it so a
// person can see what is left WITHOUT pressing promote and reading an error — a list of forty drafts is useless if the
// only way to tell which are finished is to try each one.
//
// It is kept in its own file, listed in one order, for the same reason: the list's badge and its "ready"
// count ask this question, and answering it twice is how they start disagreeing about what "ready" means.
// The detail page's Promote reasons are the fuller list — it holds the lines and the warehouse's fee — and
// every rule here is one of them, in the same order. ⚠ A rule Promote gains that a summary row can read
// belongs here too, or the list calls a draft ready that Promote refuses.
export interface DraftGap {
  // An i18n key naming what is missing.
  key: string;
}

export interface DraftGapOptions {
  /** How many mapped lines the chosen warehouse cannot fill right now.
   *
   * Only the DETAIL screen can answer this — it holds the lines, so it can read the warehouse's
   * availability for them; the list deliberately fetches no lines at all. So it is an option rather
   * than a field: absent means "not checked here", never "nothing is short". */
  shortLines?: number;
}

export function draftGaps(draft: OrderDraft, opts: DraftGapOptions = {}): DraftGap[] {
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
  }

  // platform-created-at-is-required-at-finalize — a draft may hold it empty while it is worked on; Promote refuses it.
  if (draft.platformCreatedAtUnix <= 0n) {
    gaps.push({ key: "orderDrafts.gapOrderDate" });
  }

  // platform-total-is-required-at-finalize — the STORED figure, because the list reads only what a draft keeps. The page
  // may still follow the rows' prices and send that, so this can call a draft unfinished that the page could promote —
  // the safe side to be wrong on.
  if (draft.platformTotal <= 0n) {
    gaps.push({ key: "orderDrafts.gapSellPrice" });
  }

  // an-order-ref-is-required-by-the-rpc — an app's draft carries the marketplace ref as its external id, and the page
  // seeds it. A `manual` draft's external id is a minted `form-…` id, so its ref is still to be typed.
  if (draft.source === "manual") {
    gaps.push({ key: "orderDrafts.gapRef" });
  }

  // The one gap specific to drafts: an unmapped line is precisely what makes this a draft rather than an order
  // somebody has not got round to submitting. Only asked of a draft that has lines — "no lines" already says it.
  if (draft.itemCount > 0 && draft.unmappedItemCount > 0) {
    gaps.push({ key: "orderDrafts.unmappedLines" });
  }

  // STOCK. Promote IS OrderCreate, so it DRAWS the goods
  // out of the warehouse and refuses the draft when a line is short. Without this gap the shortfall
  // is invisible until somebody presses Promote and reads a rejection, which is the state the order
  // form already refuses to be in (`order-create-short`).
  //
  // A shortfall never blocks EDITING, only promoting: mapping a scraped line to a product the
  // warehouse happens to be out of is correct work, and the draft is where it waits for a restock.
  if ((opts.shortLines ?? 0) > 0) {
    gaps.push({ key: "orderDrafts.missingStock" });
  }

  return gaps;
}

export function isDraftReady(draft: OrderDraft, opts: DraftGapOptions = {}): boolean {
  return draftGaps(draft, opts).length === 0;
}
