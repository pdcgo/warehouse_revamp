import type { WarehouseTransferItem } from "../../gen/warehouse/inventory/v1/warehouse_transfer_pb";

// The count at B's door, as typed — and the rules it has to meet before the accept is sent. Pure, so the page and its
// story read the same arithmetic (broken-and-missing-at-the-door-are-problem-rows).

export interface PlacementDraft {
  rackId: string;
  quantity: string;
}

export interface LineCount {
  itemId: bigint;
  arrived: string;
  broken: string;
  brokenNote: string;
  missingNote: string;
  placements: PlacementDraft[];
}

export const toCount = (raw: string): bigint => (/^\d+$/.test(raw) ? BigInt(raw) : 0n);

export function emptyCount(item: WarehouseTransferItem): LineCount {
  return {
    itemId: item.id,
    arrived: "",
    broken: "0",
    brokenNote: "",
    missingNote: "",
    placements: [{ rackId: "", quantity: "" }],
  };
}

export const isCounted = (line: LineCount) => /^\d+$/.test(line.arrived);
export const goodOf = (line: LineCount) => toCount(line.arrived) - toCount(line.broken);
export const missingOf = (item: WarehouseTransferItem, line: LineCount) =>
  isCounted(line) ? item.count - toCount(line.arrived) : 0n;
export const placedOf = (line: LineCount) => line.placements.reduce((sum, p) => sum + toCount(p.quantity), 0n);

export type LineProblem = "uncounted" | "overSent" | "brokenOverArrived" | "placement" | "rack";

/** What is still wrong with one line, in the order a person would fix it. */
export function problemOf(item: WarehouseTransferItem, line: LineCount): LineProblem | null {
  if (!isCounted(line)) return "uncounted";
  if (toCount(line.arrived) > item.count) return "overSent";
  if (toCount(line.broken) > toCount(line.arrived)) return "brokenOverArrived";
  if (placedOf(line) !== goodOf(line)) return "placement";
  if (line.placements.some((p) => toCount(p.quantity) > 0n && p.rackId === "")) return "rack";

  return null;
}
