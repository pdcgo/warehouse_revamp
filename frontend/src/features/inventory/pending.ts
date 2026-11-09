import type { PendingList, PendingPart } from "../pending/registry";

// WHAT THE BATCH SCREENS CANNOT DO YET — shared by the Batch list and a batch's page, which show a batch's source the
// same way (BatchSource). The list shrinks by one entry each time something behind it lands.

/** One unwired part. The id is also its i18n key (`batches.pending.<id>`). */
export type BatchPendingId = "returnLink";

const PARTS: PendingPart<BatchPendingId>[] = [
  // ⚠ A RETURN BATCH CANNOT OPEN ITS RETURN (a-batch-opens-where-it-came-from). StockBatch's `delivery_id` is the restock's
  // number — the batch read joins restocks only — so a batch a return minted carries 0 and no return number; the link to
  // /inventories/returns/:id has nothing to point at. `missing`: the return's number is not on the screen at all.
  { id: "returnLink", kind: "missing" },
];

/** What the badges and the summaries on the batch screens read. */
export const BATCH_PENDING: PendingList<BatchPendingId> = { ns: "batches", parts: PARTS };
