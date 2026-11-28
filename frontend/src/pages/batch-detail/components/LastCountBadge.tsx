import { useTranslation } from "react-i18next";
import { Badge } from "@chakra-ui/react";

import { formatUnixDate, formatUnixDateShort } from "../../../lib/datetime";

// A count is OVERDUE once it is more than two weeks old — the warehouse product page's placement tab draws the same rule.
const OVERDUE_MS = 14 * 24 * 60 * 60 * 1000;

/** Where a rack's last count stands: never, within two weeks, or overdue for a re-count. */
export function lastCountState(unix: bigint): "never" | "fresh" | "overdue" {
  if (unix <= 0n) return "never";
  return Number(unix) * 1000 < Date.now() - OVERDUE_MS ? "overdue" : "fresh";
}

const PALETTE = { never: "gray", fresh: "success", overdue: "warning" } as const;

// THE LAST COUNT AS A BADGE (owner: *"Status opname menggunakan badge agar lebih mudah dipindai, dan yang sekarang terlalu
// panjang"*, last-count-is-a-badge) — a colour read down the column without reading a word, and a word short enough to
// fit one:
//
//   [12 Nov]   success   counted within two weeks
//   [28 Okt]   warning   counted, but more than two weeks ago — due again
//   [Belum pernah]  gray  never counted (it was *Belum pernah dihitung*, a sentence in a cell)
//
// A status, so its colour is its ROLE, never a hue. The whole date is the badge's hover.
export function LastCountBadge({ unix, testId }: { unix: bigint; testId?: string }) {
  const { t } = useTranslation();
  const state = lastCountState(unix);

  return (
    <Badge
      colorPalette={PALETTE[state]}
      variant="subtle"
      title={state === "never" ? undefined : formatUnixDate(unix)}
      data-testid={testId}
      data-state={state}
    >
      {state === "never" ? t("batchDetail.neverCounted") : formatUnixDateShort(unix)}
    </Badge>
  );
}
