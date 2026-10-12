import type { PendingList, PendingPart } from "../../features/pending/registry";

// What Rack detail admits it cannot do yet. The Move and Record Sample writes are a PROTOTYPE as a whole (the server
// answers Unimplemented until design_accept); these are the parts whose RULE is not settled, which the prototype would
// otherwise present as decided.
export type RackDetailPendingId = "countLock" | "sampleAgreedBy";

const PARTS: PendingPart<RackDetailPendingId>[] = [
  // A product being counted shows locked at 0 (a-move-is-all-or-nothing) — but what a count's lock blocks is
  // opname Q4, and the stock count itself is not built, so only the stub ever sets it.
  { id: "countLock", kind: "derived" },
  // Who on the owning team agreed to the sample is not on the form: who bears a sample is transaction Q6.
  { id: "sampleAgreedBy", kind: "missing" },
];

export const RACK_DETAIL_PENDING: PendingList<RackDetailPendingId> = {
  ns: "racks.detail",
  parts: PARTS,
};
