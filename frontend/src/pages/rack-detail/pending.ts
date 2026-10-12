import type { PendingList, PendingPart } from "../../features/pending/registry";

// What Rack detail admits it cannot do yet. The Move and Record Sample writes are a PROTOTYPE as a whole (the server
// answers Unimplemented until design_accept); these are the parts whose RULE is not settled, which the prototype would
// otherwise present as decided.
export type RackDetailPendingId = "countLock";

const PARTS: PendingPart<RackDetailPendingId>[] = [
  // A product being counted shows locked at 0 (a-move-is-all-or-nothing) — but what a count's lock blocks is
  // opname Q4, and the stock count itself is not built, so only the stub ever sets it.
  { id: "countLock", kind: "derived" },
];

export const RACK_DETAIL_PENDING: PendingList<RackDetailPendingId> = {
  ns: "racks.detail",
  parts: PARTS,
};
