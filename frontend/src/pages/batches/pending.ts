import type { PendingList, PendingPart } from "../../features/pending/registry";
import { BATCH_PENDING, type BatchPendingId } from "../../features/inventory/pending";

// WHAT THE BATCH LIST CANNOT DO YET — the batch screens' shared list (a return's source, features/inventory/pending.ts)
// FIRST, so its ⚠ keeps the number BatchSource gives it on both screens, then this page's own parts.

export type BatchListPendingId = BatchPendingId | "teamFilter";

const PARTS: PendingPart<BatchListPendingId>[] = [
  ...BATCH_PENDING.parts,
  // ⚠ THE TEAM (owner: *"oke, kasih tim"*) — whose goods, held in the URL and thrown away: BatchListFilter has no owning
  // team (the owner is the product's, another service's data), and a paged list cannot be narrowed on screen without
  // missing the batches on the other pages.
  { id: "teamFilter", kind: "dropped" },
];

/** What the Batch list's badges and summary read. */
export const BATCH_LIST_PENDING: PendingList<BatchListPendingId> = { ns: "batches", parts: PARTS };
