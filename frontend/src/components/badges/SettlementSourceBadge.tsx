import { Badge, Icon } from "@chakra-ui/react";
import { FileSpreadsheet, Hand, ShoppingBag } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Where a settlement entry came from — the ledger's `source_type`. */
export type SettlementSource = "importer" | "manual" | "order";

// The ONE colour and icon per source, so an entry's origin reads the same on the list and in the
// ledger (owner: *"sumber buat saja jadi badge"*). CATEGORICAL colour — it tells sources apart, it does
// not say good or bad — so it is a hue, not a status role. Manual stands out: nothing checks a typed
// amount, so who typed it is the control.
const META: Record<SettlementSource, { color: string; icon: LucideIcon }> = {
  importer: { color: "teal", icon: FileSpreadsheet },
  manual: { color: "orange", icon: Hand },
  order: { color: "gray", icon: ShoppingBag },
};

export const description =
  "Where a settlement entry came from, as a standard-coloured badge: Import (teal — the marketplace's statement), Manual (orange — typed by a person, and names who), Order (gray — posted when the order was placed or cancelled). The same badge on the settlement list and in an order's ledger.";

export function SettlementSourceBadge({
  source,
  actor,
}: {
  source: SettlementSource;
  /** Who typed it — shown on a MANUAL entry, where it is the whole point. */
  actor?: string;
}) {
  const { t } = useTranslation();
  const { color, icon } = META[source];

  return (
    <Badge size="sm" colorPalette={color} data-testid={`source-badge-${source}`}>
      <Icon as={icon} boxSize="3" />
      {t(`orderSettlement.source.${source}`)}
      {source === "manual" && actor ? ` · ${actor}` : null}
    </Badge>
  );
}
