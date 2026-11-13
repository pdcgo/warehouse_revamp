import type { TFunction } from "i18next";

// How a corrected line's Kurang reads (a-wrong-stock-in-is-a-received-count-correction: *"units taken out —
// the restock's / transfer's existing Kurang (missing at the door) word, marked (koreksi)"*). The door's own missing
// units first, then the correction's, signed — units back in make it a minus, so the figure the cell nets to is still
// the line's whole Kurang:
//
//   door 0, 2 out    "2 (koreksi)"
//   door 1, 2 out    "1 + 2 (koreksi)"
//   door 1, 1 in     "1 − 1 (koreksi)"
export function missingMark(t: TFunction, total: bigint, netOut: bigint): string {
  const door = total - netOut;

  if (netOut > 0n) {
    return door > 0n
      ? t("receivedCount.mark.plus", { door: door.toString(), count: netOut.toString() })
      : t("receivedCount.mark.only", { count: netOut.toString() });
  }

  return t("receivedCount.mark.minus", { door: door.toString(), count: (-netOut).toString() });
}
